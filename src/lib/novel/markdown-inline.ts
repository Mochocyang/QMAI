/**
 * 反推 Markdown 时的行内转义。
 *
 * 背景：结构化-only 之后 `.md` 全部由数据反推，模型给的每个字段都是**一段自由文本**，
 * 里面完全可能有换行、以 `- ` / `#` 开头的行、`|`、反斜线。反推器如果原样拼进
 * `- 字段：值` 或表格单元格，解析回来就换了结构：
 *
 * ```
 * { label: "带列表符", text: "- 甲\n- 乙" }
 * →  - 带列表符：- 甲
 *    - 乙                 ← 被当成第二条，字段被撕成两条
 * ```
 *
 * 这里是四类反推（档案 / 卷纲 / 章纲 / 细纲）共用的唯一实现，避免各自写一份又漏。
 */

/** 换行拍平成单行：行内文本没有「多行」这个概念，留着只会改变结构。 */
function flatten(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
}

/**
 * 列表项正文（`- xxx` 里 xxx 的位置）。
 *
 * 1. 换行拍平；
 * 2. 反斜线翻倍 —— 解析侧会无条件反转义 `\\` / `\|`，不先翻倍就会少一个
 *    （`C:\path\|x` 反推再解析回来变成 `C:\path|x`）；
 * 3. 以 `- ` `* ` `#` `>` `1. ` 开头的段落会被解析器当成**另一个**条目或标题，
 *    加一个反斜线转义（必须在第 2 步之后，否则新加的反斜线也会被翻倍）。
 */
export function markdownInline(value: string): string {
  return flatten(value)
    .replace(/\\/g, "\\\\")
    .replace(/^([#>*+-])(\s)/, "\\$1$2")
    // 数字序号要转义点号而不是数字：`\1. 己` 里的 `\1` 不是 Markdown 转义，
    // 解析器会把它当字面反斜线加数字，反而多出一个字符。
    .replace(/^(\d+)([.)])(\s)/, "$1\\$2$3")
}

/**
 * 表格单元格：反斜线要先翻倍，否则 `\|` 在 GFM 里会先还原成 `\` 再切开列。
 * 只做换行与竖线/反斜线处理，不做行首记号转义（单元格里不存在列表语义）。
 */
export function escapeMarkdownCell(value: string): string {
  return flatten(value)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
}

/** 上两个函数的逆运算：还原 `\X` 形态的转义（`\|` `\\` `\-` `\#` …）。 */
export function unescapeMarkdownInline(value: string): string {
  return value.replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, "$1")
}
