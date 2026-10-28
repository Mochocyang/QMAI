/**
 * 新契约：HTML 由 AI 直接写完整网页，系统不再套任何模板。
 *
 * 旧行为（软件把结构化数据套进 skill 目录下的 template.html 渲染卡片流）已按要求删除，
 * 因此这里覆盖的是「网页怎么被取出来 / 什么算网页 / 没有网页时怎么办」。
 */
import { describe, expect, it } from "vitest"

import {
  attachOutlineHtml,
  extractHtmlBlocks,
  isCompleteHtmlDocument,
  type OutlineSaveRequest,
} from "./outline-save-request"

function page(title: string): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="zh-CN"><head><meta charset="UTF-8">',
    "<style>body{font-family:system-ui;max-width:1080px;margin:0 auto;padding:32px;line-height:1.8}</style>",
    `</head><body><h1>${title}</h1></body></html>`,
  ].join("")
}

function request(fileName = "世界观-总纲.md", fileType = "setting"): OutlineSaveRequest {
  return {
    targetFolder: "世界观设定",
    fileName,
    fileType,
    writeMode: "create",
    referencedSkills: [],
    sourceIntent: "生成世界观",
    content: "# 世界观总纲\n\n一句话世界观：大玄界靠灵脉修行。",
  } as OutlineSaveRequest
}

describe("AI 直接写网页", () => {
  it("AI 给了完整网页就挂到保存请求上（任何大纲类型都适用）", () => {
    const text = ["好的，已生成。", "", "```html", page("世界观总纲"), "```"].join("\n")
    const saved = attachOutlineHtml(request(), text)
    expect(saved.htmlContent).toContain("<!DOCTYPE html>")
    expect(saved.htmlContent).toContain("世界观总纲")
  })

  it("没给网页就不生成 HTML（不再套模板兜底）", () => {
    const saved = attachOutlineHtml(request(), "# 世界观总纲\n\n只有 Markdown，没有网页。")
    expect(saved.htmlContent).toBeUndefined()
  })

  it("只有代码片段、没有 doctype/html 的不算网页", () => {
    const text = ["```html", "<div class='card'>片段</div>", "```"].join("\n")
    const saved = attachOutlineHtml(request(), text)
    expect(saved.htmlContent).toBeUndefined()
  })

  it("请求里已带 htmlContent 时原样保留，不被文本里的围栏覆盖", () => {
    const provided = { ...request(), htmlContent: page("手写网页") }
    const saved = attachOutlineHtml(provided, "```html\n" + page("围栏网页") + "\n```")
    expect(saved.htmlContent).toContain("手写网页")
    expect(saved.htmlContent).not.toContain("围栏网页")
  })

  it("多个网页按出现顺序取出，调用方可按请求顺序配位", () => {
    const text = [
      "```html", page("第一个"), "```",
      "```json", '{"a":1}', "```",
      "```html", page("第二个"), "```",
    ].join("\n")
    const pages = extractHtmlBlocks(text)
    expect(pages).toHaveLength(2)
    expect(pages[0]).toContain("第一个")
    expect(pages[1]).toContain("第二个")
  })

  it("isCompleteHtmlDocument 只认完整文档", () => {
    expect(isCompleteHtmlDocument(page("完整"))).toBe(true)
    expect(isCompleteHtmlDocument("<html><body>x</body></html>")).toBe(true)
    expect(isCompleteHtmlDocument("<div>x</div>")).toBe(false)
    expect(isCompleteHtmlDocument("")).toBe(false)
  })
})
