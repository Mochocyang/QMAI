/**
 * 「上一轮生成失败」这件事的单一判定源。
 *
 * 两个面板（章节的 chat-panel、大纲的 outline-chat-panel）在请求失败时都会把
 * 一句错误提示**追加到助手消息正文里**，消息对象上并没有 `error` 标志位：
 *
 *   章节面板：
 *     `${已生成内容}\n\n出错：${message}`   或   `出错：${message}`
 *   大纲面板（有半截内容）：
 *     `${已生成内容}\n\n---\n\n⚠️ 生成中断：${message}`
 *   大纲面板（一个字都没生成）：
 *     `生成失败：${message}`
 *
 * 所以「这条消息是不是失败了」只能靠正文判定 —— 和 stopped-generation.ts 里
 * 「已停止生成」的做法完全一致。判定必须有唯一实现，否则两个面板迟早会对
 * "什么样算失败"产生分歧，再长出两套不一样的按钮。
 *
 * ⚠️ 三处标记的**分隔符不同**：大纲的中断提示前面带一条 `---`，复制成统一的
 * `\n\n` 去匹配会永远匹配不上（这正好会让"有半截内容的大纲失败"识别不出来，
 * 而那是最需要「继续」的一类）。所以每个标记自带它真实的前导分隔符。
 */

const FAILURE_ENTRIES = [
  /** 章节面板：错误追加在已生成内容之后，或者整条只有这一句。 */
  { marker: "出错：", separator: "\n\n" },
  /** 大纲面板：一个字都没生成时，正文只有这一句。 */
  { marker: "生成失败：", separator: "\n\n" },
  /** 大纲面板：保留了半截内容时的中断提示。 */
  { marker: "⚠️ 生成中断：", separator: "\n\n---\n\n" },
] as const

/** 点「重试」时的无障碍与悬停文案；与停止生成那对按钮保持同名。 */
export const FAILED_GENERATION_RETRY_LABEL = "重试"

/** 点「继续」时的无障碍与悬停文案。 */
export const FAILED_GENERATION_CONTINUE_LABEL = "继续"

/**
 * 点「继续」时发出的提示词。
 *
 * 与 CONTINUE_STOPPED_GENERATION_PROMPT 分开写是有意的：那一句说的是"被停止"，
 * 而失败有两种形态 —— 断在半截（要接着写）、什么都没产出（要整份重来）。
 * 同一句话没法覆盖这两种，模型在第二种情况下容易只回一句"好的，请提供内容"。
 */
export const FAILED_GENERATION_CONTINUE_PROMPT =
  "继续。上一条回复在生成中途中断了。如果上一条已经写出了部分内容，请从停下的位置接着往下写，不要重复已经生成过的内容；如果上一条完全没有产出，请按我最初的要求重新生成完整内容。不要解释中断原因，也不要输出任何过程说明，直接输出正文或大纲。"

/**
 * 失败提示在正文里的起始下标；不是失败消息则返回 -1。
 *
 * 用 `lastIndexOf`：失败提示是**收尾追加**的，正文里偶尔出现的同名字句
 * （比如模型自己写了"出错："）不该被当成收尾标记。取最靠后的那一处，
 * 剩下的前缀才是真正已生成的内容。
 */
function findFailureStart(content: string): number {
  let start = -1
  for (const { marker, separator } of FAILURE_ENTRIES) {
    if (content.startsWith(marker)) return 0
    const index = content.lastIndexOf(separator + marker)
    if (index > start) start = index
  }
  return start
}

/** 这条助手消息是不是「生成失败」。 */
export function isFailedGenerationMessage(content: string | undefined | null): boolean {
  if (!content) return false
  return findFailureStart(content) !== -1
}

/**
 * 剥掉失败提示后剩下的、真正已生成的内容（可能为空串）。
 *
 * 「继续」能不能用取决于它：一个字都没产出时，"接着写"没有可接的地方。
 */
export function failedGenerationPartialContent(content: string | undefined | null): string {
  if (!content) return ""
  const start = findFailureStart(content)
  return start === -1 ? content : content.slice(0, start)
}

/** 失败前是否已经产出了可用内容。 */
export function hasFailedGenerationPartialContent(content: string | undefined | null): boolean {
  return failedGenerationPartialContent(content).trim().length > 0
}
