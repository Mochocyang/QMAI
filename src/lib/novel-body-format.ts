/**
 * 中文小说正文的渲染前处理。
 *
 * 为什么需要它：AI 写出来的章节是「一行一段、段间没有空行」的中文排版习惯，
 * 而 Markdown 规范里**单个换行只是软换行**，会被合并进同一个 `<p>` ——
 * 于是 30 段正文在聊天框里挤成一坨，完全没法读（真实投诉）。
 *
 * 解法不是「让模型改输出」，而是在渲染前把这种常见写法规范化：
 *   1. 非空行之间补空行 → 每行成为独立段落；
 *   2. 段首的中文全角空格（U+3000）转成 CSS 可表达的缩进，
 *      而不是把两个全角空格当成正文字符渲染出来；
 *   3. 不在代码块 / 列表 / 引用 / 表格 / 标题内部动手，
 *      否则会把 Markdown 结构拆坏。
 */

/** 这些行首都意味着「这是结构性 Markdown，不是小说正文」。 */
function isStructural(line: string): boolean {
  const trimmed = line.trimStart()
  return (
    trimmed.startsWith("#") ||
    trimmed.startsWith(">") ||
    trimmed.startsWith("-") ||
    trimmed.startsWith("* ") ||
    trimmed.startsWith("+ ") ||
    trimmed.startsWith("|") ||
    trimmed.startsWith("```") ||
    trimmed.startsWith("~~~") ||
    /^\d+[.)]\s/.test(trimmed) ||
    // 分隔线
    /^-{3,}$/.test(trimmed) ||
    /^\*{3,}$/.test(trimmed)
  )
}

/**
 * 把「一行一段」的中文正文转成 Markdown 里的独立段落。
 *
 * 判断"该不该补空行"的规则：
 *   · 相邻两行都非空、都不是结构性语法、都在代码块外 → 补一个空行；
 *   · 其余情况原样保留（已有的空行、表格、列表、代码块都不动）。
 */
export function normalizeNovelParagraphs(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  const out: string[] = []
  let inFence = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()

    // 围栏代码块整段跳过（里面的换行有意义）。
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }

    const previous = out.length > 0 ? out[out.length - 1] : null
    const previousIsBlank = previous === null || previous.trim() === ""
    const currentIsBlank = trimmed === ""

    /*
     * 只在「上一行是正文、这一行也是正文」时补空行。
     * 这样：
     *   · 已经有空行的段落不会被塞进多余空行（幂等）；
     *   · 列表项、表格行、引用不会被打散；
     *   · 标题后面不会多出空行。
     */
    if (
      !currentIsBlank &&
      !previousIsBlank &&
      previous !== null &&
      !isStructural(previous) &&
      !isStructural(line)
    ) {
      out.push("")
    }

    out.push(line)
  }

  return out.join("\n")
}

/**
 * 段首的全角空格（U+3000）统一成两个半角空格。
 *
 * 为什么不直接删：中文小说段首缩进是排版习惯，删了反而不好看。
 * 但 U+3000 在等宽/非等宽字体下宽度不稳定，转成半角空格 + CSS 控制更可靠。
 */
export function normalizeParagraphIndent(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      // 只处理段首的全角空格，正文中间的不动。
      const match = /^(\u3000+)(.*)$/.exec(line)
      if (!match) return line
      const halfWidth = " ".repeat(match[1].length * 2)
      return `${halfWidth}${match[2]}`
    })
    .join("\n")
}

/** 渲染前一步到位：先规范段落，再统一缩进。 */
export function formatNovelBody(markdown: string): string {
  return normalizeParagraphIndent(normalizeNovelParagraphs(markdown))
}
