#!/usr/bin/env node
/**
 * 验证正文字号「单一来源」在真实浏览器里确实工作 —— 任务 7 的动态判据。
 *
 * 静态校验（verify-body-font-single-source.mjs）只能证明"写法符合预期"，
 * 证明不了浏览器**接受**这个写法。本任务引入了一个有真实风险的写法：
 *     font: 400 var(--qmai-body-font-size)/var(--qmai-body-line-height) var(--serif);
 * `font` 简写里放两个 var() 若被浏览器判为无效，**整条声明会失效**，
 * 字号静默退回继承值 —— 静态校验照样全绿，而正文根本不再缩放。
 * 故必须实测。
 *
 * 还必须在默认档（未设置 --qmai-body-font-px）逐位还原改造前的
 * 18px / 16px / 12px：判据 1 要求"默认观感零变化"，
 * 而 var(--qmai-body-font-px, 18px) 的兜底是否真的等于 18px、
 * 派生出来的列表 18×8/9 = 16px 与标记 18×2/3 = 12px 是否真的到位，
 * 只有浏览器说了算。
 *
 * 覆盖面（如实说明）：编辑器 DOM 在实际可达路径下从不挂载，故此处
 * **注入真实选择器结构**，让 .ui-test-root .ui-test-editor-body 等真实规则级联生效。
 * 它证明"真实 CSS 规则对真实变量有正确反应"，**不替代**真实 exe 目视（任务 10 步骤 2b）。
 *
 * ── 文件名保留，语义已从「倍数」改为「px」（本次改造）──
 * 本脚本过去用 `--qmai-body-font-scale`（倍数）当尺子。改造后正文字号是
 * **绝对 px**（`--qmai-body-font-px`），与界面字号**彻底解耦**。
 * 文件名没有改（它被 findings.md 与图稿引用），但下面每一条判据都换了模型：
 * 期望值不再是「改造前值 × 倍数」，而是「设定的 px」（从属尺寸按 8/9、2/3 派生）。
 *
 * 尺子自身的对照（不成立则本次结论无效）：
 *   ① 写入的 px 必须真的改变字号（否则"默认档正确"可能只是变量没生效）
 *   ② 探针若不在 .ui-test-root 内，就不该被规则命中 ——
 *      证明测到的是真实选择器链，而不是某种全局继承
 *   ③ 界面字号变化时正文**不得**跟着变（本次改造的核心新不变量：
 *      正文是绝对 px，与界面字号解耦。组合表里刻意保留 rootPct=150 那一档 ——
 *      删掉它等于放弃这条不变量）。
 *      配套的正对照：界面 150% 必须**真的**改变了根字号，否则"正文没变"
 *      可能只是因为界面字号根本没生效（那这条结论就是空的）。
 *   ④ Chromium 报告真实渲染字体，确认正文用的是 --serif 而非界面字体
 */

import { createServer } from "node:http"
import { readFileSync, existsSync, statSync } from "node:fs"
import { join, extname, resolve, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..")
const DIST = join(REPO, "dist")

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

const INJECT = () => {
  document.getElementById("qmai-body-scale-probe")?.remove()
  document.getElementById("qmai-body-scale-outside")?.remove()
  const root = document.querySelector(".ui-test-root")
  if (!root) return false
  const mk = (host, id) => {
    const wrap = document.createElement("div")
    wrap.id = id
    if (host) wrap.className = "ui-test-root"
    wrap.innerHTML = `
      <div class="ui-test-editor-body">
        <div class="ProseMirror" lang="zh">
          <p>正文样张段落 Ag</p>
          <h2>文档标题样张</h2>
          <ul><li>无序列表项</li></ul>
          <ol><li>有序列表项</li></ol>
        </div>
        <div data-writing-editor><textarea>输入层样张</textarea></div>
        <div data-find-highlights>高亮层样张</div>
      </div>`
    ;(host ?? document.body).appendChild(wrap)
    return true
  }
  // ② 对照：故意放在 .ui-test-root 之外，不应被规则命中
  mk(null, "qmai-body-scale-outside")
  return mk(root.parentElement, "qmai-body-scale-probe")
}

/*
 * 尺子：把已知 px 写进 App 的独占变量 --qmai-body-font-px。
 * 语义从「倍数」改成「px」——写进去的就是正文字号的绝对像素值。
 */
const SET_BODY_PX = (value) => {
  const r = document.documentElement
  if (value === null) r.style.removeProperty("--qmai-body-font-px")
  else r.style.setProperty("--qmai-body-font-px", value)
}
const SET_ROOT_PCT = (pct) => {
  const r = document.documentElement
  if (pct === null) r.style.removeProperty("font-size")
  else r.style.fontSize = `${pct}%`
}

/** 读取探针的 computed 尺寸（含 ::marker）。 */
const READ = (probeId) => {
  const host = document.getElementById(probeId)
  if (!host) return null
  const pick = (sel) => host.querySelector(sel)
  const info = (el, pseudo) => {
    if (!el) return null
    const cs = getComputedStyle(el, pseudo ?? undefined)
    return {
      fontSize: parseFloat(cs.fontSize),
      fontSizeRaw: cs.fontSize,
      lineHeight: parseFloat(cs.lineHeight),
      lineHeightRaw: cs.lineHeight,
      fontFamily: cs.fontFamily,
    }
  }
  const ul = pick("ul")
  const ol = pick("ol")
  const liUl = pick("ul li")
  const liOl = pick("ol li")
  return {
    body: info(pick(".ui-test-editor-body")),
    para: info(pick(".ProseMirror p")),
    heading: info(pick("h2")),
    listUl: info(ul),
    li: info(liUl),
    // ::marker 必须挂在 **li**（list-item）上读，不能挂在 ul/ol 上：
    // ul 不是 list-item，getComputedStyle(ul, "::marker") 会退回返回元素自身样式，
    // 于是「无序标记 12px」被读成 ul 的 16px。而「有序标记 16px」恰好与
    // ul 的 16px 相同 —— 会**假通过**。这类"碰巧正确"的值比报错更危险。
    markerUl: info(liUl, "::marker"),
    liOl: info(liOl),
    markerOl: info(liOl, "::marker"),
    highlights: info(pick("[data-find-highlights]")),
    textarea: info(pick("textarea")),
    // ::marker 只有挂在 list-item 上才有意义；不是 list-item 时上面的读数无效
    liDisplay: liUl ? getComputedStyle(liUl).display : null,
  }
}

const close = (a, b) => Math.abs(a - b) < 0.02

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

    await page.evaluate(SET_BODY_PX, null)
    await page.evaluate(SET_ROOT_PCT, null)
    await page.waitForTimeout(150)
    const injected = await page.evaluate(INJECT)
    await page.waitForTimeout(250)
    if (!injected) { console.log("  ✗ 页面上没有 .ui-test-root，无法注入探针"); process.exit(1) }

    const at1 = await page.evaluate(READ, "qmai-body-scale-probe")
    const outside = await page.evaluate(READ, "qmai-body-scale-outside")
    if (!at1?.para) { console.log("  ✗ 探针未生效，取不到 .ProseMirror p"); process.exit(1) }

    console.log("  ══ 正文字号单一来源：真实浏览器动态验证（真实 dist/ · 1440x900）══")
    console.log("")
    console.log("  ── 默认档（未设置 --qmai-body-font-px，应与改造前逐位相同）──")
    const expectBase = [
      ["正文 .ProseMirror p", at1.para, 18],
      ["正文 .ui-test-editor-body", at1.body, 18],
      ["文档标题 h2", at1.heading, 18],
      ["查找高亮层", at1.highlights, 18],
      ["输入层 textarea", at1.textarea, 18],
      ["列表容器 ul", at1.listUl, 16],
      ["列表项 li", at1.li, 16],
      ["无序标记 ::marker", at1.markerUl, 12],
      ["有序列表项 li", at1.liOl, 16],
      ["有序标记 ::marker", at1.markerOl, 16],
    ]
    let baseOk = 0
    for (const [name, rec, want] of expectBase) {
      if (!rec) { console.log(`  ${name.padEnd(26)} ✗ 取不到`); continue }
      const ok = close(rec.fontSize, want)
      if (ok) baseOk++
      console.log(`  ${name.padEnd(26)} ${rec.fontSizeRaw.padStart(9)}  期望 ${want}px  ${ok ? "✓" : "✗"}`)
    }
    // ::marker 读数的前提：必须是 list-item，否则浏览器会退回返回元素自身样式，
    // 得到一个"看起来合理"的值（本次就踩过：ul::marker 读成 16px）
    if (at1.liDisplay !== "list-item") {
      fail("A0/marker 读数无效", `探针 li 的 display 是 ${at1.liDisplay} 而非 list-item —— ::marker 读数不可信`)
    }
    if (baseOk !== expectBase.length) {
      fail("A/默认档未逐位还原", `${expectBase.length - baseOk} 处与改造前不符 —— font 简写里的 var() 可能被判为无效（声明整体失效），或 var(--qmai-body-font-px, 18px) 的兜底值与派生比例未按 18px 还原`)
    }
    // 高亮层必须与输入层逐像素对齐（单一来源的核心目的）
    if (!close(at1.highlights.lineHeight, at1.para.lineHeight)) {
      fail("B/高亮层与输入层行高不一致", `高亮层 ${at1.highlights.lineHeightRaw} vs 正文 ${at1.para.lineHeightRaw} —— 覆盖层会与文字错位`)
    }
    console.log(`  高亮层 vs 正文行高: ${at1.highlights.lineHeightRaw} vs ${at1.para.lineHeightRaw}  ${close(at1.highlights.lineHeight, at1.para.lineHeight) ? "✓ 一致" : "✗ 不一致"}`)

    // ③ 文档标题字体必须是界面字体（用户确认），正文必须是衬线正文字体
    console.log(`  文档标题字体: ${at1.heading.fontFamily.split(",")[0]}（应为界面字体，不跟随正文字体）`)
    console.log(`  正文字体:     ${at1.para.fontFamily.split(",")[0]}（应为衬线正文字体）`)

    // ① 尺子有效：写进去的 px 必须真的改变字号
    console.log("")
    console.log("  ── 字号生效（尺子自身的对照①）──")
    console.log("  正文 px  正文     列表     无序标记   有序标记   界面字号")
    console.log("  " + "─".repeat(58))
    const scaleRows = []
    for (const p of [null, "18px", "24px", "32px", "12px"]) {
      await page.evaluate(SET_BODY_PX, p)
      await page.waitForTimeout(120)
      const r = await page.evaluate(READ, "qmai-body-scale-probe")
      const base = p === null ? 18 : parseFloat(p)
      scaleRows.push({ p, base, r })
      console.log(`  ${(p === null ? "未设置" : p).padEnd(8)} ${r.para.fontSizeRaw.padStart(8)} ${r.listUl.fontSizeRaw.padStart(8)} ${r.markerUl.fontSizeRaw.padStart(10)} ${r.markerOl.fontSizeRaw.padStart(10)} ${r.body.fontSizeRaw.padStart(9)}`)
    }
    /*
     * 期望值由 px 直接推出，不再乘界面字号：
     *   正文 = Npx、列表 = N×8/9、无序标记 = N×2/3、有序标记 = N×8/9
     * （比例沿用改造前 16/18 与 12/18，故默认档 18 → 16 / 12 / 16 逐位不变）
     */
    const rulerOk = scaleRows.every((row) =>
      close(row.r.para.fontSize, row.base)
      && close(row.r.listUl.fontSize, row.base * 8 / 9)
      && close(row.r.markerUl.fontSize, row.base * 2 / 3)
      && close(row.r.markerOl.fontSize, row.base * 8 / 9))
    if (!rulerOk) fail("C/字号未按预期生效", "某一档的正文字号/列表/标记不等于「设定 px」「设定 px × 8/9」「设定 px × 2/3」")
    // 「未设置」与显式 18px 必须完全一致（证明回退默认值 18px 生效）
    const unset = scaleRows.find((x) => x.p === null).r
    const explicit = scaleRows.find((x) => x.p === "18px").r
    const defaultSame = close(unset.para.fontSize, explicit.para.fontSize) && close(unset.markerUl.fontSize, explicit.markerUl.fontSize)
    if (!defaultSame) fail("D/未设置与显式 18px 不一致", "未设置变量与设置为 18px 结果不同，说明回退默认值不是 18px")

    // ② 对照：探针不在 .ui-test-root 内时不应被规则命中
    const outsidePara = outside?.para
    const outsideNotMatched = !!outsidePara && !close(outsidePara.fontSize, at1.para.fontSize)
    if (!outsideNotMatched) {
      fail("E/选择器链对照失败", "放在 .ui-test-root 之外的探针也得到同样字号 —— 说明测到的不是真实选择器规则，本次结论不可信")
    }
    console.log("")
    console.log("  ── 尺子自身的对照 ──")
    console.log(`  ① 字号真的改变字号     ${rulerOk ? "✓ 12px~32px 各档 =「设定 px」与「设定 px × 8/9 / × 2/3」" : "✗ 不符"}`)
    console.log(`  ② 选择器链对照         ${outsideNotMatched ? `✓ 根外探针为 ${outsidePara?.fontSizeRaw}（未被命中）` : "✗ 根外也被命中"}`)
    console.log(`  ③ 未设置 == 显式 18px   ${defaultSame ? "✓ 回退默认值确为 18px" : "✗ 不一致"}`)

    /*
     * ③ 界面字号与正文字号**解耦**（本次改造最核心的语义变化）。
     * 改造前这里是「界面字号 × 正文倍数」的乘积语义；现在正文是绝对 px，
     * 改界面字号**不得**改变正文字号。
     * rootPct=150 那一档**必须保留** —— 删掉它等于放弃这条新不变量。
     */
    console.log("")
    console.log("  ── 界面字号 × 正文字号：已解耦（正文是绝对 px，不随界面字号变）──")
    const rootFontPx = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)
    const combos = []
    for (const [rootPct, p] of [[100, null], [100, "24px"], [150, null], [150, "32px"], [80, "15px"]]) {
      await page.evaluate(SET_ROOT_PCT, rootPct)
      await page.evaluate(SET_BODY_PX, p)
      await page.waitForTimeout(120)
      const r = await page.evaluate(READ, "qmai-body-scale-probe")
      const rootNow = await rootFontPx()
      const base = p === null ? 18 : parseFloat(p)
      const ok = close(r.para.fontSize, base)
      combos.push({ rootPct, p, got: r.para.fontSize, want: base, ok, rootNow })
      console.log(`  界面 ${String(rootPct).padStart(3)}% × 正文 ${(p === null ? "默认" : p).padEnd(5)} → ${r.para.fontSizeRaw.padStart(9)}  期望 ${base}px（不乘界面字号）  ${ok ? "✓" : "✗"}  [root=${rootNow}]`)
    }
    await page.evaluate(SET_ROOT_PCT, null)
    await page.evaluate(SET_BODY_PX, null)
    await page.waitForTimeout(150)
    const comboOk = combos.every((c) => c.ok)
    if (!comboOk) fail("F/解耦语义不成立", "正文字号不等于设定的 px —— 要么设定值没生效，要么正文仍跟着界面字号变（改造前才相乘）")
    /*
     * 「正文没随界面字号变」这条结论只有在界面字号**真的生效**时才有意义。
     * 若 150% 没有改变根字号，"正文不变"就只是个空结论（两条读数是同一个环境）。
     * 故补一条尺子正对照 —— 这是新增的判据，不是放松：它让解耦结论不再可能是恒真。
     */
    const root100 = combos.find((c) => c.rootPct === 100)?.rootNow
    const root150 = combos.find((c) => c.rootPct === 150)?.rootNow
    const rootRulerOk = !!root100 && !!root150 && parseFloat(root150) > parseFloat(root100)
    if (!rootRulerOk) {
      fail("G/界面字号尺子失效", `界面 150% 未改变根字号（100% → ${root100}，150% → ${root150}）—— "正文没跟着变"可能只是因为界面字号根本没生效，本次解耦结论不成立`)
    }
    console.log(`  尺子正对照：界面 100% → root=${root100}，150% → root=${root150}  ${rootRulerOk ? "✓ 界面字号确实生效（解耦结论非空）" : "✗ 界面字号未生效"}`)
    // 上限 32px（旧模型理论上限 18 × 1.5 × 1.5 = 40.5px，故裁切风险是下降的）
    await page.evaluate(SET_ROOT_PCT, 150)
    await page.evaluate(SET_BODY_PX, "32px")
    await page.waitForTimeout(120)
    const maxRec = await page.evaluate(READ, "qmai-body-scale-probe")
    console.log(`  上限组合 界面150% + 正文32px → ${maxRec.para.fontSizeRaw}（正文上限 32px，与界面字号无关）`)
    await page.evaluate(SET_ROOT_PCT, null)
    await page.evaluate(SET_BODY_PX, null)
    await page.waitForTimeout(120)

    // ④ Chromium 报告的真实渲染字体：正文必须用衬线正文字体，不是界面字体
    const fontOf = async (selector) => {
      try {
        const { root } = await cdp.send("DOM.getDocument", { depth: 0 })
        const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector })
        if (!nodeId) return null
        const r = await cdp.send("CSS.getPlatformFontsForNode", { nodeId })
        return r.fonts.map((f) => f.familyName).join(" + ")
      } catch { return null }
    }
    await page.waitForTimeout(200)
    const paraFont = await fontOf("#qmai-body-scale-probe .ProseMirror p")
    const headFont = await fontOf("#qmai-body-scale-probe h2")
    console.log("")
    console.log("  ── Chromium 报告的真实渲染字体 ──")
    console.log(`  正文     ${paraFont ?? "(取不到)"}`)
    console.log(`  文档标题 ${headFont ?? "(取不到)"}（用户确认：文档标题用界面字体）`)

    console.log("")
    console.log("  说明：编辑器 DOM 在实际可达路径下从不挂载（已登记盲区）。此处注入真实选择器")
    console.log("       结构，证明真实 CSS 规则对真实变量有正确反应；不替代真实 exe 目视。")
    for (const g of guards) console.log(`  ✗ GUARD-FAIL [${g.code}] ${g.detail}`)
    console.log(`  结论: 默认档 ${baseOk}/${expectBase.length} 逐位还原、字号生效、界面与正文解耦，守卫 ${guards.length} 项未通过 → ${guards.length === 0 ? "✓ 通过" : "✗ 未通过"}`)
    process.exit(guards.length === 0 ? 0 : 1)
  } finally {
    await browser.close()
    server.close()
  }
}

main().catch((e) => { console.log(`  ✗ 运行失败: ${e?.message ?? e}`); process.exit(1) })
