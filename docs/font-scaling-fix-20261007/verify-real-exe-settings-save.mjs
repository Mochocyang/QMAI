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
 *   ④ 正文字号必须在**真实文档**上量出**设定的绝对 px**：
 *      正文 = Npx、无序/有序列表项 = N×8/9、无序标记 = N×2/3、有序标记 = N×8/9
 *      （改造前这里量的是"×1.25 倍"，因为改造前正文与界面字号相乘；
 *       现在正文是绝对 px，与界面字号解耦）
 *   ⑤ 换字体必须在真实渲染族上量出变化，且默认档必须与初始渲染族相同
 *
 * 关于 `null`：正文字号默认值是 **18px**。从未设置过时 localStorage 里是
 * `null`，一旦保存过就写成 `"18"`。两者**语义相同**，故断言比较"有效值"
 * （null → 18），否则会把"写入默认值"误报成"串改设置"。
 * 界面字号仍是倍数（null → 1），两者默认值不同，**不能共用同一个 eff()**。
 */

import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { writeFileSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const argOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
const PORT = Number(argOf("--port") ?? 9333)
const OUTLINE_KEY = argOf("--doc") ?? "开篇方向"
const UI_FONT_TO_TRY = argOf("--ui-font") ?? "simhei"      // 黑体，实测本机可用
const BODY_FONT_TO_TRY = argOf("--body-font") ?? "kaiti"   // 楷体，实测本机可用
/*
 * 正文字号滑块现在写的是**绝对 px**（12–32，步长 1），不再是百分比倍数。
 * 取 24 而不是默认 18：必须与初始值不同，否则「保存确实生效」与
 * 「本来就是这个值」无法区分（与"未设置 vs 显式默认"同一类假通过）。
 */
const BODY_PX_TO_TRY = Number(argOf("--body-px") ?? 24)
/**
 * 证据落盘路径。**默认就写**，不是可选项。
 *
 * 为什么不靠 stdout：本脚本的结论会被人引用进 findings.md / 实施记录，
 * 而 stdout 只存在于终端滚动缓冲里 —— 引用一个只存在于终端里的数字，
 * 等于引用一个无法复核的断言（这一轮就因此撤掉过一处「6260/2971」的引用）。
 * 写成 JSON 后，文档里的每个数字都能在这一份产物里找到。
 */
const OUT = argOf("--out") ?? join(HERE, "real-exe-shots", "real-exe-settings-save.json")

/**
 * 证据的来源信息：**没有这些就无法判断这份 JSON 对应哪次构建**。
 *
 * 为什么必须补上（最终整体代码审查第 3 条）：
 * 那份 JSON 原来只有 note/capture，于是它**既证明不了自己属于哪个 exe**，
 * 也证明不了"由当前脚本产出"。审查据此指出一个自相矛盾的归档状态：
 * HEAD 的脚本会必然报出「字间距 应为 0.4，实际 "0.4px"」（夹具的 unit 写错），
 * 而同一提交里的 JSON 却是 `"fails": []`、`"verdict": "pass"` ——
 * 即那份绿证据**不可能由它自己那份脚本产出**。
 *
 * 所以每次运行都记下：脚本自身的 SHA-256（判据变了没）、
 * 被验证的 exe 路径与 SHA-256（产品变了没）、时间戳（何时测得）。
 * 这三者齐了，"归档的绿是否还算数"就变成一个可判定的问题。
 */
function fileSha256(p) {
  try { return createHash("sha256").update(readFileSync(p)).digest("hex") } catch { return null }
}
const scriptSha256 = fileSha256(fileURLToPath(import.meta.url))
const exePath = argOf("--exe") ?? null
const provenance = {
  capturedAt: new Date().toISOString(),
  script: fileURLToPath(import.meta.url),
  scriptSha256,
  cdpPort: PORT,
  exe: exePath,
  exeSha256: exePath ? fileSha256(exePath) : null,
  node: process.version,
}

const evidence = {
  note: "真实 exe：设置界面改字号/字体 → 点保存 → 生效、落盘、真实渲染族。由 verify-real-exe-settings-save.mjs 每次运行覆盖写入。",
  capture: { uiFontTried: UI_FONT_TO_TRY, bodyFontTried: BODY_FONT_TO_TRY, doc: OUTLINE_KEY },
  provenance,
  initial: null, sliders: null, cases: [], docCase: null, fontCase: null, chapterPopoverCase: null, restore: null, fails: [], notes: [], verdict: null,
}

/*
 * ── `--check-evidence`：这份归档的绿，还算不算数？ ──
 *
 * 由来（最终整体代码审查第 3 条）：审查发现 HEAD 里那份 `"verdict": "pass"`
 * 的 JSON **不可能由同一提交的脚本产出** —— 脚本当时会把字间距的期望值写成
 * `"0.4"` 而 DOM 实际是 `"0.4px"`，必然多一条失败。也就是说那份绿证据
 * 要么来自更早的脚本版本，要么根本不能反映当前判据。
 * 一份无法判断"是否仍然成立"的证据，比没有证据更危险：它会被引用。
 *
 * 这个模式做的事很小，但正好堵住那个缺口：**把归档记下的
 * scriptSha256 与当前脚本比对**。不一致就说明判据在归档之后被改过，
 * 这份绿不能再直接引用（必须重跑）。没有 scriptSha256 的旧归档同样报出来。
 *
 * 它**不能**证明"重跑一定还是绿"（那需要真机），但能把
 * "拿一份过期判据产出的绿当验收依据"变成一个显式的失败。
 */
if (argv.includes("--check-evidence")) {
  const target = argOf("--check-evidence") || OUT
  console.log(`  ══ 校验归档证据是否仍由当前脚本判据产出 ══`)
  console.log(`  归档: ${target}`)
  let archive
  try {
    archive = JSON.parse(readFileSync(target, "utf8"))
  } catch (err) {
    console.log(`  ✗ 读不出归档 JSON: ${err.message}`)
    process.exit(1)
  }
  const problems = []
  const arch = archive.provenance?.scriptSha256 ?? null
  if (!arch) {
    problems.push("归档没有 provenance.scriptSha256 —— 无法判断它由哪版判据产出（旧格式归档，必须重跑后才能引用）")
  } else if (arch !== scriptSha256) {
    problems.push(`判据已变：归档记录 scriptSha256=${arch.slice(0, 12)}…，当前脚本=${scriptSha256.slice(0, 12)}… —— 必须重跑，旧绿不可引用`)
  }
  if (archive.verdict !== "pass") problems.push(`归档 verdict=${archive.verdict}，不是 pass`)
  if ((archive.fails ?? []).length > 0) problems.push(`归档仍有 ${archive.fails.length} 条 fails`)
  if (!archive.provenance?.capturedAt) problems.push("归档没有 provenance.capturedAt —— 不知道何时测得")
  if (!archive.provenance?.exeSha256) problems.push("归档没有 provenance.exeSha256 —— 不知道验证的是哪个 exe（可用 --exe 指定后重跑补上）")

  if (problems.length) {
    console.log(`  ✗ 这份归档不能再作为验收依据（${problems.length} 项）`)
    for (const p of problems) console.log(`    · ${p}`)
    process.exit(1)
  }
  console.log(`  ✓ 归档与当前判据一致（scriptSha256=${scriptSha256.slice(0, 12)}…，${archive.provenance.capturedAt}）`)
  console.log(`    注意：这只证明"判据没变过"，**不证明**重跑仍会绿 —— 结论引用仍需真机重跑。`)
  process.exit(0)
}

/*
 * playwright 只在**真的要去连浏览器**时才加载。
 * 放在 `--check-evidence` 之后，那个只读归档的模式才能在没装/没起
 * 浏览器环境里独立运行 —— 它本来就不需要浏览器。
 */
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
/*
 * 用例 4 亲手写入并已确认落盘的「界面字体档」。
 * 用例 5 跑在大纲视图上、看不到设置页的下拉，所以必须靠这个变量才知道
 * "应该匹配哪一族" —— 否则判据会静默退化成"不是楷体就算过"（见用例 5 内注释）。
 */
let uiFontWritten = null
/*
 * 两种"有效值"：界面字号是倍数（null → 1），正文字号是**绝对 px**（null → 18）。
 * 共用一个 eff() 会把"未设置正文"算成 1（1px），断言会全错。
 */
const effUi = (v) => (v == null ? 1 : v)
const effBodyPx = (v) => (v == null ? 18 : v)
const near = (a, b, t = 0.05) => a !== null && b !== null && Math.abs(a - b) < t
/**
 * 取一个 Number，若原值是 null/undefined/NaN 则用默认值。
 * 用于"用户从未设置过该字段"（落盘为 null）时恢复成产品默认 ——
 * 直接写 null 给滑块会变成 0 或空串，反而把设置改坏。
 */
const numOr = (v, dflt) => (typeof v === "number" && Number.isFinite(v) ? v : dflt)

/*
 * ── 章节正文的"真实渲染"证据：像素，而不是 CDP 平台字体 ──
 *
 * 为什么不能用 `platformFont()`（CDP CSS.getPlatformFontsForNode）测章节正文：
 * 实测（.codex-temp/probe-chapter-body-font.mjs）章节正文是一个
 * `<textarea>`（挂在 [data-writing-editor] 里的沉浸写作模式），
 * 而 CSS.getPlatformFontsForNode 对表单控件返回**空** —— 它按"这个节点
 * 自己画了哪些字形"回答，而 textarea 的文字不由该节点绘制。
 * 同一页面上 .ui-test-brand-name / .ui-test-editor-title 都能正常取到，
 * 只有 textarea 取不到，所以这不是"字体没生效"，是**度量工具的边界**。
 *
 * 试过并否掉的两条替代度量（.codex-temp/probe-textarea-font-metric.mjs）：
 *   · canvas measureText 宽度差分 → **无效**：KaiTi 与 FangSong 量出同为 312。
 *     CJK 字形前进宽度相同，宽度根本区分不了中文字体。若直接采用，
 *     会得到一条**恒绿**判据（"换字体宽度没变"永远成立），比没有判据更糟。
 *   · document.fonts.check() → 只回答"该字体可用吗"，与"用没用上"无关。
 *
 * 剩下唯一"真的渲染了"的证据是像素。已实测（.codex-temp/probe-textarea-screenshot.mjs）：
 *   · 同一字体连截两次哈希相同    → 截图方法本身可重复（不会因光标闪烁假红）
 *   · 换字体后哈希确实不同        → 有鉴别力，能证明字形真的换了
 * 并带一条反向对照：界面衬线层（.ui-test-brand-name）在换正文字体时
 * 像素哈希必须**保持相同** —— 它保证我截的区域有区分意义，
 * 而不是把整块都截进去导致"什么都变"。
 */
const SHOT_DIR = join(HERE, "real-exe-shots")
/** 截一小块并返回像素字节的 SHA-256（取前 16 位，够用于比较）。 */
async function shotHash(box, tag) {
  if (!box || box.width < 4 || box.height < 4) return null
  const buf = await page.screenshot({ clip: box })
  try { writeFileSync(join(SHOT_DIR, `${tag}.png`), buf) } catch { /* 截图落盘失败不影响判定 */ }
  return createHash("sha256").update(buf).digest("hex")
}
/** 章节正文文字块的截图区域（textarea 顶部一小条，避免整页噪音）。 */
const BODY_SHOT_BOX = () => {
  const ta = document.querySelector(".ui-test-editor-body textarea")
  if (!ta) return null
  const r = ta.getBoundingClientRect()
  if (r.width < 4 || r.height < 4) return null
  return { x: Math.round(r.x), y: Math.round(r.y + 8), width: Math.round(Math.min(r.width, 600)), height: 80 }
}
/** 界面衬线层的截图区域（反向对照用：它**不该**随正文字体变）。 */
const BRAND_SHOT_BOX = () => {
  const b = document.querySelector(".ui-test-brand-name")
  if (!b) return null
  const r = b.getBoundingClientRect()
  if (r.width < 4 || r.height < 4) return null
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
}

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
    /* App 独占的 5 个变量里，本用例最关心字号这一个 ——
       它由 applyBodyTypography 写成 `<N>px`。旧名 domBodyScale（倍数）已废弃。 */
    domBodyPx: r.style.getPropertyValue("--qmai-body-font-px") || null,
    /*
     * ── 另外 4 个 App 独占变量（代码质量审查 M-1）──
     *
     * 原来这里只读字号一个，于是「行间距 / 字间距 / 左右边距 / 底部安全距离」
     * 这 4 个**新增参数**在整条保存链路上没有任何 e2e 断言 ——
     * 只在 vitest 单测层被覆盖，而 vitest 不在 CI 里（已实测 .github/workflows 不跑它）。
     * 用户报的原始症状恰恰是「保存了但界面不变」，那对任何**单个**参数
     * 都可能发生（例如某个 saveUiBody* 忘了接线、或某个变量被 ui-test.css 盖掉）。
     * 只验字号一个，等于默认其余 4 个不会单独坏 —— 而它们各自是独立的一条线。
     */
    domBodyLeading: r.style.getPropertyValue("--qmai-body-leading") || null,
    domBodyLetterSpacing: r.style.getPropertyValue("--qmai-body-letter-spacing") || null,
    domBodyMarginX: r.style.getPropertyValue("--qmai-body-margin-x") || null,
    domBodySafeBottom: r.style.getPropertyValue("--qmai-body-safe-bottom") || null,
    domUiFamilyVar: r.style.getPropertyValue("--qmai-ui-font-family") || null,
    domBodyFamilyVar: r.style.getPropertyValue("--qmai-body-font-family") || null,
    storedUi: parse("qmai-ui-font-size-scale"),
    /* 正文字号落盘在 qmai-body-font-px（px 数字，无单位）。
       旧的 qmai-ui-body-font-scale 只剩迁移用途，不再被写入。 */
    storedBody: parse("qmai-body-font-px"),
    /* 4 个新参数的落盘键（用于核对"DOM 变了但没落盘"这条反向失败） */
    storedLeading: (() => { const v = str("qmai-body-line-height"); return v == null ? null : Number(v) })(),
    storedLetterSpacing: (() => { const v = str("qmai-body-letter-spacing"); return v == null ? null : Number(v) })(),
    storedMarginX: (() => { const v = str("qmai-body-margin-x"); return v == null ? null : Number(v) })(),
    storedSafeBottom: (() => { const v = str("qmai-body-safe-bottom"); return v == null ? null : Number(v) })(),
    storedUiFont: str("qmai-ui-font-family"),
    storedBodyFont: str("qmai-body-font-family"),
    settingsOpen: !!document.querySelector('[data-ui="settings-navigation"]'),
    controls: {
      uiSize: (() => { const e = document.querySelector('input[aria-label="界面字号"]'); return e ? Number(e.value) : null })(),
      bodySize: (() => { const e = document.querySelector('input[aria-label="正文字号"]'); return e ? Number(e.value) : null })(),
      uiFont: (() => { const e = document.querySelector('select[aria-label="界面字体"]'); return e ? e.value : null })(),
      bodyFont: (() => { const e = document.querySelector('select[aria-label="正文字体"]'); return e ? e.value : null })(),
      /* 4 个新控件的当前值 —— 用例 2 会把它们一起改掉 */
      lineHeight: (() => { const e = document.querySelector('input[aria-label="行间距"]'); return e ? Number(e.value) : null })(),
      letterSpacing: (() => { const e = document.querySelector('input[aria-label="字间距"]'); return e ? Number(e.value) : null })(),
      marginX: (() => { const e = document.querySelector('input[aria-label="左右边距"]'); return e ? Number(e.value) : null })(),
      safeBottom: (() => { const e = document.querySelector('input[aria-label="底部安全距离"]'); return e ? Number(e.value) : null })(),
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

/*
 * ── 确保"有一本小说是打开着的"，并且真的站在大纲视图上 ──
 *
 * 为什么必须显式做这件事（实测踩出来的假红）：
 * 早先几轮脚本能跑通，是因为我在此之前用别的探针**碰巧**把一本小说打开了。
 * 一旦实例停在书架上（没有任何小说打开），就会连锁出现两类**假红**：
 *   · 用例 3：大纲里 `[data-page-path]` 行数为 0 → 正文一律量成 undefinedpx；
 *   · 用例 6：点侧栏「章节」没有反应，找不到「字体设置」入口。
 * 而根因不是产品缺陷，是**脚本对环境状态的隐含假设**。
 *
 * 更关键的一点：设置页是一个**覆盖层**，它会吃掉侧栏导航的点击
 * （实测：点「大纲」后 `[data-ui="settings-footer"]` 仍在、文档行仍为 0）。
 * 所以必须先用「返回书架」离开设置页，再按需打开一本小说，最后才去大纲。
 *
 * 判据本身不变，改的只是"把环境摆到位"。每一步都返回诊断信息，
 * 失败时能直接看出是断在哪一步（设置页没关掉 / 书架没书 / 打开失败）。
 */
async function ensureNovelOpen() {
  const state = () => page.evaluate(() => ({
    settingsOpen: !!document.querySelector('[data-ui="settings-footer"]'),
    rows: document.querySelectorAll("[data-page-path]").length,
    bookCards: document.querySelectorAll(".ui-test-book-card").length,
    editorBody: !!document.querySelector(".ui-test-editor-body"),
  }))

  /* 1) 若设置页开着，先离开它 —— 否则后面所有导航点击都会被吃掉 */
  let s = await state()
  if (s.settingsOpen) {
    await page.evaluate(() => document.querySelector('button[aria-label="返回书架"]')?.click())
    await wait(2000)
    s = await state()
  }

  /* 2) 书架上有书就打开第一本（等价于用户点一下书卡） */
  if (!s.editorBody && !s.settingsOpen && s.rows === 0) {
    const opened = await page.evaluate(() => {
      const card = document.querySelector(".ui-test-book-card")
      if (!card) return { ok: false, why: "no-book-card" }
      const title = (card.textContent ?? "").trim().slice(0, 20)
      card.click()
      return { ok: true, title }
    })
    if (!opened.ok) return { ok: false, why: opened.why, ...s }
    await wait(3500)
  }

  /* 3) 切到大纲并确认真的出现了文档行 */
  await page.evaluate(GO_TO_OUTLINE)
  await wait(2500)
  s = await state()
  return { ok: s.rows > 0, rows: s.rows, settingsOpen: s.settingsOpen, editorBody: s.editorBody }
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

/**
 * 第一步：切到「章节」视图。用户的原始操作路径。
 *
 * 只认主导航的可见文字（`.ui-test-nav-item`），不靠类名或按钮位置 ——
 * 工具栏按钮顺序会变。返回诊断字段，失败时能直接看出是哪一步断的；
 * 否则"浮层打不开"会退化成一个不知道去哪查的布尔值。
 */
const GO_TO_CHAPTER = () => {
  const nav = [...document.querySelectorAll(".ui-test-nav-item")]
  const chap = nav.find((x) => (x.textContent ?? "").trim() === "章节")
  if (!chap) return { ok: false, why: "no-chapter-nav", nav: nav.map((x) => (x.textContent ?? "").trim()) }
  chap.click()
  return { ok: true }
}

/**
 * 第二步：章节视图渲染完成后，点开工具栏上的「字体设置」入口。
 *
 * ⚠ 本函数**只负责点**，不判定浮层是否出现 —— 这是实测踩出来的：
 * 第一版把"点"和"查"写在同一个 page.evaluate 里，于是 click() 之后
 * 立刻 querySelector，而此刻 React 还没重渲染（浮层实际在 ~100ms 后出现），
 * 结果 `clicked: true` 却 `popover: false`，报出「浮层打不开」这个**假红**。
 * 真机实测（.codex-temp/probe-chapter-popover.mjs）确认浮层是正常打开的，
 * 是我的判定太早。所以拆成两步：这里只点，由调用方 wait 之后再用
 * IS_POPOVER_OPEN 单独查一次。
 *
 * 入口只认 aria-label / title（真机实测该按钮 aria="字体设置" title="字体设置"
 * class="ui-test-editor-action is-icon-only"），不靠类名或位置 —— 按钮顺序会变。
 * 返回诊断字段，失败时能直接看出是哪一步断的。
 */
const CLICK_BODY_FONT_ENTRY = () => {
  const all = [...document.querySelectorAll("button, [role='button']")]
  const entry = all.find((b) => {
    const label = `${b.getAttribute("aria-label") ?? ""} ${b.getAttribute("title") ?? ""} ${b.textContent ?? ""}`.trim()
    return /字体设置/.test(label)
  })
  if (!entry) {
    return {
      found: false, why: "no-entry",
      buttons: all.map((b) => `${b.getAttribute("aria-label") ?? ""}|${b.getAttribute("title") ?? ""}|${(b.textContent ?? "").trim().slice(0, 12)}`).slice(0, 40),
    }
  }
  entry.click()
  return { found: true, aria: entry.getAttribute("aria-label"), title: entry.getAttribute("title") }
}

/** 浮层是否已挂上（必须与上面的点击**分开**调用，见其注释）。 */
const IS_POPOVER_OPEN = () => {
  const d = document.querySelector('[role="dialog"][aria-label="字体设置"]')
  return {
    open: !!d,
    dialogs: [...document.querySelectorAll('[role="dialog"]')].map((x) => x.getAttribute("aria-label")),
  }
}

const CLOSE_POPOVER = () => {
  const btn = document.querySelector('button[aria-label="关闭字体设置"]')
  if (btn) { btn.click(); return { closed: true } }
  return { closed: false }
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

/*
 * ── 改任何东西之前，先按**字节**留一份用户设置的备份 ──
 *
 * 为什么必须有这一步（本轮恢复逻辑搬家之后尤其重要）：
 * 本脚本会往**用户真实的 app-state.json** 里写测试值，然后靠"再写回去"来恢复。
 * 而"恢复"这件事本身可能失败 —— 它依赖 CDP 连得上、浮层打得开、
 * aria-label 没漂。一旦恢复失败，用户打开软件会发现自己的排版设置
 * 被改成了一组测试值（18 / 2.2 / 0.5 / 44 / 55），而且脚本已经退出，
 * 没人再把它们改回来。
 *
 * 备份存在 `.codex-temp/`（已 gitignore，不进仓库），并在下面打印它的
 * SHA-256 与**确切的恢复命令** —— 恢复动作故意留给人来做：
 * 此刻 exe 还开着、内存里有它自己的一份状态，脚本在它背后改文件
 * 很可能被应用退出时覆盖回去，那种"看起来恢复了"比不做更危险。
 */
{
  const statePath = join(process.env.APPDATA ?? "", "com.qingmuai.writer", "app-state.json")
  try {
    const bytes = readFileSync(statePath)
    const backupPath = join(HERE, "..", "..", ".codex-temp", "app-state-before-settings-save.json")
    writeFileSync(backupPath, bytes)
    const sha = createHash("sha256").update(bytes).digest("hex")
    console.log(`\n  ── 用户设置已备份 ──`)
    console.log(`     ${statePath}`)
    console.log(`     → ${backupPath}`)
    console.log(`     SHA-256 ${sha}（${bytes.length} 字节）`)
    console.log(`     ⚠ 若本脚本报「未能恢复初始设置」，请**先退出青幕**，再跑：`)
    console.log(`        node .codex-temp/restore-user-typography.mjs`)
    evidence.userStateBackup = { statePath, backupPath, sha256: sha, bytes: bytes.length }
  } catch (e) {
    /*
     * 备份失败**不能**静默放过：那意味着"恢复失败就没退路"。
     * 但也不该直接中止（可能只是路径不存在，脚本其余部分仍有价值），
     * 所以记进 fails 并大声打印。
     */
    fails.push(`无法备份用户 app-state.json（${e.message}）—— 本次跑完后若恢复失败将没有退路`)
    console.log(`\n  ✗ 备份用户设置失败：${e.message}`)
    console.log(`    请先手动复制该文件，再重跑本脚本（否则恢复失败就没有退路）`)
  }
}

const before = await page.evaluate(READ_STATE)
evidence.initial = before
console.log(`  初始：DOM root=${before.domRootPct ?? "(未设置)"} computed=${before.domComputedRoot}  --qmai-body-font-px=${before.domBodyPx ?? "(未设置)"}`)
console.log(`        落盘 界面字号=${before.storedUi} 正文字号=${before.storedBody}（有效值 ${effUi(before.storedUi)} / ${effBodyPx(before.storedBody)}px）`)
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
const ok1 = a1.domRootPct === "150%" && effUi(a1.storedUi) === 1.5
console.log(`    ${ok1 ? "✓" : "✗"} 界面字号：DOM(${a1.domRootPct}) 落盘(${a1.storedUi})`)
if (!ok1) fails.push(`界面字号保存未生效：DOM=${a1.domRootPct} 落盘=${a1.storedUi}`)
const indep1 = effBodyPx(a1.storedBody) === effBodyPx(before.storedBody)
evidence.cases.push({
  label: "界面字号→150%", slider: { written: 150, read: set1.value, min: set1.min, max: set1.max, step: set1.step },
  after: a1, domRootPct: a1.domRootPct, computedRoot: a1.domComputedRoot, storedUi: a1.storedUi,
  independence: { storedBodyBefore: effBodyPx(before.storedBody), storedBodyAfter: effBodyPx(a1.storedBody), ok: indep1 }, ok: ok1,
})
console.log(`    ${indep1 ? "✓" : "✗"} 独立性：正文字号有效值未被动（${effBodyPx(before.storedBody)}px → ${effBodyPx(a1.storedBody)}px）`)
if (!indep1) fails.push(`改界面字号顺带改了正文字号（${effBodyPx(before.storedBody)}px → ${effBodyPx(a1.storedBody)}px）`)

// ── 用例 2：界面字号回 100%（设置页）+ 核对设置页已不再出现那 6 项 ──
/*
 * ⚠ 本轮改造：这个用例原先还在这里改「正文字号」与另外 4 个排版参数。
 * 用户要求把这 6 项**从设置页移除**（它们属于章节，不属于全局设置），
 * 于是这些控件在本页面已经不存在 —— 继续在这里写只会得到一串
 * "控件未找到"的**假红**，把"用户要的移除"报成"产品坏了"。
 *
 * 那 5 个参数改到下面的**用例 2b**，走它们现在真实的入口
 * （章节「字体设置」浮层）。判据一条没少，只是换了宿主用例。
 */
console.log("")
console.log("  ── 用例 2：界面字号回 100%，并核对设置页已不再出现那 6 个正文排版项 ──")
await page.evaluate(SET_CONTROL, { tag: "input", label: "界面字号", value: 100 })
await wait(300)

/*
 * ── 本轮新增的判据：设置页**不得**再有这 6 个正文排版控件 ──
 *
 * 为什么要在真实 exe 上再核一遍（单测已经有一条）：单测渲染的 DOM 是
 * 我们自己在 jsdom 里造的，真机的 DOM 才是用户看到的东西。
 * 而且这条判据的失效方式很安静 —— 控件"还在"不会报错，只会让用户
 * 在两个地方看到同一组设置、并以为设置页改了会立即生效（其实要按保存）。
 *
 * 同时必须核对"只移走正文那 6 项"：把界面字体/界面字号一起删掉，
 * 是把"移除"做成了"整块删掉"，同样要红。
 */
const goneControls = await page.evaluate(() => {
  const labels = ["正文字体", "正文字号预设", "正文字号", "行间距", "字间距", "左右边距", "底部安全距离"]
  return {
    found: labels.filter((l) => document.querySelector(`[aria-label="${l}"]`)),
    hasBodyFields: !!document.querySelector(".body-font-fields"),
    uiSize: !!document.querySelector('input[aria-label="界面字号"]'),
    uiFont: !!document.querySelector('select[aria-label="界面字体"]'),
  }
})
console.log(`  设置页残留的正文排版控件：${goneControls.found.length ? goneControls.found.join("/") : "（无）"}`)
if (goneControls.found.length) {
  fails.push(`设置页仍有这些正文排版控件：${goneControls.found.join(", ")}`
    + ` —— 用户要求它们只出现在章节的「字体设置」浮层里`)
}
if (!goneControls.uiSize || !goneControls.uiFont) {
  fails.push(`设置页的界面字体/界面字号被一起删掉了（界面字号=${goneControls.uiSize} 界面字体=${goneControls.uiFont}）`
    + ` —— 本轮只该移除正文那 6 项，界面自己的字体与字号必须留下`)
}

await wait(600)
console.log(`  点保存: ${JSON.stringify(await page.evaluate(CLICK_SAVE))}`)
await wait(2500)
const a2 = await page.evaluate(READ_STATE)
console.log(`  保存后：DOM root=${a2.domRootPct ?? "(清除)"}  落盘 界面=${a2.storedUi}`)
const ok2 = (a2.domRootPct === "100%" || a2.domRootPct === null) && effUi(a2.storedUi) === 1
console.log(`    ${ok2 ? "✓" : "✗"} 界面字号：DOM(${a2.domRootPct ?? "(清除)"}) 落盘(${a2.storedUi})`)
if (!ok2) fails.push(`界面字号保存未生效：DOM root=${a2.domRootPct} 落盘=${a2.storedUi}`)
evidence.cases.push({
  label: "界面字号→100%（设置页）+ 核对 6 项已移出设置页",
  after: a2, goneControls, ok: ok2 && goneControls.found.length === 0,
})

// ── 用例 2b：6 个排版参数走**它们现在唯一的入口** —— 章节「字体设置」浮层 ──
/*
 * ── 为什么这 5 个参数必须逐个在真实 exe 上验一次（原审查 M-1）──
 *
 * 「行间距 / 字间距 / 左右边距 / 底部安全距离」这 4 条**各自独立**的接线
 * 只要有一条坏了（某个 saveUiBody* 忘了接、或某个变量被 ui-test.css 盖掉），
 * 脚本原本照样全绿。所以它们必须在保存链路上被真的走一遍。
 *
 * 四个期望值刻意取成与默认值**互不相同**，否则"写入 == 没写"分不出来：
 * 行间距默认 1.95 → 取 2.2；字间距默认 0 → 取 0.5；
 * 左右边距默认跟随窗口（App 不写行内样式）→ 取 44px；
 * 底部安全距离默认 51 → 取 55。
 * 另外 4 个值两两不同，这样"串味"（把 A 的值写到 B 的键上）也能被抓住。
 *
 * ── ⚠ 本轮的**关键差异**：浮层没有「保存」按钮 ──
 * 设置页是"改草稿 → 点保存 → 落盘"；浮层是"边拖边生效 → 400ms 防抖自动落盘"。
 * 所以这里**不能**点保存（也点不到：章节视图下没有 settings-footer）。
 * 这一点本身要被断言：如果哪天有人把浮层改成"也要点保存才生效"，
 * 用户会以为拖了没用 —— 所以下面显式核对"章节视图下没有保存页脚"，
 * 并靠**等待防抖**后落盘来证明自动保存这条路是通的。
 *
 * ⚠ 期望值必须**从滑块自己的 step 推出来**，不能凭直觉硬写。
 * 我第一版给字间距写的是 0.4，真机第一次跑就报红：
 *   尺子失效：字间距 滑块写入 0.4 但读到 0.5
 * 根因是字间距滑块的 **`step={0.5}`**，而 range 控件只能取到 `min + n*step`，
 * 0.4 **根本不可表示** —— 浏览器把它吸附到 0.5。这是**夹具缺陷**，不是产品缺陷；
 * 把一个夹具缺陷报成两条产品缺陷，会让人去"修"一个并不存在的 bug。
 * 所以现在先读每个滑块的 min/max/step，再把目标**吸附到可表示值**。
 *
 * 另一处改进：某条滑块的"尺子"失效时，后续针对它的 DOM/落盘断言**跳过并标注**，
 * 不再重复计入产品失败 —— 否则同一个夹具缺陷被数成 3 条红，噪声比信号多。
 */
/*
 * `unit` 必须与 `font-settings.ts` 的实际写法一致：
 *   --qmai-body-font-px      → `${n}px`
 *   --qmai-body-leading      → `String(n)`   ← **唯一一个无单位的**
 *   --qmai-body-letter-spacing → `${n}px`
 *   --qmai-body-safe-bottom  → `${n}px`
 *   --qmai-body-margin-x     → `${n}px`
 * 我在这一处**又**把字间距猜成无单位（与 verify-real-exe.mjs 的 I-5 同一个错），
 * 真机报红 `应为 0.5，实际 "0.5px"` 才改过来。同一个错误犯两次，
 * 说明"凭直觉写期望值"这个习惯必须用"先读源码"替代。
 */
console.log("")
console.log("  ── 用例 2b：在章节「字体设置」浮层里改 5 个排版参数，等防抖自动落盘 ──")
{
  const env2b = await ensureNovelOpen()
  console.log(`  环境：${JSON.stringify(env2b)}`)
  const nav2b = await page.evaluate(GO_TO_CHAPTER)
  console.log(`  切到「章节」: ${JSON.stringify(nav2b)}`)
  await wait(2500)
  const clicked2b = await page.evaluate(CLICK_BODY_FONT_ENTRY)
  console.log(`  点「字体设置」入口: ${JSON.stringify(clicked2b)}`)
  // 点击与判定必须分开：同一次 evaluate 里 click 后立刻查询会读到重渲染前的 DOM
  await wait(1000)
  const pop2b = await page.evaluate(IS_POPOVER_OPEN)
  console.log(`  浮层状态: ${JSON.stringify(pop2b)}`)

  const FOUR = [
    { label: "行间距", key: "domBodyLeading", storedKey: "storedLeading", want: 2.2, unit: "" },
    { label: "字间距", key: "domBodyLetterSpacing", storedKey: "storedLetterSpacing", want: 0.5, unit: "px" },
    { label: "左右边距", key: "domBodyMarginX", storedKey: "storedMarginX", want: 44, unit: "px" },
    { label: "底部安全距离", key: "domBodySafeBottom", storedKey: "storedSafeBottom", want: 55, unit: "px" },
  ]

  if (!pop2b.open) {
    fails.push(`用例 2b 打不开章节「字体设置」浮层（${JSON.stringify(pop2b.dialogs)}）—— `
      + `这 5 个参数现在只有这一个入口，打不开就等于它们完全不可调`)
  } else {
    /*
     * 前提：章节视图下**没有**保存页脚。
     * 这一条既是"浮层不靠保存按钮"的证据，也是防止"哪天给浮层也加个保存"
     * 这类改动的哨兵（那会让用户以为拖了不生效）。
     */
    const noSaveFooter = await page.evaluate(() => !document.querySelector('[data-ui="settings-footer"]'))
    console.log(`  ${noSaveFooter ? "✓" : "✗"} 章节浮层路径上没有「保存」页脚（落盘只能靠防抖自动保存）`)
    if (!noSaveFooter) {
      notes.push("章节视图下出现了 settings-footer —— 浮层的落盘路径可能已经不是纯自动保存，请人工确认")
    }

    const set2b = await page.evaluate(SET_CONTROL, { tag: "input", label: "正文字号", value: BODY_PX_TO_TRY })
    console.log(`  拖滑块: 正文写入 ${set2b.value}（min=${set2b.min} max=${set2b.max} step=${set2b.step}）`)
    if (set2b.value !== String(BODY_PX_TO_TRY)) {
      fails.push(`尺子失效：正文字号滑块写入 ${BODY_PX_TO_TRY} 但读到 ${set2b.value}（单位应为 px）`)
    }

    const fourSet = []
    for (const f of FOUR) {
      const r = await page.evaluate(SET_CONTROL, { tag: "input", label: f.label, value: f.want })
      /*
       * 尺子：滑块自己得先写对，否则后面"保存没生效"可能是滑块的问题。
       * 期望值先按滑块自己的 step 吸附 —— 这样即使将来有人改了 step，
       * 这里也只会温和地跟随，而不是报一条假的"产品缺陷"。
       */
      const step = Number(r.step)
      const snapped = Number.isFinite(step) && step > 0
        ? Math.round(((f.want - Number(r.min)) / step)) * step + Number(r.min)
        : f.want
      if (Math.abs(snapped - f.want) > 1e-9) {
        console.log(`    · ${f.label} 期望 ${f.want} 按 step=${r.step} 吸附为 ${snapped}`)
        f.want = Number(snapped.toFixed(4))
      }
      f.rulerOk = Number(r.value) === f.want
      if (!f.rulerOk) fails.push(`尺子失效：${f.label} 滑块写入 ${f.want}（step=${r.step}）但读到 ${r.value}`)
      /*
       * ⚠ 必须在**算完 want/rulerOk 之后**再快照。
       * 我第一版把 `{...f, read}` 放在前面，于是 fourSet 里存的是**吸附前**的 want
       * 且**没有 rulerOk** 字段 → 打印时 4 条全部显示"(尺子失效)"，而实际 4 条都是好的。
       * 一个只为"打印诊断信息"而存在的副本，把诊断方向指反了。
       */
      fourSet.push({ ...f, read: r.value })
    }
    console.log(`  另外 4 个参数：${fourSet.map((f) => `${f.label}=${f.read}${f.rulerOk ? "" : "(尺子失效)"}`).join("  ")}`)

    /*
     * 等防抖落盘：createDebouncedPersist(400) 是**替换式**的，
     * 所以从最后一次改动算起 400ms 左右就会写盘。给 1800ms 余量
     * （要覆盖 React 重渲染 + Tauri 写文件的实际耗时）。
     * 这里**不点保存** —— 浮层没有保存按钮，这正是要验的那条差异。
     */
    await wait(1800)
    const b2 = await page.evaluate(READ_STATE)
    console.log(`  防抖落盘后：DOM --qmai-body-font-px=${b2.domBodyPx}  落盘 正文=${b2.storedBody}`)
    const okBody = b2.domBodyPx === `${BODY_PX_TO_TRY}px` && effBodyPx(b2.storedBody) === BODY_PX_TO_TRY
    console.log(`    ${okBody ? "✓" : "✗"} 正文字号：DOM(${b2.domBodyPx}) 落盘(${b2.storedBody})`)
    if (!okBody) {
      fails.push(`浮层里改「正文字号」后未生效（未点保存，靠防抖）：`
        + `DOM --qmai-body-font-px=${b2.domBodyPx} 落盘=${b2.storedBody}`)
    }

    /* 逐条核对 4 个新参数：DOM 行内样式与落盘两侧都要对 */
    const fourChecks = []
    for (const f of FOUR) {
      const wantStr = `${f.want}${f.unit}`
      /*
       * 尺子已失效的条目**跳过断言**：此刻"保存后不等于期望值"只能说明
       * 滑块没写进去，无法区分"产品没保存"与"夹具没写入"。
       * 仍记录事实，但不计入产品失败 —— 同一个夹具缺陷不该被数成 3 条红。
       */
      if (!f.rulerOk) {
        fourChecks.push({ label: f.label, want: wantStr, dom: b2[f.key], stored: b2[f.storedKey], domOk: null, storedOk: null, skipped: "尺子失效，无法判定" })
        console.log(`    – ${f.label.padEnd(7)} DOM=${b2[f.key] ?? "(未写)"} 落盘=${b2[f.storedKey] ?? "(未写)"}  （尺子失效，跳过判定）`)
        continue
      }
      const domOk = b2[f.key] === wantStr
      const storedOk = b2[f.storedKey] === f.want
      fourChecks.push({ label: f.label, want: wantStr, dom: b2[f.key], stored: b2[f.storedKey], domOk, storedOk })
      if (!domOk) fails.push(`M-1/${f.label} 浮层改后 DOM --qmai-body-* 应为 ${wantStr}，实际 ${JSON.stringify(b2[f.key])}`)
      if (!storedOk) fails.push(`M-1/${f.label} 浮层改后落盘应为 ${f.want}，实际 ${JSON.stringify(b2[f.storedKey])}`)
      console.log(`    ${domOk && storedOk ? "✓" : "✗"} ${f.label.padEnd(7)} DOM=${b2[f.key] ?? "(未写)"} 落盘=${b2[f.storedKey] ?? "(未写)"}  （期望 ${wantStr}）`)
    }
    const fourOk = fourChecks.every((c) => c.domOk !== false && c.storedOk !== false)
    if (!fourOk) fails.push(`M-1/浮层改的 4 个参数里至少一个未生效（见上逐条）`)

    evidence.cases.push({
      label: `浮层内：正文→${BODY_PX_TO_TRY}px + 4 个新参数（无保存按钮，靠防抖落盘）`,
      slider: { written: BODY_PX_TO_TRY, read: set2b.value, min: set2b.min, max: set2b.max, step: set2b.step },
      after: b2, fourChecks, noSaveFooter, popover: pop2b, ok: okBody && fourOk,
    })
    await page.evaluate(CLOSE_POPOVER)
  }
}

// ── 用例 3：正文字号必须在真实文档上量出**设定的绝对 px** ──
console.log("")
console.log(`  ── 用例 3：回到大纲文档，实测正文与列表是否等于设定的 ${BODY_PX_TO_TRY}px 及其派生值 ──`)
const env3 = await ensureNovelOpen()
console.log(`  环境：${JSON.stringify(env3)}`)
if (!env3.ok) {
  fails.push(`用例 3 无法进入"有一本小说打开的大纲视图"（诊断 ${JSON.stringify(env3)}）—— 判据无从执行`)
}
console.log(`  打开: ${JSON.stringify(await page.evaluate(OPEN_DOC, OUTLINE_KEY))}`)
const doc = await waitForDoc()
console.log(`  文档实测: p=${doc.p} 无序li=${doc.ulLi} marker=${doc.ulMarker} 有序li=${doc.olLi} marker=${doc.olMarker} li.display=${doc.liDisplay}`)
/*
 * 期望值由设定的 px 推出（比例沿用改造前 16/18 = 8/9、12/18 = 2/3）：
 *   正文 = Npx、无序/有序列表项 = N×8/9、无序标记 = N×2/3、有序标记 = N×8/9。
 * 浏览器保留小数（N×8/9 是循环小数），故用 near() 做接近比较，不用相等。
 */
const expSize = {
  p: BODY_PX_TO_TRY,
  ulLi: BODY_PX_TO_TRY * 8 / 9,
  ulMarker: BODY_PX_TO_TRY * 2 / 3,
  olLi: BODY_PX_TO_TRY * 8 / 9,
  olMarker: BODY_PX_TO_TRY * 8 / 9,
}
const docChecks = {}
for (const [k, v] of Object.entries(expSize)) {
  const ok = near(doc[k], v)
  docChecks[k] = { expected: v, measured: doc[k], ok }
  console.log(`    ${ok ? "✓" : "✗"} ${k.padEnd(9)} 期望 ${v}px 实测 ${doc[k]}px`)
  if (!ok) fails.push(`正文字号 ${BODY_PX_TO_TRY}px 下 ${k} 期望 ${v}px（±0.05）实测 ${doc[k]}px`)
}
if (doc.liDisplay && doc.liDisplay !== "list-item") fails.push(`::marker 读数不可信（li.display=${doc.liDisplay}）`)
evidence.docCase = { fontPx: BODY_PX_TO_TRY, liDisplay: doc.liDisplay, checks: docChecks, ok: Object.values(docChecks).every((c) => c.ok) }

// ── 用例 4：界面字体 → 黑体（真实渲染族判定）──
console.log("")
console.log(`  ── 用例 4：界面字体选「黑体」，正文字体选「楷体」，保存 ──`)
if (!(await goToSettings())) { fails.push("无法回到设置页（用例 4）") } else {
  const b = await page.evaluate(READ_STATE)
  // 基线：改动前，界面文字实际用什么字体渲染
  const baseUiFont = await platformFont("select[aria-label=\"界面字体\"]")
  console.log(`  改动前 界面文字真实渲染族: ${baseUiFont ? baseUiFont.main + "  [" + baseUiFont.all.join(" ") + "]" : "(取不到)"}`)
  /*
   * ⚠ 选一个**与当前不同**的档，否则"真实渲染族变了"这条会假红。
   *
   * 实测踩到：本脚本上一轮在用例 4 之后异常退出，界面字体留在 simhei；
   * 重跑时"改成黑体"其实是无操作（本来就是黑体），于是
   * 「前 SimHei 后 SimHei」被判为"未改变真实渲染族" —— 一条**假红**，
   * 而且它会让人去查一个并不存在的产品缺陷。
   * 所以这里按**当前值**决定目标：已经是黑体就改成 system，反之改黑体。
   * 这样"变了"永远有可观察的差异，而且断言仍然只关心"确实变了"。
   */
  const uiFontSelectedNow = await page.evaluate(() => {
    const s = [...document.querySelectorAll("select")].find((x) => /界面字体/.test(x.getAttribute("aria-label") ?? ""))
    return s?.value ?? null
  })
  const uiTarget = uiFontSelectedNow === UI_FONT_TO_TRY
    ? (UI_FONT_TO_TRY === "simhei" ? "system" : "simhei")
    : UI_FONT_TO_TRY
  if (uiTarget !== UI_FONT_TO_TRY) {
    notes.push(`用例 4 的界面字体当前已是「${UI_FONT_TO_TRY}」，为避免「无变化」被误判成缺陷，本用例改为切到「${uiTarget}」；判据仍是"真实渲染族确实变了"`)
  }
  const s4a = await page.evaluate(SET_CONTROL, { tag: "select", label: "界面字体", value: uiTarget })
  const s4b = await page.evaluate(SET_CONTROL, { tag: "select", label: "正文字体", value: BODY_FONT_TO_TRY })
  console.log(`  下拉: 界面字体=${s4a.value} 正文字体=${s4b.value}`)
  console.log(`    界面字体可选项: ${(s4a.options ?? []).join(", ")}`)
  if (s4a.value !== uiTarget) fails.push(`尺子失效：界面字体下拉写入 ${uiTarget} 但读到 ${s4a.value}`)
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
  if (!changed) fails.push(`界面字体选择未改变真实渲染族（前「${baseUiFont?.main}」后「${afterUiFont?.main}」，写入的是 ${uiTarget}）`)
  const expectFamily = uiTarget === "simhei" ? /SimHei|黑体/i : null
  if (expectFamily && afterUiFont && !expectFamily.test(afterUiFont.main)) {
    notes.push(`界面字体选「黑体」后真实渲染族为「${afterUiFont.main}」——若不是 SimHei，说明回退链命中了别的中文字体（仍有变化，但不是所选那一个）`)
  }
  if (a4.storedUiFont !== uiTarget || a4.storedBodyFont !== BODY_FONT_TO_TRY) {
    fails.push(`字体设置未落盘：界面=${a4.storedUiFont}（应 ${uiTarget}） 正文=${a4.storedBodyFont}（应 ${BODY_FONT_TO_TRY}）`)
  } else {
    // 只有确认落盘了才把它当作"当前界面字体档"给用例 5 用
    uiFontWritten = uiTarget
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

  // ── 用例 5：正文字体只影响文档正文；界面（含界面衬线层）都不受影响 ──
  /*
   * ⚠ 本用例**曾经断言的是相反的**：它要求 `.ui-test-brand-name`（品牌名）
   * 随正文字体一起变成楷体，并打印「设计一致 ✓」。
   * 即：这条断言把用户随后报的缺陷**认证成了正确行为** ——
   * 真机输出当时是
   *   「正文衬线层(brand): KaiTi（按设计跟随正文字体 = KaiTi）」
   *   「✓ 设计一致：正文衬线层随正文字体变为「KaiTi」」
   * 而用户的原话是「在章节正文中调整字体，整个界面的字体都会发生变化。这是不对的」。
   *
   * 根因：`--serif` 一个变量同时承担了「界面衬线层」与「文档正文层」两个角色。
   * 现在拆成两层：界面看 `--serif`（固定），正文看 `--body-font`（派生）。
   * 因此品牌名这条断言**必须反过来** —— 它现在是"界面没被带偏"的证据，
   * 而不是"设计一致"的证据。品牌名应始终是那一套宋体系。
   */
  console.log("")
  console.log("  ── 用例 5：正文用楷体，界面控件应仍用**界面字体**，品牌名（界面衬线层）应保持宋体系不变 ──")
  /* 与用例 3 同理：先保证"有一本小说打开 + 站在大纲上"，否则正文选择器取不到 */
  const env5 = await ensureNovelOpen()
  if (!env5.ok) console.log(`  ⚠ 环境未摆好：${JSON.stringify(env5)}`)
  await page.evaluate(OPEN_DOC, OUTLINE_KEY)
  await waitForDoc()
  const docFont = await platformFont(".ui-test-editor-body .ProseMirror p")
  // 界面控件：.ui-test-nav-item 不自己设 font-family，继承 .ui-test-root 的 var(--ui)
  const uiFontNow = await platformFont(".ui-test-nav-item")
  // 界面衬线层：.ui-test-brand-name 用 var(--serif)，而 --serif 是**固定**取值、不跟随正文字体
  const serifConsumer = await platformFont(".ui-test-brand-name")
  console.log(`  正文段落真实渲染族  : ${docFont ? docFont.main + "  [" + docFont.all.join(" ") + "]" : "(取不到)"}`)
  console.log(`  界面控件(nav-item)  : ${uiFontNow ? uiFontNow.main + "  [" + uiFontNow.all.join(" ") + "]" : "(取不到)"}（应为**当前界面字体**，不得是楷体/仿宋）`)
  console.log(`  界面衬线层(brand)   : ${serifConsumer ? serifConsumer.main + "  [" + serifConsumer.all.join(" ") + "]" : "(取不到)"}（界面层固定，**不应**变成 KaiTi）`)
  const docIsKai = docFont && /KaiTi|楷体|Kaiti/i.test(docFont.main)
  console.log(`    ${docIsKai ? "✓" : "✗"} 正文字体：正文渲染为「${docFont?.main}」${docIsKai ? "（楷体系）" : "（期望楷体系）"}`)
  if (!docIsKai) fails.push(`正文字体选楷体后正文真实渲染族为「${docFont?.main}」，不是楷体系`)
  /*
   * ⚠ 这里**必须**比对"当前的界面字体"，不能写死 SimHei。
   *
   * 实测踩到：用例 4 现在会按当前值选一个不同的档（见其注释），
   * 所以跑完之后界面字体可能是 simhei 也可能是 system。若此处写死 SimHei，
   * 一旦界面字体是 system（Microsoft YaHei UI）就会报"被正文字体带偏" ——
   * 一条**假红**，而且指向一个不存在的缺陷。
   *
   * 本条真正要守的是"界面控件用的是**界面字体**、没被正文字体带偏"，
   * 所以正确判据是：nav-item 的真实渲染族 == 当前界面字体所对应的族，
   * 且明确**不是**楷体/仿宋（即没有被正文字体带走）。
   */
  /*
   * ⚠ 这里**不能**去读设置页的下拉来得知"当前界面字体档" ——
   * 本用例跑在**大纲视图**上，那时设置页的 `select[aria-label="界面字体"]`
   * 根本不在 DOM 里，于是读出来是 null，判据会悄悄退化成"只要不是楷体/仿宋就行"。
   * 实测就是这么退化的（日志里打出 `当前界面字体档=?`）——
   * 一条**自己变弱却仍然报绿**的判据，比没有更危险。
   *
   * 正确做法：用用例 4 **亲手写入并已确认落盘**的那个档（uiFontWritten），
   * 它不依赖当前视图，且是这条断言真正要对照的事实。
   */
  const UI_FAMILY_BY_VALUE = {
    system: /Microsoft YaHei UI|Microsoft YaHei|Segoe UI/i,
    simhei: /SimHei|黑体/i,
  }
  const uiFamilySelected = uiFontWritten
  const expectUiFamily = uiFamilySelected ? UI_FAMILY_BY_VALUE[uiFamilySelected] ?? null : null
  if (!uiFamilySelected) {
    fails.push("用例 5 拿不到「用例 4 到底把界面字体写成了哪一档」—— 判据会退化成弱断言，先修用例 4")
  }
  const uiIsSelectedUiFont = !!uiFontNow && (!expectUiFamily || expectUiFamily.test(uiFontNow.main))
  const uiIsDocFont = !!uiFontNow && /KaiTi|楷体|FangSong|仿宋/i.test(uiFontNow.main)
  console.log(`    ${uiIsSelectedUiFont && !uiIsDocFont ? "✓" : "✗"} 独立性：界面控件用的是界面字体「${uiFontNow?.main}」`
    + `（用例 4 写入的档=${uiFamilySelected ?? "?"}${expectUiFamily ? `，应匹配 ${expectUiFamily}` : ""}；**不得**为楷体/仿宋）`)
  if (uiIsDocFont) {
    fails.push(`正文字体改了界面控件字体（nav-item 渲染为「${uiFontNow?.main}」，是正文字体那一路的楷体/仿宋，说明界面被带偏了）`)
  } else if (!uiIsSelectedUiFont) {
    fails.push(`界面控件渲染族「${uiFontNow?.main}」与用例 4 写入的界面字体档「${uiFamilySelected}」不符（期望匹配 ${expectUiFamily}）`)
  }
  /*
   * 品牌名**不得**变成楷体。判据同时给出正向期望（宋体系），
   * 因为"不是楷体"太弱：若品牌名被别的东西带偏成黑体，只断言"不是楷体"也会通过。
   */
  const brandIsKai = serifConsumer && /KaiTi|楷体|Kaiti/i.test(serifConsumer.main)
  const brandIsSong = serifConsumer && /Noto Serif SC|Source Han Serif SC|Songti|SimSun|宋/i.test(serifConsumer.main)
  console.log(`    ${!brandIsKai && brandIsSong ? "✓" : "✗"} 界面衬线层未被带偏：品牌名保持「${serifConsumer?.main}」（应为宋体系，不得为 KaiTi）`)
  if (brandIsKai) {
    fails.push(`正文字体漏到界面衬线层：品牌名（.ui-test-brand-name）被改成「${serifConsumer?.main}」`
      + ` —— 这正是用户报过的缺陷（"整个界面的字体都变了"）；界面层 --serif 必须固定`)
  } else if (!brandIsSong) {
    fails.push(`界面衬线层既不是楷体也不是宋体系（品牌名渲染为「${serifConsumer?.main}」）—— 期望保持默认宋体系`)
  }
  evidence.fontCase.realRenderedBody = { selector: ".ui-test-editor-body .ProseMirror p", main: docFont?.main ?? null, all: docFont?.all ?? [] }
  evidence.fontCase.realRenderedUiControl = { selector: ".ui-test-nav-item", main: uiFontNow?.main ?? null, all: uiFontNow?.all ?? [] }
  evidence.fontCase.realRenderedSerifLayer = { selector: ".ui-test-brand-name", main: serifConsumer?.main ?? null, all: serifConsumer?.all ?? [] }
}

// ── 用例 6：用户的**原始操作路径** —— 在章节里用浮层改字体，界面不得跟着变 ──
/*
 * 为什么必须单独走一遍：用例 5 是在**设置页**改的「正文字体」，而用户报的是
 * 「在**章节正文当中**调整字体设置的功能」。两条路径确实汇聚到同一个 store
 * 字段（设置页 → settings-view → store；浮层 → applyBodyTypographyChange → store），
 * 但"汇聚"是**读代码得出的推断**，不是实测。用户的操作路径必须被真的走一遍 ——
 * 这正是本轮教训的延伸：不要用推断替代证据。
 *
 * 断言（对应用户的原话）：
 *   · 在浮层里把正文字体改成仿宋 → 章节正文的渲染字体必须变成仿宋（设置有效）
 *   · 同一时刻界面衬线层（品牌名）必须仍是宋体系（**不**跟着变）
 *   · 界面字体元素必须仍是界面字体
 */
console.log("")
console.log("  ── 用例 6：用户的原始路径 —— 章节里用「字体设置」浮层改正文字体 ──")
{
  const beforeBrand = await platformFont(".ui-test-brand-name")
  const beforeUi = await platformFont(".ui-test-nav-item")
  /*
   * 先摆好环境：本用例要切到「章节」，而设置页是覆盖层、会吃掉侧栏导航的点击
   * （实测：点「章节」毫无反应，于是找不到「字体设置」入口 → 一条假红）。
   * ensureNovelOpen() 会先离开设置页、必要时打开一本小说、并切到写作视图。
   */
  const env6 = await ensureNovelOpen()
  console.log(`  环境：${JSON.stringify(env6)}`)
  const navRes = await page.evaluate(GO_TO_CHAPTER)
  console.log(`  切到「章节」: ${JSON.stringify(navRes)}`)
  await wait(2500)
  const clicked = await page.evaluate(CLICK_BODY_FONT_ENTRY)
  console.log(`  点「字体设置」入口: ${JSON.stringify(clicked)}`)
  // 点击与判定必须分开：同一次 evaluate 里 click 后立刻 querySelector 会读到
  // React 重渲染之前的 DOM（实测浮层约 100ms 后才挂上），从而报出假红。
  await wait(1000)
  const popState = await page.evaluate(IS_POPOVER_OPEN)
  const opened = { ...clicked, popover: popState.open }
  console.log(`  浮层状态: ${JSON.stringify(popState)}`)
  if (!opened.popover) {
    fails.push(`章节「字体设置」浮层打不开（${opened.why ?? "未知"}）—— 用户最主要的操作入口不可用`)
  } else {
    /*
     * 先截一张"改动前"的正文像素 —— 章节正文是 textarea，
     * CDP 平台字体取不到（原因见 shotHash 上方注释），只能靠像素差。
     * 没有这个基线就无法区分"改了但没生效"与"改了且生效"。
     */
    const bodyBox = await page.evaluate(BODY_SHOT_BOX)
    const brandBoxBefore = await page.evaluate(BRAND_SHOT_BOX)
    const bodyBefore = await shotHash(bodyBox, "case6-body-before")
    const brandShotBefore = await shotHash(brandBoxBefore, "case6-brand-before")
    console.log(`  改动前 正文像素哈希: ${bodyBefore ? bodyBefore.slice(0, 16) : "(取不到)"}`)

    /* 在浮层里改「正文字体」（浮层与设置页共用同一个控件组件与同一份 store 取值） */
    const set = await page.evaluate(SET_CONTROL, { tag: "select", label: "正文字体", value: "fangsong" })
    console.log(`  浮层内改正文字体 → fangsong: ${JSON.stringify(set)}`)
    await wait(1400)
    const bodyAfter = await shotHash(await page.evaluate(BODY_SHOT_BOX), "case6-body-after")
    const brandShotAfter = await shotHash(await page.evaluate(BRAND_SHOT_BOX), "case6-brand-after")
    const brand = await platformFont(".ui-test-brand-name")
    const uiNow = await platformFont(".ui-test-nav-item")
    const domFont = await page.evaluate(() => {
      const ta = document.querySelector(".ui-test-editor-body textarea")
      return ta ? getComputedStyle(ta).fontFamily : null
    })
    console.log(`  改动后 正文像素哈希: ${bodyAfter ? bodyAfter.slice(0, 16) : "(取不到)"}`)
    console.log(`  章节正文 computed font-family: ${domFont ?? "(取不到)"}（应含 FangSong/仿宋）`)
    console.log(`  界面衬线层   : ${brand ? brand.main : "(取不到)"}（此前 ${beforeBrand?.main ?? "?"}，**必须不变**）`)
    console.log(`  界面字体     : ${uiNow ? uiNow.main : "(取不到)"}（此前 ${beforeUi?.main ?? "?"}，必须不变）`)

    /*
     * 主要判据：像素确实变了（证明"设置到达了正文的字形"）+ 声明值也对。
     * 两者都要：computed font-family 只证明"样式写上了"，像素才证明"字真的换了"。
     * 若只有 computed 变而像素不变，说明文字没有真的重排（例如控件被遮挡），
     * 那时不能说"设置生效了"。
     */
    const pixelsMoved = !!(bodyBefore && bodyAfter && bodyBefore !== bodyAfter)
    const declOk = !!domFont && /FangSong|仿宋/i.test(domFont)
    console.log(`    ${pixelsMoved ? "✓" : "✗"} 浮层改正文字体后，章节正文**像素**确实变了（不只是声明值）`)
    if (!pixelsMoved) {
      fails.push(`浮层里改正文字体后章节正文像素**未变**（前后哈希 ${bodyBefore?.slice(0, 16)} / ${bodyAfter?.slice(0, 16)}）`
        + ` —— 不能证明浮层→正文的通路接通了（声明值 ${domFont ?? "取不到"}）`)
    }
    console.log(`    ${declOk ? "✓" : "✗"} 章节正文 font-family 已是仿宋系（${domFont ?? "取不到"}）`)
    if (!declOk) fails.push(`浮层里改正文字体后章节正文 font-family 为「${domFont ?? "取不到"}」，不是仿宋系`)

    /*
     * 反向对照：界面衬线层的**像素**必须完全不变。
     * 这一条同时守住两件事：①用户报的缺陷（改正文→界面跟着变）；
     * ②我这个截图判据本身有意义（若连品牌名区域都"变了"，说明截的区域不对）。
     */
    const brandPixelsMoved = !!(brandShotBefore && brandShotAfter && brandShotBefore !== brandShotAfter)
    console.log(`    ${!brandPixelsMoved ? "✓" : "✗"} 反向对照：界面衬线层像素未变（哈希 ${brandShotAfter?.slice(0, 16) ?? "取不到"}）`)
    if (brandPixelsMoved) {
      fails.push(`【用户报的缺陷】在章节浮层里改「正文字体」后，界面衬线层的**像素**也变了`
        + `（${brandShotBefore?.slice(0, 16)} → ${brandShotAfter?.slice(0, 16)}）—— 正文字体必须只作用于文档正文（--body-font）`)
    }
    const brandLeak = brand && beforeBrand && brand.main !== beforeBrand.main
    const brandIsKaiOrFang = brand && /KaiTi|楷体|FangSong|仿宋|SimHei|黑体/i.test(brand.main)
    console.log(`    ${!brandLeak && !brandIsKaiOrFang ? "✓" : "✗"} 界面衬线层渲染族未被带偏（品牌名 ${brand?.main ?? "取不到"}）`)
    if (brandLeak || brandIsKaiOrFang) {
      fails.push(`【用户报的缺陷】在章节浮层里改「正文字体」把界面也改了：品牌名 ${beforeBrand?.main} → ${brand?.main}`
        + ` —— 正文字体必须只作用于文档正文（--body-font），界面衬线层 --serif 必须固定`)
    }
    const uiLeak = uiNow && beforeUi && uiNow.main !== beforeUi.main
    console.log(`    ${!uiLeak ? "✓" : "✗"} 界面字体未被动（${uiNow?.main ?? "取不到"}）`)
    if (uiLeak) fails.push(`在章节浮层里改「正文字体」把界面字体也改了：${beforeUi?.main} → ${uiNow?.main}`)
    evidence.chapterPopoverCase = {
      opened, set,
      bodyPixelHashBefore: bodyBefore, bodyPixelHashAfter: bodyAfter, bodyPixelMoved: pixelsMoved,
      brandPixelHashBefore: brandShotBefore, brandPixelHashAfter: brandShotAfter, brandPixelMoved: brandPixelsMoved,
      chapterBodyComputedFontFamily: domFont,
      brandBefore: beforeBrand?.main ?? null, brandAfter: brand?.main ?? null,
      uiBefore: beforeUi?.main ?? null, uiAfter: uiNow?.main ?? null,
      note: "章节正文是 textarea，CDP 平台字体对其返回空，故用像素哈希作真实渲染证据（见脚本内注释）",
    }
    await page.evaluate(CLOSE_POPOVER)
  }
}

// ── 恢复 ──
/*
 * ⚠ 恢复必须覆盖**脚本改动过的每一个字段**，一个都不能漏。
 *
 * 实测踩到：本段原先只恢复 4 个（界面字号 / 正文字号 / 界面字体 / 正文字体），
 * 而用例 2 还改了行间距、字间距、左右边距、底部安全距离 ——
 * 于是那 4 个字段的**测试值被留在用户的真实设置里**，而"恢复成功"照样报绿
 * （因为判据只比了它自己恢复的那 4 个）。这是一条"自己给自己打分"的判据：
 * 漏掉的字段既没被恢复、也没被检查，两边同时失明。
 *
 * 所以这里两件事一起做：
 *   ① 恢复 6 个字段（与 READ_STATE / 用例 2 改动过的集合逐一对齐）；
 *   ② 判据同时比这 6 个 —— 漏一个就会红。
 * 下方 restore 数组是唯一事实来源，改动字段时只需改这一处。
 */
console.log("")
console.log("  ── 恢复原始设置 ──")
/*
 * ⚠⚠ 本轮最容易踩的坑：**恢复的控件搬家了**。
 *
 * 这段代码原来是"回到设置页 → 按 aria-label 把 8 个控件逐个写回"。
 * 用户要求把那 6 项移出设置页之后，`行间距 / 字间距 / 左右边距 /
 * 底部安全距离 / 正文字号 / 正文字体` 在设置页里**已经不存在**，
 * 于是旧写法会：
 *   ① 6 个 `SET_CONTROL` 全部 `{ok:false}` → 只推一条 notes 就继续；
 *   ② 那 6 个字段**根本没被恢复**，测试值留在用户的真实设置里；
 *   ③ 最后核对时它们当然对不上 —— 于是一次真机跑完，
 *      用户的排版设置被改成测试值，而脚本还报了一堆"恢复失败"。
 * 也就是说：**恢复这件事必须跟着控件一起搬家**，不能只搬用例不搬恢复。
 *
 * 所以每个字段现在显式标注它住在哪个视图，并分两阶段恢复：
 *   阶段 1（浮层）：正文字体 + 5 个排版参数 —— 它们现在只在这里；
 *   阶段 2（设置页）：界面字号 + 界面字体 —— 这两个仍在设置页。
 * 最后点一次「保存」把设置页那两项落盘（浮层那几项靠防抖自动落盘）。
 */
const restore = [
  /* ── 阶段 1：只在章节「字体设置」浮层里 ── */
  {
    where: "popover", tag: "input", label: "左右边距",
    write: before.storedMarginX,
    expect: (s) => s.storedMarginX, expectValue: before.storedMarginX,
    /*
     * null = 「跟随窗口宽度」，不是"没设过"。若把 null 塞给滑块，
     * `String(null)` 会写成字面量 "null"，反而把用户的设置改坏。
     *
     * ⚠ 恢复 null 的手段**变了**（本轮）：原先左右边距下面有一个
     * 「改回跟随窗口」按钮可单独把这一项设回 null；用户要求删掉它，
     * 于是现在唯一能回到跟随窗口的入口是浮层标题栏的**「默认设置」**。
     * 那个按钮会把 **6 项一起**复位，所以它必须在写其余值**之前**点，
     * 否则会把刚恢复好的值冲掉 —— 恢复就成了"看起来跑了"。
     * 顺序由下面 `needDefault` 那一段保证（不是靠数组顺序，见其注释）。
     */
    defaultWant: { clickLabel: "默认设置" },
  },
  {
    where: "popover", tag: "input", label: "正文字号",
    write: effBodyPx(before.storedBody),
    expect: (s) => effBodyPx(s.storedBody), expectValue: effBodyPx(before.storedBody),
  },
  {
    where: "popover", tag: "input", label: "行间距",
    write: numOr(before.storedLeading, 2.2),
    expect: (s) => s.storedLeading, expectValue: numOr(before.storedLeading, 2.2),
  },
  {
    where: "popover", tag: "input", label: "字间距",
    write: numOr(before.storedLetterSpacing, 0.5),
    expect: (s) => s.storedLetterSpacing, expectValue: numOr(before.storedLetterSpacing, 0.5),
  },
  {
    where: "popover", tag: "input", label: "底部安全距离",
    write: numOr(before.storedSafeBottom, 51),
    expect: (s) => s.storedSafeBottom, expectValue: numOr(before.storedSafeBottom, 51),
  },
  {
    where: "popover", tag: "select", label: "正文字体",
    write: before.storedBodyFont ?? "serif-default",
    expect: (s) => s.storedBodyFont, expectValue: before.storedBodyFont ?? "serif-default",
  },
  /* ── 阶段 2：仍在设置页 ── */
  {
    where: "settings", tag: "input", label: "界面字号",
    write: Math.round(effUi(before.storedUi) * 100),
    expect: (s) => effUi(s.storedUi), expectValue: effUi(before.storedUi),
  },
  {
    where: "settings", tag: "select", label: "界面字体",
    write: before.storedUiFont ?? "system",
    expect: (s) => s.storedUiFont, expectValue: before.storedUiFont ?? "system",
  },
]

const popoverItems = restore.filter((r) => r.where === "popover")
const settingsItems = restore.filter((r) => r.where === "settings")

/* 写一个值；null/undefined 由调用方另行处理（走「默认设置」） */
async function writeOne(r, view) {
  if (r.write === null || r.write === undefined) return { skippedNull: true }
  const res = await page.evaluate(SET_CONTROL, { tag: r.tag, label: r.label, value: r.write })
  if (!res.ok) {
    /* 控件找不到 = 恢复没做成，必须进 fails（notes 会被忽略掉） */
    fails.push(`恢复「${r.label}」时在${view}里找不到控件（aria-label 漂了？）—— 该字段会留有测试值`)
  }
  await wait(250)
  return res
}

// ── 阶段 1：浮层（正文字体 + 5 个排版参数）──
{
  const envR = await ensureNovelOpen()
  console.log(`  阶段 1 环境：${JSON.stringify(envR)}`)
  const navR = await page.evaluate(GO_TO_CHAPTER)
  console.log(`  切到「章节」: ${JSON.stringify(navR)}`)
  await wait(2500)
  const clickedR = await page.evaluate(CLICK_BODY_FONT_ENTRY)
  console.log(`  点「字体设置」入口: ${JSON.stringify(clickedR)}`)
  await wait(1000)
  const stR = await page.evaluate(IS_POPOVER_OPEN)
  if (!stR.open) {
    fails.push(`恢复阶段打不开章节「字体设置」浮层（${JSON.stringify(stR.dialogs)}）—— `
      + `那 6 项现在只在这里，打不开就**无法恢复**，用户的排版设置会留在测试值上`)
  } else {
    /*
     * 顺序保证（不依赖数组顺序）：先决定要不要点「默认设置」，
     * 而且必须在写任何值**之前**点。若哪天有人往 restore 前面插一条，
     * 数组顺序会变，但这段逻辑不受影响。
     */
    const needDefault = before.storedMarginX === null || before.storedMarginX === undefined
    if (needDefault) {
      const lbl = popoverItems.find((r) => r.defaultWant)?.defaultWant.clickLabel
      if (!lbl) {
        fails.push("左右边距原为「跟随窗口」(null)，但没有可用的复位按钮 —— 该字段会留有测试值")
      } else {
        const c = await page.evaluate((label) => {
          const b = [...document.querySelectorAll("button")]
            .find((x) => `${x.getAttribute("aria-label") ?? ""} ${x.getAttribute("title") ?? ""} ${x.textContent ?? ""}`.includes(label))
          if (!b) return { ok: false }
          b.click(); return { ok: true }
        }, lbl)
        if (c.ok) {
          console.log(`  「左右边距」原为「跟随窗口」，已点「${lbl}」复位（该按钮会一并复位其余 5 项，下面按序写回用户原值）`)
        } else {
          fails.push(`恢复「左右边距」需要点浮层里的「${lbl}」按钮，但没找到 —— 该字段会留有测试值`)
        }
        // 等复位真的落盘再写其余值，否则两者会互相覆盖
        await wait(1200)
      }
    }
    for (const r of popoverItems) {
      const res = await writeOne(r, "章节浮层")
      if (res.skippedNull) {
        console.log(`    · ${r.label} 原为「跟随窗口」，已由上面的复位按钮处理`)
      }
    }
    /*
     * 浮层没有保存按钮，落盘靠 createDebouncedPersist(400)。
     * 从最后一次改动算起给它 1500ms，确保写盘真的发生；
     * 不等就可能"关掉浮层再回设置页点保存"时把旧值又写回去。
     */
    await wait(1500)
    console.log(`  浮层内恢复后：${JSON.stringify(await page.evaluate(CLOSE_POPOVER))}`)
  }
}

// ── 阶段 2：设置页（界面字号 + 界面字体）──
if (!(await goToSettings())) { fails.push("恢复阶段无法回到设置页") } else {
  for (const r of settingsItems) await writeOne(r, "设置页")
  await wait(600)
  console.log(`  点保存: ${JSON.stringify(await page.evaluate(CLICK_SAVE))}`)
  await wait(2500)
  const a3 = await page.evaluate(READ_STATE)
  console.log(`  恢复后：DOM root=${a3.domRootPct ?? "(清除)"} --qmai-body-font-px=${a3.domBodyPx ?? "(清除)"}`
    + ` 落盘 界面字号=${a3.storedUi} 正文字号=${a3.storedBody} 行间距=${a3.storedLeading} 字间距=${a3.storedLetterSpacing}`
    + ` 左右边距=${a3.storedMarginX} 底部安全距离=${a3.storedSafeBottom} 界面字体=${a3.storedUiFont} 正文字体=${a3.storedBodyFont}`)

  /* 逐字段核对：任一项不符即列出具体是哪个字段，不要只给一个总的 false */
  const bad = []
  for (const r of restore) {
    const a = r.expect(a3), w = r.expectValue
    const same = (typeof w === "number" || typeof a === "number")
      ? (a === null && w === null) || (typeof a === "number" && typeof w === "number" && Math.abs(a - w) < 1e-6)
      : a === w
    if (!same) bad.push(`${r.label}: 期望 ${JSON.stringify(w)} 实得 ${JSON.stringify(a)}`)
    console.log(`    ${same ? "✓" : "✗"} ${r.label.padEnd(7)} ${JSON.stringify(a)}（期望 ${JSON.stringify(w)}）`)
  }
  const restored = bad.length === 0
  if (!restored) fails.push(`未能恢复初始设置（${bad.length} 个字段不符）：${bad.join("；")}`)
  if (before.storedBody === null && a3.storedBody === 18) {
    notes.push("正文字号原为「从未设置」(null)，保存后落为显式默认值 18 —— 语义相同（都是默认 18px），非串改")
  }
  evidence.restore = {
    /*
     * ⚠ 这里必须收**全部 8 个**字段，不能只收其中 4 个。
     * 上一版只收了界面/正文的字号与字体，于是"那 4 个排版参数没被恢复"
     * 这件事在归档里**看不出来** —— 证据自己就把盲区复制了一份。
     * 逐字段的 where/diff 让归档能直接回答"哪个字段、住在哪个视图、差多少"。
     */
    fields: restore.map((r) => {
      const a = r.expect(a3), w = r.expectValue
      return { label: r.label, where: r.where, expected: w, actual: a }
    }),
    ok: restored,
    backup: evidence.userStateBackup ?? null,
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
