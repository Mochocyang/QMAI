/**
 * 排除一个会伪造验收结论的可能：React 是否覆盖了我们手动设置的根字号？
 *
 * 风险：App.tsx 有
 *   useEffect(() => { document.documentElement.style.fontSize = `${scale*100}%` }, [uiFontSizeScale])
 * 若在我用脚本设置 150% 之后 React 又渲染一次，就会把根字号重置回 100%。
 * 那样"27/27 未缩放"就不是因为 px 单位，而是因为根字号根本没生效 ——
 * 结论会被误读，且后续修复的验收会假失败。
 *
 * 本脚本：
 *   1. 读初始根字号与 documentElement.style.fontSize
 *   2. 设为 150%，持续观察 3 秒，看是否被改回
 *   3. 用已知 rem 元素（Tailwind text-xs）作为"探针"，判断 rem 是否真的随之缩放
 *   4. 用 px 元素作对照
 * 这样可区分两种情形：
 *   A. 根字号保持 150% 且 rem 探针缩放、px 探针不变 → 是真实的单位问题（预期）
 *   B. 根字号被改回 100% → 是 React 覆盖问题，验收方法需改（在应用内改设置而非直接改根字号）
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

/** 注入探针：一个 rem 元素（text-xs）与一个 px 元素，测 rem 通路是否可用。 */
await page.evaluate(() => {
  const host = document.querySelector(".ui-test-root") || document.body
  const wrap = document.createElement("div")
  wrap.id = "__probe__"
  wrap.innerHTML = `
    <span id="__probe_rem__" class="text-xs">rem 探针</span>
    <span id="__probe_px__" style="font-size:12px">px 探针</span>`
  host.appendChild(wrap)
})

const snapshot = async (label) => {
  const s = await page.evaluate(() => ({
    inlineRootFontSize: document.documentElement.style.fontSize || "(未设置)",
    computedRootFontSize: getComputedStyle(document.documentElement).fontSize,
    remProbe: getComputedStyle(document.getElementById("__probe_rem__")).fontSize,
    pxProbe: getComputedStyle(document.getElementById("__probe_px__")).fontSize,
    brandName: (() => {
      const el = document.querySelector(".ui-test-brand-name")
      return el ? getComputedStyle(el).fontSize : "(无)"
    })(),
  }))
  console.log(`  ${label}`)
  console.log(`    documentElement.style.fontSize = ${s.inlineRootFontSize}   计算根字号 = ${s.computedRootFontSize}`)
  console.log(`    rem 探针 = ${s.remProbe}   px 探针 = ${s.pxProbe}   .ui-test-brand-name = ${s.brandName}`)
  return s
}

console.log("  ══ 初始状态 ══")
const initial = await snapshot("初始")

console.log("\n  ══ 设为 150% 后持续观察（看 React 是否改回）══")
await page.evaluate(() => { document.documentElement.style.fontSize = "150%" })

for (const delay of [0, 300, 800, 1500, 3000]) {
  if (delay > 0) await page.waitForTimeout(delay - (delay === 300 ? 0 : 0))
  const s = await snapshot(`+${delay}ms`)
  const ok = s.inlineRootFontSize === "150%"
  console.log(`    → 根字号${ok ? "保持 150%" : "已被改回（React 覆盖！）"}`)
  void s
}

const final = await page.evaluate(() => ({
  inlineRootFontSize: document.documentElement.style.fontSize || "(未设置)",
  remProbe: getComputedStyle(document.getElementById("__probe_rem__")).fontSize,
  pxProbe: getComputedStyle(document.getElementById("__probe_px__")).fontSize,
}))

console.log("\n  ══ 判定 ══")
const rootHeld = final.inlineRootFontSize === "150%"
const remScaled = Math.abs(parseFloat(final.remProbe) - parseFloat(initial.remProbe) * 1.5) < 0.2
const pxHeld = Math.abs(parseFloat(final.pxProbe) - parseFloat(initial.pxProbe)) < 0.01

console.log(`    根字号保持 150%: ${rootHeld}`)
console.log(`    rem 探针缩放 1.5 倍: ${remScaled}（${initial.remProbe} → ${final.remProbe}）`)
console.log(`    px 探针保持不变: ${pxHeld}（${initial.pxProbe} → ${final.pxProbe}）`)

console.log()
if (rootHeld && remScaled && pxHeld) {
  console.log("    → 情形 A：根字号稳定，rem 缩放、px 不缩放。")
  console.log("      「27/27 未缩放」是真实的单位问题，验收方法有效。")
} else if (!rootHeld) {
  console.log("    → 情形 B：根字号被 React 改回，验收必须改为在应用内改设置（而非直接改根字号）。")
} else {
  console.log("    → 情形异常，需进一步排查。")
}

await browser.close()
server.close()
