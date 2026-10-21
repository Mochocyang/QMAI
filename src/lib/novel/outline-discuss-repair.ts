import { streamChat } from "@/lib/llm-client"
import {
  OUTLINE_DISCUSS_REPAIR_MAX_TOKENS,
  OUTLINE_DISCUSS_TOPUP_MAX_TOKENS,
  buildOutlineDiscussRepairMessages,
  buildOutlineDiscussTopUpMessages,
  hasOutlineDiscussRepairableContent,
  parseOutlineDiscussProtocol,
  validateOutlineDiscussProtocol,
  type OutlineDiscussProtocol,
} from "./outline-discuss-protocol"
import { repairJsonProtocolWithAi } from "./discuss-protocol-shared"

interface RepairOutlineDiscussProtocolOptions {
  content: string
  module: string
  llmConfig: Parameters<typeof streamChat>[0]
  signal: AbortSignal
  maxTokens?: number
  stream?: typeof streamChat
}

/**
 * 共创讨论轮「补协议」：模型只给了正文、没给 outline_discuss 协议块时，
 * 用一次便宜的确定性调用把它已经表达出的判断与分歧转写成协议。
 *
 * 为什么值得多花这一次调用：没有协议块就没有待拍板卡片，整轮讨论等于白跑，
 * 而模型给出的判断往往是有价值的 —— 直接判死会把有价值的内容一起丢掉
 * （实测故障就是这样：一整卷大纲被判为「共创协议格式无效」）。
 *
 * 这里只转写、不创作；解析仍由调用方负责，修复失败不影响原有报错路径。
 * 底层修复轮机械已抽到 discuss-protocol-shared，与章节侧共用。
 */
export async function repairOutlineDiscussProtocolWithAi(
  options: RepairOutlineDiscussProtocolOptions,
): Promise<string> {
  return repairJsonProtocolWithAi({
    messages: buildOutlineDiscussRepairMessages({ content: options.content, module: options.module }),
    maxTokens: options.maxTokens ?? OUTLINE_DISCUSS_REPAIR_MAX_TOKENS,
    llmConfig: options.llmConfig,
    signal: options.signal,
    stream: options.stream,
  })
}

interface TopUpOutlineDiscussProtocolOptions extends Omit<RepairOutlineDiscussProtocolOptions, "content"> {
  protocol: OutlineDiscussProtocol | null
  error: string
  content?: string
}

/** 「补齐」：协议解析出来了但没过闸门，只补不合格项（提示词见协议模块）。 */
export async function topUpOutlineDiscussProtocolWithAi(
  options: TopUpOutlineDiscussProtocolOptions,
): Promise<string> {
  return repairJsonProtocolWithAi({
    messages: buildOutlineDiscussTopUpMessages({
      module: options.module,
      error: options.error,
      protocol: options.protocol,
      content: options.content,
    }),
    maxTokens: options.maxTokens ?? OUTLINE_DISCUSS_TOPUP_MAX_TOKENS,
    llmConfig: options.llmConfig,
    signal: options.signal,
    stream: options.stream,
  })
}

export interface OutlineDiscussGateResult {
  protocol: OutlineDiscussProtocol | null
  /** 校验没过但已放行时的说明（空串表示无需提示）。 */
  notice: string
  /** 完全拿不到协议时的原因（空串表示正常）。 */
  error: string
}

interface ResolveOutlineDiscussProtocolOptions {
  text: string
  module: string
  llmConfig: Parameters<typeof streamChat>[0]
  signal: AbortSignal
  stream?: typeof streamChat
  repair?: typeof repairOutlineDiscussProtocolWithAi
  topUp?: typeof topUpOutlineDiscussProtocolWithAi
}

/**
 * 大纲共创的「一次重试 + 宁可降级也不丢内容」策略（与章节侧同构）。
 *
 * 1. 解析 + 校验通过 → 直接用；
 * 2. 没有协议块 → 补协议一轮（转写已有判断）；
 * 3. 有块但校验不过 → 补齐一轮（只补可选项/倾向）；
 * 4. 补完仍不过 → 原样放行已解析出的协议并给出说明；完全解析不出来才报错。
 *
 * 绝不因为"格式不够完美"就把整轮讨论作废：前面几轮问答的 token 已经花掉了。
 */
export async function resolveOutlineDiscussProtocol(
  options: ResolveOutlineDiscussProtocolOptions,
): Promise<OutlineDiscussGateResult> {
  const repair = options.repair ?? repairOutlineDiscussProtocolWithAi
  const topUp = options.topUp ?? topUpOutlineDiscussProtocolWithAi
  const shared = {
    module: options.module,
    llmConfig: options.llmConfig,
    signal: options.signal,
    stream: options.stream,
  }

  const inspect = (text: string):
    | { ok: true; protocol: OutlineDiscussProtocol }
    | { ok: false; protocol: OutlineDiscussProtocol | null; reason: string } => {
    const outcome = parseOutlineDiscussProtocol(text)
    if (outcome.kind === "none") {
      return { ok: false, protocol: null, reason: "模型未返回 outline_discuss 协议块" }
    }
    if (outcome.kind === "invalid") return { ok: false, protocol: null, reason: outcome.error }
    const validation = validateOutlineDiscussProtocol(outcome.protocol)
    if (validation.kind === "invalid") return { ok: false, protocol: outcome.protocol, reason: validation.error }
    return { ok: true, protocol: validation.protocol }
  }

  const first = inspect(options.text)
  if (first.ok) return { protocol: first.protocol, notice: "", error: "" }

  if (!first.protocol) {
    if (options.text.trim().length < 80) return { protocol: null, notice: "", error: first.reason }
    // 1) 压根没有协议标记 → 「补协议」把已有判断转写成协议。
    if (hasOutlineDiscussRepairableContent(options.text)) {
      const repairedText = await repair({ content: options.text, ...shared }).catch((error) => {
        console.warn("大纲共创补协议失败，按原结果继续：", error instanceof Error ? error.message : error)
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

  const topped = await topUp({
    protocol: first.protocol,
    error: first.reason,
    content: options.text,
    ...shared,
  }).catch((error) => {
    console.warn("大纲共创补齐失败，按现有内容继续：", error instanceof Error ? error.message : error)
    return ""
  })
  if (topped) {
    const afterTopUp = inspect(topped)
    if (afterTopUp.ok) return { protocol: afterTopUp.protocol, notice: "", error: "" }
  }
  return { protocol: first.protocol, notice: `已按现有内容展示（${first.reason}）。`, error: "" }
}
