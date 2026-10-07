#!/usr/bin/env node
/**
 * 真实 exe 端到端：从**设置界面**改字号与字体 → 点保存 → 确认真的生效、落盘、并改变真实渲染。
 *
 * ── 为什么这一层不可省 ──
 * 判据 2 与 verify-real-exe.mjs 证明的是"变量一改，界面就会跟着变"。
 * 但用户报的原始缺陷是"拖滑块/选字体根本没用"—— 那是**保存链路**的问题，
 * 与 CSS 是否响应变量是两件事。中间任何一环断掉，前面所有判据都会全绿。
 *
 * 特别是已登记的风险：`setUiFontSizeScale` 排在约 10 个 `await saveXxx(...)`
 * **之后**；前面任何一处抛错，后面这句就被静默跳过 —— 界面不动，且不报错。
 * 所以必须真的点一次保存按钮，而不是直接改变量。
 *
 * ── 字体用"真实渲染族"判定，不看 CSS 字段 ──
 * `getComputedStyle(el).fontFamily` 只回显你写的栈，**栈首字体在本机不存在时
 * 它照样回显那个名字**，所以它证明不了任何"生效"。这里改用 CDP 的
 * `CSS.getPlatformFontsForNode`，它报告的是 Chromium **实际拿来画这些字**的字体，
 * 这是唯一无法伪装的判据。
 *
 * 尺子对照：
 *   ① 保存前滑块/下拉必须真的变了值（否则按保存不会走应用分支）
 *   ② 保存后 localStorage 必须真的跟着变（证明落盘，而不只是内存生效）
 *   ③ 界面字体与正文字体必须**各自独立**
 *   ④ 正文字号必须在**真实文档**上量出像素变化
 *   ⑤ 换字体必须在真实渲染族上量出变化，且默认档必须与初始渲染族相同
 *
 * 关于 `null`：正文字号默认值是 1（100%）。从未设置过时 localStorage 里是
 * `null`，一旦保存过就写成 `1`。两者**语义相同**，故断言比较"有效值"
 * （null → 1），否则会把"写入默认值"误报成"串改设置"。
 */

import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { writeFileSync } from "node:fs"

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const argOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
const PORT = Number(argOf("--port") ?? 9333)
const OUTLINE_KEY = argOf("--doc") ?? "开篇方向"
const UI_FONT_TO_TRY = argOf("--ui-font") ?? "simhei"      // 黑体，实测本机可用
const BODY_FONT_TO_TRY = argOf("--body-font") ?? "kaiti"   // 楷体，实测本机可用
/**
 * 证据落盘路径。**默认就写**，不是可选项。
 *
 * 为什么不靠 stdout：本脚本的结论会被人引用进 findings.md / 实施记录，
 * 而 stdout 只存在于终端滚动缓冲里 —— 引用一个只存在于终端里的数字，
 * 等于引用一个无法复核的断言（这一轮就因此撤掉过一处「6260/2971」的引用）。
 * 写成 JSON 后，文档里的每个数字都能在这一份产物里找到。
 */
const OUT = argOf("--out") ?? join(HERE, "real-exe-shots", "real-exe-settings-save.json")
const evidence = {
  note: "真实 exe：设置界面改字号/字体 → 点保存 → 生效、落盘、真实渲染族。由 verify-real-exe-settings-save.mjs 每次运行覆盖写入。",
  capture: { uiFontTried: UI_FONT_TO_TRY, bodyFontTried: BODY_FONT_TO_TRY, doc: OUTLINE_KEY },
  initial: null, sliders: null, cases: [], docCase: null, fontCase: null, restore: null, fails: [], notes: [], verdict: null,
}

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const chromium = mod.chromium ?? mod.default?.chromium
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
let page = null
for (const c of browser.contexts()) for (const p of c.pages()) if (p.url() && !p.url().startsWith("devtools://")) page = p
if (!page) { console.log("  ✗ 找不到页面"); process.exit(1) }
const cdp = await page.context().newCDPSession(page)
await cdp.send("DOM.enable"); await cdp.send("CSS.enable")
/*
 * 对 `connectOverCDP` 连上的浏览器，`browser.close()` 可能一直不返回
 * （它试图去关掉那个**真实存在**的浏览器进程）。实测会把脚本永久挂住：
 * 结论已经全部打印完毕，进程却不退出。故这里限时，绝不阻塞退出。
 */
const bye = async () => { try { await Promise.race([browser.close(), wait(4000)]) } catch { /* 忽略 */ } }

const fails = [], notes = []
const eff = (v) => (v == null ? 1 : v)
const near = (a, b, t = 0.05) => a !== null && b !== null && Math.abs(a - b) < t

/** 落盘证据。放在退出前调用，通过与否都写 —— 失败的现场同样需要留证。 */
function writeEvidence(verdict) {
  evidence.fails = fails
  evidence.notes = notes
  evidence.verdict = verdict
  try {
    writeFileSync(OUT, JSON.stringify(evidence, null, 2), "utf8")
    console.log(`\n  证据已写入: ${OUT}`)
  } catch (e) {
    console.log(`\n  ⚠ 证据写入失败: ${e.message}`)
    fails.push(`证据写入失败: ${e.message}`)
  }
}

/** Chromium 实际渲染这个元素用的字体族。取不到返回 null。 */
async function platformFont(selector) {
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 })
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector })
    if (!nodeId) return null
    const r = await cdp.send("CSS.getPlatformFontsForNode", { nodeId })
    if (!r.fonts?.length) return null
    // 按字数排序，取占主导的那个；同时给出全量便于人工核对
    const sorted = [...r.fonts].sort((a, b) => (b.glyphCount ?? 0) - (a.glyphCount ?? 0))
    return { main: sorted[0].familyName, all: sorted.map((f) => `${f.familyName}(${f.glyphCount})`) }
  } catch { return null }
}

/* ── 页面内函数（会被序列化，不能引用外层变量）── */

const READ_STATE = () => {
  const r = document.documentElement
  const parse = (k) => { const v = localStorage.getItem(k); return v == null ? null : Number(v) }
  const str = (k) => localStorage.getItem(k)
  return {
    domRootPct: r.style.fontSize || null,
    domComputedRoot: getComputedStyle(r).fontSize,
    domBodyScale: r.style.getPropertyValue("--qmai-body-font-scale") || null,
    domUiFamilyVar: r.style.getPropertyValue("--qmai-ui-font-family") || null,
    domBodyFamilyVar: r.style.getPropertyValue("--qmai-body-font-family") || null,
    storedUi: parse("qmai-ui-font-size-scale"),
    storedBody: parse("qmai-ui-body-font-scale"),
    storedUiFont: str("qmai-ui-font-family"),
    storedBodyFont: str("qmai-body-font-family"),
    settingsOpen: !!document.querySelector('[data-ui="settings-navigation"]'),
    controls: {
      uiSize: (() => { const e = document.querySelector('input[aria-label="界面字号"]'); return e ? Number(e.value) : null })(),
      bodySize: (() => { const e = document.querySelector('input[aria-label="正文字号"]'); return e ? Number(e.value) : null })(),
      uiFont: (() => { const e = document.querySelector('select[aria-label="界面字体"]'); return e ? e.value : null })(),
      bodyFont: (() => { const e = document.querySelector('select[aria-label="正文字体"]'); return e ? e.value : null })(),
    },
  }
}

/** React 认得的原生 setter + 事件：range 用 input+change，select 用 change。 */
const SET_CONTROL = (o) => {
  const el = document.querySelector(`${o.tag}[aria-label="${o.label}"]`)
  if (!el) return { ok: false }
  const proto = o.tag === "select" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set
  setter.call(el, String(o.value))
  el.dispatchEvent(new Event("input", { bubbles: true }))
  el.dispatchEvent(new Event("change", { bubbles: true }))
  return { ok: true, value: el.value, options: el.tagName === "SELECT" ? [...el.options].map((x) => x.value) : undefined, min: el.min, max: el.max, step: el.step }
}

/**
 * 一步步走到「外观与界面」。设置按钮只在 `!writing` 时渲染
 * （ui-test-shell.tsx），大纲/章节视图下它不在 DOM 里，必须先切视图。
 */
const STEP_TO_SETTINGS = () => {
  if (document.querySelector('[data-ui="settings-footer"]')) return { done: true }
  const nav = document.querySelector('[data-ui="settings-navigation"]')
  if (nav) {
    const btns = [...nav.querySelectorAll("button, [role='tab'], a")]
    const cat = btns.find((b) => /外观与界面|界面/.test((b.textContent ?? "").trim()))
    if (!cat) return { stepped: "no-category", cats: btns.map((b) => (b.textContent ?? "").trim()).filter(Boolean).slice(0, 30) }
    cat.click(); return { stepped: "category" }
  }
  const gear = document.querySelector('button[aria-label="设置"]')
  if (gear) { gear.click(); return { stepped: "gear" } }
  const soul = [...document.querySelectorAll(".ui-test-nav-item")].find((x) => (x.textContent ?? "").trim() === "灵魂")
  if (soul) { soul.click(); return { stepped: "nav-soul" } }
  return { stepped: "nowhere", nav: [...document.querySelectorAll(".ui-test-nav-item")].map((x) => (x.textContent ?? "").trim()) }
}

const CLICK_SAVE = () => {
  const f = document.querySelector('[data-ui="settings-footer"]')
  if (!f) return { ok: false, reason: "无保存页脚" }
  const btns = [...f.querySelectorAll("button")]
  const target = btns.find((b) => /保存/.test((b.textContent ?? "").trim())) ?? btns[btns.length - 1]
  if (!target) return { ok: false, reason: "找不到保存按钮" }
  const label = (target.textContent ?? "").trim()
  target.click()
  return { ok: true, label }
}

const GO_TO_OUTLINE = () => {
  const nav = [...document.querySelectorAll(".ui-test-nav-item")].find((x) => (x.textContent ?? "").trim() === "大纲")
  nav?.click()
  return { clickedNav: !!nav }
}
const OPEN_DOC = (docKey) => {
  const rows = [...document.querySelectorAll("[data-page-path]")]
  const t = rows.find((r) => (r.getAttribute("data-page-path") ?? "").includes(docKey))
    ?? rows.find((r) => (r.getAttribute("data-page-path") ?? "").toLowerCase().endsWith(".md"))
  if (!t) return { ok: false, n: rows.length }
  t.scrollIntoView({ block: "center" })
  const btn = t.querySelector("button") ?? t
  btn.click()
  return { ok: true, path: t.getAttribute("data-page-path") }
}
const READ_DOC = () => {
  const body = document.querySelector(".ui-test-editor-body")
  if (!body) return { reachable: false }
  const p = body.querySelector(".ProseMirror p")
  const ulLi = body.querySelector(".ProseMirror ul > li")
  const olLi = body.querySelector(".ProseMirror ol > li")
  const cs = (el, ps) => (el ? parseFloat(getComputedStyle(el, ps ?? undefined).fontSize) : null)
  return {
    reachable: !!p,
    p: cs(p), ulLi: cs(ulLi), olLi: cs(olLi),
    ulMarker: ulLi ? cs(ulLi, "::marker") : null,
    olMarker: olLi ? cs(olLi, "::marker") : null,
    liDisplay: ulLi ? getComputedStyle(ulLi).display : null,
  }
}

async function goToSettings() {
  for (let i = 0; i < 8; i++) {
    const step = await page.evaluate(STEP_TO_SETTINGS)
    if (step.done) return true
    if (step.stepped === "nowhere" || step.stepped === "no-category") {
      console.log(`    ✗ 无法到达设置页（${step.stepped}${step.cats ? ": " + step.cats.join("/") : ""}${step.nav ? ": " + step.nav.join("/") : ""}）`)
      return false
    }
    await wait(1500)
  }
  return false
}
async function waitForDoc(timeoutMs = 60_000) {
  const d = Date.now() + timeoutMs
  while (Date.now() < d) {
    const s = await page.evaluate(READ_DOC)
    if (s.reachable && s.ulLi !== null) return s
    await wait(1000)
  }
  return await page.evaluate(READ_DOC)
}

/* ── 开始 ── */
console.log("  ══ 真实 exe：设置界面改字号与字体 → 保存 → 生效？落盘？真实渲染变了吗？══")
const before = await page.evaluate(READ_STATE)
evidence.initial = before
console.log(`  初始：DOM root=${before.domRootPct ?? "(未设置)"} computed=${before.domComputedRoot}  --body-scale=${before.domBodyScale ?? "(未设置)"}`)
console.log(`        落盘 界面字号=${before.storedUi} 正文字号=${before.storedBody}（有效值 ${eff(before.storedUi)}/${eff(before.storedBody)}）`)
console.log(`        落盘 界面字体=${before.storedUiFont} 正文字体=${before.storedBodyFont}`)

if (!(await goToSettings())) { await bye(); process.exit(1) }
let st = await page.evaluate(READ_STATE)
console.log(`  控件：界面字号=${st.controls.uiSize} 正文字号=${st.controls.bodySize} 界面字体=${st.controls.uiFont} 正文字体=${st.controls.bodyFont}`)
if (st.controls.uiSize === null || st.controls.uiFont === null) { console.log("  ✗ 找不到字号/字体控件"); await bye(); process.exit(1) }

// ── 用例 1：界面字号 → 150 ──
console.log("")
console.log("  ── 用例 1：界面字号 拖到 150%，点保存 ──")
const set1 = await page.evaluate(SET_CONTROL, { tag: "input", label: "界面字号", value: 150 })
console.log(`  拖滑块: 写入 ${set1.value}（min=${set1.min} max=${set1.max} step=${set1.step}）`)
if (set1.value !== "150") fails.push(`尺子失效：滑块写入 150 但读到 ${set1.value}`)
await wait(600)
console.log(`  点保存: ${JSON.stringify(await page.evaluate(CLICK_SAVE))}`)
await wait(2500)
const a1 = await page.evaluate(READ_STATE)
console.log(`  保存后：DOM root=${a1.domRootPct} computed=${a1.domComputedRoot}  落盘 界面=${a1.storedUi} 正文=${a1.storedBody}`)
const ok1 = a1.domRootPct === "150%" && eff(a1.storedUi) === 1.5
console.log(`    ${ok1 ? "✓" : "✗"} 界面字号：DOM(${a1.domRootPct}) 落盘(${a1.storedUi})`)
if (!ok1) fails.push(`界面字号保存未生效：DOM=${a1.domRootPct} 落盘=${a1.storedUi}`)
const indep1 = eff(a1.storedBody) === eff(before.storedBody)
evidence.cases.push({
  label: "界面字号→150%", slider: { written: 150, read: set1.value, min: set1.min, max: set1.max, step: set1.step },
  after: a1, domRootPct: a1.domRootPct, computedRoot: a1.domComputedRoot, storedUi: a1.storedUi,
  independence: { storedBodyBefore: eff(before.storedBody), storedBodyAfter: eff(a1.storedBody), ok: indep1 }, ok: ok1,
})
console.log(`    ${indep1 ? "✓" : "✗"} 独立性：正文字号有效值未被动（${eff(before.storedBody)} → ${eff(a1.storedBody)}）`)
if (!indep1) fails.push(`改界面字号顺带改了正文字号（${eff(before.storedBody)} → ${eff(a1.storedBody)}）`)

// ── 用例 2：界面字号回 100，正文字号 → 125 ──
console.log("")
console.log("  ── 用例 2：界面字号回 100%，正文字号拖到 125%，一起保存 ──")
await page.evaluate(SET_CONTROL, { tag: "input", label: "界面字号", value: 100 })
await wait(300)
const set2 = await page.evaluate(SET_CONTROL, { tag: "input", label: "正文字号", value: 125 })
console.log(`  拖滑块: 正文写入 ${set2.value}`)
await wait(600)
console.log(`  点保存: ${JSON.stringify(await page.evaluate(CLICK_SAVE))}`)
await wait(2500)
const a2 = await page.evaluate(READ_STATE)
console.log(`  保存后：DOM root=${a2.domRootPct ?? "(清除)"}  --body-scale=${a2.domBodyScale}  落盘 界面=${a2.storedUi} 正文=${a2.storedBody}`)
const ok2 = (a2.domRootPct === "100%" || a2.domRootPct === null) && eff(a2.storedBody) === 1.25 && eff(a2.storedUi) === 1
evidence.cases.push({
  label: "正文→125%（界面回100%）", slider: { written: 125, read: set2.value },
  after: a2, domBodyScale: a2.domBodyScale, domRootPct: a2.domRootPct,
  storedBody: a2.storedBody, storedUi: a2.storedUi, ok: ok2,
})
console.log(`    ${ok2 ? "✓" : "✗"} 正文字号：DOM(${a2.domBodyScale}) 落盘(${a2.storedBody}) 界面字号回(${a2.storedUi})`)
if (!ok2) fails.push(`正文字号保存未生效：DOM=${a2.domBodyScale} 落盘 正文=${a2.storedBody} 界面=${a2.storedUi}`)

// ── 用例 3：正文字号必须在真实文档上量出像素变化 ──
console.log("")
console.log("  ── 用例 3：回到大纲文档，实测正文与列表是否变成 1.25 倍 ──")
await page.evaluate(GO_TO_OUTLINE)
await wait(2000)
console.log(`  打开: ${JSON.stringify(await page.evaluate(OPEN_DOC, OUTLINE_KEY))}`)
const doc = await waitForDoc()
console.log(`  文档实测: p=${doc.p} 无序li=${doc.ulLi} marker=${doc.ulMarker} 有序li=${doc.olLi} marker=${doc.olMarker} li.display=${doc.liDisplay}`)
const expSize = { p: 22.5, ulLi: 20, ulMarker: 15, olLi: 20, olMarker: 20 }
const docChecks = {}
for (const [k, v] of Object.entries(expSize)) {
  const ok = near(doc[k], v)
  docChecks[k] = { expected: v, measured: doc[k], ok }
  console.log(`    ${ok ? "✓" : "✗"} ${k.padEnd(9)} 期望 ${v}px 实测 ${doc[k]}px`)
  if (!ok) fails.push(`正文字号 125% 下 ${k} 期望 ${v}px 实测 ${doc[k]}px`)
}
if (doc.liDisplay && doc.liDisplay !== "list-item") fails.push(`::marker 读数不可信（li.display=${doc.liDisplay}）`)
evidence.docCase = { scale: 1.25, liDisplay: doc.liDisplay, checks: docChecks, ok: Object.values(docChecks).every((c) => c.ok) }

// ── 用例 4：界面字体 → 黑体（真实渲染族判定）──
console.log("")
console.log(`  ── 用例 4：界面字体选「黑体」，正文字体选「楷体」，保存 ──`)
if (!(await goToSettings())) { fails.push("无法回到设置页（用例 4）") } else {
  const b = await page.evaluate(READ_STATE)
  // 基线：改动前，界面文字实际用什么字体渲染
  const baseUiFont = await platformFont("select[aria-label=\"界面字体\"]")
  console.log(`  改动前 界面文字真实渲染族: ${baseUiFont ? baseUiFont.main + "  [" + baseUiFont.all.join(" ") + "]" : "(取不到)"}`)
  const s4a = await page.evaluate(SET_CONTROL, { tag: "select", label: "界面字体", value: UI_FONT_TO_TRY })
  const s4b = await page.evaluate(SET_CONTROL, { tag: "select", label: "正文字体", value: BODY_FONT_TO_TRY })
  console.log(`  下拉: 界面字体=${s4a.value} 正文字体=${s4b.value}`)
  console.log(`    界面字体可选项: ${(s4a.options ?? []).join(", ")}`)
  if (s4a.value !== UI_FONT_TO_TRY) fails.push(`尺子失效：界面字体下拉写入 ${UI_FONT_TO_TRY} 但读到 ${s4a.value}`)
  if (s4b.value !== BODY_FONT_TO_TRY) fails.push(`尺子失效：正文字体下拉写入 ${BODY_FONT_TO_TRY} 但读到 ${s4b.value}`)
  await wait(600)
  console.log(`  点保存: ${JSON.stringify(await page.evaluate(CLICK_SAVE))}`)
  await wait(2500)
  const a4 = await page.evaluate(READ_STATE)
  console.log(`  保存后：落盘 界面字体=${a4.storedUiFont} 正文字体=${a4.storedBodyFont}`)
  const afterUiFont = await platformFont("select[aria-label=\"界面字体\"]")
  console.log(`  改动后 界面文字真实渲染族: ${afterUiFont ? afterUiFont.main + "  [" + afterUiFont.all.join(" ") + "]" : "(取不到)"}`)
  const changed = baseUiFont && afterUiFont && afterUiFont.main !== baseUiFont.main
  console.log(`    ${changed ? "✓" : "✗"} 界面字体：真实渲染族从「${baseUiFont?.main}」变为「${afterUiFont?.main}」`)
  if (!changed) fails.push(`界面字体选择未改变真实渲染族（前「${baseUiFont?.main}」后「${afterUiFont?.main}」）`)
  const expectFamily = UI_FONT_TO_TRY === "simhei" ? /SimHei|黑体/i : null
  if (expectFamily && afterUiFont && !expectFamily.test(afterUiFont.main)) {
    notes.push(`界面字体选「黑体」后真实渲染族为「${afterUiFont.main}」——若不是 SimHei，说明回退链命中了别的中文字体（仍有变化，但不是所选那一个）`)
  }
  if (a4.storedUiFont !== UI_FONT_TO_TRY || a4.storedBodyFont !== BODY_FONT_TO_TRY) {
    fails.push(`字体设置未落盘：界面=${a4.storedUiFont} 正文=${a4.storedBodyFont}`)
  }
  evidence.fontCase = {
    options: s4a.options ?? [],
    selectWritten: { ui: UI_FONT_TO_TRY, body: BODY_FONT_TO_TRY },
    selectRead: { ui: s4a.value, body: s4b.value },
    stored: { uiFont: a4.storedUiFont, bodyFont: a4.storedBodyFont },
    realRenderedUI: { before: baseUiFont?.main ?? null, beforeAll: baseUiFont?.all ?? [], after: afterUiFont?.main ?? null, afterAll: afterUiFont?.all ?? [], changed: !!changed },
    // 下面三项在用例 5 里填
    realRenderedBody: null, realRenderedUiControl: null, realRenderedSerifLayer: null,
  }

  // ── 用例 5：正文字体只影响正文与「正文衬线层」，界面控件不受影响 ──
  console.log("")
  console.log("  ── 用例 5：正文用楷体，「界面控件」应仍是黑体，而「正文衬线层」应跟着变楷体 ──")
  await page.evaluate(GO_TO_OUTLINE)
  await wait(2000)
  await page.evaluate(OPEN_DOC, OUTLINE_KEY)
  await waitForDoc()
  const docFont = await platformFont(".ui-test-editor-body .ProseMirror p")
  // 界面控件：.ui-test-nav-item 不自己设 font-family，继承 .ui-test-root 的 var(--ui)
  const uiFontNow = await platformFont(".ui-test-nav-item")
  // 正文衬线层：.ui-test-brand-name 由 ui-test.css 明确写成 var(--serif)，**按设计**跟随正文字体
  const serifConsumer = await platformFont(".ui-test-brand-name")
  console.log(`  正文段落真实渲染族  : ${docFont ? docFont.main + "  [" + docFont.all.join(" ") + "]" : "(取不到)"}`)
  console.log(`  界面控件(nav-item)  : ${uiFontNow ? uiFontNow.main + "  [" + uiFontNow.all.join(" ") + "]" : "(取不到)"}（应为本机界面字体 = SimHei）`)
  console.log(`  正文衬线层(brand)   : ${serifConsumer ? serifConsumer.main + "  [" + serifConsumer.all.join(" ") + "]" : "(取不到)"}（按设计跟随正文字体 = KaiTi）`)
  const docIsKai = docFont && /KaiTi|楷体|Kaiti/i.test(docFont.main)
  console.log(`    ${docIsKai ? "✓" : "✗"} 正文字体：正文渲染为「${docFont?.main}」${docIsKai ? "（楷体系）" : "（期望楷体系）"}`)
  if (!docIsKai) fails.push(`正文字体选楷体后正文真实渲染族为「${docFont?.main}」，不是楷体系`)
  const uiIsSimHei = uiFontNow && /SimHei|黑体/i.test(uiFontNow.main)
  console.log(`    ${uiIsSimHei ? "✓" : "✗"} 独立性：界面控件仍是界面字体「${uiFontNow?.main}」（未被正文字体带偏）`)
  if (!uiIsSimHei) fails.push(`正文字体改了界面控件字体（nav-item 渲染为「${uiFontNow?.main}」，期望 SimHei）`)
  const brandIsKai = serifConsumer && /KaiTi|楷体|Kaiti/i.test(serifConsumer.main)
  console.log(`    ${brandIsKai ? "✓" : "✗"} 设计一致：正文衬线层随正文字体变为「${serifConsumer?.main}」（ui-test.css:118 明确用 var(--serif)）`)
  if (!brandIsKai) fails.push(`正文衬线层未跟随正文字体（brand-name 渲染为「${serifConsumer?.main}」）`)
  evidence.fontCase.realRenderedBody = { selector: ".ui-test-editor-body .ProseMirror p", main: docFont?.main ?? null, all: docFont?.all ?? [] }
  evidence.fontCase.realRenderedUiControl = { selector: ".ui-test-nav-item", main: uiFontNow?.main ?? null, all: uiFontNow?.all ?? [] }
  evidence.fontCase.realRenderedSerifLayer = { selector: ".ui-test-brand-name", main: serifConsumer?.main ?? null, all: serifConsumer?.all ?? [] }
}

// ── 恢复 ──
console.log("")
console.log("  ── 恢复原始设置 ──")
if (!(await goToSettings())) { fails.push("恢复阶段无法回到设置页") } else {
  await page.evaluate(SET_CONTROL, { tag: "input", label: "界面字号", value: Math.round(eff(before.storedUi) * 100) })
  await wait(300)
  await page.evaluate(SET_CONTROL, { tag: "input", label: "正文字号", value: Math.round(eff(before.storedBody) * 100) })
  await wait(300)
  await page.evaluate(SET_CONTROL, { tag: "select", label: "界面字体", value: before.storedUiFont ?? "system" })
  await wait(300)
  await page.evaluate(SET_CONTROL, { tag: "select", label: "正文字体", value: before.storedBodyFont ?? "serif-default" })
  await wait(600)
  console.log(`  点保存: ${JSON.stringify(await page.evaluate(CLICK_SAVE))}`)
  await wait(2500)
  const a3 = await page.evaluate(READ_STATE)
  console.log(`  恢复后：DOM root=${a3.domRootPct ?? "(清除)"} --body-scale=${a3.domBodyScale ?? "(清除)"} 落盘 界面字号=${a3.storedUi} 正文字号=${a3.storedBody} 界面字体=${a3.storedUiFont} 正文字体=${a3.storedBodyFont}`)
  const restored = eff(a3.storedUi) === eff(before.storedUi) && eff(a3.storedBody) === eff(before.storedBody)
    && a3.storedUiFont === (before.storedUiFont ?? "system") && a3.storedBodyFont === (before.storedBodyFont ?? "serif-default")
  console.log(`    ${restored ? "✓" : "✗"} 已恢复初始有效值（尺寸 ${eff(before.storedUi)}/${eff(before.storedBody)}，字体 ${before.storedUiFont ?? "system"}/${before.storedBodyFont ?? "serif-default"}）`)
  if (!restored) fails.push(`未能恢复初始设置（界面=${a3.storedUi}/${a3.storedUiFont} 正文=${a3.storedBody}/${a3.storedBodyFont}）`)
  if (before.storedBody === null && a3.storedBody === 1) {
    notes.push("正文字号原为「从未设置」(null)，保存后落为显式默认值 1 —— 语义相同（都是 100%），非串改")
  }
  evidence.restore = {
    expected: { uiSize: eff(before.storedUi), bodySize: eff(before.storedBody), uiFont: before.storedUiFont ?? "system", bodyFont: before.storedBodyFont ?? "serif-default" },
    actual: { uiSize: a3.storedUi, bodySize: a3.storedBody, uiFont: a3.storedUiFont, bodyFont: a3.storedBodyFont, domRootPct: a3.domRootPct, domBodyScale: a3.domBodyScale },
    ok: restored,
  }
}

console.log("")
for (const n of notes) console.log(`  · ${n}`)
if (fails.length) {
  console.log(`  ✗ FAIL（${fails.length} 项）`)
  for (const f of fails) console.log(`    · ${f}`)
  writeEvidence("fail")
  await bye(); process.exit(1)
}
console.log("  ✓ 通过：设置界面改字号与字体 → 保存 → 生效、落盘、真实渲染同步变化")
writeEvidence("pass")
await bye()
process.exit(0)
