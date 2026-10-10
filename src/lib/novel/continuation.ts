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
