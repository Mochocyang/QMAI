/**
 * AI 手写网页的安全与美观约束。
 *
 * 敏感内容分析结论（写在这里便于以后复查）：
 * - 生成阶段喂给模型的上下文里**没有** API Key / 令牌（provider 配置不进提示词）；
 * - 但模型能看到项目名、记忆库内容、用户粘贴的设定，因此**输出侧必须兜底**：
 *   绝对路径与常见密钥前缀打码，脚本与外链一律删除；
 * - 预览 iframe 是 sandbox="allow-same-origin"（无 allow-scripts），脚本跑不起来，
 *   但文件会落盘、还可能被云同步，用浏览器直接打开时会执行 —— 所以保存前就要清洗。
 */
import { describe, expect, it } from "vitest"

import { auditAiHtml, sanitizeAiHtml } from "./ai-html-safety"

const page = (body: string, style = "body{margin:0}") =>
  `<!DOCTYPE html><html><head><style>${style}</style></head><body>${body}</body></html>`

describe("sanitizeAiHtml：安全", () => {
  it("删掉 script（成对与自闭合都处理）", () => {
    const result = sanitizeAiHtml(page("<script>alert(1)</script><h1>标题</h1><script src=\"x.js\"></script>"))
    expect(result.html).not.toContain("<script")
    expect(result.html).not.toContain("alert(1)")
    expect(result.report.removedTags).toContain("script")
  })

  it("删掉事件属性与 javascript: 链接", () => {
    const result = sanitizeAiHtml(page('<h1 onclick="steal()">标题</h1><a href="javascript:alert(1)">x</a>'))
    expect(result.html).not.toContain("onclick")
    expect(result.html).not.toContain("javascript:")
  })

  it("删掉外链资源（字体/图片/样式表），保证离线可用", () => {
    const result = sanitizeAiHtml(
      page('<img src="https://cdn.example.com/a.png"><link rel="stylesheet" href="https://cdn.example.com/a.css"><h1>标题</h1>'),
    )
    expect(result.html).not.toContain("cdn.example.com")
    expect(result.report.removedTags).toContain("link")
  })

  it("打码本机绝对路径", () => {
    const result = sanitizeAiHtml(page("<h1>标题</h1><p>项目在 C:\\QM-BOOK\\黑雨之下\\wiki</p>"))
    expect(result.html).not.toContain("QM-BOOK")
    expect(result.html).toContain("本机路径已隐藏")
    expect(result.report.maskedPaths).toBeGreaterThan(0)
  })

  it("打码疑似 API Key", () => {
    const result = sanitizeAiHtml(page("<h1>标题</h1><p>sk-abcdef1234567890 与 ghp_abcdefghij1234</p>"))
    expect(result.html).not.toContain("sk-abcdef1234567890")
    expect(result.html).not.toContain("ghp_abcdefghij1234")
    expect(result.report.maskedSecrets).toBe(2)
  })

  it("正常内容不被误伤", () => {
    const html = page("<h1>世界观</h1><p>大玄界靠灵脉修行。</p>")
    const result = sanitizeAiHtml(html)
    expect(result.html).toContain("大玄界靠灵脉修行。")
    expect(result.report.maskedPaths).toBe(0)
    expect(result.report.maskedSecrets).toBe(0)
  })
})

describe("auditAiHtml：美观体检", () => {
  it("只有一张表格时判为不合格（用户反馈的形态）", () => {
    const html = page(
      "<table><tr><th>境界</th><th>标志</th></tr><tr><td>淬体</td><td>洗练筋骨</td></tr></table>",
      "table{border-collapse:collapse}th{padding:4px}td{padding:4px}",
    )
    const report = auditAiHtml(html)
    expect(report.ok).toBe(false)
    expect(report.problems.join()).toContain("只有表格")
  })

  it("没有 style / h1 / 分区的裸页面判为不合格", () => {
    const report = auditAiHtml("<html><body><p>纯文本</p></body></html>")
    expect(report.ok).toBe(false)
    expect(report.problems.join()).toContain("没有内联样式表")
    expect(report.problems.join()).toContain("没有 <h1>")
  })

  it("结构完整的页面判为合格", () => {
    const html = page(
      [
        "<h1>世界观总纲</h1>",
        "<section><h2>一句话世界观</h2><p>靠灵脉修行。</p></section>",
        "<section><h2>地理层级</h2><ul><li>青岚城</li><li>云梦州</li></ul></section>",
        "<section><h2>修行体系</h2><p>九境九重。</p></section>",
      ].join(""),
      ":root{--ink:#1f2937}body{color:var(--ink);line-height:1.8}h1{font-size:2rem}h2{font-size:1.2rem}section{padding:24px}",
    )
    const report = auditAiHtml(html)
    expect(report.problems).toEqual([])
    expect(report.ok).toBe(true)
  })
})
