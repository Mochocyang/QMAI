import { describe, expect, it, vi } from "vitest"
import { createReadWebPageTool } from "./read-web-page"

describe("createReadWebPageTool", () => {
  it("拒绝非 http/https 地址并返回中文错误", async () => {
    const tool = createReadWebPageTool({
      fetchPage: vi.fn(),
    })

    const raw = await tool.execute({ url: "file:///C:/secret.txt" })
    const result = JSON.parse(raw)

    expect(result.status).toBe("error")
    expect(result.message).toContain("只支持 http 或 https")
  })

  it("读取 HTML 时移除脚本、样式和标签，并保留标题", async () => {
    const tool = createReadWebPageTool({
      fetchPage: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => "text/html; charset=utf-8" },
        text: async () => `
          <html>
            <head><title>黄蓉资料</title><style>.x{color:red}</style></head>
            <body><script>alert(1)</script><h1>黄蓉</h1><p>桃花岛主黄药师之女。</p></body>
          </html>
        `,
      }),
    })

    const raw = await tool.execute({ url: "https://example.com/huang-rong" })
    const result = JSON.parse(raw)

    expect(result.status).toBe("ok")
    expect(result.title).toBe("黄蓉资料")
    expect(result.content).toContain("黄蓉")
    expect(result.content).toContain("桃花岛主黄药师之女。")
    expect(result.content).not.toContain("alert")
    expect(result.content).not.toContain(".x")
  })

  it("正文超过 maxChars 时截断并标记 truncated", async () => {
    const tool = createReadWebPageTool({
      fetchPage: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => "text/plain" },
        text: async () => "一二三四五六七八九十",
      }),
    })

    const raw = await tool.execute({ url: "https://example.com/text", maxChars: 4 })
    const result = JSON.parse(raw)

    expect(result.status).toBe("ok")
    expect(result.content).toBe("一二三四")
    expect(result.truncated).toBe(true)
    expect(result.message).toContain("已截断")
  })
})
