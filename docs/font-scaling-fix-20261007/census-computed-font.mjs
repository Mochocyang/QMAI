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
 * ─────────────────────────────────────────────────────────────────────────
 * 键的构成规则（**契约**，后续任务依赖它；改动此处等于让基线失效）
 * ─────────────────────────────────────────────────────────────────────────
 *   键 = `<分区id>::<DOM 路径>`；`::marker` 条目再追加 `::marker` 后缀。
 *
 *   - DOM 路径 = 标签名 + `:` + 同级索引，用 `>` 连接
 *     （例：`body:1>div:0>div:0>header:0>span:1`）。用路径而非 class，
 *     因为改动只涉及 CSS 值、不改 DOM 结构，路径稳定可比对。
 *   - 分区id = 采集该元素时**实际处于激活状态**的设置页分区
 *     （`[data-ui-page="settings"]` 上 `data-ui-settings-category` 的取值），
 *     而不是"请求点击"的分区：没点到就按实际到达的分区记账，不伪造。
 *
 *   为什么必须带分区前缀：11 个分区各有自己的 DOM 状态，**不同分区既可能在
 *   不同路径上放不同元素，也可能在同一路径上放不同元素**。若只以 DOM 路径为键
 *   再跨分区 `Object.assign` 合并，后访问的分区会覆盖先访问分区的元素，该元素
 *   对判据 1/2 **完全不可见**——历史上由此静默遮蔽过 6 个元素，其中一个
 *   （「重排模型」13px）恰恰是未缩放的 px 元素，即缺陷本身藏在盲区里。
 *   加分区前缀后"同路径、不同分区"永不碰撞，任何元素都不可能被静默覆盖。
 *
 * 合并语义（两种情况分别怎么处理）
 *   1. **同一元素在多个分区重复出现**（公共外框、侧栏导航等）：那是同一元素被
 *      观察多次，在不同分区前缀下各记一份，值必然一致（同一元素的计算样式）。
 *      条目数因此大于"纯元素个数"（实测：每档 12 次快照 1140 条 → 1113 个键，
 *      见 `README.md`），但对"未解释必须为 0"的判据没有影响。
 *   2. **不同元素撞同一 DOM 路径**（跨分区）：键不同，二者都被保留、都被判据
 *      覆盖，不存在谁覆盖谁。
 *   唯一会重写同一个键的情形是"固定起始分区 + 该分区又在分区列表里"导致的
 *   重复访问（`model` 采集两遍）：两次采的是同一元素、值一致，属幂等重写。
 *   为杜绝残余的静默遮蔽，合并时会校验"同键重写是否换了元素身份"
 *   （cls/text 不同即视为换了元素）并打印警告，采集日志里也会给出每次
 *   「采集 N 条 / 新增 M 条」计数。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 已登记例外（**允许不缩放**，不算漏项）：
 *   SVG 内联 `fontSize="N"` 属性 —— 无单位等同 px，画在固定 viewBox 的图标里
 *   （环形图百分比、16×16 品牌单字）。改 rem 会让字形溢出图标框。
 *   采集时以 `inSvg: true` 标记，判据 2 归入独立的"SVG 例外"组。
 *   ⚠️ `::marker` 采集条目（`isMarker: true`）**必须**缩放，不得算作例外。
 *
 * 覆盖面：进入设置页后依次点击**全部 11 个**子分区，并在每个分区各采集一次；
 *   每个分区的快照以 `<分区id>::` 前缀并入累积对象（见上"键的构成规则"）。
 *   子分区按钮用 `data-ui-settings-category-button="<id>"` 定位 —— 与界面语言无关。
 *
 * 伪元素：普通遍历读不到 `::marker` 的字号，故单独遍历
 *   `.ui-test-editor-body li, .ui-test-root li` 采集 `getComputedStyle(li, "::marker")`，
 *   键为 `分区id + "::" + DOM 路径 + "::marker"`。用 `--marker-selftest` 可单独验证该采集确实有效。
 *
 * 用法：
 *   node census-computed-font.mjs --out before.json         # 改动前采集
 *   node census-computed-font.mjs --out after.json          # 改动后采集
 *   node census-computed-font.mjs --scales 100,130,150 --out x.json  # 自定义根字号档位
 *   node census-computed-font.mjs --compare before.json after.json
 *   node census-computed-font.mjs --marker-selftest         # 只验证 ::marker 采集可用
 */
import { createServer } from "node:http"
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs"
import { join, extname } from "node:path"
import { pathToFileURL } from "node:url"

const argv = process.argv.slice(2)
const argOf = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }

const DIST = join(process.cwd(), "dist")

/* ── 根字号档位：可用 --scales 覆盖（原先硬编码，传参被静默忽略） ── */
const scalesArg = argOf("--scales")
const CENSUS_SCALES = scalesArg === undefined
  ? [100, 150]
  : scalesArg.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)

/**
 * 设置页真实子分区 id —— 取自 `src/components/settings/settings-view.tsx`
 * 的 CATEGORIES（model/novel/network/web-search/interface/user-memory/
 * maintenance/data-management/feedback/contact-support/changelog）。
 * 用 id 定位而非中文标签，避免受界面语言影响。
 */
const SETTINGS_SECTIONS = [
  "model", "novel", "network", "web-search", "interface", "user-memory",
  "maintenance", "data-management", "feedback", "contact-support", "changelog",
]
/** 每个 scale 轮开始时先固定停在这个分区，保证各档位采集状态对称。 */
const SETTINGS_HOME_SECTION = "model"

/* ─────────── 比较模式 ─────────── */
if (argv.includes("--compare")) {
  const i = argv.indexOf("--compare")
  const before = JSON.parse(readFileSync(argv[i + 1], "utf8"))
  const after = JSON.parse(readFileSync(argv[i + 2], "utf8"))

  // 防"静默通过"：两判据都锚定 100% / 150% 两档。若采集时用了别的 --scales，
  // 缺档会让判据 2 无数据可比 → 0/0 "通过"，这是伪结论，必须直接报错。
  for (const [name, file] of [["before", before], ["after", after]]) {
    if (!file.census || !file.census["100"]) {
      console.error(`  ${name} 缺少 100% 档基线（scales=${JSON.stringify(file.scales)}）；--compare 需要 100% 与 150% 两档，采集时不要改 --scales`)
      process.exit(1)
    }
  }
  if (!after.census["150"]) {
    console.error(`  after 缺少 150% 档基线（scales=${JSON.stringify(after.scales)}）；--compare 需要 100% 与 150% 两档，采集时不要改 --scales`)
    process.exit(1)
  }

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

  // 判据 2：150% 生效性（三分类：正确缩放 / SVG 例外 / 未解释）
  const a150 = after.census["150"] ?? {}
  const svgException = []
  const unexplained = []
  let scaled = 0
  let sample = null
  let markerCount = 0
  let noPair = 0
  for (const k of keysA) {
    const at100 = a100[k], at150 = a150[k]
    if (!at100 || !at150) { noPair++; continue }
    if (at100.isMarker === true) markerCount++
    const base = parseFloat(at100.fontSize)
    const big = parseFloat(at150.fontSize)
    if (!Number.isFinite(base) || base === 0) { noPair++; continue }
    const ratio = big / base
    // 允许 1.5% 误差（浏览器亚像素取整）
    if (Math.abs(ratio - 1.5) < 0.015) { scaled++; continue }
    const rec = { key: k, at100: at100.fontSize, at150: at150.fontSize, ratio: ratio.toFixed(3), cls: at100.cls, text: at100.text }
    // SVG 图标几何是已登记例外；但 ::marker 条目必须缩放（isMarker 优先判定）
    if (at100.inSvg === true && at100.isMarker !== true) svgException.push(rec)
    else unexplained.push(rec)
    if (!sample) sample = { key: k, at100: at100.fontSize, at150: at150.fontSize, ratio: ratio.toFixed(3) }
  }

  console.log(`\n  判据 2：150% 字号下缩放生效性（期望全部 = 1.5 倍）`)
  console.log(`    正确缩放: ${scaled}`)
  console.log(`    SVG 例外（已登记，不要求缩放）: ${svgException.length}`)
  if (svgException.length) {
    console.log(`      前 5 条：`)
    for (const d of svgException.slice(0, 5)) {
      console.log(`        ${d.at100} → ${d.at150} (×${d.ratio})  ${JSON.stringify(d.text || "")}  .${(d.cls || "").slice(0, 50)}`)
    }
  }
  console.log(`    未解释（真正漏项）: ${unexplained.length}`)
  if (unexplained.length) {
    console.log(`      前 20 条（键=分区id::DOM路径）:`)
    for (const d of unexplained.slice(0, 20)) {
      console.log(`        ${d.at100} → ${d.at150} (×${d.ratio})  text=${JSON.stringify(d.text || "")}  .${(d.cls || "").slice(0, 40)}`)
      console.log(`            ${d.key}`)
    }
    if (unexplained.length > 20) console.log(`        …（其余 ${unexplained.length - 20} 条见 JSON 中的 100%/150% 档对比）`)
  }
  console.log(`    （其中 ::marker 条目: ${markerCount}${markerCount === 0 ? " ← 本页未采集到 marker，采集能力见 --marker-selftest" : ""}）`)
  const triageSum = scaled + svgException.length + unexplained.length
  console.log(`    三组之和 = ${triageSum}；键总数 = ${keysA.length}；缺 100%/150% 任一档未参与 = ${noPair}`)
  if (triageSum !== keysA.length - noPair) {
    console.log(`    ⚠️ 计数不一致（应等于键总数 − 未参与数 = ${keysA.length - noPair}），有元素被算丢或算重`)
  }
  const judge2 = unexplained.length === 0

  console.log(`\n  ══ 结论 ══`)
  console.log(`    判据 1（100% 等效，无视觉回归）: ${judge1 ? "通过" : "未通过"}`)
  console.log(`    判据 2（150% 全部缩放，已排除登记例外）: ${judge2 ? "通过" : "未通过"}`)
  console.log(`    → ${judge1 && judge2 ? "字号修复已达成：既无回归，又真实生效" : "尚未达成，需继续修"}`)
  process.exitCode = judge1 && judge2 ? 0 : 1
} else {
  /* ─────────── 采集模式 ─────────── */
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("  dist/index.html 不存在，请先构建")
    process.exit(1)
  }
  if (CENSUS_SCALES.length === 0) {
    console.error(`  --scales 解析结果为空（收到: ${JSON.stringify(scalesArg)}），请提供如 --scales 100,150`)
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
        // SVG 内联 fontSize 属性 = 图标几何，不随 rem 缩放是正确行为（已登记例外）
        inSvg: !!(el.closest && el.closest("svg")),
      }
    }
    // 伪元素 ::marker：普通遍历读不到它的字号，单独采集
    // （后续要改 ui-test-editor.css 的 li::marker 12px / ol>li::marker 16px）
    for (const li of document.querySelectorAll(".ui-test-editor-body li, .ui-test-root li")) {
      const marker = getComputedStyle(li, "::marker")
      if (!marker || marker.fontSize === "") continue
      out[path(li) + "::marker"] = {
        fontSize: marker.fontSize,
        lineHeight: marker.lineHeight,
        cls: (li.className || "").toString().slice(0, 70),
        text: (li.textContent || "").trim().slice(0, 20),
        inSvg: false,
        isMarker: true,
      }
    }
    return out
  })

  /**
   * 点击设置页子分区（用 data-ui-settings-category-button 定位，与界面语言无关）。
   * 返回真实到达的分区 id 与按钮标签 —— 没点到就如实返回 null，不伪造。
   */
  const openSection = async (id) => {
    const clicked = await page.evaluate((sectionId) => {
      const btn = document.querySelector(`[data-ui-settings-category-button="${sectionId}"]`)
      if (!btn) return false
      btn.click()
      return true
    }, id)
    await page.waitForTimeout(700)
    const landed = await page.evaluate(() => {
      const active = document.querySelector('[data-ui-page="settings"]')?.getAttribute("data-ui-settings-category") ?? null
      const btn = active ? document.querySelector(`[data-ui-settings-category-button="${active}"]`) : null
      const label = (btn?.textContent || "").trim().replace(/\s+/g, " ")
      return { id: active, label }
    })
    return { requested: id, clicked, landed: landed.id, label: landed.label }
  }

  /**
   * 一个 scale 档位的完整采集：先回固定分区，再逐个分区采集。
   *
   * 每个分区的快照以 `<分区id>::` 前缀并入累积对象（见文件头"键的构成规则"）。
   * 分区前缀用的是**实际到达**的分区（landed），不是请求点击的分区。
   *
   * 合并时若同一个键被重写，会校验两次记录是否同一元素（cls/text 一致）。
   * 正常只应发生一次（起始分区 model 与列表首项 model 重复访问，同一元素、
   * 值一致的幂等重写）；一旦出现"同键不同元素"，即说明有元素可能被遮蔽，
   * 必须当作错误上报而不是沉默通过。
   */
  const censusAllSections = async () => {
    const merged = {}
    const reached = []
    const passes = []
    const shadowed = []
    const mergeSnapshot = (sectionId, snap) => {
      const entries = Object.entries(snap)
      let added = 0
      for (const [path, rec] of entries) {
        const key = `${sectionId}::${path}`
        const prev = merged[key]
        if (prev === undefined) {
          added++
        } else if (prev.cls !== rec.cls || prev.text !== rec.text) {
          // 同键重写且元素身份不同 —— 理论上不该发生（同分区同一路径即同一元素），
          // 出现即意味着状态在两次采集之间变了，如实记录并报警。
          shadowed.push({ key, prev: { cls: prev.cls, text: prev.text }, next: { cls: rec.cls, text: rec.text } })
        }
        merged[key] = rec
      }
      passes.push({ sectionId, captured: entries.length, added })
    }
    const home = await openSection(SETTINGS_HOME_SECTION)
    mergeSnapshot(home.landed ?? home.requested, await censusOnce())
    reached.push(home)
    for (const id of SETTINGS_SECTIONS) {
      const r = await openSection(id)
      mergeSnapshot(r.landed ?? r.requested, await censusOnce())
      reached.push(r)
    }
    return { merged, reached, passes, shadowed }
  }

  /* ── ::marker 采集能力自检：临时插入 li 与规则，确认读数确实随之变化 ── */
  const markerSelftest = async () => {
    const probe = await page.evaluate(() => {
      const root = document.querySelector(".ui-test-root") || document.body
      const host = document.createElement("ul")
      host.id = "__marker_probe_host__"
      const li = document.createElement("li")
      li.id = "__marker_probe_li__"
      li.textContent = "marker探针"
      host.appendChild(li)
      root.appendChild(host)
      const read = () => {
        const ms = getComputedStyle(li, "::marker")
        return { fontSize: ms ? ms.fontSize : null, lineHeight: ms ? ms.lineHeight : null }
      }
      const inherited = read()
      const st = document.createElement("style")
      st.id = "__marker_probe_style__"
      st.textContent = "li::marker { font-size: 12px; }"
      document.head.appendChild(st)
      const rule12 = read()
      st.textContent = "li::marker { font-size: 16px; }"
      const rule16 = read()
      st.remove()
      host.remove()
      return {
        inherited, rule12, rule16,
        appendedTo: root.className || root.tagName.toLowerCase(),
        cleaned: !document.getElementById("__marker_probe_host__") && !document.getElementById("__marker_probe_style__"),
      }
    })
    const ok = probe.rule12.fontSize === "12px" && probe.rule16.fontSize === "16px" && probe.cleaned
    console.log("  ══ ::marker 采集能力自检 ══")
    console.log(`    临时节点挂载到: ${probe.appendedTo}`)
    console.log(`    未加规则（继承 li）: fontSize=${JSON.stringify(probe.inherited.fontSize)} lineHeight=${JSON.stringify(probe.inherited.lineHeight)}`)
    console.log(`    加 li::marker{font-size:12px}: fontSize=${JSON.stringify(probe.rule12.fontSize)}`)
    console.log(`    改 li::marker{font-size:16px}: fontSize=${JSON.stringify(probe.rule16.fontSize)}`)
    console.log(`    临时节点/规则已清理: ${probe.cleaned}`)
    console.log(`    → ${ok ? "有效：能读到 ::marker 字号，且读数随规则改变（可区分 12px / 16px）" : "【无效】getComputedStyle(li, \"::marker\").fontSize 不可用，marker 采集必须换方法（改从 CSS 文本静态校验）"}`)
    if (!ok) process.exitCode = 1
  }

  if (argv.includes("--marker-selftest")) {
    await markerSelftest()
    await browser.close()
    server.close()
  } else {
    const census = {}
    for (const s of CENSUS_SCALES) {
      await page.evaluate((p) => { document.documentElement.style.fontSize = p + "%" }, s)
      await page.waitForTimeout(600)
      const { merged, reached, passes, shadowed } = await censusAllSections()
      census[String(s)] = merged
      const keys = Object.keys(merged)
      const markerKeys = keys.filter((k) => k.endsWith("::marker"))
      const okReached = reached.filter((r) => r.landed === r.requested)
      const missed = reached.filter((r) => r.landed !== r.requested)
      const capturedTotal = passes.reduce((n, p) => n + p.captured, 0)
      console.log(`  采集 ${s}%: ${keys.length} 个键（其中 ::marker ${markerKeys.length} 条）`)
      console.log(`    快照合计 ${capturedTotal} 条 → 去重后 ${keys.length} 个键`
        + `（重复=${capturedTotal - keys.length}：同一元素被多个分区/重复访问各记一份，键不冲突）`)
      console.log(`    分区前缀: ${passes.map((p) => `${p.sectionId}[${p.captured}→+${p.added}]`).join(" ")}`)
      if (shadowed.length) {
        console.log(`    ⚠️ 同键换成不同元素 ${shadowed.length} 处 —— 有元素可能被遮蔽，需排查:`)
        for (const d of shadowed.slice(0, 10)) console.log(`        ${d.key}  前=${JSON.stringify(d.prev)}  后=${JSON.stringify(d.next)}`)
      } else {
        console.log(`    同键重写且元素身份不同: 0（无静默遮蔽）`)
      }
      console.log(`    实际到达分区（${okReached.length}/${SETTINGS_SECTIONS.length}）: ${okReached.map((r) => `${r.requested}${r.label ? `(${r.label})` : ""}`).join(", ")}`)
      if (missed.length) {
        console.log(`    ⚠️ 未到达: ${missed.map((r) => `${r.requested}(clicked=${r.clicked}, landed=${r.landed})`).join(", ")}`)
      }
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
}
