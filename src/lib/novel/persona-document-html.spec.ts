import { describe, expect, it } from "vitest"
import { renderPersonaDocumentHtml } from "./persona-document-html"

/**
 * 人物 MD 视图要与卷纲 / 章纲的 HTML 预览**同一种观感**：
 * 文档型排版（居中限宽、衬线标题、字段名加粗后接正文）。
 *
 * 所以这里断言的是「结构与排版约定」，而不是像素：
 * 有没有 .doc 居中容器、有没有字段行、空字段是否收进文末汇总。
 */
describe("renderPersonaDocumentHtml", () => {
  const base = {
    characterName: "杨寒",
    roleType: "主角",
    fields: {
      性别: "男",
      怎么说话: "短句，爱反问。",
      关系网: "沈砚：旧识（互相提防）",
    } as Record<string, string>,
  }

  it("输出完整 HTML 文档并自带排版样式", () => {
    const html = renderPersonaDocumentHtml(base)
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("<style>")
    // 居中限宽的容器 + 衬线标题：与卷纲文档同一套观感
    expect(html).toContain('class="doc"')
    expect(html).toContain("max-width: 880px")
    expect(html).toContain("Songti SC")
  })

  it("标题与字段行按文档格式排布", () => {
    const html = renderPersonaDocumentHtml(base)
    expect(html).toContain("<h1>杨寒 · 人物 Skill</h1>")
    expect(html).toContain("主角")
    // 字段名加粗 + 正文
    expect(html).toContain("<b>怎么说话：</b>")
    expect(html).toContain("短句，爱反问。")
    expect(html).toContain("<b>关系网：</b>")
  })

  it("没填的字段收进文末一行，名字一个不少", () => {
    const html = renderPersonaDocumentHtml(base)
    expect(html).toContain('class="empty-note"')
    expect(html).toContain("还没填的字段")
    expect(html).toContain("外貌")
    expect(html).toContain("知道局限")
  })

  it("内容里的尖括号被转义，不会冲掉文档结构", () => {
    const html = renderPersonaDocumentHtml({
      characterName: "甲<b>乙</b>",
      fields: { 怎么说话: "<script>alert(1)</script>" },
    })
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("甲&lt;b&gt;乙&lt;/b&gt;")
  })
})
