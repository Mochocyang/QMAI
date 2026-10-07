#!/usr/bin/env node
/**
 * 证明「界面字体」设置真的生效。
 *
 * 为什么需要这个脚本：
 * `src/components/uitest/ui-test.css` 里的 `--ui` 曾硬编码为
 *   --ui: "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif;
 * 于是用户在「外观与界面」里选任何字体都**没有任何效果** ——
 * `applyUiFontFamily` 确实把选择写进了 `--qmai-ui-font-family`，
 * 但界面元素用的是 `var(--ui)`，两者之间没有任何连接。
 * 这类"设置存下来了、也读回来了，就是没作用"的缺陷，
 * 靠读代码很容易看漏（两个名字都与字体有关，看起来像是通的），
 * 所以必须有一条会失败/会通过的可执行判据。
 *
 * 判据方法（双重证据）：
 *   1. canvas 像素哈希 + measureText 宽度 —— 样本文本含中文与拉丁字母，
 *      换字体就会改变字形轮廓 → 哈希与宽度都变。
 *   2. Chromium 的 `CSS.getPlatformFontsForNode` —— 浏览器直接报告该节点
 *      渲染时用了哪些真实字体家族。这是最接近"用户看到什么"的证据，
 *      也是唯一能区分「字体串写对了」与「真的换了字形」的手段
 *      （字体没装时会静默回退，字串看着对、画面没变）。
 *
 * 尺子自身的对照（任何一项不成立，本脚本的结论都不成立）：
 *   ① 直接给元素写内联 font-family → 指纹必须变（度量方法能识别换字体）
 *   ② 给容器写内联 --ui → 指纹必须变（var(--ui) 通路本身是活的）
 *   ③ 负向对照：默认栈前面加一个不存在的字体名 → 指纹必须与默认**相同**
 *   ④ 覆盖面：必须真的找到足够多的界面文字元素
 *   ⑤ Chromium 报告的真实字体在所有用例间不能完全相同
 *   ⑥ 默认字体栈必须读自产品本身，不能由本脚本写死
 *
 * 用法：
 *   node docs/font-scaling-fix-20261007/verify-ui-font-applies.mjs
 *   node docs/font-scaling-fix-20261007/verify-ui-font-applies.mjs --record docs/.../ui-font-before.json
 *   node docs/font-scaling-fix-20261007/verify-ui-font-applies.mjs --compare docs/.../ui-font-before.json
 *   node docs/font-scaling-fix-20261007/verify-ui-font-applies.mjs --selftest
 *
 * 退出码：0 = 全部判据通过；1 = 有判据不通过（含守卫不通过）。
 */

import { createServer } from "node:http"
import { createHash } from "node:crypto"
import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs"
import { join, extname, resolve, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..")
const DIST = join(REPO, "dist")
const SETTINGS_NAV = 'nav[aria-label="设置分类"]'
const MIN_ELEMENTS = 8

const MISSING_FONT = "__QMaiNoSuchFont__"

/**
 * 指纹样本文本。**必须同时含中文与拉丁字母**。
 *
 * 原因：中文字形在字体缺失时会统一回退到系统默认中文字体，
 * 于是"两套不同的字体栈"在纯中文样本上可能渲染得一模一样
 * （实测本机 "PingFang SC" 优先与 system-ui 优先就是如此：
 * 中文都回退到 Microsoft YaHei UI，哈希、宽度、非空像素数全同）。
 * 若样本只有中文，"默认档没变"就会因为看不出差别而空洞成立。
 * 拉丁字母能区分出字体栈中靠前的那几个家族的差异。
 */
const SAMPLE_TEXT = "青幕AI界面字体Ag"

/**
 * 用例。`css: null` 表示「移除行内属性，用产品自己的默认」。
 *
 * 这里刻意**不写死默认字体栈**：初版把默认写成一个常量，
 * 而那常量其实是 index.css 改造前的旧值，并非产品实际默认栈
 * （改造前界面元素用的是 ui-test.css 里硬编码的 `--ui`）。
 * 基准搞错了，后面所有对比都不可靠 —— 所以默认档一律从页面读。
 */
const CASES = [
  { name: "默认", css: null, expect: "same" },
  { name: "黑体", css: "SimHei, sans-serif", expect: "differ" },
  { name: "楷体", css: "KaiTi, serif", expect: "differ" },
  { name: "仿宋", css: "FangSong, serif", expect: "differ" },
  { name: "不存在", css: "DYNAMIC_MISSING", expect: "same" },
]

/**
 * 负向对照 = 默认栈前面加一个不存在的字体名。
 *
 * 不能只用不存在的字体名自成一套栈：那样整条栈会塌到浏览器兜底衬线，
 * 它与默认档不同只能说明"栈不同"，说明不了"字体名真的被忽略"。
 */
function missingCase(fallbackStack) {
  return `"${MISSING_FONT}", ${fallbackStack}`
}

/* ── 1. 自检：先证明度量方法本身是对的 ─────────────────────────────── */
function selftest() {
  const results = []
  const check = (name, ok, detail) => results.push({ name, ok, detail })

  const h1 = hashOf("abc")
  const h2 = hashOf("abc")
  const h3 = hashOf("abd")
  check("哈希函数确定性（同输入同输出）", h1 === h2, `${h1} vs ${h2}`)
  check("哈希函数敏感性（改一位就变）", h1 !== h3, `${h1} vs ${h3}`)

  // 聚合哈希必须与元素顺序无关，否则页面渲染顺序一变就误报
  const a = aggregate([{ key: "b", v: 1 }, { key: "a", v: 2 }])
  const b = aggregate([{ key: "a", v: 2 }, { key: "b", v: 1 }])
  check("聚合哈希与元素顺序无关", a === b, `${a} vs ${b}`)
  const c = aggregate([{ key: "a", v: 2 }, { key: "b", v: 9 }])
  check("聚合哈希对取值敏感", a !== c, `${a} vs ${c}`)

  // 用例集合必须两边都有，否则判据会一边倒地空洞通过
  check("用例含唯一默认基准", CASES.filter((x) => x.name === "默认").length === 1, "")
  check("用例既有期望不同也有期望相同",
    CASES.some((x) => x.expect === "differ") && CASES.some((x) => x.expect === "same"), "")

  // 针对真实踩过的坑：默认基准曾被写死成一个并非产品默认的常量
  const base = CASES.find((x) => x.name === "默认")
  check("默认基准取自产品默认（不写死字体栈）", base.css === null, String(base.css))

  const neg = missingCase('"PingFang SC", sans-serif')
  check("负向对照 = 不存在的字体 + 默认栈",
    neg.startsWith(`"${MISSING_FONT}"`) && neg.includes("PingFang SC"), neg)

  // 样本必须双语，否则"默认档没变"可能只因中文都回退到同一字体而空洞成立
  check("指纹样本含中文", /[\u4e00-\u9fff]/.test(SAMPLE_TEXT), SAMPLE_TEXT)
  check("指纹样本含拉丁字母", /[A-Za-z]/.test(SAMPLE_TEXT), SAMPLE_TEXT)

  const failed = results.filter((r) => !r.ok)
  for (const r of results) console.log(`    ${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? `  ${r.detail}` : ""}`)
  console.log(`\n  自检：${results.length - failed.length} 通过 / ${failed.length} 失败`)
  process.exit(failed.length === 0 ? 0 : 1)
}

function hashOf(text) {
  return createHash("sha256").update(String(text)).digest("hex").slice(0, 16)
}

/** 按 key 排序后拼接再哈希：与遍历顺序无关。 */
function aggregate(entries) {
  const sorted = [...entries].sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))
  return hashOf(sorted.map((e) => `${e.key}=${e.v}`).join("\n"))
}

/* ── 2. 静态服务 dist ─────────────────────────────────────────────── */
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  ".woff": "font/woff", ".ttf": "font/ttf", ".wasm": "application/wasm",
}

function serve() {
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
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, port: server.address().port })))
}

async function loadPlaywright() {
  const candidates = [
    join(process.env.APPDATA ?? "", "npm/node_modules/playwright/index.js"),
    join(REPO, "node_modules/playwright/index.js"),
  ]
  for (const c of candidates) {
    if (existsSync(c)) {
      const mod = await import(pathToFileURL(c).href)
      return mod.chromium ?? mod.default?.chromium
    }
  }
  throw new Error("找不到 playwright，请先 npx playwright install chromium")
}

/* ── 3. 页面内度量 ───────────────────────────────────────────────── */
const MEASURE = (sample) => {
  const SEL = [
    ".ui-test-root button",
    ".ui-test-root label",
    ".ui-test-root select",
    ".ui-test-root input:not([type=checkbox]):not([type=radio]):not([type=range])",
    ".ui-test-root p",
    ".ui-test-root h1",
    ".ui-test-root h2",
    ".ui-test-root [role=button]",
  ].join(", ")

  const canvas = document.createElement("canvas")
  canvas.width = 420
  canvas.height = 64
  const ctx = canvas.getContext("2d", { willReadFrequently: true })

  /** 用给定字体在 canvas 上画样本文本，返回「像素哈希 + 宽度」。 */
  function fingerprint(fontShorthand) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = fontShorthand
    ctx.textBaseline = "top"
    ctx.fillStyle = "#000"
    ctx.fillText(sample, 4, 4)
    const width = ctx.measureText(sample).width
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    // FNV-1a 32 位
    let h = 0x811c9dc5
    for (let i = 0; i < data.length; i++) {
      h ^= data[i]
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return { hash: h.toString(16), width: Math.round(width * 1000) / 1000 }
  }

  const seen = new Set()
  const out = []
  for (const el of document.querySelectorAll(SEL)) {
    const cs = getComputedStyle(el)
    if (cs.display === "none" || cs.visibility === "hidden") continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    // 稳定的键：按同级序号生成 DOM 路径，避免依赖页面渲染顺序
    const parts = []
    let node = el
    while (node && node !== document.body && parts.length < 6) {
      const parent = node.parentElement
      if (!parent) break
      const idx = Array.prototype.indexOf.call(parent.children, node)
      parts.unshift(`${node.tagName.toLowerCase()}${idx}`)
      node = parent
    }
    const key = parts.join(">")
    if (seen.has(key)) continue
    seen.add(key)
    const text = (el.value ?? el.textContent ?? "").trim().slice(0, 8)
    const fp = fingerprint(`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`)
    out.push({
      key, tag: el.tagName.toLowerCase(), text,
      family: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
      pixelHash: fp.hash, width: fp.width,
    })
  }
  return out
}

/** 写 --qmai-ui-font-family 到 documentElement 行内样式 —— 与 applyUiFontFamily 一致。 */
const APPLY_VAR = (css) => {
  const root = document.documentElement
  if (css === null) root.style.removeProperty("--qmai-ui-font-family")
  else root.style.setProperty("--qmai-ui-font-family", css)
}

/** 读产品真实默认字体栈（临时移除行内覆盖后 :root 的计算值）。 */
const READ_DEFAULT_STACK = () => {
  const root = document.documentElement
  const inline = root.style.getPropertyValue("--qmai-ui-font-family")
  root.style.removeProperty("--qmai-ui-font-family")
  const computed = getComputedStyle(root).getPropertyValue("--qmai-ui-font-family").trim()
  if (inline) root.style.setProperty("--qmai-ui-font-family", inline)
  return computed
}

/** 内联 font-family 直接改元素本身（① 号对照，绕过变量通路）。 */
const OVERRIDE_INLINE = (css) => {
  for (const el of document.querySelectorAll(".ui-test-root button, .ui-test-root label, .ui-test-root select, .ui-test-root p, .ui-test-root h1, .ui-test-root h2")) {
    if (css === null) el.style.removeProperty("font-family")
    else el.style.setProperty("font-family", css)
  }
}

/** 内联 --ui 改容器（② 号对照，只走变量通路）。 */
const OVERRIDE_UI_VAR = (css) => {
  for (const el of document.querySelectorAll(".ui-test-root")) {
    if (css === null) el.style.removeProperty("--ui")
    else el.style.setProperty("--ui", css)
  }
}

async function openSettings(page) {
  await page.waitForTimeout(2500)
  const clickedSettings = await page.evaluate(() => {
    for (const el of document.querySelectorAll(".ui-test-root button, .ui-test-root a")) {
      if ((el.getAttribute("aria-label") ?? "") === "设置") { el.click(); return true }
    }
    return false
  })
  await page.waitForTimeout(1200)
  await page.evaluate((navSel) => {
    const nav = document.querySelector(navSel)
    const btn = nav?.querySelector("[data-ui-settings-category-button]")
    if (btn) btn.click()
  }, SETTINGS_NAV)
  await page.waitForTimeout(800)
  return clickedSettings
}

/* ── 4. CDP 权威证据：Chromium 实际用了哪些字体 ────────────────────── */
async function platformFontsOf(cdp) {
  const out = {}
  for (const sel of [".ui-test-crumb", ".ui-test-page-title", ".ui-test-root button", ".ui-test-root p"]) {
    try {
      const { root } = await cdp.send("DOM.getDocument", { depth: 0 })
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: sel })
      if (!nodeId) continue
      const r = await cdp.send("CSS.getPlatformFontsForNode", { nodeId })
      out[sel] = r.fonts.map((f) => f.familyName).join(" + ")
    } catch {
      // 选择器不存在属正常（不同页面结构不同），不视为失败
    }
  }
  return out
}

/* ── 5. 主流程 ───────────────────────────────────────────────────── */
async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes("--selftest")) return selftest()

  const argVal = (flag) => {
    const i = argv.indexOf(flag)
    if (i < 0) return null
    const v = argv[i + 1]
    if (!v || v.startsWith("--")) {
      console.log(`  ✗ ARG-FAIL：${flag} 后面缺少文件路径`)
      process.exit(1)
    }
    return v
  }
  const recordAt = argVal("--record")
  const compareAt = argVal("--compare")

  if (!existsSync(DIST)) {
    console.log(`  ✗ 找不到构建产物 ${DIST}，请先 npm run build`)
    process.exit(1)
  }

  const chromium = await loadPlaywright()
  const { server, port } = await serve()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("DOM.enable")
  await cdp.send("CSS.enable")
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(String(e).split("\n")[0].slice(0, 120)))

  const guards = []
  const fail = (code, detail) => guards.push({ code, detail })

  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" })
    const opened = await openSettings(page)

    const containerCount = await page.evaluate(() => document.querySelectorAll(".ui-test-root").length)
    if (!opened || containerCount === 0) fail("A/界面未就绪", `未能进入设置页（.ui-test-root 数=${containerCount}）`)

    // ── ① 尺子对照：内联 font-family 必须改变指纹 ──────────────────
    await page.evaluate(APPLY_VAR, null)
    await page.evaluate(OVERRIDE_INLINE, null)
    await page.waitForTimeout(150)
    const appDefaultStack = await page.evaluate(READ_DEFAULT_STACK)
    if (!appDefaultStack) fail("G/默认栈缺失", "读不到 --qmai-ui-font-family 的产品默认值，基准无从建立")
    const baseline = await page.evaluate(MEASURE, SAMPLE_TEXT)

    await page.evaluate(OVERRIDE_INLINE, "SimHei, sans-serif")
    await page.waitForTimeout(150)
    const inline = await page.evaluate(MEASURE, SAMPLE_TEXT)
    await page.evaluate(OVERRIDE_INLINE, null)
    await page.waitForTimeout(150)

    const inlineChanged = countChanged(baseline, inline)
    if (baseline.length >= MIN_ELEMENTS && inlineChanged === 0) {
      fail("B/尺子失效", "直接把元素字体内联改成黑体，指纹却毫无变化 —— 度量方法识别不出换字体，本次所有结论无效")
    }

    // ── ② 尺子对照：内联 --ui 必须改变指纹（变量通路是活的）────────
    await page.evaluate(OVERRIDE_UI_VAR, "SimHei, sans-serif")
    await page.waitForTimeout(150)
    const viaUiVar = await page.evaluate(MEASURE, SAMPLE_TEXT)
    await page.evaluate(OVERRIDE_UI_VAR, null)
    await page.waitForTimeout(150)

    const uiVarChanged = countChanged(baseline, viaUiVar)
    if (baseline.length >= MIN_ELEMENTS && uiVarChanged === 0) {
      fail("C/变量通路断了", "内联 --ui 后指纹无变化 —— var(--ui) 通路本身没有接到任何元素上，本次所有结论无效")
    }

    if (baseline.length < MIN_ELEMENTS) {
      fail("D/样本过少", `只测到 ${baseline.length} 个界面文字元素（下限 ${MIN_ELEMENTS}），页面可能没渲染出来`)
    }

    // ── 主判据：逐个用例 ────────────────────────────────────────────
    const byCase = {}
    const cdpFonts = {}
    for (const c of CASES) {
      const css = c.css === "DYNAMIC_MISSING" ? missingCase(appDefaultStack) : c.css
      await page.evaluate(APPLY_VAR, css)
      await page.waitForTimeout(150)
      byCase[c.name] = await page.evaluate(MEASURE, SAMPLE_TEXT)
      cdpFonts[c.name] = await platformFontsOf(cdp)
    }
    await page.evaluate(APPLY_VAR, null)
    await page.waitForTimeout(150)

    const defaultRec = byCase["默认"]
    const defaultHash = aggregate(defaultRec.map((e) => ({ key: e.key, v: `${e.pixelHash}|${e.width}` })))

    // ── ③ 负向对照：不存在的字体必须与默认一致 ─────────────────────
    const missingRec = byCase["不存在"]
    const missingHash = aggregate(missingRec.map((e) => ({ key: e.key, v: `${e.pixelHash}|${e.width}` })))
    if (missingHash !== defaultHash) {
      fail("E/负向对照失败", "在默认栈前加一个不存在的字体名，指纹却与默认不同 —— 说明指纹变化并非来自字体本身，判据不可信")
    }

    /* ── 输出 ─────────────────────────────────────────────────────── */
    console.log("  ══ 界面字体生效性（真实产物 dist/ · 1440x900）══")
    console.log(`  测到的界面文字元素: ${baseline.length}`)
    console.log(`  产品默认字体栈: ${appDefaultStack.slice(0, 90)}${appDefaultStack.length > 90 ? "…" : ""}`)
    console.log("")
    console.log("  用例       与默认档相比   变化元素数   计算字体（首个元素）")
    console.log("  " + "─".repeat(72))

    let judgeFail = 0
    const diffNames = []
    for (const c of CASES) {
      const rec = byCase[c.name]
      const h = aggregate(rec.map((e) => ({ key: e.key, v: `${e.pixelHash}|${e.width}` })))
      const changed = countChanged(defaultRec, rec)
      const same = h === defaultHash
      const actual = same ? "相同" : "不同"
      const ok = c.expect === "differ" ? !same : same
      if (!ok) judgeFail++
      if (c.expect === "differ" && !same) diffNames.push(c.name)
      const fam = (rec[0]?.family ?? "").split(",")[0].replace(/["']/g, "")
      console.log(`  ${c.name.padEnd(8)} ${actual.padEnd(12)} ${String(changed).padStart(6)}       ${fam}${ok ? "" : "   ← 不符期望"}`)
    }

    console.log("")
    console.log("  ── Chromium 报告的真实渲染字体（权威证据）──")
    const allFontSets = new Set()
    for (const c of CASES) {
      const fonts = cdpFonts[c.name] ?? {}
      const summary = Object.values(fonts).filter(Boolean).join(" / ") || "（取不到）"
      allFontSets.add(JSON.stringify(fonts))
      console.log(`  ${c.name.padEnd(8)} ${summary}`)
    }
    if (allFontSets.size < 2) {
      fail("H/字体未真正改变", "所有用例的 Chromium 实际渲染字体完全相同 —— 说明字体根本没换，本次结论无效")
    }

    console.log("")
    console.log("  ── 尺子自身的对照（任何一项不成立，本次测量结论就不成立）──")
    console.log(`  ① 内联 font-family 对照   变化元素数 ${inlineChanged}  → ${inlineChanged > 0 ? "✓ 度量能识别换字体" : "✗ 识别不出"}`)
    console.log(`  ② 内联 --ui 对照          变化元素数 ${uiVarChanged}  → ${uiVarChanged > 0 ? "✓ var(--ui) 通路是活的" : "✗ 通路没接上"}`)
    console.log(`  ③ 负向对照（不存在字体）  ${missingHash === defaultHash ? "✓ 与默认档相同" : "✗ 与默认档不同"}`)
    console.log(`  ④ 覆盖面                  ${baseline.length} 个元素（下限 ${MIN_ELEMENTS}）${baseline.length >= MIN_ELEMENTS ? " ✓" : " ✗"}`)
    console.log(`  ⑤ 真实字体随用例改变      ${allFontSets.size} 种不同字体组合 ${allFontSets.size >= 2 ? "✓" : "✗"}`)
    console.log(`  ⑥ 默认栈读自产品本身      ${appDefaultStack ? "✓" : "✗"}`)

    /* ── 基线对比 ─────────────────────────────────────────────────── */
    const snapshot = {
      // 记录产品**实际**默认栈，而不是脚本里的某个常量 ——
      // 否则"默认档没变"只能证明脚本没变，证明不了产品没变
      appDefaultStack,
      cases: CASES.map((c) => c.name),
      elementCount: baseline.length,
      defaultHash,
      defaultFamilies: defaultRec.map((e) => ({ key: e.key, family: e.family })),
      cdpFonts,
      perCase: Object.fromEntries(CASES.map((c) => [
        c.name,
        aggregate(byCase[c.name].map((e) => ({ key: e.key, v: `${e.pixelHash}|${e.width}` }))),
      ])),
    }

    if (recordAt) {
      writeFileSync(resolve(REPO, recordAt), JSON.stringify(snapshot, null, 2), "utf8")
      console.log(`\n  已记录基线: ${recordAt}`)
    }

    if (compareAt) {
      const before = JSON.parse(readFileSync(resolve(REPO, compareAt), "utf8"))
      const changedDefault = before.defaultHash !== defaultHash
      const stackChanged = before.appDefaultStack !== appDefaultStack
      const beforeFonts = JSON.stringify(before.cdpFonts?.["默认"] ?? {})
      const nowFonts = JSON.stringify(cdpFonts["默认"] ?? {})
      const fontsChanged = beforeFonts !== nowFonts
      console.log("")
      console.log("  ── 与基线对比（默认档观感是否改变）──")
      console.log(`  基线元素数         ${before.elementCount} → 现在 ${baseline.length}`)
      console.log(`  默认档指纹         ${changedDefault ? "✗ 已改变" : "✓ 完全一致"}`)
      console.log(`  默认档真实渲染字体 ${fontsChanged ? "✗ 已改变" : "✓ 一致"}`)
      console.log(`  默认字体栈字符串   ${stackChanged ? "（已改变 —— 见下）" : "✓ 完全一致"}`)
      /*
       * 判据以「用户看到的东西」为准，不以字体栈字符串为准。
       *
       * 本次修复把两套并存的字体栈合成了一套：旧 index.css 的
       * --qmai-ui-font-family（system-ui 优先）与旧 ui-test.css 硬编码的
       * --ui（PingFang SC 优先，且少了 -apple-system / "Segoe UI" 回退项）。
       * 合并后字符串必然不同，但**实际渲染结果可能完全一样**。
       * 若把"字符串必须逐字相同"当作判据，就会把一次无视觉影响的合并
       * 误判为回归，并逼实施者去做没有必要的"字面保真"。
       *
       * 但这不等于放宽判据：真正在意的就是"用户看到的字形变了没有"，
       * 所以下面两条只要有一条不成立即判失败 —— 指纹（样本含双语）
       * 与浏览器报告的真实字体。两者都相同才允许字符串不同，
       * 且会**打印提示**而不是静默放过。
       */
      if (changedDefault || fontsChanged) {
        const beforeKeys = new Map((before.defaultFamilies ?? []).map((e) => [e.key, e.family]))
        let shown = 0
        for (const e of defaultRec) {
          const prev = beforeKeys.get(e.key)
          if (prev && prev !== e.family && shown < 6) {
            console.log(`    ${e.key}`)
            console.log(`      之前: ${prev}`)
            console.log(`      现在: ${e.family}`)
            shown++
          }
        }
        fail("F/默认档观感改变", changedDefault
          ? `默认档字形与基线不同（${before.defaultHash} → ${defaultHash}）`
          : `默认档 Chromium 实际渲染字体与基线不同（${beforeFonts} → ${nowFonts}）`)
      } else if (stackChanged) {
        console.log("    之前: " + before.appDefaultStack)
        console.log("    现在: " + appDefaultStack)
        console.log("    → 字符串不同、但渲染结果相同（指纹与真实渲染字体均已核对），")
        console.log("      属把两套并存字体栈合并为一套的必然结果，默认观感未变。")
        console.log("      新增的 -apple-system / \"Segoe UI\" 只在前面几个家族全部缺失时")
        console.log("      才会被用到；本机由 Microsoft YaHei UI 提供全部字形，故不可达。")
        console.log("      目标平台为 Windows。")
      }
      const beforeDiffer = CASES.filter((c) => c.expect === "differ" && before.perCase[c.name] !== before.defaultHash).map((c) => c.name)
      const nowDiffer = CASES.filter((c) => c.expect === "differ" && snapshot.perCase[c.name] !== defaultHash).map((c) => c.name)
      console.log(`  修复前能生效的字体: ${beforeDiffer.length ? beforeDiffer.join("、") : "（无 —— 这正是缺陷）"}`)
      console.log(`  现在能生效的字体:   ${nowDiffer.join("、") || "（无）"}`)
      if (beforeDiffer.length === 0 && nowDiffer.length === 0) {
        fail("I/修复未生效", "基线与现在都无字体生效 —— 修复没有产生任何效果")
      }
    }

    console.log("")
    if (pageErrors.length) {
      console.log("  页面报错（非 Tauri 环境下属预期）:")
      for (const e of pageErrors.slice(0, 2)) console.log(`    ${e}`)
      console.log("")
    }

    for (const g of guards) console.log(`  ✗ GUARD-FAIL [${g.code}] ${g.detail}`)
    const verdict = guards.length === 0 && judgeFail === 0
    console.log(`  结论: ${judgeFail === 0 ? `字体档 ${diffNames.length} 个生效、负向对照一致` : `${judgeFail} 个用例不符期望`}，守卫 ${guards.length} 项未通过 → ${verdict ? "✓ 通过" : "✗ 未通过"}`)
    process.exit(verdict ? 0 : 1)
  } finally {
    await browser.close()
    server.close()
  }
}

/** 以 baseline 为基准，统计有多少元素的指纹发生了变化。 */
function countChanged(baseline, other) {
  const byKey = new Map(other.map((e) => [e.key, `${e.pixelHash}|${e.width}`]))
  let n = 0
  for (const e of baseline) {
    const now = byKey.get(e.key)
    if (now !== undefined && now !== `${e.pixelHash}|${e.width}`) n++
  }
  return n
}

main().catch((err) => {
  console.log(`  ✗ 运行失败: ${err?.message ?? err}`)
  process.exit(1)
})
