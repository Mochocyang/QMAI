/**
 * 隐私政策与服务条款页面的**跳转入口**。
 *
 * ── 为什么改成跳转，而不是继续在这里维护正文 ──
 *
 * 这里原本内嵌了一份完整的条款 HTML。问题在于：条款后来又做了一轮修订
 * （v1.1，补齐了责任上限矛盾、泄露免责、跨境披露、未成年人专规等），
 * 新版本发布在 Cloudflare Pages（qmai-legal.pages.dev），这份内嵌副本没跟上 ——
 * 于是**同一个网站同时存在两份冲突的对外条款**：
 *   · qmai.pro/terms、qmai.pro/privacy → 无版本号、生效日 2026-10-29 的旧文本
 *   · qmai-legal.pages.dev            → 带版本号 v1.1 的新文本
 * 用户在哪个入口看到哪一版，取决于他从哪里点进来。这比写错更严重：
 * 一旦发生争议，对方可以直接指出「你们公示的是两份不同的条款」。
 *
 * 所以这里不再维护正文，只做 301 跳转，让**唯一事实来源**是 Pages 站点的
 * terms.md / privacy.md（由 scripts/build-legal-site.mjs 生成 index.html）。
 * 保留这两个路由是为了不破坏百度开放平台等已登记的 URL。
 *
 * 改条款的流程因此只有一步：改 md → 重新生成 → 部署。不再需要同步改这里。
 */

/** 条款站点（唯一事实来源）。 */
const LEGAL_SITE = "https://qmai-legal.pages.dev"

/**
 * 301 跳转。
 *
 * 用 301 而不是 302：条款地址是长期稳定的，让搜索引擎与开放平台审核缓存跳转目标。
 * 响应体保留一行纯文本，给不跟随跳转的客户端一个可读提示。
 */
function redirectTo(target: string): Response {
  return new Response(`条款已迁移至 ${target}`, {
    status: 301,
    headers: {
      Location: target,
      "Content-Type": "text/plain; charset=utf-8",
      // 跳转目标可能变化（如绑定自定义域名），不让中间层长期缓存。
      "Cache-Control": "public, max-age=3600",
    },
  })
}

/** qmai.pro/privacy → 条款站点隐私政策页。 */
export function privacyPage(): Response {
  return redirectTo(`${LEGAL_SITE}/#privacy`)
}

/** qmai.pro/terms → 条款站点服务条款页。 */
export function termsPage(): Response {
  return redirectTo(`${LEGAL_SITE}/#terms`)
}
