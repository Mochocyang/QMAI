/**
 * 探明在纯浏览器（非 Tauri）下能覆盖到哪些界面页 —— 决定溢出验证的覆盖面。
 *
 * 背景：字号改动涉及 7 个 CSS、239 处字号，风险是"文字放大但 px 容器不放"导致裁切。
 * 要验证就得把每个界面都渲染出来测。但正式构建依赖 Tauri invoke，
 * 纯浏览器下初始化会失败。已知书架空态能渲染（ui-test-library 提供假数据）。
 * 本脚本枚举 shell 里的导航项，逐个点击，记录能到达哪些 data-ui-page。
 */
import { createServer } from "node:http"
import { readFileSync, existsSync, statSync } from "node:fs"
import { join, extname } from "node:path"
import { pathToFileURL } from "node:url"

const DIST = join(process.cwd(), "dist")
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" }
const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url ?? "/").split("?")[0])
  if (p === "/") p = "/index.html"
  const f = join(DIST, p)
  if (!f.startsWith(DIST) || !existsSync(f) || statSync(f).isDirectory()) return res.writeHead(404).end("nf")
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" })
  res.end(readFileSync(f))
})
const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)))

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const browser = await (mod.chromium ?? mod.default.chromium).launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" })
await page.waitForTimeout(2500)

console.log("  ══ 初始根节点 ══")
const shell = await page.evaluate(() => {
  const root = document.querySelector(".ui-test-root")
  return {
    hasRoot: !!root,
    pages: [...document.querySelectorAll("[data-ui-page]")].map((e) => e.getAttribute("data-ui-page")),
    skin: document.documentElement.dataset.uiTestSkin ?? null,
  }
})
console.log(`    有 .ui-test-root: ${shell.hasRoot}`)
console.log(`    当前 data-ui-page: ${shell.pages.join(", ") || "（无）"}`)
console.log(`    皮肤: ${shell.skin}`)

// 枚举可点击的导航控件（按钮/带 role 的元素），看能到达哪些页面
console.log("\n  ══ 可点击控件（用于导航）══")
const clickables = await page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll(".ui-test-root button, .ui-test-root [role='tab'], .ui-test-root [role='menuitem'], .ui-test-root a")) {
    const t = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24)
    const label = el.getAttribute("aria-label") || ""
    if (!t && !label) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    out.push({ text: t, label, title: (el.getAttribute("title") || "").slice(0, 20) })
  }
  return out.slice(0, 40)
})
for (const c of clickables) console.log(`    "${c.text}"  aria-label="${c.label}"  title="${c.title}"`)

// 尝试逐个点击，收集到达过的页面
const visited = new Set()
const tryClick = async (selectorText) => {
  const ok = await page.evaluate((t) => {
    for (const el of document.querySelectorAll(".ui-test-root button, .ui-test-root [role='tab'], .ui-test-root [role='menuitem']")) {
      const s = (el.textContent || "").trim().replace(/\s+/g, " ")
      const l = el.getAttribute("aria-label") || ""
      if (s === t || l === t) {
        const r = el.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) continue
        el.click()
        return true
      }
    }
    return false
  }, selectorText)
  if (!ok) return null
  await page.waitForTimeout(700)
  const pageName = await page.evaluate(() => {
    const els = [...document.querySelectorAll("[data-ui-page]")]
    return els.map((e) => e.getAttribute("data-ui-page"))
  })
  pageName.forEach((p) => visited.add(p))
  return pageName.join(",")
}

console.log("\n  ══ 逐个点击导航 ══")
const names = [...new Set(clickables.map((c) => c.text || c.label))].filter((n) => n && n.length <= 12)
for (const n of names.slice(0, 22)) {
  const got = await tryClick(n)
  if (got !== null) console.log(`    点击 "${n}" → data-ui-page = ${got}`)
}

console.log(`\n  ══ 覆盖结论 ══`)
console.log(`    到达过的页面: ${[...visited].join(", ") || "（无）"}`)
console.log(`    可导航控件数: ${clickables.length}`)
console.log(`    → ${visited.size >= 4 ? "可覆盖多个页面，适合作溢出验证面" : "覆盖有限，需其他方式（如注入假 Tauri 桥）才能覆盖全部界面"}`)

await page.screenshot({ path: "docs/font-scaling-fix-20261007/probe-nav.png", fullPage: false })
await browser.close()
server.close()
