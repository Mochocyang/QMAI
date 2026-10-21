import { streamChat } from "@/lib/llm-client"
import {
  CHAPTER_DISCUSS_REPAIR_MAX_TOKENS,
  CHAPTER_DISCUSS_TOPUP_MAX_TOKENS,
  buildChapterDiscussRepairMessages,
  buildChapterDiscussTopUpMessages,
  hasChapterDiscussRepairableContent,
  parseChapterDiscussProtocol,
  validateChapterDiscussProtocol,
  type ChapterDiscussProtocol,
} from "./chapter-discuss-protocol"
import { repairJsonProtocolWithAi } from "./discuss-protocol-shared"

interface RepairChapterDiscussProtocolOptions {
  content: string
  module: string
  llmConfig: Parameters<typeof streamChat>[0]
  signal: AbortSignal
  maxTokens?: number
  stream?: typeof streamChat
}

/**
 * 章节共创「补协议」：模型只给了推演正文、没给 chapter_discuss 协议块时，
 * 用一次便宜的确定性调用把它已经表达出的判断与方向转写成协议。
 *
 * 与大纲侧行为一致：只转写、不创作；失败时抛出原始错误，不伪装成空修复。
 * 底层修复轮机械见 discuss-protocol-shared。
 */
export async function repairChapterDiscussProtocolWithAi(
  options: RepairChapterDiscussProtocolOptions,
): Promise<string> {
  return repairJsonProtocolWithAi({
    messages: buildChapterDiscussRepairMessages({
      content: options.content,
      module: options.module,
    }),
    maxTokens: options.maxTokens ?? CHAPTER_DISCUSS_REPAIR_MAX_TOKENS,
    llmConfig: options.llmConfig,
    signal: options.signal,
    stream: options.stream,
  })
}

interface TopUpChapterDiscussProtocolOptions extends Omit<RepairChapterDiscussProtocolOptions, "content"> {
  /** 已解析出的协议；JSON 坏掉时传 null，让模型据此重建。 */
  protocol: ChapterDiscussProtocol | null
  /** 闸门给出的失败原因，原样进提示词。 */
  error: string
  content?: string
}

/**
 * 章节共创「补齐」：协议**已经解析出来**但没通过代码闸门（介绍太短、缺标题、
 * 故事类型重复、方向数量不对、AI 推荐悬空）时，只让模型修这几处再输出一次。
 *
 * 与「补协议」的区别：补协议是"完全没有块"，补齐是"块有了但内容不达标"。
 * 后者如果直接重新生成整批，用户已经看到的标题/方向会全被换掉。
 */
export async function topUpChapterDiscussProtocolWithAi(
  options: TopUpChapterDiscussProtocolOptions,
): Promise<string> {
  return repairJsonProtocolWithAi({
    messages: buildChapterDiscussTopUpMessages({
      module: options.module,
      error: options.error,
      protocol: options.protocol,
      content: options.content,
    }),
    maxTokens: options.maxTokens ?? CHAPTER_DISCUSS_TOPUP_MAX_TOKENS,
    llmConfig: options.llmConfig,
    signal: options.signal,
    stream: options.stream,
  })
}

export interface ChapterDiscussGateResult {
  protocol: ChapterDiscussProtocol | null
  /** 校验没过但已放行时给用户的一句话（空串表示无需提示）。 */
  notice: string
  /** 完全拿不到协议时的原因（空串表示正常）。 */
  error: string
}

interface ResolveChapterDiscussProtocolOptions {
  text: string
  module: string
  llmConfig: Parameters<typeof streamChat>[0]
  signal: AbortSignal
  stream?: typeof streamChat
  /** 可注入，便于测试；默认走真实模型调用。 */
  repair?: typeof repairChapterDiscussProtocolWithAi
  topUp?: typeof topUpChapterDiscussProtocolWithAi
}

/**
 * 共创协议的「一次重试 + 宁可降级也不丢内容」策略。
 *
 * 用户口径（2026-10-21）：「共创时前面问了非常多的问题，后面要生成内容时出现格式无效，
 * 导致后面所有的内容都丢失了……第一次审查出现错误时自动补齐，第二次还失败就直接返回
 * 正常内容，不再审查；即便内容没有生成完全也要正常返回。」
 *
 * 于是这里按代价从低到高最多补两次（转写一次 + 补齐一次）、再降级：
 *   1. 解析通过且校验通过 → 直接用（最常见，零额外调用）。
 *   2. 没有协议块 → 「补协议」一轮（转写已有推演）；有块但 JSON 坏了 → 直接重建一次。
 *   3. 有块但校验不过 → 「补齐」一轮（只补不合格项）。
 *   4. 补完仍不过 → **把已经解析出来的协议原样放行**，附一句提示；
 *      完全解析不出来 → 返回 null + 原因，由调用方保留正文、不再拦生成。
 *
 * 绝不在这一步抛错：前面几轮对话与推演的 token 已经花掉了，丢掉它们才是最贵的。
 */
export async function resolveChapterDiscussProtocol(
  options: ResolveChapterDiscussProtocolOptions,
): Promise<ChapterDiscussGateResult> {
  const repair = options.repair ?? repairChapterDiscussProtocolWithAi
  const topUp = options.topUp ?? topUpChapterDiscussProtocolWithAi
  const shared = {
    module: options.module,
    llmConfig: options.llmConfig,
    signal: options.signal,
    stream: options.stream,
  }

  /** 解析 + 校验：通过则给出可用协议，否则给出原因（protocol 尽量保留）。 */
  const inspect = (text: string):
    | { ok: true; protocol: ChapterDiscussProtocol }
    | { ok: false; protocol: ChapterDiscussProtocol | null; reason: string } => {
    const outcome = parseChapterDiscussProtocol(text)
    if (outcome.kind === "none") return { ok: false, protocol: null, reason: "模型未返回 chapter_discuss 协议块" }
    if (outcome.kind === "invalid") return { ok: false, protocol: null, reason: outcome.error }
    const validation = validateChapterDiscussProtocol(outcome.protocol)
    if (validation.kind === "invalid") return { ok: false, protocol: outcome.protocol, reason: validation.error }
    return { ok: true, protocol: validation.protocol }
  }

  const first = inspect(options.text)
  if (first.ok) return { protocol: first.protocol, notice: "", error: "" }

  // 没有任何可解析的块：回复本身太短就没什么可补，别白花一次调用。
  if (!first.protocol) {
    if (options.text.trim().length < 80) return { protocol: null, notice: "", error: first.reason }
    // 1) 压根没有协议标记 → 「补协议」把已有推演转写成协议。
    if (hasChapterDiscussRepairableContent(options.text)) {
      const repairedText = await repair({ content: options.text, ...shared }).catch((error) => {
        console.warn("章节共创补协议失败，按原结果继续：", error instanceof Error ? error.message : error)
        return ""
      })
      const repaired = repairedText ? inspect(repairedText) : null
      if (repaired?.ok) return { protocol: repaired.protocol, notice: "", error: "" }
      if (repaired && repaired.protocol) {
        return { protocol: repaired.protocol, notice: `已按现有内容展示（${repaired.reason}）。`, error: "" }
      }
    }
    // 2) 有标记但 JSON 坏了 → 让「补齐」据原文重建一次；再不行才报错。
    const rebuilt = await topUp({
      protocol: null,
      error: first.reason,
      content: options.text,
      ...shared,
    }).catch(() => "")
    if (rebuilt) {
      const afterRebuild = inspect(rebuilt)
      if (afterRebuild.ok) return { protocol: afterRebuild.protocol, notice: "", error: "" }
    }
    return { protocol: null, notice: "", error: first.reason }
  }

  // 有块但校验不过：只补一次不合格项；仍不过就原样放行，绝不丢内容。
  const topped = await topUp({
    protocol: first.protocol,
    error: first.reason,
    content: options.text,
    ...shared,
  }).catch((error) => {
    console.warn("章节共创补齐失败，按现有内容继续：", error instanceof Error ? error.message : error)
    return ""
  })
  if (topped) {
    const afterTopUp = inspect(topped)
    if (afterTopUp.ok) return { protocol: afterTopUp.protocol, notice: "", error: "" }
  }
  return { protocol: first.protocol, notice: `已按现有内容展示（${first.reason}）。`, error: "" }
}
