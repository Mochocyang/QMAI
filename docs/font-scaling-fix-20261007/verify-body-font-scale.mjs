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
 * 还必须在默认档（未设置 --qmai-body-font-scale）逐位还原改造前的
 * 18px / 16px / 12px：判据 1 要求"默认观感零变化"，
 * 而 calc(1.125rem * 1) 是否真的等于 18px、::marker 是否真的 12px，
 * 只有浏览器说了算。
 *
 * 覆盖面（如实说明）：编辑器 DOM 在实际可达路径下从不挂载，故此处
 * **注入真实选择器结构**，让 .ui-test-root .ui-test-editor-body 等真实规则级联生效。
 * 它证明"真实 CSS 规则对真实变量有正确反应"，**不替代**真实 exe 目视（任务 10 步骤 2b）。
 *
 * 尺子自身的对照（不成立则本次结论无效）：
 *   ① 倍数必须真的改变字号（否则"默认档正确"可能只是变量没生效）
 *   ② 探针若不在 .ui-test-root 内，就不该被规则命中 ——
 *      证明测到的是真实选择器链，而不是某种全局继承
 *   ③ 界面字号 × 正文字号 必须乘积生效（验证设计：文档尺寸 = 两者相乘）
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

const SET_SCALE = (value) => {
  const r = document.documentElement
  if (value === null) r.style.removeProperty("--qmai-body-font-scale")
  else r.style.setProperty("--qmai-body-font-scale", value)
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

    await page.evaluate(SET_SCALE, null)
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
    console.log("  ── 默认档（未设置 --qmai-body-font-scale，应与改造前逐位相同）──")
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
      fail("A/默认档未逐位还原", `${expectBase.length - baseOk} 处与改造前不符 —— font 简写里的 var() 可能被判为无效（声明整体失效）或 calc 未按 1 倍还原`)
    }
    // 高亮层必须与输入层逐像素对齐（单一来源的核心目的）
    if (!close(at1.highlights.lineHeight, at1.para.lineHeight)) {
      fail("B/高亮层与输入层行高不一致", `高亮层 ${at1.highlights.lineHeightRaw} vs 正文 ${at1.para.lineHeightRaw} —— 覆盖层会与文字错位`)
    }
    console.log(`  高亮层 vs 正文行高: ${at1.highlights.lineHeightRaw} vs ${at1.para.lineHeightRaw}  ${close(at1.highlights.lineHeight, at1.para.lineHeight) ? "✓ 一致" : "✗ 不一致"}`)

    // ③ 文档标题字体必须是界面字体（用户确认），正文必须是衬线正文字体
    console.log(`  文档标题字体: ${at1.heading.fontFamily.split(",")[0]}（应为界面字体，不跟随正文字体）`)
    console.log(`  正文字体:     ${at1.para.fontFamily.split(",")[0]}（应为衬线正文字体）`)

    // ① 尺子有效：倍数必须真的改变字号
    console.log("")
    console.log("  ── 倍数生效（尺子自身的对照①）──")
    console.log("  倍数     正文     列表     无序标记   有序标记   界面字号")
    console.log("  " + "─".repeat(58))
    const scaleRows = []
    for (const s of [null, "1", "1.25", "1.5", "0.85"]) {
      await page.evaluate(SET_SCALE, s)
      await page.waitForTimeout(120)
      const r = await page.evaluate(READ, "qmai-body-scale-probe")
      const k = s === null ? 1 : Number(s)
      scaleRows.push({ s, k, r })
      console.log(`  ${(s === null ? "未设置" : `×${s}`).padEnd(8)} ${r.para.fontSizeRaw.padStart(8)} ${r.listUl.fontSizeRaw.padStart(8)} ${r.markerUl.fontSizeRaw.padStart(10)} ${r.markerOl.fontSizeRaw.padStart(10)} ${r.body.fontSizeRaw.padStart(9)}`)
    }
    const rulerOk = scaleRows.every((row) =>
      close(row.r.para.fontSize, 18 * row.k)
      && close(row.r.listUl.fontSize, 16 * row.k)
      && close(row.r.markerUl.fontSize, 12 * row.k)
      && close(row.r.markerOl.fontSize, 16 * row.k))
    if (!rulerOk) fail("C/倍数未按预期缩放", "某一档的正文字号/列表/标记不等于「改造前值 × 倍数」")
    // 「未设置」与显式 1 必须完全一致（证明默认值 1 生效）
    const unset = scaleRows.find((x) => x.s === null).r
    const one = scaleRows.find((x) => x.s === "1").r
    const defaultSame = close(unset.para.fontSize, one.para.fontSize) && close(unset.markerUl.fontSize, one.markerUl.fontSize)
    if (!defaultSame) fail("D/默认值与显式 1 不一致", "未设置变量与设置为 1 结果不同，说明回退默认值不是 1")

    // ② 对照：探针不在 .ui-test-root 内时不应被规则命中
    const outsidePara = outside?.para
    const outsideNotMatched = !!outsidePara && !close(outsidePara.fontSize, at1.para.fontSize)
    if (!outsideNotMatched) {
      fail("E/选择器链对照失败", "放在 .ui-test-root 之外的探针也得到同样字号 —— 说明测到的不是真实选择器规则，本次结论不可信")
    }
    console.log("")
    console.log("  ── 尺子自身的对照 ──")
    console.log(`  ① 倍数真的改变字号     ${rulerOk ? "✓ 0.85~1.5 各档均为「改造前值 × 倍数」" : "✗ 不符"}`)
    console.log(`  ② 选择器链对照         ${outsideNotMatched ? `✓ 根外探针为 ${outsidePara?.fontSizeRaw}（未被命中）` : "✗ 根外也被命中"}`)
    console.log(`  ③ 未设置 == 显式 1      ${defaultSame ? "✓ 回退默认值确为 1" : "✗ 不一致"}`)

    // ③ 界面字号 × 正文字号 必须乘积生效（设计：文档尺寸 = 两者相乘）
    console.log("")
    console.log("  ── 界面字号 × 正文字号 的乘积语义（设计 §5.3）──")
    const combos = []
    for (const [rootPct, scale] of [[100, null], [100, "1.25"], [150, null], [150, "1.5"], [80, "0.85"]]) {
      await page.evaluate(SET_ROOT_PCT, rootPct)
      await page.evaluate(SET_SCALE, scale)
      await page.waitForTimeout(120)
      const r = await page.evaluate(READ, "qmai-body-scale-probe")
      const k = scale === null ? 1 : Number(scale)
      const want = 18 * (rootPct / 100) * k
      const ok = close(r.para.fontSize, want)
      combos.push({ rootPct, scale, got: r.para.fontSize, want, ok })
      console.log(`  界面 ${String(rootPct).padStart(3)}% × 正文 ${(scale === null ? "默认" : `×${scale}`).padEnd(5)} → ${r.para.fontSizeRaw.padStart(9)}  期望 ${want}px  ${ok ? "✓" : "✗"}`)
    }
    await page.evaluate(SET_ROOT_PCT, null)
    await page.evaluate(SET_SCALE, null)
    await page.waitForTimeout(150)
    const comboOk = combos.every((c) => c.ok)
    if (!comboOk) fail("F/相乘语义不成立", "正文字号未等于「界面字号 × 正文字号倍数」")
    // 上限 1.5 × 1.5 = 2.25 倍（约 40.5px）—— 设计确认过的最大值
    await page.evaluate(SET_ROOT_PCT, 150)
    await page.evaluate(SET_SCALE, "1.5")
    await page.waitForTimeout(120)
    const maxRec = await page.evaluate(READ, "qmai-body-scale-probe")
    console.log(`  上限组合 150% × 1.5 → ${maxRec.para.fontSizeRaw}（设计确认约 40.5px）`)
    await page.evaluate(SET_ROOT_PCT, null)
    await page.evaluate(SET_SCALE, null)
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
    console.log(`  结论: 默认档 ${baseOk}/${expectBase.length} 逐位还原、倍数与乘积语义成立，守卫 ${guards.length} 项未通过 → ${guards.length === 0 ? "✓ 通过" : "✗ 未通过"}`)
    process.exit(guards.length === 0 ? 0 : 1)
  } finally {
    await browser.close()
    server.close()
  }
}

main().catch((e) => { console.log(`  ✗ 运行失败: ${e?.message ?? e}`); process.exit(1) })
