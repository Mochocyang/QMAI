import { formatChapterWriting } from "@/lib/chapter-formatting"
import type { ChatMessage } from "@/lib/llm-providers"

/** 续写目标字数：提示词里的软目标，不做硬截断（用户原话「300 到 400 字左右」）。 */
export const CONTINUATION_TARGET_MIN_CHARS = 300
export const CONTINUATION_TARGET_MAX_CHARS = 400

/**
 * 送模正文上限。
 *
 * 超过就只送「开头 + 结尾」：用户要的是「能读到当前章节的内容，不需要读取
 * 全部内容」——整章 8000 字以内全送，超过就掐掉中段。掐中间而不是掐尾巴，
 * 是因为续写要接的是**结尾**的语气与动作，尾部绝不能丢。
 *
 * 注意 head + tail 正好等于本上限，而截断标记是额外加的：正文长度在
 * 8001–8017 之间时，截断后的输出会比原文略长一点点（输出恒为 8017）。
 * 这是刻意的 —— 标记本身必须完整可见，且输出仍被硬限制住。
 */
export const CONTINUATION_SOURCE_LIMIT_CHARS = 8000
export const CONTINUATION_SOURCE_HEAD_CHARS = 2000
export const CONTINUATION_SOURCE_TAIL_CHARS = 6000

export const CONTINUATION_TRUNCATION_MARK = "\n……（正文过长，此处省略）……\n"

/**
 * 输出上限，刻意宽松（约为目标字数的 5 倍）。
 *
 * 带思考的模型把思考 token 也算进这个额度，卡到 400 字对应的量级会让输出
 * 整段被截掉、用户拿到空结果。真正的字数控制交给提示词，这里只防跑飞。
 */
export const CONTINUATION_MAX_TOKENS = 2000
/** 续写要的是「接着写下去」而不是「最可能的下一句」，略高于默认值。 */
export const CONTINUATION_TEMPERATURE = 0.8

/** 输入框留空时，明确告诉模型「自行判断」，而不是丢一段空白让它猜。 */
export const CONTINUATION_EMPTY_INSTRUCTION = "未指定方向，请自行判断合理的推进"

/** 续写的插入位置。 */
export interface ContinuationAnchor {
  /** 正文偏移（**不含** frontmatter，也不含 `# 标题` 行）。 */
  at: number
  /** 右击 / 选中那一刻的正文快照，写入前用来检测正文是否已变化。 */
  bodySnapshot: string
}

/**
 * 要求编辑器把光标移到某个偏移。
 *
 * 不能复用 `highlightRequest`：那个是按文本 `indexOf` 找位置的
 * （wiki-editor.tsx:277），正文里出现重复句子时会定位到错的地方。
 */
export interface PendingEditorCaret {
  /** 目标光标偏移（正文偏移）。 */
  at: number
  /**
   * 变更计数。
   *
   * 光看 `at` 不够：连续两次插入可能算出同一个偏移，effect 的依赖数组判定
   * 「没变」就不重跑，光标会停在原地。带上 nonce 才能强制生效。
   */
  nonce: number
}

const CONTINUATION_SYSTEM_PROMPT = [
  "你是中文小说写作助手。任务：接着给定正文继续往下写。",
  "",
  `- 输出 ${CONTINUATION_TARGET_MIN_CHARS}–${CONTINUATION_TARGET_MAX_CHARS} 字。`,
  "- 只输出续写的正文。不要解释、不要复述已有内容、不要「好的」这类开场。",
  "- 承接最后一段的动作与情绪，自然衔接。",
  "- 保持人称、时态、叙事视角、文风、人物语气与给定正文一致。",
  "- 段落之间用一个换行分隔。不要自己加缩进，排版由应用统一处理。",
  "- 不要在结尾强行升华、总结或预告。",
].join("\n")

export function buildContinuationSource(body: string): string {
  if (body.length <= CONTINUATION_SOURCE_LIMIT_CHARS) return body
  return (
    body.slice(0, CONTINUATION_SOURCE_HEAD_CHARS)
    + CONTINUATION_TRUNCATION_MARK
    + body.slice(body.length - CONTINUATION_SOURCE_TAIL_CHARS)
  )
}

export function buildContinuationMessages(body: string, instruction: string): ChatMessage[] {
  const direction = instruction.trim() || CONTINUATION_EMPTY_INSTRUCTION
  const source = buildContinuationSource(body)
  const context = source.trim()
    ? `【本章已有正文】\n${source}`
    : "【本章已有正文】\n（本章正文为空，请从章首开始写。）"
  return [
    { role: "system", content: CONTINUATION_SYSTEM_PROMPT },
    { role: "user", content: `${context}\n\n【续写要求】\n${direction}` },
  ]
}

export type ContinuationInsertResult =
  | { ok: true; body: string; caret: number }
  | { ok: false; reason: "changed" | "empty" }

/**
 * 把续写片段插到正文的锚点上。
 *
 * 与润色 / 去AI味 的 `replaceChapterBodySelection` 是**两套语义**：那边替换、
 * 这边插入。刻意不合并 —— 合并后浮层要同时承担「输入框」与「原文对比」两种
 * 形态，谁也说不清某个字段属于哪一边。
 *
 * 插入规则只做一件事：让续写自成一段。刻意**不**做「把插入点所在的段落切开、
 * 挪到续写后面再拼回来」这类聪明事 —— 那在用户眼里就是「我的字被动过了」。
 */
export function insertContinuationBody(
  currentBody: string,
  anchor: ContinuationAnchor,
  continuation: string,
): ContinuationInsertResult {
  /*
   * 先排版、再判空 —— 顺序和写法都不能改。
   *
   * 段首缩进是两个全角空格（U+3000），而 String.prototype.trim() 会把 U+3000
   * 一起去掉（它属于 Unicode 空白）。所以这里**只能拿 trim() 的结果判空**，
   * 绝不能拿它去拼正文，否则缩进会被静默吃掉。
   */
  const snippet = formatChapterWriting(continuation)
  if (!snippet.trim()) return { ok: false, reason: "empty" }
  if (anchor.bodySnapshot !== currentBody) return { ok: false, reason: "changed" }

  const at = Math.max(0, Math.min(anchor.at, currentBody.length))
  const before = currentBody.slice(0, at)
  const after = currentBody.slice(at)
  const lead = before && !before.endsWith("\n") ? "\n" : ""
  const tail = after && !after.startsWith("\n") ? "\n" : ""
  return {
    ok: true,
    body: `${before}${lead}${snippet}${tail}${after}`,
    caret: before.length + lead.length + snippet.length,
  }
}

/** 浮层尺寸，用来在摆放位置时判断「放不放得下」。 */
export const CONTINUATION_POPOVER_WIDTH = 360
export const CONTINUATION_POPOVER_MAX_HEIGHT = 320
/** 浮层与视口边缘的最小间距。 */
export const CONTINUATION_POPOVER_GAP = 12

export interface ContinuationPopoverPosition {
  left: number
  top: number
}

/**
 * 把浮层摆进视口内。
 *
 * 收成纯函数、由调用方传入视口尺寸，是为了能在 node 环境里直接单测 —— 否则
 * 就得在 jsdom 里伪造 getBoundingClientRect，测的还是伪造出来的东西。
 *
 * 视口比浮层还小时 `max` 会拿到一个比 `min` 更大的下限：`Math.max(min, Math.min(...))`
 * 里 `Math.min` 先算出负值，再被 `Math.max` 抬回间隙处，所以结果不会是负数。
 */
export function clampContinuationPopoverPosition(
  left: number,
  top: number,
  viewport: { width: number; height: number },
): ContinuationPopoverPosition {
  const maxLeft = viewport.width - CONTINUATION_POPOVER_WIDTH - CONTINUATION_POPOVER_GAP
  const maxTop = viewport.height - CONTINUATION_POPOVER_MAX_HEIGHT - CONTINUATION_POPOVER_GAP
  return {
    left: Math.max(CONTINUATION_POPOVER_GAP, Math.min(left, maxLeft)),
    top: Math.max(CONTINUATION_POPOVER_GAP, Math.min(top, maxTop)),
  }
}

/**
 * 续写候选的字数。
 *
 * 与 `writing-stats.ts` 的计数字符口径保持一致：去掉全部空白（含全角空格
 * U+3000 —— 它是段首缩进，不该算进字数）。
 */
export function countContinuationChars(text: string): number {
  return text.replace(/\s/g, "").length
}
