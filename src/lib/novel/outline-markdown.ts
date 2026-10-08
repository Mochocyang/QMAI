import { parseFrontmatter } from "@/lib/frontmatter"

function withSingleTrailingNewline(value: string): string {
  const trimmed = value.trim()
  return trimmed ? `${trimmed}\n` : ""
}

/**
 * 只有真正贴在**文首**的 `---…---` 才算大纲的 frontmatter。
 *
 * 为什么要自己先卡一道，而不是直接把内容交给 parseFrontmatter：
 * 它除了文首的严格匹配，还有一条"容错"分支——去正文里找第一个 `---…---` 对，
 * 只要开头那个 `---` 落在前 6 行内（`MAX_PREFIX_LINES_BEFORE_FRONTMATTER`）就认。
 * 而「# 标题 / > 说明 / --- / 正文」恰恰是大纲文档最常见的写法，那个 `---`
 * 是**分隔线**不是 frontmatter 围栏。实测（E:\高人一等\修改方案\00-设定集.md）：
 * 分隔线正好落在第 6 行，判断是 `lineNumberAt() > 6` → `6 > 6` 为假，于是放行，
 * 标题、`> 用途` 说明、以及到下一个 `---` 为止的一整节（`## 0. 定位` 表格和
 * 三条全书纪律）全被当成 frontmatter 切掉了。
 *
 * 更隐蔽的是那段内容根本解析不成 YAML（frontmatter 回来是 null），
 * 但 parseFrontmatter 在 YAML 解析失败时**仍然返回切过的 body**，而调用方只取 body，
 * 于是 727 个字符的真实内容静默消失：导入后文件从 427 行变 404 行，
 * 正文直接从 `## 1. 金手指` 开始。实测把原文过一遍 buildPureOutlineMarkdown，
 * 产物与盘上那份被导入的文件逐字节相同（16684 == 16684）。
 *
 * 大纲的 frontmatter 永远是应用自己写在文首的，所以这里只认文首。
 * 代价是放弃了"围栏前还夹了一两行垃圾"的容错：那种内容不会被剥掉，
 * 但会原样留在正文里。这个取舍是有意的——那个容错恰恰就是吞掉真实正文的元凶，
 * 宁可让垃圾可见，也不能让正文静默消失。
 */
const OUTLINE_FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n/

export function stripOutlineFrontmatter(content: string): string {
  // 文首没有围栏就直接原样返回：交给 parseFrontmatter 会走进上面那条容错分支，
  // 把正文里当分隔线用的 `---` 误判成 frontmatter。没有 frontmatter 时
  // parseFrontmatter 的 body 本来就等于入参，所以这里与旧行为等价。
  if (!OUTLINE_FRONTMATTER_RE.test(content)) return withSingleTrailingNewline(content)
  return withSingleTrailingNewline(parseFrontmatter(content).body)
}

export function buildPureOutlineMarkdown(title: string, content: string): string {
  const body = stripOutlineFrontmatter(content).trim()
  if (/^#\s+\S/m.test(body) && body.match(/^#\s+\S/m)?.index === 0) {
    return `${body}\n`
  }

  const cleanTitle = title.trim()
  if (!cleanTitle) return body ? `${body}\n` : ""
  return body ? `# ${cleanTitle}\n\n${body}\n` : `# ${cleanTitle}\n`
}
