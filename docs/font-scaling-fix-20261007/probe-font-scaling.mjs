/**
 * 探针：在真实 Chrome 里加载构建产物，摸清"界面字号"到底影响了哪些文字。
 *
 * 用户的报告是「放大缩小只有按钮有效果，其他根本没有效果」。
 * 要证实或推翻它，必须量**计算后的 font-size**，而不是读 CSS 源码猜。
 *
 * 做法：
 *   1) 用 node http 伺服 dist（真实产物，含 lightningcss 处理后的 CSS）
 *   2) Chrome 打开，等界面渲染
 *   3) 分别在根字号 100% 与 130% 下，遍历页面上所有可见文字节点，
 *      记录各自的计算 font-size
 *   4) 对比：哪些变了、哪些没变 —— 这就是用户感受到的"有用/没用"
 *
 * 关键：这一步不预设结论。先看清事实，再谈修复。
 */
import { createServer } from "node:http"
import { readFileSync, existsSync, statSync } from "node:fs"
import { join, extname } from "node:path"
import { pathToFileURL } from "node:url"

const REPO = process.cwd()
const DIST = join(REPO, "dist")

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
}

const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url ?? "/").split("?")[0])
  if (p === "/") p = "/index.html"
  const file = join(DIST, p)
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end("not found")
    return
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" })
  res.end(readFileSync(file))
})

const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)))
console.log(`  伺服 dist: http://127.0.0.1:${port}/`)

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const browser = await (mod.chromium ?? mod.default.chromium).launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const errors = []
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 200))
})
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)))

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" })
// 给应用启动留时间（非 Tauri 环境下会走"无项目"分支）
await page.waitForTimeout(6000)

/** 遍历所有可见的、含直接文字的元素，取计算 font-size。 */
const SAMPLE = `() => {
  const out = []
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  let n
  while ((n = walk.nextNode())) {
    const text = (n.textContent ?? "").trim()
    if (!text) continue
    const el = n.parentElement
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue
    // 每个元素只取一次（取其第一个文字节点）
    if (seen.has(el)) continue
    seen.add(el)
    out.push({
      text: text.slice(0, 28),
      tag: el.tagName.toLowerCase(),
      cls: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 60),
      fontPx: parseFloat(cs.fontSize),
      fontFamily: cs.fontFamily.slice(0, 40),
    })
  }
  return out
}`

const bodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 400)
console.log(`\n  页面可见文字（前 400 字）:\n${bodyText.split("\n").slice(0, 12).map((l) => "    " + l).join("\n")}`)

// 基准：根字号 100%
await page.evaluate(() => { document.documentElement.style.fontSize = "100%" })
await page.waitForTimeout(400)
const base = await page.evaluate(eval(`(${SAMPLE})`))

// 放大到 130%（与设置页滑块上限一致）
await page.evaluate(() => { document.documentElement.style.fontSize = "130%" })
await page.waitForTimeout(400)
const big = await page.evaluate(eval(`(${SAMPLE})`))

// 按文字配对比较
const key = (s) => `${s.tag}|${s.text}`
const bigMap = new Map(big.map((s) => [key(s), s]))
const scaled = []
const fixed = []
for (const s of base) {
  const b = bigMap.get(key(s))
  if (!b) continue
  const ratio = b.fontPx / s.fontPx
  const row = { ...s, bigPx: b.fontPx, ratio }
  if (Math.abs(ratio - 1.3) < 0.02) scaled.push(row)
  else if (Math.abs(ratio - 1) < 0.001) fixed.push(row)
  else scaled.push(row) // 部分缩放也算有反应
}

console.log(`\n=== 根字号 100% → 130% 的影响 ===`)
console.log(`  采样元素: ${base.length}，两轮都匹配到: ${scaled.length + fixed.length}`)
console.log(`  随字号缩放: ${scaled.length}`)
console.log(`  完全不变  : ${fixed.length}`)

if (fixed.length) {
  console.log(`\n  ── 完全不变的元素（用户说的"没有效果"）──`)
  for (const f of fixed.slice(0, 25)) {
    console.log(`    ${String(f.fontPx).padStart(6)}px  <${f.tag}>  ${f.text}`)
  }
  if (fixed.length > 25) console.log(`    ...另有 ${fixed.length - 25} 个`)
}
if (scaled.length) {
  console.log(`\n  ── 随字号缩放的元素（用户说的"只有按钮有效果"）──`)
  for (const s of scaled.slice(0, 15)) {
    console.log(`    ${String(s.fontPx).padStart(6)}px → ${String(s.bigPx).padStart(6)}px  <${s.tag}>  ${s.text}`)
  }
}

if (errors.length) {
  console.log(`\n  控制台错误（前 5 条）:`)
  for (const e of errors.slice(0, 5)) console.log(`    ${e}`)
}

await page.screenshot({ path: join(REPO, "docs/font-scaling-fix-20261007/probe-app.png") })
await browser.close()
server.close()
