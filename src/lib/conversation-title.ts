/**
 * 会话标题的**派生**规则。
 *
 * 此前两处会话 store 都把首条用户消息直接 `slice(0, 50)` 当标题
 * （`chat-store.ts` 章节会话、`outline-chat-store.ts` 大纲会话），
 * 于是标题栏里挂着两行没头没尾的正文，既难看又认不出是哪个会话。
 *
 * 这里用**本地规则**派生一个短标题：优先在某个人们本来就会停顿的标点处断开，
 * 实在没有标点才硬截。不调模型——标题要即时可见，而且多一次 LLM 调用就多一种
 * 「标题生成失败」的失败模式，不值得。
 */

/** 人们本来就会停顿的地方：句末、分句、顿开、换行。 */
const TITLE_BOUNDARY = /[。！？!?；;，,、：:\n\r]/

/** 比这更早就断开会失去辨识度（「帮我…」这种标题没有信息量）。 */
const MIN_TITLE_CHARS = 4

/** 短标题的默认长度上限。 */
export const CONVERSATION_TITLE_MAX_CHARS = 12

function finishTitle(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[\s。！？!?；;，,、：:…]+$/g, "")
    .trim()
}

/**
 * 把一段用户消息派生成短标题。
 *
 * 规则（按顺序）：
 * 1. 只折叠**横向**空白，保留换行——换行本身就是一个自然断点，先折叠掉它会
 *    让多行消息的第一行和第二行粘在一起（`- 甲\n- 乙` 会变成 `甲 - 乙`）。
 *    同时去掉行首的列表符号/引用符。取 `Array.from` 的字符数（emoji 安全）。
 * 2. 本来就不超长 → 去掉句末标点后原样用作标题。
 * 3. 在 `[MIN_TITLE_CHARS, maxLength]` 窗口内取**最靠后**的那个停顿标点断开：
 *    这样既不超过上限，又尽量多留内容，还正好落在一个自然的断句处。
 * 4. 窗口内没有标点 → 硬截到上限并加省略号，明确表示「被截断了」。
 *
 * 空字符串代表「派生不出标题」，调用方应保留原标题而不是写入空标题。
 */
export function deriveConversationTitle(
  text: string,
  maxLength = CONVERSATION_TITLE_MAX_CHARS,
): string {
  const flat = text
    .replace(/[^\S\n]+/g, " ")
    .replace(/^[\s\-*#>·•]+/, "")
    .trim()
  if (!flat) return ""

  const chars = Array.from(flat)
  if (chars.length <= maxLength) return finishTitle(chars.join(""))

  let cut = -1
  for (let index = MIN_TITLE_CHARS; index <= maxLength; index += 1) {
    if (TITLE_BOUNDARY.test(chars[index]!)) cut = index
  }
  if (cut > 0) return finishTitle(chars.slice(0, cut).join(""))

  return `${finishTitle(chars.slice(0, maxLength).join(""))}…`
}
