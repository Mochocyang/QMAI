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

export const CONTINUATION_POPOVER_WIDTH = 360
export const CONTINUATION_POPOVER_MAX_HEIGHT = 320
const CONTINUATION_POPOVER_GAP = 12

export interface ContinuationPopoverPosition {
  left: number
  top: number
}

/** 浮层里显示的「N 字」：与正文计数口径一致，去掉所有空白。 */
export function countContinuationChars(text: string): number {
  return text.replace(/\s/g, "").length
}

/**
 * 把浮层夹进视口。
 *
 * 做成纯函数（而不是在组件里量 DOM）有两个好处：能被直接单测；不必依赖
 * jsdom 里一堆返回 0 的 getBoundingClientRect。
 *
 * 优先放锚点**下方**：续写浮层是从「刚写完的那句话」触发的，压在正文上会
 * 挡住用户正要看的正文。下方放不下才翻到上方。
 *
 * 夹取用 `margin`（视口内缩）与 `CONTINUATION_POPOVER_GAP`（与锚点的距离）
 * 两个量：前者决定浮层离视口边缘多近，后者决定浮层离锚点多远，混用一个值
 * 会让「贴边」和「贴身」被迫取同一个数。
 */
export function clampContinuationPopoverPosition(
  anchor: { x: number; y: number },
  viewport: { width: number; height: number },
  size: { width: number; height: number } = {
    width: CONTINUATION_POPOVER_WIDTH,
    height: CONTINUATION_POPOVER_MAX_HEIGHT,
  },
  margin = 8,
): ContinuationPopoverPosition {
  const maxLeft = Math.max(margin, viewport.width - size.width - margin)
  const left = Math.min(Math.max(anchor.x - size.width / 2, margin), maxLeft)

  const below = anchor.y + CONTINUATION_POPOVER_GAP
  const above = anchor.y - size.height - CONTINUATION_POPOVER_GAP
  const top = below + size.height + margin <= viewport.height
    ? below
    : Math.max(margin, above)

  return { left, top }
}

/** 模型一个字都没吐出来时给用户看的话。 */
export const CONTINUATION_EMPTY_OUTPUT_MESSAGE = "续写失败：模型未返回正文"

/** 一次续写流是怎么结束的。 */
export type ContinuationFinishKind =
  /** 流正常结束。 */
  | "done"
  /** 用户按了「停止」（或切走导致中止）。 */
  | "aborted"
  /** 输出撞上 token 上限被截断。 */
  | "truncated"
  /** 真的失败了：网络、鉴权、模型报错等。 */
  | "failed"

export interface ContinuationFinishState {
  phase: "done" | "idle" | "error"
  /** 仅在 `phase === "error"` 时非空。 */
  errorMessage: string | null
}

/**
 * 流结束后该进哪个相位。
 *
 * 单抽成纯函数，是因为这段判断在组件里根本没法被验证（preview-panel 是
 * 两千多行的组件，没有组件测试），而它对应的两条真实路径都容易写反：
 *
 * 1. **用户按「停止」走的是 `onDone`，不是 `onError`。**
 *    llm-client 在 `isUserAbortError(err, signal)` 之后调的是 `onDone()`
 *    （见 llm-client.ts 流读取的 catch）。所以「没有正文」在中断时是正常
 *    结果 —— 一律报「模型未返回正文」是冤枉模型，也误导用户。
 * 2. **输出被截断走的是 `onError`（`buildOutputTruncatedError`）。**
 *    但它不是失败：那一刻已经有半截正文，进 error 相位会让浮层不渲染候选区，
 *    用户拿不到已经生成的内容。有半截就按 done 处理，让他自己决定插不插。
 *
 * 没有半截正文时，「截断」与「正常结束但为空」都算失败（模型确实没产出），
 * 而「中止」安静退回输入态（是用户自己的选择，不是错误）。
 */
export function resolveContinuationFinish(
  kind: ContinuationFinishKind,
  hasPartial: boolean,
  failureMessage = "",
): ContinuationFinishState {
  if (kind === "aborted") {
    return hasPartial
      ? { phase: "done", errorMessage: null }
      : { phase: "idle", errorMessage: null }
  }
  if (kind === "done" || kind === "truncated") {
    return hasPartial
      ? { phase: "done", errorMessage: null }
      : { phase: "error", errorMessage: CONTINUATION_EMPTY_OUTPUT_MESSAGE }
  }
  return { phase: "error", errorMessage: failureMessage }
}
