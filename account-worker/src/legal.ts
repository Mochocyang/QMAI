/**
 * 隐私政策与服务条款页面。
 *
 * ── 条款挂在哪、为什么 ──
 *
 * 条款必须挂在 **qmai.pro** 上：
 *   · 它是已在百度开放平台登记的正式域名；
 *   · 用户点「同意」时打开的可读入口，必须在中国大陆也能稳定打开。
 *     Cloudflare Pages 的默认域名（*.pages.dev）在大陆访问不稳定，不能作为唯一入口。
 *
 * 主站是 Pages 项目 `qmai`（源码不在本仓库，不能直接往里加页面）。
 * 但本 Worker 已经挂了同域的 qmai.pro/terms、qmai.pro/privacy 路由，
 * 所以在它这里直接返回条款 HTML 最稳 —— 内容仍在 qmai.pro 域名之下。
 *
 * ── 内容从哪来 ──
 *
 * `legal-page.ts` 由 `scripts/build-legal-site.mjs` 从
 * cloudflare/legal-site/terms.md 与 privacy.md 生成。
 * 同一份 md 同时产出 Pages 站点与这份内嵌页，两者永远一致。
 *
 * 改条款的流程只有一条：改 md → 跑生成脚本 → 部署 Worker。
 */
import { LEGAL_PAGE_HTML } from "./legal-page"

/**
 * 条款页的响应头。
 *
 * 与服务端其它接口的区别：这是给人看的 HTML 而不是 JSON API，
 * 所以 Content-Type 是 text/html，且允许被搜索引擎与开放平台审核抓取。
 */
const LEGAL_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "public, max-age=600",
  // 条款页只由本站渲染，不加载任何外部脚本或样式。
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
}

/**
 * qmai.pro/legal —— 条款总入口（含服务条款与隐私政策两个 tab）。
 * 页内用 hash 切换：#terms 显示服务条款，#privacy 显示隐私政策。
 */
export function legalPage(): Response {
  return new Response(LEGAL_PAGE_HTML, { status: 200, headers: LEGAL_HEADERS })
}

/**
 * qmai.pro/privacy —— 落到隐私政策 tab。
 *
 * 用跳转而不是再渲染一份「只有隐私政策」的页面：页内切 tab 靠 hash 完成，
 * 跳一次即可。不复制第二份 HTML，避免两份内容将来不一致。
 */
export function privacyPage(): Response {
  return redirectTo("/legal#privacy")
}

/** qmai.pro/terms —— 落到服务条款 tab。 */
export function termsPage(): Response {
  return redirectTo("/legal#terms")
}

/**
 * 站内跳转。
 *
 * 用相对路径 `/legal#...` 而不是绝对 URL：无论用户从 qmai.pro 还是其它绑定域名进来，
 * 都会留在同一域名内，不会把人甩到别的域去。
 */
function redirectTo(target: string): Response {
  return new Response(`跳转到 ${target}`, {
    status: 302,
    headers: {
      Location: target,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=600",
    },
  })
}
