/**
 * 界面溢出测量 —— 既是设计依据，也是字号修复的验收测试。
 *
 * 用途：
 *   1. 基线：在当前产物上测各字号档位下有多少文本元素溢出，
 *      判断"字号放大导致布局破裂"是否已存在的问题。
 *   2. 验收：改动后重跑，确认溢出数量没有变差。
 *
 * 判定"溢出"的口径（两类，分开计数，避免混淆）：
 *   - 纵向溢出：scrollHeight > clientHeight + 1，且该元素有 overflow:hidden/clip
 *     （真正被裁切，用户看不到内容）
 *   - 横向溢出：scrollWidth > clientWidth + 1，且 overflow:hidden/clip
 *     或 white-space:nowrap（文字被截断）
 *   仅统计含可见文本的元素，忽略纯装饰/图标容器。
 *
 * 用法：
 *   node measure-ui-overflow.mjs                     # 测 100/115/130/150
 *   node measure-ui-overflow.mjs --scales 100,150
 *   node measure-ui-overflow.mjs --json > baseline.json
 */
import { createServer } from "node:http"
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs"
import { join, extname } from "node:path"
import { pathToFileURL } from "node:url"

const REPO = process.cwd()
const DIST = join(REPO, "dist")
const AS_JSON = process.argv.includes("--json")
const scalesIdx = process.argv.indexOf("--scales")
const scalesArg = scalesIdx >= 0 ? process.argv[scalesIdx + 1] : undefined
const SCALES = scalesArg && !scalesArg.startsWith("--")
  ? scalesArg.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)
  : [100, 115, 130, 150]
if (SCALES.length === 0) {
  console.error("  --scales 参数无效")
  process.exit(1)
}

if (!existsSync(join(DIST, "index.html"))) {
  console.error("  dist/index.html 不存在，请先构建")
  process.exit(1)
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".wasm": "application/wasm",
}
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

const errors = []
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)))
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)) })

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" })
await page.waitForTimeout(2500)

/** 在页面内统计溢出元素。 */
const collect = () => page.evaluate(() => {
  const out = []
  const all = document.querySelectorAll("*")
  for (const el of all) {
    // 只统计元素本身直接含可见文本的节点
    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join("")
    if (!ownText) continue
    const cs = getComputedStyle(el)
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue

    const clipsY = /hidden|clip/.test(cs.overflowY)
    const clipsX = /hidden|clip/.test(cs.overflowX)
    const nowrap = cs.whiteSpace === "nowrap" || cs.whiteSpace === "pre"

    const overY = el.scrollHeight - el.clientHeight
    const overX = el.scrollWidth - el.clientWidth

    if ((clipsY && overY > 1) || ((clipsX || nowrap) && overX > 1)) {
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || "").toString().slice(0, 60),
        text: ownText.slice(0, 30),
        fontSize: cs.fontSize,
        overY, overX,
        h: Math.round(r.height), w: Math.round(r.width),
        rect: cs.overflowX + "/" + cs.overflowY,
      })
    }
  }
  return out
})

const results = {}
for (const s of SCALES) {
  await page.evaluate((p) => { document.documentElement.style.fontSize = p + "%" }, s)
  await page.waitForTimeout(500)
  const items = await collect()
  results[s] = items
}

const textScale = await page.evaluate(() => {
  const el = document.querySelector("p, div, span, button")
  return el ? getComputedStyle(el).fontSize : null
})

if (AS_JSON) {
  console.log(JSON.stringify({ scales: SCALES, results, errors: errors.slice(0, 5), textScale }, null, 2))
  await browser.close(); server.close(); process.exit(0)
}

console.log("  ══ 界面溢出基线测量（真实产物 dist/ · 1440x900）══\n")
console.log("  字号档位   溢出元素数")
console.log("  " + "─".repeat(34))
for (const s of SCALES) {
  console.log(`  ${String(s + "%").padEnd(10)} ${results[s].length}`)
}

const base = results[SCALES[0]].length
const worst = results[SCALES[SCALES.length - 1]].length
console.log(`\n  最低档 ${SCALES[0]}% 溢出 ${base} 个；最高档 ${SCALES[SCALES.length - 1]}% 溢出 ${worst} 个`)
console.log(`  → ${worst > base ? `随字号增大而恶化（+${worst - base}）` : "未随字号增大而恶化"}`)

// 明细：只列最高档，便于定位
console.log(`\n  ${SCALES[SCALES.length - 1]}% 档位溢出明细（前 25 条）：`)
console.log("  " + "─".repeat(112))
for (const it of results[SCALES[SCALES.length - 1]].slice(0, 25)) {
  console.log(`    <${it.tag}> fs=${it.fontSize.padStart(7)} 纵+${String(it.overY).padStart(4)} 横+${String(it.overX).padStart(4)}  ${it.rect.padEnd(15)} "${it.text}"  .${it.cls}`)
}

if (errors.length) {
  console.log("\n  页面报错（非 Tauri 环境下属预期）：")
  for (const e of errors.slice(0, 3)) console.log(`    ${e}`)
}

await browser.close()
server.close()
