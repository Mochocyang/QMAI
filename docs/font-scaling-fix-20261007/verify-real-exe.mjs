#!/usr/bin/env node
/**
 * 真实 exe 验证（任务 10）—— 通过 CDP 驱动便携版，而不是靠肉眼看截图。
 *
 * ── 为什么必须做这一步 ──
 * 计算样式普查工具**到不了编辑器 DOM**（实测 11 个设置分区里
 * `.ui-test-editor-body` = 0、`.ProseMirror` = 0）。所以
 * `ui-test-editor.css` 的正文与列表标记规则不在判据 1/2 的覆盖内。
 * `verify-body-font-scale.mjs` 用注入结构证明了"规则对变量有正确反应"，
 * 但注入毕竟不是真实应用。本脚本补上最后一环：在**真实 exe 的真实 DOM** 上实测。
 *
 * ── 过程中查清的两件"与计划假设不符"的事实（见 findings.md）──
 * ① 小说**章节**的正文是 textarea（沉浸写作），`li` 永远不可能出现；
 *    `.ui-test-editor.css` 里那两条 `li::marker` 规则，
 *    唯一可达的消费者是**非章节文档**（大纲/设定页）走 Milkdown 的 `.ProseMirror`。
 *    故本脚本先导航到「大纲」视图并打开一个含列表的真实大纲文件。
 * ② `UiTestEditor` 自己的读写切换按钮是死代码（`{false && …}`），
 *    章节的 read 模式不可达（`effectiveMode = immersiveWriting ? "edit" : mode`）。
 *
 * ── 与"人眼看截图"相比为什么更可靠 ──
 * 目视只能看出"变大了/没变大"，读不出 12px/16px 这种精确值，
 * 也分不清"标记没变"与"标记变了但比例错了"。CDP 直读计算值是判据，截图只作留证。
 *
 * ── 尺子自身的对照（任何一条不成立，本次读数即不可信）──
 *   ① `li` 的 `display` 必须是 `list-item`：否则 `getComputedStyle(li,"::marker")`
 *      会**静默退回返回元素自身样式**。本项目已踩过一次 —— 读 `ul::marker`
 *      拿到的其实是 `ul` 的 16px，而"有序标记"的期望恰好也是 16px，于是它通过了。
 *   ② 默认档必须逐位还原改造前的值（18/16/12/16px）。
 *   ③ 写入的 px 必须真的改变字号，否则「默认档正确」可能只是变量完全没生效。
 *   ④ 界面字号变化时正文**不得**跟着变（本次改造的核心新不变量：
 *      正文是绝对 px，与界面字号解耦。改造前是「两者相乘」）。
 *      组合表里刻意保留「界面150%」那一档 —— 删掉它等于放弃这条不变量。
 *   ⑤ 界面字号必须改变**整个界面**（不只按钮）—— 这正是用户最初的抱怨。
 *
 * ── 尺子的语义已从「倍数」改为「px」（本次改造）──
 * 过去这里写 `--qmai-body-font-scale`（倍数，与界面字号相乘）；
 * 现在写 `--qmai-body-font-px`（绝对像素，`<N>px`），期望值由 N 直接推出：
 *   正文 = Npx、无序/有序列表项 = N×8/9、无序标记 = N×2/3、有序标记 = N×8/9。
 * 默认档（清掉该变量）= 18 / 16 / 12 / 16px，与改造前逐位相同。
 *
 * 用法：
 *   node verify-real-exe.mjs                 # 启动 exe 并验证
 *   node verify-real-exe.mjs --attach --port 9333
 *   node verify-real-exe.mjs --keep-open
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawn } from "node:child_process"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..")

const argv = process.argv.slice(2)
const argOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
const EXE = argOf("--exe") ?? join(REPO, "release-portable", "QMaiWrite.exe")
const PORT = Number(argOf("--port") ?? 9222)
const ATTACH = argv.includes("--attach")
const KEEP_OPEN = argv.includes("--keep-open")
const SHOT_DIR = argOf("--shot-dir") ?? join(HERE, "real-exe-shots")
/*
 * 跟随率的**参与元素下限**（对抗性审查 P2-③）。
 *
 * 没有下限时，"跟随率 100%" 可以在只有 3 个文字元素的样本上成立 ——
 * 分母小到不构成证据。实测本机 150% 档有 2574 个文字元素，故默认 500 是很宽的护栏：
 * 正常采集远高于它，一旦页面没渲染出来或选择器失效就会跌破并失败。
 */
const MIN_TEXTY = Number(argOf("--min-texty") ?? 500)

async function loadPlaywright() {
  for (const c of [join(process.env.APPDATA ?? "", "npm/node_modules/playwright/index.js"), join(REPO, "node_modules/playwright/index.js")]) {
    if (existsSync(c)) { const mod = await import(pathToFileURL(c).href); return mod.chromium ?? mod.default?.chromium }
  }
  throw new Error("找不到 playwright")
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastErr = null
  while (Date.now() < deadline) {
    try { const res = await fetch(`http://127.0.0.1:${port}/json/version`); if (res.ok) return await res.json() } catch (e) { lastErr = e }
    await wait(500)
  }
  throw new Error(`等待 CDP 端口 ${port} 超时${lastErr ? `（最后一次错误: ${lastErr.message}）` : ""}`)
}

/* ────────────────────────── 页面内函数 ────────────────────────── */

const PROBE = () => {
  const q = (s) => document.querySelectorAll(s).length
  return {
    url: location.href, title: document.title,
    view: document.querySelector(".ui-test-root")?.getAttribute("data-view") ?? null,
    rootCount: q(".ui-test-root"), bodyCount: q(".ui-test-editor-body"), pmCount: q(".ProseMirror"),
    proseInBody: q(".ui-test-editor-body .ProseMirror"),
    ulInBody: q(".ui-test-editor-body ul"), olInBody: q(".ui-test-editor-body ol"), liInBody: q(".ui-test-editor-body li"),
    anyUl: q("ul"), anyOl: q("ol"), anyLi: q("li"), textareaInBody: q(".ui-test-editor-body textarea"),
    editorKind: document.querySelector(".ui-test-editor")?.getAttribute("data-kind") ?? null,
    navItems: [...document.querySelectorAll(".ui-test-nav-item")].map((b) => (b.textContent ?? "").trim()),
    censusMarks: document.querySelectorAll("[data-qmai-census]").length,
  }
}

/** 切到指定视图（点主导航项）。返回是否成功。 */
const NAV_TO = (wantLabel) => {
  const items = [...document.querySelectorAll(".ui-test-nav-item")]
  const hit = items.find((b) => (b.textContent ?? "").trim() === wantLabel) ?? items.find((b) => (b.textContent ?? "").trim().includes(wantLabel))
  if (!hit) return { ok: false, labels: items.map((b) => (b.textContent ?? "").trim()) }
  hit.click()
  return { ok: true, labels: items.map((b) => (b.textContent ?? "").trim()) }
}

/** 点开含列表的真实文档。优先挑同时有 ul>li 与 ol>li 且体积较小的。 */
const OPEN_LIST_DOC = () => {
  const rows = [...document.querySelectorAll("[data-page-path]")]
  const cand = rows.map((r) => ({ row: r, path: r.getAttribute("data-page-path") ?? "" }))
    .filter((c) => c.path.toLowerCase().endsWith(".md"))
  // 这些是实测同时含无序与有序列表的真实大纲文件；按体积从小到大试
  const prefer = ["开篇方向", "设定总索引", "章纲-第002章", "总纲", "十年动乱史"]
  for (const key of prefer) {
    const found = cand.find((c) => c.path.includes(key))
    if (found) {
      found.row.scrollIntoView({ block: "center" })
      // 真正的点击处理器挂在行内的 button 上；点外层 div 只会向上冒泡，不会下传。
      const btn = found.row.querySelector("button") ?? found.row
      btn.click()
      return { ok: true, path: found.path, by: `prefer:${key}`, clicked: btn.tagName.toLowerCase() }
    }
  }
  if (cand[0]) { const b = cand[0].row.querySelector("button") ?? cand[0].row; b.click(); return { ok: true, path: cand[0].path, by: "first" } }
  return { ok: false, available: cand.map((c) => c.path).slice(0, 30) }
}

/** 编辑器里是否已出现可在其上读 ::marker 的结构。 */
const LIST_STATE = () => {
  const body = document.querySelector(".ui-test-editor-body")
  if (!body) return { body: false }
  const ulLi = body.querySelector("ul > li")
  const olLi = body.querySelector("ol > li")
  return {
    body: true,
    proseMirror: body.querySelectorAll(".ProseMirror").length,
    dirLang: body.querySelectorAll("[dir][lang]").length,
    ulLi: !!ulLi, olLi: !!olLi,
    ulCount: body.querySelectorAll("ul > li").length, olCount: body.querySelectorAll("ol > li").length,
    ulDisplay: ulLi ? getComputedStyle(ulLi).display : null,
    olDisplay: olLi ? getComputedStyle(olLi).display : null,
  }
}

/*
 * 尺子：把已知的**绝对 px** 写进 App 的独占变量 `--qmai-body-font-px`（`<N>px`）。
 *
 * 语义已从「倍数」改成「px」：写进去的就是正文字号的像素值，
 * 期望值直接由它推出（见下方判定 2），**不再乘界面字号** ——
 * 改造后正文与界面字号彻底解耦。
 */
const SET_BODY_PX = (o) => {
  const r = document.documentElement
  const px = o.bodyPx, rp = o.rootPct
  // 只接受有限数字或 null。写进 "undefined" 这类字符串会让
  // var(--qmai-body-font-px, 18px) 的兜底与声明整条失效，字号静默退回继承值 ——
  // 表现是"所有档位读数完全一样"，极易被误读成"功能坏了"。
  if (typeof px === "number" && Number.isFinite(px)) r.style.setProperty("--qmai-body-font-px", `${px}px`)
  else r.style.removeProperty("--qmai-body-font-px")
  if (typeof rp === "number" && Number.isFinite(rp)) r.style.fontSize = `${rp}%`
  else r.style.removeProperty("font-size")
  // 回读：尺子自身的正对照。写进去的值必须等于要求的值。
  return { appliedBodyPx: r.style.getPropertyValue("--qmai-body-font-px") || null, appliedRoot: r.style.fontSize || null, computedRoot: getComputedStyle(r).fontSize }
}

/** 读列表标记的相关计算样式。`li` 非 list-item 时标记读数为 null（守卫 A0）。 */
const READ_MARKERS = () => {
  const body = document.querySelector(".ui-test-editor-body")
  if (!body) return { noBody: true }
  const ulLi = body.querySelector("ul > li")
  const olLi = body.querySelector("ol > li")
  const cs = (el, pseudo) => {
    if (!el) return null
    const s = getComputedStyle(el, pseudo ?? undefined)
    return { fontSize: parseFloat(s.fontSize), fontSizeRaw: s.fontSize, lineHeight: parseFloat(s.lineHeight), fontFamily: s.fontFamily, display: s.display }
  }
  const readable = !!ulLi && !!olLi && getComputedStyle(ulLi).display === "list-item" && getComputedStyle(olLi).display === "list-item"
  return {
    guards: { ulDisplay: ulLi ? getComputedStyle(ulLi).display : null, olDisplay: olLi ? getComputedStyle(olLi).display : null, markerReadable: readable },
    samples: {
      paragraph: cs(body.querySelector("p")),
      ulLi: cs(ulLi), olLi: cs(olLi),
      ulMarker: readable ? cs(ulLi, "::marker") : null,
      olMarker: readable ? cs(olLi, "::marker") : null,
      heading: cs(body.querySelector(":is(h2,h3,h4,h5,h6)")),
      highlight: cs(body.querySelector("[data-find-highlights]")),
    },
    vars: {
      /*
       * App 独占的 5 个变量（唯一入口是 font-settings.ts 的 applyBodyTypography，
       * 写在 documentElement 行内样式上）—— 真机验证要一次看到全部 5 个，
       * 因为"这几个值有没有真的写进去、ui-test.css 有没有偷偷再声明一份盖掉它"
       * 是本次改造新引入的失败模式，只会表现为「设置保存了但界面不变」。
       */
      bodyFontPx: getComputedStyle(document.documentElement).getPropertyValue("--qmai-body-font-px").trim(),
      bodyLeading: getComputedStyle(document.documentElement).getPropertyValue("--qmai-body-leading").trim(),
      bodyLetterSpacing: getComputedStyle(document.documentElement).getPropertyValue("--qmai-body-letter-spacing").trim(),
      bodyMarginX: getComputedStyle(document.documentElement).getPropertyValue("--qmai-body-margin-x").trim(),
      bodySafeBottom: getComputedStyle(document.documentElement).getPropertyValue("--qmai-body-safe-bottom").trim(),
      // 三个派生尺寸 + 界面侧读数（与改造前同名保留，便于对照旧记录）
      bodyFontSize: getComputedStyle(document.documentElement).getPropertyValue("--qmai-body-font-size").trim(),
      bodyFontMarker: getComputedStyle(document.documentElement).getPropertyValue("--qmai-body-font-marker").trim(),
      bodyFontList: getComputedStyle(document.documentElement).getPropertyValue("--qmai-body-font-list").trim(),
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      serif: getComputedStyle(document.documentElement).getPropertyValue("--qmai-body-font-family").trim().slice(0, 80),
    },
  }
}

/**
 * 全界面字号普查：给所有元素留引用，供 100% / 150% 两趟比对。
 * 不写任何 DOM 属性（避免惊动 React 的观察者），元素引用存在 window 上。
 */
const CENSUS_COLLECT = () => {
  const els = []
  for (const el of document.querySelectorAll("*")) {
    const t = el.tagName
    if (t === "STYLE" || t === "SCRIPT" || t === "LINK" || t === "META" || t === "HEAD" || t === "TITLE") continue
    const cs = getComputedStyle(el)
    els.push({
      el,
      tag: t.toLowerCase(),
      cls: (typeof el.className === "string" ? el.className : "").slice(0, 90),
      aria: el.getAttribute?.("aria-label") ?? null,
      inSvg: !!el.closest("svg"),
      ownText: [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim().slice(0, 24),
      /*
       * 表单控件的"文字"不在文本节点里 —— `<textarea>` 的内容是 `.value`，
       * `<input>` 是 value/placeholder，`<select>` 是选中项的 label。
       * 只看文本节点会让这些元素 ownText 恒为空，于是被排除在跟随率之外。
       * 而 QMAI 的章节正文恰好就是 textarea（见 verify-body-font-single-source.mjs 的说明），
       * 即**最主要的书写面**曾被排除在"跟随率 100%"的分母之外。
       * 这里补上，让它必须一起被计入。
       */
      ctrlText: (() => {
        if (t === "TEXTAREA" || t === "INPUT") return String(el.value ?? el.placeholder ?? "").trim().slice(0, 24)
        if (t === "SELECT") return String(el.selectedOptions?.[0]?.textContent ?? "").trim().slice(0, 24)
        return ""
      })(),
      childEls: el.children.length,
      fs: cs.fontSize, lh: cs.lineHeight,
    })
  }
  window.__qmaiCensus = els
  return { count: els.length }
}
const CENSUS_READBACK = () => {
  const els = window.__qmaiCensus ?? []
  return els.map((e) => {
    let fs = "", lh = ""
    try { const cs = getComputedStyle(e.el); fs = cs.fontSize; lh = cs.lineHeight } catch { /* 已卸载 */ }
    return { tag: e.tag, cls: e.cls, aria: e.aria, inSvg: e.inSvg, ownText: e.ownText, ctrlText: e.ctrlText, childEls: e.childEls, before: e.fs, beforeLh: e.lh, after: fs, afterLh: lh }
  })
}

/* ────────────────────────── 主流程 ────────────────────────── */

async function main() {
  if (!ATTACH && !existsSync(EXE)) { console.log(`  ✗ 找不到便携版: ${EXE}`); process.exit(1) }
  if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true })
  const chromium = await loadPlaywright()

  let child = null
  if (!ATTACH) {
    console.log(`  启动: ${EXE}`)
    child = spawn(EXE, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: "ignore" })
    child.on("error", (e) => console.log(`  exe 启动错误: ${e.message}`))
  }
  const version = await waitForCdp(PORT, 120_000)
  console.log(`  CDP 就绪: ${version.Browser ?? "(未知)"}`)
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
  /*
   * 对 `connectOverCDP` 连上的浏览器，`browser.close()` 可能一直不返回
   * （它试图去关掉那个**真实存在**的浏览器进程）。实测会把脚本永久挂住：
   * 结论已经全部打印完毕，进程却不退出。故这里限时，绝不阻塞退出。
   */
  const bye = async () => { try { await Promise.race([browser.close(), wait(4000)]) } catch { /* 忽略 */ } }

  let page = null
  const pd = Date.now() + 60_000
  while (Date.now() < pd && !page) {
    for (const c of browser.contexts()) for (const p of c.pages()) if (p.url() && !p.url().startsWith("devtools://")) { page = p; break }
    if (!page) await wait(500)
  }
  if (!page) { console.log("  ✗ 找不到应用页面"); await bye(); if (child && !KEEP_OPEN) child.kill(); process.exit(1) }
  console.log(`  页面: ${page.url()}`)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable")

  let probe = null
  const ad = Date.now() + 90_000
  while (Date.now() < ad) {
    try { probe = await page.evaluate(PROBE) } catch { probe = null }
    if (probe && probe.rootCount > 0) break
    await wait(1000)
  }
  if (!probe) { console.log("  ✗ 页面无法求值"); await bye(); if (child && !KEEP_OPEN) child.kill(); process.exit(1) }

  const fails = [], notes = []
  console.log("")
  console.log("  ══ 一、应用结构（真实 exe）══")
  console.log(`  标题: ${probe.title}`)
  console.log(`  视图=${probe.view}  编辑器 kind=${probe.editorKind}`)
  console.log(`  .ui-test-root=${probe.rootCount}  .ui-test-editor-body=${probe.bodyCount}  编辑器内 .ProseMirror=${proseIn(probe)}  textarea=${probe.textareaInBody}`)
  console.log(`  编辑器内 ul=${probe.ulInBody} ol=${probe.olInBody} li=${probe.liInBody}   全页 ul=${probe.anyUl} ol=${probe.anyOl} li=${probe.anyLi}`)
  console.log(`  主导航: ${probe.navItems.join(" / ")}`)
  await page.screenshot({ path: join(SHOT_DIR, "01-启动后.png") })

  if (probe.bodyCount === 0) {
    fails.push("编辑器 DOM 未挂载，无法在真实 exe 上验证正文")
  } else {
    /* ── 二、导航到含列表的真实文档 ── */
    console.log("")
    console.log("  ══ 二、找到可在其上读 ::marker 的真实文档 ══")
    let opened = null
    // 章节正文是 textarea，li 不可能出现；列表标记只能靠非章节文档（Milkdown .ProseMirror）。
    if (probe.proseInBody > 0 && probe.liInBody > 0) {
      console.log("  当前文档已含 .ProseMirror 且已有 li，直接用。")
      opened = { ok: true, path: "(当前文档)" }
    } else {
      console.log(`  当前是${probe.textareaInBody > 0 ? "章节（textarea，li 不可能出现）" : "无编辑器"}，切到「大纲」找含列表的文档…`)
      const nav = await page.evaluate(NAV_TO, "大纲")
      if (!nav.ok) { fails.push(`找不到「大纲」导航项（现有: ${nav.labels.join("/")}）`) } else {
        const vd = Date.now() + 20_000
        while (Date.now() < vd) { if ((await page.evaluate(PROBE)).view === "sources") break; await wait(500) }
        await wait(1500)
        const opened0 = await page.evaluate(OPEN_LIST_DOC)
        if (!opened0.ok) { fails.push(`大纲视图里找不到可点开的 .md（可见: ${(opened0.available ?? []).join(", ")}）`) } else {
          console.log(`  已点开: ${opened0.path}（${opened0.by}）`)
          const wd = Date.now() + 60_000
          let st = null
          while (Date.now() < wd) { st = await page.evaluate(LIST_STATE); if (st.ulLi && st.olLi) break; await wait(1000) }
          console.log(`  编辑器结构: .ProseMirror=${st.proseMirror}  [dir][lang]=${st.dirLang}  ul>li=${st.ulCount}  ol>li=${st.olCount}`)
          console.log(`  li.display: ul=${st.ulDisplay} ol=${st.olDisplay}`)
          if (!(st.ulLi && st.olLi)) { fails.push(`打开的文档里读不到 ul>li 与 ol>li（.ProseMirror=${st.proseMirror}, ul>li=${st.ulCount}, ol>li=${st.olCount}）`) }
          opened = { ok: st.ulLi && st.olLi, path: opened0.path }
        }
      }
    }
    await page.screenshot({ path: join(SHOT_DIR, "02-含列表文档.png") })

    /* ── 三、列表标记实测 ── */
    if (opened?.ok) {
      console.log("")
      console.log("  ══ 三、列表标记随正文字号缩放（真实 DOM 的 ::marker）══")
      await page.evaluate(SET_BODY_PX, { bodyPx: null, rootPct: null })
      await wait(500)
      const base = await page.evaluate(READ_MARKERS)
      const row = (l, s) => console.log(`    ${l.padEnd(13)} fontSize=${s ? s.fontSize : "(无)"}  lineHeight=${s ? s.lineHeight : "(无)"}  display=${s ? s.display : "—"}`)
      console.log(`  守卫 A0  li.display: ul=${base.guards.ulDisplay} ol=${base.guards.olDisplay}  → ::marker 读数可信=${base.guards.markerReadable}`)
      if (!base.guards.markerReadable) fails.push("A0/::marker 读数不可信（li 的 display 不是 list-item）")
      row("正文 p", base.samples.paragraph); row("无序 li", base.samples.ulLi); row("有序 li", base.samples.olLi)
      row("无序 ::marker", base.samples.ulMarker); row("有序 ::marker", base.samples.olMarker)
      const cdpBody = await platformFonts(cdp, ".ui-test-editor-body .ProseMirror p")
      console.log(`  变量(5 个 App 独占 + 派生): --qmai-body-font-px=${base.vars.bodyFontPx || "(未设置)"}  --qmai-body-leading=${base.vars.bodyLeading || "(未设置)"}  --qmai-body-letter-spacing=${base.vars.bodyLetterSpacing || "(未设置)"}  --qmai-body-margin-x=${base.vars.bodyMarginX || "(未设置)"}  --qmai-body-safe-bottom=${base.vars.bodySafeBottom || "(未设置)"}`)
      console.log(`  派生尺寸: --qmai-body-font-size=${base.vars.bodyFontSize}  --qmai-body-font-list=${base.vars.bodyFontList}  --qmai-body-font-marker=${base.vars.bodyFontMarker}  root=${base.vars.rootFontSize}`)
      console.log(`  Chromium 报告正文真实字体: ${cdpBody ?? "(取不到)"}`)

      /*
       * ── 5 个 App 独占变量必须**断言**，不能只打印（代码质量审查 I-5）──
       *
       * 这一段原来只有上面那行 console.log。审查的判词很准：
       * 这 5 个变量在全文里只出现在"采集"和"打印"两处，**没有任何 fails.push**，
       * 而注释（上面那段）明确写着它们是"本次改造新引入的失败模式"、
       * 需要真机确认"有没有真的写进去"。**只打印不断言 = 把判定推给人眼扫一行长输出**，
       * 而人眼对一长串 `${x || "(未设置)"}` 的分辨力极低 —— 真出问题时
       * 恰恰是那串 "(未设置)" 被看漏。
       *
       * 判据分两类，因为它们的"正确值"来源不同：
       *   · --qmai-body-font-px 是**用户设置**驱动的最外层输入，
       *     App 一定会写（applyBodyTypography 无条件写这一条）→ 必须非空且形如 "<数字>px"；
       *   · 其余 4 条只有在用户**设过**对应项时才由 App 写入
       *     （marginX 未拖过时 App 会 removeProperty）→ 只要求"若存在则必须是合法数值"，
       *     不要求非空。把它们也要求非空会制造假红：全新用户本来就没有这几个值。
       * 这里**默认档**跑的是 page.evaluate(SET_BODY_PX, {bodyPx:null,rootPct:null})，
       * 即清掉 App 行内样式、回落到 CSS 兜底 —— 所以此刻读到的值来自 CSS 或用户设置，
       * 正是我们想确认"没有被 ui-test.css 偷偷声明一份盖掉"的时刻。
       */
      {
        const isPx = (v) => /^-?\d+(\.\d+)?px$/.test(v)
        const isNumber = (v) => /^-?\d+(\.\d+)?$/.test(v)
        // 字号：必须存在且是合法 px（CSS 兜底 chain 里 --qmai-body-font-px 有 18px 默认，
        // 若这里读不到，说明兜底链断了 —— 那是真缺陷）
        if (!isPx(base.vars.bodyFontPx)) {
          fails.push(`I-5/--qmai-body-font-px 读不到合法 px（实际 ${JSON.stringify(base.vars.bodyFontPx)}）—— 字号兜底链断了`)
        }
        // 派生尺寸：由字号派生，必须与上面同源
        if (!isPx(base.vars.bodyFontSize)) {
          fails.push(`I-5/--qmai-body-font-size 读不到合法 px（实际 ${JSON.stringify(base.vars.bodyFontSize)}）`)
        }
        // 行高：必须是无单位数字（带单位会让行高不随字号变化）
        if (base.vars.bodyLeading && !isNumber(base.vars.bodyLeading)) {
          fails.push(`I-5/--qmai-body-leading 不是无单位数字（实际 ${JSON.stringify(base.vars.bodyLeading)}）`)
        }
        // 字间距 / 左右边距 / 底部安全距离：存在则必须是合法数值
        for (const [name, v, unit] of [
          ["--qmai-body-letter-spacing", base.vars.bodyLetterSpacing, "number"],
          ["--qmai-body-margin-x", base.vars.bodyMarginX, "px"],
          ["--qmai-body-safe-bottom", base.vars.bodySafeBottom, "px"],
        ]) {
          if (!v) continue // 未设置是合法状态（全新用户），见上面的理由
          const ok = unit === "px" ? isPx(v) : isNumber(v)
          if (!ok) fails.push(`I-5/${name} 存在但不是合法 ${unit}（实际 ${JSON.stringify(v)}）`)
        }
        /*
         * 反向控制（本段的自我鉴别力）：故意喂一个坏值，上面那组判据必须能抓住。
         * 不做这一步的话，"没报 fail"既可能是"值都对"，也可能是"判据恒不触发" ——
         * 而这一整段的起因恰恰就是"判据根本不存在"。
         */
        const probeBad = [{ v: "", why: "空" }, { v: "abc", why: "非数值" }, { v: "24", why: "缺 px" }]
        const caught = probeBad.filter((p) => !isPx(p.v)).length
        if (caught !== probeBad.length) {
          fails.push(`I-5/自检失效：判据没能识破全部 ${probeBad.length} 个坏值（只识破 ${caught} 个）`)
        }
        console.log(`  ✓ 5 个 App 独占变量已断言（字号/派生/行高必查格式，其余存在则查格式；判据自检 ${caught}/${probeBad.length}）`)
      }

      /*
       * 组合表：尺子由「倍数」改成「绝对 px」。
       *
       * 「界面150%」与「24px+界面150%」这两档**必须保留** —— 它们证明的是
       * 本次改造最核心的新不变量「改界面字号时正文不变」。
       * 删掉它们等于放弃这条不变量，而任务 13 会以为它被验证过。
       * （改造前这里是「正文150% / 界面150% / 双150% / 正文85% / 双85%」的乘积表：
       *   "双"这个概念在新模型里已经不存在。）
       */
      const combos = [
        { label: "正文24px", bodyPx: 24, rootPct: null },
        { label: "界面150%", bodyPx: null, rootPct: 150 },
        { label: "24px+界面150%", bodyPx: 24, rootPct: 150 },
        { label: "正文15px", bodyPx: 15, rootPct: null },
        { label: "15px+界面85%", bodyPx: 15, rootPct: 85 },
      ]
      const results = { default: base, combos: [] }
      console.log("")
      for (const c of combos) {
        const set = await page.evaluate(SET_BODY_PX, c)
        // 尺子正对照：写进去的必须等于要求写的
        const wantPx = c.bodyPx === null ? null : `${c.bodyPx}px`
        const rulerOk = (set.appliedBodyPx || null) === wantPx
        if (!rulerOk) fails.push(`尺子失效：要求 --qmai-body-font-px=${wantPx}，实际写入 ${set.appliedBodyPx}`)
        await wait(400)
        const m = await page.evaluate(READ_MARKERS)
        results.combos.push({ ...c, set, rulerOk, measured: m })
        const f = (s) => (s ? s.fontSize : "—")
        console.log(`    ${c.label.padEnd(13)} 写入(--qmai-body-font-px=${set.appliedBodyPx ?? "清除"}, root=${set.appliedRoot ?? "清除"}${rulerOk ? "" : " ✗尺子"}) 正文p=${f(m.samples.paragraph)}  无序li=${f(m.samples.ulLi)} marker=${f(m.samples.ulMarker)}  有序li=${f(m.samples.olLi)} marker=${f(m.samples.olMarker)}  可信=${m.guards.markerReadable}`)
        await page.screenshot({ path: join(SHOT_DIR, `03-${c.label}.png`) })
      }

      // 判定：默认档逐位还原
      const expectDefault = { paragraph: 18, ulLi: 16, olLi: 16, ulMarker: 12, olMarker: 16 }
      console.log("")
      console.log("  ── 判定 1：默认档逐位还原（改造前 正文18 无序li16 有序li16 无序marker12 有序marker16）──")
      for (const [k, want] of Object.entries(expectDefault)) {
        const got = base.samples[k]?.fontSize
        const ok = got !== undefined && Math.abs(got - want) < 0.01
        console.log(`    ${ok ? "✓" : "✗"} ${k.padEnd(10)} 期望 ${want}px 实测 ${got ?? "(无)"}px`)
        if (!ok) fails.push(`默认档 ${k} 期望 ${want}px 实测 ${got}`)
      }
      const propOk = base.samples.ulMarker && base.samples.ulLi && base.samples.olMarker && base.samples.olLi
        && base.samples.ulMarker.fontSize < base.samples.ulLi.fontSize
        && Math.abs(base.samples.olMarker.fontSize - base.samples.olLi.fontSize) < 0.01
      console.log(`    ${propOk ? "✓" : "✗"} 比例：无序标记(${base.samples.ulMarker?.fontSize}) < 无序列表项(${base.samples.ulLi?.fontSize})；有序标记(${base.samples.olMarker?.fontSize}) = 有序列表项(${base.samples.olLi?.fontSize})`)
      if (!propOk) fails.push("默认档标记比例不符（无序应小于列表项、有序应等于列表项）")

      /*
       * 判定 2：正文字号 = 设定的绝对 px（**且与界面字号无关**）+ 比例守恒。
       *
       * 改造前这里断言的是「界面字号 × 正文倍数」的乘积倍率；
       * 新模型下期望值由设定的 px 直接推出，界面字号**不进公式** ——
       * 「24px+界面150%」那一档期望仍是 24px 而不是 36px，这正是解耦的证明。
       */
      console.log("")
      console.log("  ── 判定 2：正文字号取设定 px（与界面字号解耦）+ 比例守恒 ──")
      const near = (x, y) => x !== null && Math.abs(x - y) < 0.02
      for (const c of results.combos) {
        const m = c.measured
        if (!c.rulerOk) continue   // 尺子失效时读数无意义，已在上面记为失败
        if (!m.guards.markerReadable || !m.samples.olMarker || !m.samples.ulMarker) { fails.push(`${c.label}: 读不到 marker`); continue }
        const basePx = c.bodyPx ?? 18
        const want = { paragraph: basePx, ulLi: basePx * 8 / 9, olLi: basePx * 8 / 9, ulMarker: basePx * 2 / 3, olMarker: basePx * 8 / 9 }
        const got = {
          paragraph: m.samples.paragraph?.fontSize, ulLi: m.samples.ulLi?.fontSize,
          olLi: m.samples.olLi?.fontSize, ulMarker: m.samples.ulMarker?.fontSize, olMarker: m.samples.olMarker?.fontSize,
        }
        const ok = Object.keys(want).every((k) => near(got[k], want[k]))
        const ulLt = m.samples.ulMarker.fontSize < m.samples.ulLi.fontSize
        const olEq = Math.abs(m.samples.olMarker.fontSize - m.samples.olLi.fontSize) < 0.01
        const fmt = (k) => `${got[k]}${near(got[k], want[k]) ? "" : `(期望${want[k].toFixed(4)})`}`
        console.log(`    ${ok && ulLt && olEq ? "✓" : "✗"} ${c.label.padEnd(13)} 期望 px=${basePx}（界面 ${c.rootPct ?? "100"}% 不参与）｜实测 正文=${fmt("paragraph")} 无序li=${fmt("ulLi")} 无序marker=${fmt("ulMarker")} 有序li=${fmt("olLi")} 有序marker=${fmt("olMarker")}｜比例 无序<列表项=${ulLt} 有序=列表项=${olEq}`)
        if (!ok) fails.push(`${c.label} 正文字号未按设定 px 生效（正文与界面字号应解耦）：期望 ${JSON.stringify(want)}，实测 ${JSON.stringify(got)}`)
        if (!ulLt || !olEq) fails.push(`${c.label} 比例被破坏：无序<列表项=${ulLt}，有序=列表项=${olEq}`)
      }
      /*
       * 解耦结论的正对照：界面字号必须**真的**改变了根字号。
       * 若 150% 那一档的根字号与 100% 相同，"正文没跟着变"就是一句空话
       * （两次读数在同一个渲染环境里，什么都没被证明）。
       */
      const rootAt100 = results.combos.find((c) => c.rootPct !== 150)?.set?.computedRoot
      const rootAt150 = results.combos.find((c) => c.rootPct === 150)?.set?.computedRoot
      const rootRulerOk = !!rootAt100 && !!rootAt150 && parseFloat(rootAt150) > parseFloat(rootAt100)
      console.log(`    ${rootRulerOk ? "✓" : "✗"} 尺子正对照：界面字号确实生效 root@${results.combos.find((c) => c.rootPct !== 150)?.rootPct ?? "100"}%=${rootAt100} → root@150%=${rootAt150}（否则「正文不变」是空结论）`)
      if (!rootRulerOk) {
        fails.push(`界面字号尺子失效：150% 未改变根字号（${rootAt100} → ${rootAt150}）—— 「正文不随界面字号变」可能只是因为界面字号根本没生效，本次解耦结论不成立`)
      }
      writeFileSync(join(SHOT_DIR, "real-exe-marker-results.json"), JSON.stringify({ capturedAt: new Date().toISOString(), exe: EXE, opened, probe, results, fails }, null, 2), "utf8")

      // 复位
      await page.evaluate(SET_BODY_PX, { bodyPx: null, rootPct: null })
    }
  }

  /* ── 四、界面字号必须改变整个界面（用户最初的抱怨）── */
  console.log("")
  console.log("  ══ 四、界面字号是否改变整个界面（不只按钮）══")
  await page.evaluate(SET_BODY_PX, { bodyPx: null, rootPct: 100 })
  await wait(600)
  const col = await page.evaluate(CENSUS_COLLECT)
  console.log(`  100% 时采集元素 ${col.count} 个`)
  await page.evaluate(SET_BODY_PX, { bodyPx: null, rootPct: 150 })
  await wait(800)
  const rb = await page.evaluate(CENSUS_READBACK)
  const rootNow = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)
  console.log(`  150% 时根字号 = ${rootNow}`)
  // 正向对照：根字号必须真的变了，否则后面"全都缩放"可能只是没生效
  if (parseFloat(rootNow) <= 16) { fails.push(`根字号未生效（150% 下仍是 ${rootNow}），界面字号普查无效`) }
  const px = (s) => (typeof s === "string" && s.endsWith("px") ? parseFloat(s) : NaN)
  const rows = rb.map((r) => {
    const b = px(r.before), a = px(r.after)
    // 文字元素 = 有自身文本节点 **或** 是带文字的表单控件（textarea/input/select）
    const hasText = r.ownText.length > 0 || (r.ctrlText ?? "").length > 0
    return { ...r, b, a, ratio: b > 0 && Number.isFinite(a) ? a / b : NaN, hasText, texty: hasText && !r.inSvg }
  }).filter((r) => Number.isFinite(r.b) && r.b > 0 && Number.isFinite(r.a) && r.a > 0)
  const texty = rows.filter((r) => r.texty)
  const controlTexty = texty.filter((r) => r.tag === "textarea" || r.tag === "input" || r.tag === "select")
  const scaled = texty.filter((r) => Math.abs(r.ratio - 1.5) < 0.02)
  const unscaled = texty.filter((r) => Math.abs(r.ratio - 1) < 0.001)
  console.log(`  可比对元素 ${rows.length}；有文字且不在 SVG 内 ${texty.length}`)
  console.log(`    其中表单控件文字元素: ${controlTexty.length}（textarea/input/select —— 章节正文即 textarea，此前被漏在分母外）`)
  console.log(`    恰好 ×1.5（跟着界面字号变）: ${scaled.length}`)
  console.log(`    完全没变（×1.0）         : ${unscaled.length}`)
  const unscaledByCls = new Map()
  for (const r of unscaled) { const k = `${r.tag}.${r.cls}`; unscaledByCls.set(k, (unscaledByCls.get(k) ?? 0) + 1) }
  if (unscaled.length) {
    console.log(`    未缩放元素归类（前 15）:`)
    for (const [k, n] of [...unscaledByCls.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15)) console.log(`      ×${String(n).padEnd(4)} ${k.slice(0, 110)}`)
  }
  /*
   * 门槛分两级（对抗性审查 P2-③）：
   *   1. 分母下限：参与元素太少时，"100%" 不构成证据（很可能只是页面没渲染出来）。
   *      这条必须失败，不能只打提示 —— 否则下限形同装饰。
   *   2. 比例门槛：至少 95% 的可见文字元素必须跟着缩放（留少量固定尺寸的图标/装饰例外）。
   */
  if (texty.length < MIN_TEXTY) {
    fails.push(`界面字号普查的参与元素仅 ${texty.length} 个（下限 ${MIN_TEXTY}）——`
      + ` 分母过小，跟随率不构成证据（页面可能未渲染完整，或选择器失效）。若本次确实只测小页面，请显式传 --min-texty N`)
  }
  const ratioPct = texty.length ? (scaled.length / texty.length) * 100 : 0
  console.log(`  文字元素跟随率 = ${ratioPct.toFixed(1)}%（${scaled.length}/${texty.length}，下限 ${MIN_TEXTY}）`)
  await page.screenshot({ path: join(SHOT_DIR, "04-界面字号150.png") })
  writeFileSync(join(SHOT_DIR, "real-exe-ui-scale.json"), JSON.stringify({
    capturedAt: new Date().toISOString(), rootAt150: rootNow, total: rows.length, texty: texty.length,
    minTexty: MIN_TEXTY, controlTexty: controlTexty.length,
    scaled: scaled.length, unscaled: unscaled.length, followRatePct: ratioPct,
    unscaledTop: [...unscaledByCls.entries()].sort((x, y) => y[1] - x[1]).slice(0, 40).map(([k, n]) => ({ cls: k, n })),
    unscaledSample: unscaled.slice(0, 60),
  }, null, 2), "utf8")
  if (ratioPct < 95) fails.push(`界面字号跟随率仅 ${ratioPct.toFixed(1)}%（<95%），说明仍有大量文字不跟界面字号变化`)
  else if (texty.length >= MIN_TEXTY) notes.push(`界面字号跟随率 ${ratioPct.toFixed(1)}%（${scaled.length}/${texty.length} 文字元素，含 ${controlTexty.length} 个表单控件）`)

  await page.evaluate(SET_BODY_PX, { bodyPx: null, rootPct: null })

  /* ── 结论 ── */
  console.log("")
  console.log("  ══ 结论 ══")
  for (const n of notes) console.log(`  · ${n}`)
  if (fails.length) {
    console.log(`  ✗ FAIL（${fails.length} 项）`)
    for (const f of fails) console.log(`    · ${f}`)
    console.log(`  证据: ${SHOT_DIR}`)
    await bye(); if (child && !KEEP_OPEN) child.kill(); process.exit(1)
  }
  console.log("  ✓ 通过")
  console.log(`  证据: ${SHOT_DIR}`)
  await bye(); if (child && !KEEP_OPEN) child.kill(); process.exit(0)
}

function proseIn(p) { return p.proseInBody ?? p.pmCount }
async function platformFonts(cdp, selector) {
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 })
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector })
    if (!nodeId) return null
    const r = await cdp.send("CSS.getPlatformFontsForNode", { nodeId })
    return r.fonts.map((f) => f.familyName).join(" + ")
  } catch { return null }
}

main().catch((e) => { console.log(`  ✗ 运行失败: ${e?.message ?? e}`); process.exit(1) })
