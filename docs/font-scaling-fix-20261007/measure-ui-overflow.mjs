/**
 * 界面溢出测量 —— 既是设计依据，也是字号修复的验收测试。
 *
 * 用途：
 *   1. 基线：在各字号档位下测有多少文本元素被裁切，
 *      判断"字号放大导致布局破裂"是否已存在的问题。
 *   2. 验收：改动后重跑，确认裁切数量没有变差（判据是绝对标准：150% 档必须为 0）。
 *
 * ── 覆盖面（2026-10-08 扩展：此前只测落地页，会给出一半的假安全感）──
 *   落地页（书架）+ 设置页 11 个分区。设置页才是 CSS 规则最密集处 ——
 *   普查恰在那里发现 219 个未缩放元素。每个条目都带分区标识，
 *   合并时以 `<分区>::<DOM路径>` 为键，避免不同分区同一路径互相覆盖
 *   （普查工具正是在这里出现过 7 个元素被静默遮蔽的缺陷）。
 *
 * 判定"裁切"的口径（分开计数，避免混淆）：
 *   - 纵向裁切：scrollHeight > clientHeight + 1，且该元素 overflow-y 为 hidden/clip
 *   - 横向裁切：scrollWidth > clientWidth + 1，且 overflow-x 为 hidden/clip，
 *     或 white-space 为 nowrap/pre
 *   仅统计自身直接含可见文本的元素，忽略纯装饰/图标容器。
 *   注意：`min-height` 撑开的容器**不算裁切**（它会变高，内容可见）——
 *   这一点由下面的负向对照实证，而不是靠口头约定。
 *
 * ── 为什么"0 个"这个结论需要被守卫（本项目已吃过教训）──
 *   只打印一个 0 的检查器比没有检查器更危险。本脚本因此在每次运行时都
 *   同时打印四项对照，任何一项不成立即整体判失败、退出码非 0：
 *     守卫① 倍率真的生效：正文计算字号的中位数在 150% 档 / 100% 档 ≈ 1.5
 *            （否则"150% 无裁切"可能只是"倍率压根没应用"这种空洞通过）
 *     守卫② 阳性对照：注入一个必定被裁切的探针，必须被检出
 *            （证明检测器"该报的一定报"，不是失灵后报 0）
 *     守卫③ 阴性对照：注入一个 min-height 撑开的探针，必须不被检出
 *            （证明判据没有把"会变高"误判成"被裁切"）
 *     守卫④ 覆盖面与非空：落地页 + 11 个分区全部到达；被测文本元素数不得低于下限
 *
 * 用法：
 *   node measure-ui-overflow.mjs                     # 测 100/115/130/150
 *   node measure-ui-overflow.mjs --scales 100,150
 *   node measure-ui-overflow.mjs --json > baseline.json
 *   node measure-ui-overflow.mjs --selftest          # 只跑对照，证明尺子可信
 */
import { createServer } from "node:http"
import { readFileSync, existsSync, statSync } from "node:fs"
import { join, extname } from "node:path"
import { pathToFileURL } from "node:url"

const REPO = process.cwd()
const DIST = join(REPO, "dist")
const AS_JSON = process.argv.includes("--json")
const SELFTEST_ONLY = process.argv.includes("--selftest")
const scalesIdx = process.argv.indexOf("--scales")
const scalesArg = scalesIdx >= 0 ? process.argv[scalesIdx + 1] : undefined
if (scalesArg !== undefined && scalesArg.startsWith("--")) {
  console.error(`  ✗ ARG-FAIL --scales 需要参数，但收到的是另一个选项 "${scalesArg}"`)
  process.exit(1)
}
const SCALES = scalesArg
  ? scalesArg.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)
  : [100, 115, 130, 150]
if (SCALES.length === 0) {
  console.error("  ✗ ARG-FAIL --scales 参数无效（需要逗号分隔的正数，如 100,150）")
  process.exit(1)
}
/** 被测文本元素数下限：低于它说明页面没渲染出来，此时"0 裁切"毫无意义。 */
const MIN_ELEMENTS = 100

const SETTINGS_SECTIONS = [
  "model", "novel", "network", "web-search", "interface", "user-memory",
  "maintenance", "data-management", "feedback", "contact-support", "changelog",
]

if (!existsSync(join(DIST, "index.html"))) {
  console.error("  ✗ dist/index.html 不存在，请先构建")
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

/**
 * 在页面内统计裁切元素，并同时给出两项探针对照与字号样本。
 * 探针每次测量前注入、测完移除，绝不会混进应用自身的统计里（用 probe 标记区分）。
 */
const collect = (surface) => page.evaluate((surfaceId) => {
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

  // ── 探针：阳性（overflow:hidden 固定高，行盒 40px > 20px，必定裁切）──
  //          阴性（min-height，容器会被撑高，不该被判为裁切）
  const wrap = document.createElement("div")
  wrap.setAttribute("data-overflow-probe", "1")
  wrap.style.cssText = "position:fixed;left:-9999px;top:0;"
  wrap.innerHTML =
    '<div id="probe-clip" style="overflow:hidden;height:20px;font-size:16px;line-height:40px">PROBE_CLIP</div>' +
    '<div id="probe-grow" style="min-height:20px;font-size:16px;line-height:40px">PROBE_GROW</div>'
  document.body.appendChild(wrap)

  const isClipped = (el, cs) => {
    const clipsY = /hidden|clip/.test(cs.overflowY)
    const clipsX = /hidden|clip/.test(cs.overflowX)
    const nowrap = cs.whiteSpace === "nowrap" || cs.whiteSpace === "pre"
    const overY = el.scrollHeight - el.clientHeight
    const overX = el.scrollWidth - el.clientWidth
    return { hit: (clipsY && overY > 1) || ((clipsX || nowrap) && overX > 1), overY, overX }
  }

  const probeClipEl = document.getElementById("probe-clip")
  const probeGrowEl = document.getElementById("probe-grow")
  const probePositive = isClipped(probeClipEl, getComputedStyle(probeClipEl)).hit
  const probeNegative = isClipped(probeGrowEl, getComputedStyle(probeGrowEl)).hit
  wrap.remove()

  const out = []
  const fontSizes = []
  let measured = 0
  for (const el of document.querySelectorAll("*")) {
    if (el.closest("[data-overflow-probe]")) continue
    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join("")
    if (!ownText) continue
    const cs = getComputedStyle(el)
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    measured++
    const fs = parseFloat(cs.fontSize)
    if (Number.isFinite(fs) && fs > 0) fontSizes.push(fs)

    const { hit, overY, overX } = isClipped(el, cs)
    if (hit) {
      out.push({
        key: `${surfaceId}::${path(el)}`,
        section: surfaceId,
        kind: "dom-overflow",
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

  /**
   * 第二类检测：**表单控件的行盒被内容高度裁掉**。
   *
   * 为什么必须单列一类：`<input>`/`<textarea>` 的值不是子文本节点，
   * 而是 value 属性 —— 上面的 DOM 文本遍历**永远看不到它们**（实测：
   * 模型设置的标签输入框写成 `height:28px; font:14px/28px`，
   * 150% 时行盒 42px > 内容高 28px，文字会被切掉，但本工具此前报 0）。
   * 这是"检测器结构性看不见"，不是"布局没问题"。
   *
   * 判据：line-height > clientHeight 即文字纵向被裁（浏览器会把行盒居中后裁掉两侧）。
   */
  const controls = []
  let textControlsSeen = 0
  /**
   * 只考虑**会渲染文字**的输入类型。
   * 实测教训：不加类型过滤时，checkbox/radio（value 恒为 "on"）与 range
   * （value 为档位数字）都会被算成"行盒大于内容高"，凭空报出 10 个假缺陷
   * —— 它们根本不渲染文本，line-height 对它们毫无意义。
   */
  const TEXTUAL = new Set(["", "text", "search", "email", "url", "tel", "password", "number"])
  for (const el of document.querySelectorAll("input, textarea")) {
    const cs = getComputedStyle(el)
    if (cs.display === "none" || cs.visibility === "hidden") continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    if (el.tagName.toLowerCase() === "input") {
      const type = (el.getAttribute("type") ?? "text").toLowerCase()
      if (!TEXTUAL.has(type)) continue
    } else if (el.tagName.toLowerCase() === "textarea") {
      // textarea 一律是文本控件
    }
    textControlsSeen++
    const lh = parseFloat(cs.lineHeight)
    const ch = el.clientHeight
    if (!Number.isFinite(lh) || lh <= 0 || ch < 1) continue
    const over = lh - ch
    if (over > 1) {
      const val = (el.value ?? "").toString()
      controls.push({
        key: `${surfaceId}::${path(el)}`,
        section: surfaceId,
        kind: "control-clip",
        tag: el.tagName.toLowerCase(),
        cls: (el.className || "").toString().slice(0, 60),
        text: val.slice(0, 30) || "(空)",
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        overY: Math.round(over), overX: 0,
        h: ch, w: Math.round(r.width),
        rect: "控制行盒/内容高",
        filled: val.length > 0,
      })
    }
  }

  return { items: [...out, ...controls], measured, fontSizes, probePositive, probeNegative, controlsTotal: controls.length, controlsFilled: controls.filter((c) => c.filled).length, textControlsSeen }
}, surface)

const setScale = async (s) => {
  await page.evaluate((p) => { document.documentElement.style.fontSize = p + "%" }, s)
  await page.waitForTimeout(350)
}

/** 进入设置页（浏览器中可到达；与界面语言无关的定位方式优先）。 */
const openSettings = async () => {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll(".ui-test-root button, .ui-test-root a")) {
      if ((el.getAttribute("aria-label") || "") === "设置") { el.click(); return }
    }
  })
  await page.waitForTimeout(1500)
}

/** 点击设置页子分区，返回真实到达的分区 id（没点到就如实返回 null）。 */
const openSection = async (id) => {
  const clicked = await page.evaluate((sectionId) => {
    const btn = document.querySelector(`[data-ui-settings-category-button="${sectionId}"]`)
    if (!btn) return false
    btn.click()
    return true
  }, id)
  await page.waitForTimeout(600)
  const landed = await page.evaluate(() => document.querySelector('[data-ui-page="settings"]')?.getAttribute("data-ui-settings-category") ?? null)
  return { requested: id, clicked, landed }
}

// ─────────────────────────── 采集 ───────────────────────────
const byScale = {}
for (const s of SCALES) byScale[s] = []

/** 合并时以键去重，并校验同键是否同一元素（防静默遮蔽）。 */
const mergedByScale = {}
const shadowed = []

const pushAll = (s, items, surface) => {
  for (const it of items) {
    const prev = byScale[s].find((x) => x.key === it.key)
    if (prev) {
      if (prev.cls !== it.cls || prev.text !== it.text) {
        shadowed.push({ scale: s, surface, key: it.key, a: `${prev.cls}|${prev.text}`, b: `${it.cls}|${it.text}` })
      }
      continue
    }
    byScale[s].push(it)
  }
}

const measuredCount = {}
const textControlsSeen = {}
const fontSamples = {}
const probes = { positive: {}, negative: {} }
const surfacesReached = new Set()

// 第一段：落地页（书架）—— 此时尚未进入设置页，无需导航
for (const s of SCALES) {
  await setScale(s)
  const r = await collect("landing")
  pushAll(s, r.items, "landing")
  measuredCount[s] = (measuredCount[s] ?? 0) + r.measured
  textControlsSeen[s] = (textControlsSeen[s] ?? 0) + (r.textControlsSeen ?? 0)
  fontSamples[s] = (fontSamples[s] ?? []).concat(r.fontSizes)
  probes.positive[s] = probes.positive[s] || r.probePositive
  probes.negative[s] = probes.negative[s] || r.probeNegative
  surfacesReached.add("landing")
}

// 第二段：设置页 11 个分区
if (!SELFTEST_ONLY) {
  await openSettings()
  for (const s of SCALES) {
    for (const id of SETTINGS_SECTIONS) {
      const land = await openSection(id)
      if (!land.landed) continue
      await setScale(s)
      const r = await collect(land.landed)
      pushAll(s, r.items, land.landed)
      measuredCount[s] = (measuredCount[s] ?? 0) + r.measured
      textControlsSeen[s] = (textControlsSeen[s] ?? 0) + (r.textControlsSeen ?? 0)
      fontSamples[s] = (fontSamples[s] ?? []).concat(r.fontSizes)
      probes.positive[s] = probes.positive[s] || r.probePositive
      probes.negative[s] = probes.negative[s] || r.probeNegative
      surfacesReached.add(land.landed)
    }
  }
}

const median = (a) => {
  if (!a.length) return null
  const b = [...a].sort((x, y) => x - y)
  const m = b.length >> 1
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2
}

// ─────────────────────────── 守卫 ───────────────────────────
const guardFails = []
const fail = (code, msg) => guardFails.push({ code, msg })

// 守卫④：覆盖面
const expectedSurfaces = SELFTEST_ONLY ? 1 : 1 + SETTINGS_SECTIONS.length
if (surfacesReached.size < expectedSurfaces) {
  const missing = SELFTEST_ONLY ? [] : SETTINGS_SECTIONS.filter((s2) => !surfacesReached.has(s2))
  fail("D/覆盖面", `只到达 ${surfacesReached.size}/${expectedSurfaces} 个界面${missing.length ? `，缺分区: ${missing.join(", ")}` : ""}`)
}
for (const s of SCALES) {
  if ((measuredCount[s] ?? 0) < MIN_ELEMENTS) {
    fail("D/样本过少", `${s}% 档只测到 ${measuredCount[s] ?? 0} 个文本元素（下限 ${MIN_ELEMENTS}），页面可能没渲染出来`)
  }
  if ((textControlsSeen[s] ?? 0) < 1) {
    fail("E/控件未覆盖", `${s}% 档没有检查到任何文本输入控件 —— 此时"控件行盒未被裁"是空洞结论（这类控件正是静态预判发现风险的地方）`)
  }
}

// 守卫②③：探针阳性/阴性对照
for (const s of SCALES) {
  if (probes.positive[s] !== true) fail("B/阳性对照", `${s}% 档注入的"必定被裁切"探针未被检出 —— 检测器失灵，此时报 0 是假绿`)
  if (probes.negative[s] !== false) fail("C/阴性对照", `${s}% 档注入的"min-height 撑开"探针被误判为裁切 —— 判据把"会变高"当成了"被裁切"`)
}

// 守卫①：倍率真的生效（否则"150% 无裁切"可能只是倍率没应用这种空洞通过）
const lo = SCALES[0]
const hi = SCALES[SCALES.length - 1]
const medLo = median(fontSamples[lo] ?? [])
const medHi = median(fontSamples[hi] ?? [])
let medianRatio = null
if (medLo && medHi) {
  medianRatio = medHi / medLo
  const expect = hi / lo
  if (Math.abs(medianRatio - expect) > 0.05) {
    fail("A/倍率未生效", `正文计算字号中位数 ${lo}%→${medLo}px、${hi}%→${medHi}px（比值 ${medianRatio.toFixed(3)}，期望 ${expect.toFixed(2)}）—— 倍率可能根本没应用`)
  }
} else {
  fail("A/倍率未生效", "没有采到字号样本，无法证明倍率生效")
}

// 守卫⑥：静默遮蔽
if (shadowed.length > 0) {
  fail("F/静默遮蔽", `${shadowed.length} 个键在合并时命中了不同元素（同键不同 cls/text），可能有元素测不到`)
}

// ─────────────────────────── 输出 ───────────────────────────
const appCount = (s) => byScale[s].length
const kindCount = (s, kind) => byScale[s].filter((x) => x.kind === kind).length

if (AS_JSON) {
  console.log(JSON.stringify({
    scales: SCALES,
    surfaces: [...surfacesReached].sort(),
    appOverflow: Object.fromEntries(SCALES.map((s) => [s, byScale[s]])),
    measuredCount, probes, medianRatio,
    guardFails, errors: errors.slice(0, 5),
  }, null, 2))
  await browser.close(); server.close()
  process.exit(guardFails.length ? 1 : 0)
}

console.log("  ══ 界面裁切测量（真实产物 dist/ · 1440x900）══")
console.log(`  覆盖面: ${[...surfacesReached].sort().join(", ")}`)
console.log(`  到达界面数: ${surfacesReached.size}/${expectedSurfaces}\n`)
console.log("  字号档位   DOM溢出(被裁切文本)   控件行盒被裁   被测文本元素数   文本控件数")
console.log("  " + "─".repeat(80))
for (const s of SCALES) {
  console.log(`  ${String(s + "%").padEnd(9)} ${String(kindCount(s, "dom-overflow")).padStart(14)}   ${String(kindCount(s, "control-clip")).padStart(12)}   ${String(measuredCount[s] ?? 0).padStart(12)}   ${String(textControlsSeen[s] ?? 0).padStart(10)}`)
}

console.log("\n  ── 尺子自身的对照（任何一项不成立，本次测量结论就不成立）──")
console.log(`  ① 倍率生效    正文字号中位数 ${lo}%→${medLo ?? "?"}px，${hi}%→${medHi ?? "?"}px，比值 ${medianRatio ? medianRatio.toFixed(3) : "?"}（期望 ${(hi / lo).toFixed(2)}）`)
console.log(`  ② 阳性对照    注入"必定被裁切"探针 → ${SCALES.map((s) => (probes.positive[s] ? "已检出" : "未检出")).join(" / ")}`)
console.log(`  ③ 阴性对照    注入"min-height 撑开"探针 → ${SCALES.map((s) => (probes.negative[s] ? "误判为裁切" : "未误判")).join(" / ")}`)
console.log(`  ④ 覆盖面      ${surfacesReached.size}/${expectedSurfaces} 个界面（落地页 + 设置页 11 分区）`)
console.log(`  ⑥ 静默遮蔽    同键不同元素: ${shadowed.length}`)

const worst = kindCount(hi, "dom-overflow") + kindCount(hi, "control-clip")
const base = kindCount(lo, "dom-overflow") + kindCount(lo, "control-clip")

console.log(`\n  最低档 ${lo}% 裁切 ${base} 个；最高档 ${hi}% 裁切 ${worst} 个（两类相加）`)

if (worst > 0) {
  console.log(`\n  ${hi}% 档位裁切明细（前 25 条）：`)
  console.log("  " + "─".repeat(120))
  for (const it of byScale[hi].slice(0, 25)) {
    const extra = it.kind === "control-clip" ? ` 行盒=${it.lineHeight}/${it.h}px ${it.filled ? "(有内容)" : "(空)"}` : ` 纵+${it.overY} 横+${it.overX}  ${it.rect}`
    console.log(`    [${it.section}] <${it.tag}> fs=${it.fontSize.padStart(7)}${extra}  "${it.text}"  .${it.cls}`)
  }
}

if (errors.length) {
  console.log("\n  页面报错（非 Tauri 环境下属预期）：")
  for (const e of errors.slice(0, 3)) console.log(`    ${e}`)
}

if (guardFails.length) {
  console.log("")
  for (const g of guardFails) console.log(`  ✗ GUARD-FAIL [${g.code}] ${g.msg}`)
}

const ok = guardFails.length === 0 && worst === 0 && base === 0
console.log(`\n  结论: ${hi}% 档裁切 ${worst} 个，${lo}% 档裁切 ${base} 个，守卫 ${guardFails.length} 项未通过 → ${ok ? "✓ 通过（当前档位范围无裁切）" : "✗ 未通过"}`)
await browser.close()
server.close()
process.exit(ok ? 0 : 1)
