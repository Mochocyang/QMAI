import { describe, expect, it } from "vitest"

import {
  formatNovelBody,
  normalizeNovelParagraphs,
  normalizeParagraphIndent,
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

  it("段首全角空格转成等宽半角空格，保留缩进习惯", () => {
    expect(normalizeParagraphIndent("\u3000\u3000杨寒收回手。")).toBe("    杨寒收回手。")
    // 正文中间的全角空格不动
    expect(normalizeParagraphIndent("杨寒\u3000收回手")).toBe("杨寒\u3000收回手")
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
    expect(output.startsWith("    Titlen")).toBe(true)
  })

  it("空输入与纯空白不会炸", () => {
    expect(formatNovelBody("")).toBe("")
    expect(formatNovelBody("   \n\n  ")).toBe("   \n\n  ")
  })
})
