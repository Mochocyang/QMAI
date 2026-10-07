/**
 * 计算样式普查 —— 字号修复的决定性验收测试。
 *
 * 为什么用"计算样式普查"而不是截图比对：
 *   截图会受抗锯齿、字体栅格化、动态内容影响，噪声可能掩盖真实差异；
 *   计算样式是确定性的，可逐元素精确比较，且能直接断言"缩放倍数"。
 *
 * 判据（两步，缺一不可）：
 *   1. 等效性：根字号 100% 时，改动前后的计算 fontSize / lineHeight 必须逐元素相同。
 *      依据：557 处 px→rem 换算中，所有 px 值均为 0.5 的整数倍，
 *      除以 16 得精确有限小数，故 100% 下计算值应与现状完全一致。
 *      若有差异 → 换算有误或漏改，必须修正。
 *   2. 生效性：根字号 150% 时，**所有**文本元素的计算 fontSize 必须等于
 *      100% 时数值的 1.5 倍（允许浮点误差）。若有元素未变 → 该处仍有绝对单位漏网。
 *
 * 元素标识：用 DOM 路径（标签 + 同级索引）而非 class，
 * 因为改动只涉及 CSS 值、不改 DOM 结构，路径稳定可比对。
 *
 * 用法：
 *   node census-computed-font.mjs --out before.json         # 改动前采集
 *   node census-computed-font.mjs --out after.json          # 改动后采集
 *   node census-computed-font.mjs --compare before.json after.json
 */
import { createServer } from "node:http"
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs"
import { join, extname } from "node:path"
import { pathToFileURL } from "node:url"

const argv = process.argv.slice(2)
const argOf = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }

const DIST = join(process.cwd(), "dist")
const CENSUS_SCALES = [100, 150]

/* ─────────── 比较模式 ─────────── */
if (argv.includes("--compare")) {
  const i = argv.indexOf("--compare")
  const before = JSON.parse(readFileSync(argv[i + 1], "utf8"))
  const after = JSON.parse(readFileSync(argv[i + 2], "utf8"))

  console.log("  ══ 比较：改动前 vs 改动后 ══\n")

  // 判据 1：100% 等效性
  const b100 = before.census["100"] ?? {}
  const a100 = after.census["100"] ?? {}
  const keysB = Object.keys(b100)
  const keysA = Object.keys(a100)
  const missing = keysB.filter((k) => !(k in a100))
  const added = keysA.filter((k) => !(k in b100))

  let diff100 = []
  for (const k of keysB) {
    if (!(k in a100)) continue
    const x = b100[k], y = a100[k]
    if (x.fontSize !== y.fontSize || x.lineHeight !== y.lineHeight) {
      diff100.push({ key: k, before: x, after: y })
    }
  }

  console.log(`  判据 1：100% 字号下计算样式等效性`)
  console.log(`    元素数 改动前=${keysB.length} 改动后=${keysA.length}`)
  console.log(`    仅改动前有: ${missing.length}${missing.length ? "  ← 元素消失，需排查" : ""}`)
  console.log(`    仅改动后有: ${added.length}${added.length ? "  ← 新增元素" : ""}`)
  console.log(`    fontSize/lineHeight 不同: ${diff100.length}`)
  if (diff100.length) {
    console.log(`      前 12 条差异：`)
    for (const d of diff100.slice(0, 12)) {
      console.log(`        ${d.key}`)
      console.log(`          前: ${d.before.fontSize} / lh ${d.before.lineHeight}`)
      console.log(`          后: ${d.after.fontSize} / lh ${d.after.lineHeight}`)
    }
  }
  const judge1 = diff100.length === 0 && missing.length === 0

  // 判据 2：150% 生效性
  const a150 = after.census["150"] ?? {}
  let notScaled = []
  let scaled = 0
  let sample = null
  for (const k of keysA) {
    const at100 = a100[k], at150 = a150[k]
    if (!at100 || !at150) continue
    const base = parseFloat(at100.fontSize)
    const big = parseFloat(at150.fontSize)
    if (!Number.isFinite(base) || base === 0) continue
    const ratio = big / base
    // 允许 1% 误差（浏览器亚像素取整）
    if (Math.abs(ratio - 1.5) < 0.015) scaled++
    else notScaled.push({ key: k, at100: at100.fontSize, at150: at150.fontSize, ratio: ratio.toFixed(3), cls: at100.cls })
    if (!sample) sample = { key: k, at100: at100.fontSize, at150: at150.fontSize, ratio: ratio.toFixed(3) }
  }

  console.log(`\n  判据 2：150% 字号下缩放生效性（期望全部 = 1.5 倍）`)
  console.log(`    正确缩放: ${scaled}`)
  console.log(`    未按 1.5 缩放: ${notScaled.length}`)
  if (notScaled.length) {
    console.log(`      前 15 条：`)
    for (const d of notScaled.slice(0, 15)) {
      console.log(`        ${d.at100} → ${d.at150} (×${d.ratio})  .${(d.cls || "").slice(0, 50)}`)
    }
  }
  const judge2 = notScaled.length === 0

  console.log(`\n  ══ 结论 ══`)
  console.log(`    判据 1（100% 等效，无视觉回归）: ${judge1 ? "通过" : "未通过"}`)
  console.log(`    判据 2（150% 全部缩放）        : ${judge2 ? "通过" : "未通过"}`)
  console.log(`    → ${judge1 && judge2 ? "字号修复已达成：既无回归，又真实生效" : "尚未达成，需继续修"}`)
  process.exitCode = judge1 && judge2 ? 0 : 1
} else {
  /* ─────────── 采集模式 ─────────── */
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("  dist/index.html 不存在，请先构建")
    process.exit(1)
  }

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

  // 打开设置页 —— 它是"外观与界面"控件所在页，且浏览器中可到达
  await page.evaluate(() => {
    for (const el of document.querySelectorAll(".ui-test-root button, .ui-test-root a")) {
      if ((el.getAttribute("aria-label") || "") === "设置") { el.click(); return }
    }
  })
  await page.waitForTimeout(1500)

  /** 采集当前 DOM 中所有可见文本元素的计算字号/行高，键为 DOM 路径。 */
  const censusOnce = () => page.evaluate(() => {
    const out = {}
    const path = (el) => {
      const parts = []
      let cur = el
      while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
        const parent = cur.parentElement
        const idx = parent ? [...parent.children].indexOf(cur) : 0
        parts.unshift(`${cur.tagName.toLowerCase()}:${idx}`)
        cur = parent
      }
      return parts.join(">")
    }
    for (const el of document.querySelectorAll("*")) {
      const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("")
      if (!ownText) continue
      const cs = getComputedStyle(el)
      if (cs.display === "none" || cs.visibility === "hidden") continue
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      out[path(el)] = {
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        cls: (el.className || "").toString().slice(0, 70),
        text: ownText.slice(0, 20),
      }
    }
    return out
  })

  const census = {}
  for (const s of CENSUS_SCALES) {
    await page.evaluate((p) => { document.documentElement.style.fontSize = p + "%" }, s)
    await page.waitForTimeout(600)
    census[String(s)] = await censusOnce()
    console.log(`  采集 ${s}%: ${Object.keys(census[String(s)]).length} 个文本元素`)
  }

  await browser.close()
  server.close()

  const payload = {
    capturedAt: new Date().toISOString(),
    scales: CENSUS_SCALES,
    census,
  }
  const out = argOf("--out") ?? "census.json"
  writeFileSync(out, JSON.stringify(payload, null, 1), "utf8")
  console.log(`\n  已写入 ${out}`)
}
