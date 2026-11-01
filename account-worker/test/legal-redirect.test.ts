import { describe, expect, it } from "vitest"

import { privacyPage, termsPage } from "../src/legal"

/**
 * 条款页只做跳转，不再在这里维护正文。
 *
 * 背景：这里原本内嵌一份完整条款 HTML。条款改到 v1.1（补责任上限矛盾、
 * 泄露免责、跨境披露、未成年人专规）后发布在 Cloudflare Pages，
 * 这份内嵌副本没跟着改 —— 于是同一个网站同时存在**两份冲突的对外条款**：
 * qmai.pro/terms 是无版本号的旧文本，pages.dev 是 v1.1。
 * 用户在哪个入口看到哪一版取决于他从哪进来，出争议时对方可以直接指出这一点。
 *
 * 现在只保留 301 跳转，唯一事实来源是 Pages 站点的 terms.md / privacy.md。
 * 这组用例锁住「跳转目标正确」与「不再返回内嵌正文」。
 */

const LEGAL_SITE = "https://qmai-legal.pages.dev"

describe("条款页面跳转", () => {
  it("隐私政策跳转到 Pages 站点的 #privacy", () => {
    const response = privacyPage()
    expect(response.status).toBe(301)
    expect(response.headers.get("Location")).toBe(`${LEGAL_SITE}/#privacy`)
  })

  it("服务条款跳转到 Pages 站点的 #terms", () => {
    const response = termsPage()
    expect(response.status).toBe(301)
    expect(response.headers.get("Location")).toBe(`${LEGAL_SITE}/#terms`)
  })

  it("不再返回内嵌的条款正文：响应体只有一行提示", async () => {
    const body = await privacyPage().text()
    // 旧实现会返回整页 HTML（几 KB），现在只该是一句纯文本。
    expect(body.length).toBeLessThan(200)
    expect(body).not.toContain("<html")
    expect(body).not.toContain("<h1")
  })

  it("两个入口的跳转目标不同，不会互相串", () => {
    expect(privacyPage().headers.get("Location")).not.toBe(termsPage().headers.get("Location"))
  })
})
