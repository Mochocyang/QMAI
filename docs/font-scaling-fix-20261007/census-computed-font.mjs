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
 * 已登记例外（**允许不缩放**，不算漏项）：
 *   SVG 内联 `fontSize="N"` 属性 —— 无单位等同 px，画在固定 viewBox 的图标里
 *   （环形图百分比、16×16 品牌单字）。改 rem 会让字形溢出图标框。
 *   采集时以 `inSvg: true` 标记，判据 2 归入独立的"SVG 例外"组。
 *   ⚠️ `::marker` 采集条目（`isMarker: true`）**必须**缩放，不得算作例外。
 *
 * 覆盖面：进入设置页后依次点击**全部**子分区并在每个分区各采集一次，
 *   同键以最后一次为准（Object.assign 合并）。子分区按钮用
 *   `data-ui-settings-category-button="<id>"` 定位 —— 与界面语言无关。
 *
 * 伪元素：普通遍历读不到 `::marker` 的字号，故单独遍历
 *   `.ui-test-editor-body li, .ui-test-root li` 采集 `getComputedStyle(li, "::marker")`，
 *   键为 DOM 路径 + `"::marker"`。用 `--marker-selftest` 可单独验证该采集确实有效。
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
  for (const k of keysA) {
    const at100 = a100[k], at150 = a150[k]
    if (!at100 || !at150) continue
    if (at100.isMarker === true) markerCount++
    const base = parseFloat(at100.fontSize)
    const big = parseFloat(at150.fontSize)
    if (!Number.isFinite(base) || base === 0) continue
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
    console.log(`      前 15 条：`)
    for (const d of unexplained.slice(0, 15)) {
      console.log(`        ${d.at100} → ${d.at150} (×${d.ratio})  .${(d.cls || "").slice(0, 50)}`)
    }
  }
  console.log(`    （其中 ::marker 条目: ${markerCount}${markerCount === 0 ? " ← 本页未采集到 marker，采集能力见 --marker-selftest" : ""}）`)
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

  /** 一个 scale 档位的完整采集：先回固定分区，再逐个分区采集并合并（同键以最后一次为准）。 */
  const censusAllSections = async () => {
    const merged = {}
    await openSection(SETTINGS_HOME_SECTION)
    Object.assign(merged, await censusOnce())
    const reached = []
    for (const id of SETTINGS_SECTIONS) {
      const r = await openSection(id)
      Object.assign(merged, await censusOnce())
      reached.push(r)
    }
    return { merged, reached }
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
      const { merged, reached } = await censusAllSections()
      census[String(s)] = merged
      const keys = Object.keys(merged)
      const markerKeys = keys.filter((k) => k.endsWith("::marker"))
      const okReached = reached.filter((r) => r.landed === r.requested)
      const missed = reached.filter((r) => r.landed !== r.requested)
      console.log(`  采集 ${s}%: ${keys.length} 个文本元素（其中 ::marker ${markerKeys.length} 条）`)
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
