import { describe, expect, it } from "vitest"

import {
  formatNovelBody,
  normalizeNovelParagraphs,
  stripParagraphIndent,
} from "./novel-body-format"

describe("中文正文段落规范化", () => {
  it("一行一段的中文正文会被拆成独立段落", () => {
    const input = "第一段内容。\n第二段内容。\n第三段内容。"
    // Markdown 里要成为独立段落，必须有空行分隔。
    expect(normalizeNovelParagraphs(input)).toBe(
      "第一段内容。\n\n第二段内容。\n\n第三段内容。",
    )
  })

  it("已经有空行分隔的正文不会被再塞空行（幂等）", () => {
    const input = "第一段。\n\n第二段。\n\n第三段。"
    expect(normalizeNovelParagraphs(input)).toBe(input)
    // 跑两遍结果一样。
    expect(normalizeNovelParagraphs(normalizeNovelParagraphs(input))).toBe(input)
  })

  it("段首全角空格必须删掉，绝不能变成 4 个半角空格", () => {
    /*
     * 这是上一版的真实 bug：2 个全角空格转成 4 个半角空格后，
     * Markdown 把它当成「缩进代码块」，每段正文都渲染成 <pre><code>
     * —— 等宽字体 + 灰色背景。
     */
    const stripped = stripParagraphIndent("\u3000\u3000杨寒收回手。")
    expect(stripped).toBe("杨寒收回手。")
    expect(stripped.startsWith(" ")).toBe(false)
  })

  it("正文中间的全角空格不动（那是内容，不是缩进）", () => {
    expect(stripParagraphIndent("杨寒\u3000收回手")).toBe("杨寒\u3000收回手")
  })

  it("更深的缩进（可能是真代码块）保留原样", () => {
    // 8 个半角空格：判定为"作者本来就想表达代码块"，不能拆。
    expect(stripParagraphIndent("        code line")).toBe("        code line")
  })

  it("不会打散列表、标题、引用与表格", () => {
    const input = [
      "# 第26章 顶格之名",
      "- 第一项",
      "- 第二项",
      "> 引用一句",
      "| 列1 | 列2 |",
    ].join("\n")
    const output = normalizeNovelParagraphs(input)
    expect(output).not.toContain("\n\n- 第一项")
    expect(output).not.toContain("\n\n> 引用")
    expect(output).not.toContain("\n\n| 列1")
  })

  it("代码块内部原样保留（换行有意义）", () => {
    const input = "说明：\n```\nline1\nline2\n```\n结尾。"
    const output = normalizeNovelParagraphs(input)
    expect(output).toContain("```\nline1\nline2\n```")
  })

  it("真实章节片段：多段变成一个一个独立段落", () => {
    const input = [
      "　　Titlen 废车场比诊所更偏，也更暗。",
      "　　成排的报废车辆像沉默的巨兽骨架。",
      "　　杨寒抱着林小满，每一步都尽量放轻。",
    ].join("\n")
    const output = formatNovelBody(input)
    // 每段前有缩进，段与段之间有空行。
    expect(output.split("\n\n")).toHaveLength(3)
    // 段首缩进交给 CSS，文本里不该再有前导空白（否则又会被当成代码块）。
    expect(output.startsWith("Titlen")).toBe(true)
  })

  it("空输入不会炸；纯空白的「段」会被清掉（否则又变成 4 空格缩进）", () => {
    expect(formatNovelBody("")).toBe("")
    // 只有空白字符的行等同于空行，不该保留缩进空格。
    expect(formatNovelBody("   \n\n  ")).toBe("\n\n")
  })
})
