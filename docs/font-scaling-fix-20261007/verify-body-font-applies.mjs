#!/usr/bin/env node
/**
 * 证明「正文字体」只作用于**文档正文**，且**不影响界面**。
 *
 * ── 这条判据的方向被用户推翻过一次，值得完整记下来 ──
 * 原先这里是反过来的：`--serif` 既当界面衬线层又当正文层，
 * 于是本脚本把**品牌名** `span.ui-test-brand-name` 当作"真实正文元素"，
 * 并要求改「正文字体」时它**必须**一起变（A 方向）。那条断言实际上
 * 是在**认证**一个缺陷：用户在章节里改正文字体后，品牌名、页面标题、
 * 书封标题、对话框标题跟着一起换字形，用户报为"整个界面的字体都变了"。
 * 现在分成两层：界面看 `--serif`（固定），文档正文看 `--body-font`（派生）。
 * 因此本脚本的两个方向都**反向**了：
 *   A. 改了正文字体，**文档正文探针**真的换字形；
 *   B. 改了正文字体，**界面**——界面字体元素**以及**品牌名这样的界面衬线层
 *      ——都**不得**变化。B 现在有两条独立断言，因为用户报的正是后者。
 * 只验证 A 会漏掉 B；只验证 B 会得到一个永远为真的空洞结论。
 * （教训：**一条只描述现状的断言，会把缺陷固化成契约。**）
 *
 * 覆盖面的现实约束（必须如实说明，不能假装测了真实编辑器）：
 * 普通浏览器里**只能到达设置页**，小说编辑器（.ui-test-editor-body / .ProseMirror）
 * 从不挂载 —— 这是已登记的盲区。因此正文规则用
 * **注入真实选择器结构**的方式验证：把 `<div class="ui-test-root">
 * <div class="ui-test-editor-body">…</div></div>` 插进真实页面，
 * 让 `.ui-test-root .ui-test-editor-body` 这条**真实规则**级联生效。
 * 这能证明"CSS 规则本身对变量有反应"，**不能**替代真实 exe 里的目视验证。
 *
 * 尺子自身的对照（任何一项不成立，结论就不成立）：
 *   ① 内联 font-family 对照：直接改元素字体，指纹必须变（尺子有效）
 *   ② 负向对照：在正文栈前加不存在的字体名，指纹必须与默认相同
 *   ③ 覆盖面：界面衬线层对照、文档正文探针、界面字体元素都必须存在
 *   ④ 独立性反向对照：改**界面**字体时，正文探针不得跟着变
 *      （若跟着变，说明两者被串到了一起，A 的结论也就不可信）
 */

import { createServer } from "node:http"
import { createHash } from "node:crypto"
import { readFileSync, existsSync, statSync } from "node:fs"
import { join, extname, resolve, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..")
const DIST = join(REPO, "dist")
const SAMPLE = "青幕AI正文样张Ag"
const MISSING = "__QMaiNoSuchFont__"

/** 正文字体的候选取值（都必须是本机真实存在的字体，否则验的是回退行为）。 */
const BODY_CASES = [
  { name: "楷体", css: "KaiTi, serif" },
  { name: "仿宋", css: "FangSong, serif" },
  { name: "黑体", css: "SimHei, sans-serif" },
]

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
  for (const c of [join(process.env.APPDATA ?? "", "npm/node_modules/playwright/index.js"), join(REPO, "node_modules/playwright/index.js")]) {
    if (existsSync(c)) {
      const mod = await import(pathToFileURL(c).href)
      return mod.chromium ?? mod.default?.chromium
    }
  }
  throw new Error("找不到 playwright")
}

function hashOf(s) { return createHash("sha256").update(String(s)).digest("hex").slice(0, 16) }

/** 注入真实选择器结构（正文规则探针），并返回分组指纹。 */
const MEASURE = (sample) => {
  const canvas = document.createElement("canvas")
  canvas.width = 420
  canvas.height = 64
  const ctx = canvas.getContext("2d", { willReadFrequently: true })

  function fingerprint(shorthand) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = shorthand
    ctx.textBaseline = "top"
    ctx.fillStyle = "#000"
    ctx.fillText(sample, 4, 4)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let h = 0x811c9dc5
    for (let i = 0; i < data.length; i++) { h ^= data[i]; h = Math.imul(h, 0x01000193) >>> 0 }
    return h.toString(16)
  }

  // 注入正文规则探针：用真实类名，让真实 CSS 规则级联生效
  let host = document.getElementById("qmai-body-probe")
  if (!host) {
    const root = document.querySelector(".ui-test-root")
    if (root) {
      host = document.createElement("div")
      host.id = "qmai-body-probe"
      host.className = "ui-test-root"
      host.innerHTML = '<div class="ui-test-editor-body">正文样张文本</div>'
      root.parentElement?.appendChild(host)
    }
  }

  /*
   * 三组样本，各自承担一个方向：
   *   uiBrand  —— 品牌名，属于**界面衬线层**（--serif，固定取值）。
   *               它必须**不**随正文字体变化；用户报的缺陷正是它变了。
   *   docProbe —— 注入的 .ui-test-editor-body，属于**文档正文层**（--body-font）。
   *               它**必须**随正文字体变化，否则设置形同虚设。
   *   uiFont   —— 界面字体元素（--ui），随「界面字体」变化。
   */
  const groups = { uiBrand: [], docProbe: [], uiFont: [] }
  const brand = document.querySelector("span.ui-test-brand-name")
  if (brand) groups.uiBrand.push(brand)
  const probe = host?.querySelector(".ui-test-editor-body")
  if (probe) groups.docProbe.push(probe)

  let uiCount = 0
  for (const el of document.querySelectorAll(".ui-test-root button, .ui-test-root label, .ui-test-root p, .ui-test-root h1, .ui-test-root h2")) {
    if (uiCount >= 40) break
    const cs = getComputedStyle(el)
    if (cs.display === "none" || cs.visibility === "hidden") continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    if (cs.fontFamily.includes("PingFang SC")) { groups.uiFont.push(el); uiCount++ }
  }

  const out = {}
  for (const [k, els] of Object.entries(groups)) {
    out[k] = els.map((el, i) => {
      const cs = getComputedStyle(el)
      return { i, family: cs.fontFamily, fp: fingerprint(`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`) }
    })
  }
  return out
}

const APPLY_BODY = (css) => {
  const r = document.documentElement
  if (css === null) r.style.removeProperty("--qmai-body-font-family")
  else r.style.setProperty("--qmai-body-font-family", css)
}
const APPLY_UI = (css) => {
  const r = document.documentElement
  if (css === null) r.style.removeProperty("--qmai-ui-font-family")
  else r.style.setProperty("--qmai-ui-font-family", css)
}
const OVERRIDE_INLINE = ({ sel, css }) => {
  for (const el of document.querySelectorAll(sel)) {
    if (css === null) el.style.removeProperty("font-family")
    else el.style.setProperty("font-family", css)
  }
}

function hashGroup(rec) {
  return hashOf(rec.map((e) => `${e.i}=${e.fp}`).join("\n"))
}

async function platformFonts(cdp, selector) {
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 })
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector })
    if (!nodeId) return null
    const r = await cdp.send("CSS.getPlatformFontsForNode", { nodeId })
    return r.fonts.map((f) => f.familyName).join(" + ")
  } catch { return null }
}

async function main() {
  if (!existsSync(DIST)) { console.log(`  ✗ 找不到 ${DIST}，请先 npm run build`); process.exit(1) }
  const chromium = await loadPlaywright()
  const { server, port } = await serve()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable")

  const guards = []
  const fail = (code, detail) => guards.push({ code, detail })

  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" })
    await page.waitForTimeout(2500)
    await page.evaluate(() => {
      for (const el of document.querySelectorAll(".ui-test-root button, .ui-test-root a")) {
        if ((el.getAttribute("aria-label") ?? "") === "设置") { el.click(); return }
      }
    })
    await page.waitForTimeout(1500)

    await page.evaluate(APPLY_BODY, null)
    await page.evaluate(APPLY_UI, null)
    await page.waitForTimeout(150)
    const base = await page.evaluate(MEASURE, SAMPLE)
    const baseHashes = {
      uiBrand: hashGroup(base.uiBrand),
      docProbe: hashGroup(base.docProbe),
      uiFont: hashGroup(base.uiFont),
    }

    if (base.uiBrand.length === 0) fail("A/界面衬线层对照缺失", "页面上找不到 span.ui-test-brand-name —— 无法验证「正文字体不得漏到界面」这条方向")
    if (base.docProbe.length === 0) fail("B/正文探针未注入", "注入 .ui-test-root .ui-test-editor-body 后仍取不到元素，正文规则无法验证")
    if (base.uiFont.length < 5) fail("C/界面字体样本过少", `只找到 ${base.uiFont.length} 个界面字体元素（下限 5）`)

    // ① 尺子有效：内联 font-family 必须改变指纹
    await page.evaluate(OVERRIDE_INLINE, { sel: "span.ui-test-brand-name", css: "SimHei, sans-serif" })
    await page.evaluate(OVERRIDE_INLINE, { sel: ".ui-test-editor-body", css: "SimHei, sans-serif" })
    await page.waitForTimeout(150)
    const inline = await page.evaluate(MEASURE, SAMPLE)
    await page.evaluate(OVERRIDE_INLINE, { sel: "span.ui-test-brand-name", css: null })
    await page.evaluate(OVERRIDE_INLINE, { sel: ".ui-test-editor-body", css: null })
    await page.waitForTimeout(150)
    const rulerOk = hashGroup(inline.uiBrand) !== baseHashes.uiBrand
      && hashGroup(inline.docProbe) !== baseHashes.docProbe
    if (!rulerOk) fail("D/尺子失效", "直接把正文元素字体内联改成黑体，指纹却无变化 —— 度量方法识别不出换字体，本次结论无效")

    // ② 负向对照：正文栈前加一个不存在的字体名，指纹必须与默认相同
    await page.evaluate(APPLY_BODY, `"${MISSING}", "Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif`)
    await page.waitForTimeout(150)
    const missingRec = await page.evaluate(MEASURE, SAMPLE)
    await page.evaluate(APPLY_BODY, null)
    await page.waitForTimeout(150)
    if (hashGroup(missingRec.docProbe) !== baseHashes.docProbe) {
      fail("E/负向对照失败", "正文栈前加不存在的字体名，指纹却与默认不同 —— 指纹变化并非来自字体本身")
    }

    // ④ 独立性反向对照：改界面字体，正文探针不得跟着变
    await page.evaluate(APPLY_UI, "SimHei, sans-serif")
    await page.waitForTimeout(150)
    const uiChanged = await page.evaluate(MEASURE, SAMPLE)
    await page.evaluate(APPLY_UI, null)
    await page.waitForTimeout(150)
    const uiChangedProbe = hashGroup(uiChanged.docProbe) !== baseHashes.docProbe
    const uiChangedBrand = hashGroup(uiChanged.uiBrand) !== baseHashes.uiBrand
    const uiChangedUi = hashGroup(uiChanged.uiFont) !== baseHashes.uiFont

    console.log("  ══ 正文字体只作用于文档正文、不碰界面（真实 dist/ · 1440x900）══")
    console.log(`  界面衬线层对照: ${base.uiBrand.length} 个（span.ui-test-brand-name —— 必须**不**随正文字体变）`)
    console.log(`  文档正文探针:   ${base.docProbe.length} 个（.ui-test-root .ui-test-editor-body，真实选择器）`)
    console.log(`  界面字体元素:   ${base.uiFont.length} 个`)
    console.log("")
    console.log("  ── 改「正文字体」时（期望：正文探针变；界面衬线层与界面字体都不变）──")
    console.log("  取值     正文(探针)   界面衬线层   界面字体")
    console.log("  " + "─".repeat(52))

    let bodyFail = 0
    /* 按原因分类收集，让失败信息**指名道姓**而不是只给一个数字 */
    const leakedBrand = []
    const leakedUi = []
    const noEffect = []
    for (const c of BODY_CASES) {
      await page.evaluate(APPLY_BODY, c.css)
      await page.waitForTimeout(150)
      const rec = await page.evaluate(MEASURE, SAMPLE)
      const dBrand = hashGroup(rec.uiBrand) !== baseHashes.uiBrand
      const dProbe = hashGroup(rec.docProbe) !== baseHashes.docProbe
      const dUi = hashGroup(rec.uiFont) !== baseHashes.uiFont
      /*
       * 三个条件缺一不可：
       *   dProbe  —— 设置真的生效（否则是"改了没反应"）
       *   !dBrand —— 正文字体**没有**漏到界面衬线层（用户报过的缺陷）
       *   !dUi    —— 正文字体**没有**漏到界面字体
       */
      const ok = dProbe && !dBrand && !dUi
      if (!ok) bodyFail++
      if (dBrand) leakedBrand.push(c.name)
      if (dUi) leakedUi.push(c.name)
      if (!dProbe) noEffect.push(c.name)
      console.log(`  ${c.name.padEnd(8)} ${(dProbe ? "已变" : "未变 ← 失效！").padEnd(12)} ${dBrand ? "已变 ← 漏到界面！" : "未变"}     ${dUi ? "已变 ← 串味！" : "未变"}${ok ? "" : "   ← 不符期望"}`)
    }
    await page.evaluate(APPLY_BODY, null)
    await page.waitForTimeout(150)
    if (leakedBrand.length) {
      fail("J/正文字体漏到界面衬线层",
        `改「正文字体」时品牌名（--serif，界面衬线层）跟着变了：${leakedBrand.join(" / ")}`
        + ` —— 这正是用户报过的缺陷（"整个界面的字体都变了"）：正文层与界面层又合并成了一个变量`)
    }
    if (leakedUi.length) {
      fail("K/正文字体漏到界面字体", `改「正文字体」时界面字体元素也跟着变了：${leakedUi.join(" / ")}`)
    }
    if (noEffect.length) {
      fail("L/正文字体未生效", `改「正文字体」时文档正文探针毫无变化：${noEffect.join(" / ")} —— 设置形同虚设`)
    }

    console.log("")
    console.log("  ── 改「界面字体」时（期望：只有界面变，正文不受影响）──")
    console.log(`  正文(探针) ${uiChangedProbe ? "已变 ← 串味！" : "未变"}；界面衬线层 ${uiChangedBrand ? "已变（界面衬线层固定，不该变）" : "未变"}；界面字体 ${uiChangedUi ? "已变" : "未变"}`)
    if (!uiChangedUi) fail("F/界面字体未生效", "改界面字体后界面元素指纹无变化 —— 反向对照不成立，独立性结论不可信")
    if (uiChangedProbe) fail("G/两个字体互相串味", "改界面字体时正文也跟着变了 —— 界面字体与正文字体没有真正独立")

    console.log("")
    console.log("  ── Chromium 报告的真实渲染字体（权威证据）──")
    const cdpRows = []
    for (const c of [{ name: "默认", css: null }, ...BODY_CASES.map((x) => ({ name: x.name, css: x.css }))]) {
      await page.evaluate(APPLY_BODY, c.css)
      await page.waitForTimeout(150)
      const probeFont = await platformFonts(cdp, "#qmai-body-probe .ui-test-editor-body")
      const brandFont = await platformFonts(cdp, "span.ui-test-brand-name")
      const uiFontReal = await platformFonts(cdp, ".ui-test-root button")
      cdpRows.push({ name: c.name, probeFont, brandFont, uiFontReal })
      console.log(`  ${c.name.padEnd(8)} 正文探针=${probeFont ?? "(取不到)"}  界面衬线层=${brandFont ?? "(取不到)"}  界面=${uiFontReal ?? "(取不到)"}`)
    }
    await page.evaluate(APPLY_BODY, null)
    await page.waitForTimeout(150)
    const probeFonts = new Set(cdpRows.map((r) => r.probeFont))
    if (probeFonts.size < 2) fail("H/正文真实字体未改变", "Chromium 报告的正文字体在所有用例间完全相同 —— 说明字体根本没换")
    const uiFonts = new Set(cdpRows.map((r) => r.uiFontReal))
    if (uiFonts.size !== 1) fail("I/界面字体被正文设置影响", `改正文字体时界面字体也变了（${[...uiFonts].join(" / ")}）`)
    /*
     * 与 J 号守卫互补：J 用像素指纹，这里用 Chromium 报告的**真实渲染字体族**。
     * 两者独立 —— 指纹相同理论上仍可能换到另一个字形完全相同的字体上，
     * 而字体族名可以直接看出来。品牌名必须始终是那一套宋体系。
     */
    const brandFonts = new Set(cdpRows.map((r) => r.brandFont))
    if (brandFonts.size !== 1) {
      fail("M/界面衬线层真实字体被正文设置影响",
        `改正文字体时品牌名的真实渲染字体族也变了（${[...brandFonts].join(" / ")}）—— 界面观感被正文设置带偏`)
    }

    console.log("")
    console.log("  ── 尺子自身的对照 ──")
    console.log(`  ① 内联 font-family 对照   ${rulerOk ? "✓ 度量能识别换字体" : "✗ 识别不出"}`)
    console.log(`  ② 负向对照（不存在字体） ${hashGroup(missingRec.docProbe) === baseHashes.docProbe ? "✓ 与默认档相同" : "✗ 与默认档不同"}`)
    console.log(`  ③ 覆盖面                 界面衬线层 ${base.uiBrand.length} / 正文探针 ${base.docProbe.length} / 界面 ${base.uiFont.length}`)
    console.log(`  ④ 界面字体反向对照       ${uiChangedUi ? "✓ 确实改变了" : "✗ 没变"}`)
    console.log("")
    console.log("  说明：普通浏览器只到得了设置页，小说编辑器从不挂载（已登记盲区）。")
    console.log("       正文规则用**注入真实选择器结构**验证，只证明 CSS 规则对变量有反应，")
    console.log("       不能替代真实 exe 里的目视验证（任务 10）。")

    for (const g of guards) console.log(`  ✗ GUARD-FAIL [${g.code}] ${g.detail}`)
    const verdict = guards.length === 0 && bodyFail === 0
    console.log(`  结论: ${bodyFail === 0 ? "正文字体各档均生效，且界面（含界面衬线层品牌名）不受影响" : `${bodyFail} 档不符期望`}，守卫 ${guards.length} 项未通过 → ${verdict ? "✓ 通过" : "✗ 未通过"}`)
    process.exit(verdict ? 0 : 1)
  } finally {
    await browser.close()
    server.close()
  }
}

main().catch((e) => { console.log(`  ✗ 运行失败: ${e?.message ?? e}`); process.exit(1) })
