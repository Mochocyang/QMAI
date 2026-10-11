/**
 * 验证修复方向：把字号从 px 改成 rem 是否真的能随"界面字号"缩放。
 *
 * 已知：产物里 Tailwind 的 text-* 用 rem（--text-xs:.75rem），自定义 CSS 用 px（160 处）。
 * 本实验用真实 dist CSS 建一个受控 DOM，分别在根字号 100% / 130% / 150% 下
 * 读取计算后的 fontSize：
 *   - 用 Tailwind 类的元素 → 应当缩放（证明 rem 通路可用 = 把 px 改成 rem 是对的解法）
 *   - 用自定义 px 类的元素 → 应当不变（复现当前缺陷）
 *
 * 这是"证明修复方向可行"的实验，不改任何源码。
 */
import { createServer } from "node:http"
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs"
import { join, extname } from "node:path"
import { pathToFileURL } from "node:url"

const REPO = process.cwd()
const DIST = join(REPO, "dist")

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".wasm": "application/wasm" }
const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url ?? "/").split("?")[0])
  if (p === "/") p = "/index.html"
  const f = join(DIST, p)
  if (!f.startsWith(DIST) || !existsSync(f) || statSync(f).isDirectory()) return res.writeHead(404).end("nf")
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" })
  res.end(readFileSync(f))
})
const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)))

// 把产物 CSS 内联，避免相对路径问题
const css = readdirSync(join(DIST, "assets"))
  .filter((f) => f.endsWith(".css"))
  .map((f) => readFileSync(join(DIST, "assets", f), "utf8"))
  .join("\n")
console.log(`  载入产物 CSS ${(css.length / 1024).toFixed(0)} KB`)

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const browser = await (mod.chromium ?? mod.default.chromium).launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" })

// 建受控 DOM：左列用 Tailwind rem 类，右列模拟自定义 CSS 的 px
await page.evaluate((cssText) => {
  document.head.innerHTML = `<style>${cssText}</style>`
  document.body.innerHTML = `
    <div class="ui-test-root" data-ui-test-skin="jing">
      <div id="tw-xs" class="text-xs">Tailwind text-xs</div>
      <div id="tw-sm" class="text-sm">Tailwind text-sm</div>
      <div id="tw-base" class="text-base">Tailwind text-base</div>
      <div id="px-12" style="font-size:12px">inline 12px</div>
      <div id="px-14" style="font-size:14px">inline 14px</div>
      <div id="px-18" style="font-size:18px">inline 18px</div>
    </div>`
}, css)

const IDS = ["tw-xs", "tw-sm", "tw-base", "px-12", "px-14", "px-18"]

async function measure(rootPercent) {
  await page.evaluate((p) => { document.documentElement.style.fontSize = p }, rootPercent)
  await page.waitForTimeout(150)
  return page.evaluate((ids) => {
    const o = {}
    for (const id of ids) {
      const el = document.getElementById(id)
      o[id] = parseFloat(getComputedStyle(el).fontSize)
    }
    return o
  }, IDS)
}

const at100 = await measure("100%")
const at130 = await measure("130%")
const at150 = await measure("150%")

console.log("\n  元素            100%      130%      150%      130%时是否缩放")
console.log("  " + "─".repeat(66))
let twScaled = 0
let pxScaled = 0
for (const id of IDS) {
  const a = at100[id], b = at130[id], c = at150[id]
  const isTw = id.startsWith("tw-")
  const scaled = Math.abs(b - a) > 0.01
  if (isTw && scaled) twScaled++
  if (!isTw && scaled) pxScaled++
  console.log(`  ${id.padEnd(14)} ${String(a).padStart(7)} ${String(b).padStart(8)} ${String(c).padStart(8)}      ${scaled ? "是" : "否"}${isTw ? "  (rem)" : "  (px)"}`)
}

console.log("\n  结论：")
console.log(`    Tailwind rem 类缩放: ${twScaled}/3`)
console.log(`    自定义 px 缩放     : ${pxScaled}/3`)

if (twScaled === 3 && pxScaled === 0) {
  console.log("    → rem 通路确实可用，px 确实不缩放。")
  console.log("    → 把 160 处 px 字号改为 rem 就是正确解法，且字号滑块会真正生效。")
} else if (twScaled === 0) {
  console.log("    → 连 rem 也不缩放！根字号设置有别的问题，需另找原因（不能直接改 px→rem）。")
} else {
  console.log("    → 结果与预期不符，需进一步排查。")
}

await browser.close()
server.close()
