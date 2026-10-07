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
 *   node measure-ui-overflow.mjs --json              # 把 JSON 打到 stdout
 *   node measure-ui-overflow.mjs --json --out x.json # 直接写文件（推荐）
 *   node measure-ui-overflow.mjs --selftest          # 只跑对照，证明尺子可信
 *
 * ── 为什么要有 --out（而不是靠 shell 重定向）──
 *   本项目在 Windows PowerShell 5.1 下跑。`>` 与 Tee-Object 写出的是
 *   **UTF-16LE**（带 BOM FF FE），而证据里全是中文；一旦被当成 UTF-8
 *   读回来，中文就毁了。曾经为了绕开这一点去手写转义字符串，结果
 *   全角引号嵌进 JSON 字面量直接把脚本弄成语法错误。
 *   让脚本自己用 writeFileSync(utf8) 写，是唯一稳的路子。
 */
import { createServer } from "node:http"
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import { join, extname, dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const REPO = process.cwd()
const DIST = join(REPO, "dist")
const AS_JSON = process.argv.includes("--json")
const SELFTEST_ONLY = process.argv.includes("--selftest")
// --out 只允许写到仓库内：证据产物不该散落到仓库外
const outIdx = process.argv.indexOf("--out")
const OUT_ARG = outIdx >= 0 ? process.argv[outIdx + 1] : undefined
if (outIdx >= 0 && (OUT_ARG === undefined || OUT_ARG.startsWith("--"))) {
  console.error(`  ✗ ARG-FAIL --out 需要参数，但收到的是 "${OUT_ARG ?? "(空)"}"`)
  process.exit(1)
}
const OUT_PATH = OUT_ARG ? resolve(REPO, OUT_ARG) : undefined
if (OUT_PATH && !OUT_PATH.startsWith(resolve(REPO))) {
  console.error(`  ✗ ARG-FAIL --out 只能写到仓库内，收到: ${OUT_ARG}`)
  process.exit(1)
}
/** 把 JSON 结果落到磁盘（UTF-8，无 BOM）。 */
function writeOut(payload) {
  if (!OUT_PATH) return
  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8")
  console.error(`\n  证据已写入: ${OUT_PATH}`)
}
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

/*
 * ── 为什么档位参数必须校验跨度（对抗性审查 P1-③）──
 * 守卫①用「最高档正文字号中位数 ÷ 最低档」来证明"倍率真的生效"。
 * 但如果只给一个档位（`--scales 100`）或给两个几乎相同的档位
 * （`--scales 100,104`），这个比值恒 ≈ 1，与"期望值"相等 ——
 * 于是守卫①**恒真**，工具会打印"比值 1.000（期望 1.00）"并宣布"✓ 通过"，
 * 而此时它既没验证倍率生效、也没验证任何放大后的布局。
 * 实测（审查者报告，我本轮复现）：把 setScale 改成空操作（倍率彻底失效，
 * 也就是用户最初报的那个 bug）后用 `--scales 150` 跑，仍然退出 0 / "✓ 通过"。
 * 默认参数 100/115/130/150 是安全的，所以这是**潜伏陷阱**而非现存错误；
 * 但一条"用错参数就静默假绿"的命令行工具迟早会被用错。故直接拒绝。
 */
const SCALE_SPAN_MIN = 1.25
if (SCALES.length < 2) {
  console.error(`  ✗ ARG-FAIL 至少要两个档位才能验证"倍率生效"（当前只有 ${SCALES.length} 个: ${SCALES.join(", ")}）。单个档位下守卫①恒真，会静默假绿。`)
  process.exit(1)
}
const spanLo = Math.min(...SCALES)
const spanHi = Math.max(...SCALES)
if (spanHi / spanLo < SCALE_SPAN_MIN) {
  console.error(`  ✗ ARG-FAIL 档位跨度太小（${spanLo}% → ${spanHi}%，比值 ${(spanHi / spanLo).toFixed(3)} < ${SCALE_SPAN_MIN}）。跨度太小时"倍率生效"守卫没有判别力，会静默假绿。`)
  process.exit(1)
}

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
   * ── 判据：为什么必须减掉内边距（这里曾经错得很隐蔽）──
   * `clientHeight` **包含内边距**（它 = border-box 高度 − 上下边框）。
   * 我最初直接拿 `clientHeight` 当"能放文字的高度"，于是
   * `.ui-test-create-name`（height:44px、padding:10px 14px、line-height:1.5rem）
   * 在 150% 档被算成"可用 44px ≥ 行盒 36px → 不裁"，
   * 而真实可用高度只有 44 − 10 − 10 = **24px**，文字确实被裁掉 12px。
   *
   * 这个错误之所以一直没被抓住，是因为第一类检测（DOM 文本遍历）与它
   * **同时**存在盲区：`<input>` 的文本不在文本节点里，只有这一类能看它；
   * 而这一类的尺子又偏大 20px，刚好把 12px 的溢出吃掉。
   * 两个盲区叠加 → 该缺陷在真实 exe 与浏览器里都能复现，工具却报 0。
   *
   * 判据修正为：line-height > (clientHeight − 上下内边距) 即文字纵向被裁。
   * 注意这个修正**只会让检测更灵敏**，不会放宽任何既有结论。
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
    /*
     * ⚠️ 必须先减掉上下内边距。`clientHeight` **含内边距**，
     * 直接拿它当"能放文字的高度"会把可用高度高估 (padding-top + padding-bottom)，
     * 从而整类漏掉这种缺陷（见上方判据注释里 .ui-test-create-name 的实例：
     * 44px 的框被当成可用 44px，实际只有 24px，12px 的溢出被吃掉）。
     */
    const padTop = parseFloat(cs.paddingTop) || 0
    const padBottom = parseFloat(cs.paddingBottom) || 0
    const contentBox = el.clientHeight - padTop - padBottom
    if (!Number.isFinite(lh) || lh <= 0 || contentBox < 1) continue
    const over = lh - contentBox
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
        h: Math.round(contentBox), w: Math.round(r.width),
        rect: `行盒/内容盒(内边距${padTop}+${padBottom})`,
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

/**
 * 打开落地页的「创建项目」对话框。
 *
 * ── 为什么要专门加这一段 ──
 * 本脚本原来只走「落地页 + 设置页 11 分区」。而阶段 1 引入的那处真实裁切
 * 缺陷（`.ui-test-create-name`：`height:44px` 固定 + `line-height:1.5rem` 可缩放）
 * 正好落在**这个对话框**里 —— 它既不在落地页上，也不在设置页里，
 * 于是整轮测量报「0 裁切」，守卫却全部通过。这正是"检查器只会在它看过的地方说没事"。
 *
 * 更讽刺的是，同文件的守卫④ E 项原文就写着
 * 「这类控件正是静态预判发现风险的地方」—— 说明写它的时候已经意识到
 * 输入控件有风险，却始终没走到页面上唯一那个输入控件所在的地方。
 * 所以这里补上这个界面，并把它的到达与否纳入覆盖面守卫（守卫 F）。
 */
const DIALOG_SELECTORS = [
  '[data-ui-test-dialog="create-project"]',
  ".ui-test-create-project-dialog",
]

/** 打开创建项目对话框；返回是否确实打开（用真实 DOM 存在性判定，不靠"点了就算"）。 */
const openCreateProjectDialog = async () => {
  const clicked = await page.evaluate(() => {
    /*
     * 优先用结构定位：ui-test-shelf.tsx:238 的第一个 hero 操作按钮
     * （`.ui-test-shelf-actions > .ui-test-btn.primary`，文案「新建小说」）。
     * 文本匹配只作为兜底 —— 文案会改，结构不会。
     */
    const structural = document.querySelector(".ui-test-shelf-actions .ui-test-btn.primary")
    if (structural) {
      structural.click()
      return { clicked: true, how: "结构定位 .ui-test-shelf-actions .ui-test-btn.primary" }
    }
    const texts = ["新建小说", "创建项目", "新建项目"]
    for (const el of document.querySelectorAll('.ui-test-root button, .ui-test-root a, .ui-test-root [role="button"]')) {
      const label = el.getAttribute("aria-label") || ""
      const text = (el.textContent || "").trim()
      if (texts.includes(text) || texts.some((t) => label.includes(t))) {
        el.click()
        return { clicked: true, how: `文本定位 text=${text} label=${label}` }
      }
    }
    return { clicked: false, how: "未找到入口" }
  })
  await page.waitForTimeout(1200)
  // 如实回报：真的出现了对话框元素才算到达
  const landed = await page.evaluate((sels) => {
    for (const s of sels) if (document.querySelector(s)) return s
    return null
  }, DIALOG_SELECTORS)
  return { ...clicked, landed }
}

/** 关闭对话框（Esc + 点遮罩），确保不影响后续测量。 */
const closeDialog = async () => {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(600)
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

// 第二段：落地页的「创建项目」对话框
// 位置必须在进设置页**之前** —— 设置页会盖住落地页，之后就没有这个入口了。
let dialogLanded = null
if (!SELFTEST_ONLY) {
  const dlg = await openCreateProjectDialog()
  dialogLanded = dlg.landed
  if (dlg.landed) {
    for (const s of SCALES) {
      await setScale(s)
      const r = await collect("create-project-dialog")
      pushAll(s, r.items, "create-project-dialog")
      measuredCount[s] = (measuredCount[s] ?? 0) + r.measured
      textControlsSeen[s] = (textControlsSeen[s] ?? 0) + (r.textControlsSeen ?? 0)
      fontSamples[s] = (fontSamples[s] ?? []).concat(r.fontSizes)
      probes.positive[s] = probes.positive[s] || r.probePositive
      probes.negative[s] = probes.negative[s] || r.probeNegative
      surfacesReached.add("create-project-dialog")
    }
  }
  await closeDialog()
}

// 第三段：设置页 11 个分区
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
// 期望界面 = 落地页 + 创建项目对话框 + 设置页 11 分区。
// 对话框必须计入：它承载着落地页上唯一的文本输入控件，
// 而那个控件正是本类缺陷（固定 px 盒高 + 可缩放行盒）的真实落点。
const expectedSurfaces = SELFTEST_ONLY ? 1 : 2 + SETTINGS_SECTIONS.length
if (surfacesReached.size < expectedSurfaces) {
  const missing = SELFTEST_ONLY ? [] : SETTINGS_SECTIONS.filter((s2) => !surfacesReached.has(s2))
  fail("D/覆盖面", `只到达 ${surfacesReached.size}/${expectedSurfaces} 个界面${missing.length ? `，缺分区: ${missing.join(", ")}` : ""}`)
}
// 守卫 F：创建项目对话框**必须**到达。
// 单纯靠 surfacesReached.size 不够 —— 少一个分区、多到达一个别的界面也能凑够数。
// 这里单独、明确地断言它，因为它是"检查器没看过的地方就敢说没事"的活证据。
if (!SELFTEST_ONLY && !surfacesReached.has("create-project-dialog")) {
  fail("F/对话框未到达", `没能打开「创建项目」对话框（入口未找到或对话框元素不存在，landed=${dialogLanded ?? "null"}）—— 落地页上唯一的文本输入控件就在那里，漏掉它等于对这类缺陷盲测`)
}
for (const s of SCALES) {
  // 见下方说明：selftest 模式下跳过样本量/控件覆盖，否则 --selftest 恒返回 1。
  if (SELFTEST_ONLY) break
  if ((measuredCount[s] ?? 0) < MIN_ELEMENTS) {
    fail("D/样本过少", `${s}% 档只测到 ${measuredCount[s] ?? 0} 个文本元素（下限 ${MIN_ELEMENTS}），页面可能没渲染出来`)
  }
  if ((textControlsSeen[s] ?? 0) < 1) {
    fail("E/控件未覆盖", `${s}% 档没有检查到任何文本输入控件 —— 此时"控件行盒未被裁"是空洞结论（这类控件正是静态预判发现风险的地方）`)
  }
}
/*
 * 守卫④里的「样本量 / 控件覆盖」在 `--selftest` 模式下**必须跳过**：
 * selftest 故意只渲染一个探针页（不导航进应用，见上方 `if (!SELFTEST_ONLY)`），
 * 那里天然只有十几个元素、零个输入控件。若不跳过，这两条就永远不成立，
 * 于是文档里写明的 `--selftest` 命令**恒返回 1**（改动前实测就是如此）——
 * 谁按文档跑一次都会以为工具坏了，而下一个人很可能直接把这些守卫删掉了事。
 * 它们说的是"整轮测量的覆盖面"，与"尺子准不准"无关；
 * 尺子的可信度由①倍率、②阳性对照、③阴性对照负责，那三条在 selftest 下照跑。
 */

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
  // 相对容差（原来是与 expect 直接比绝对差 0.05，在 expect≈1 时几乎无判别力）
  const relErr = Math.abs(medianRatio / expect - 1)
  if (relErr > 0.03) {
    fail("A/倍率未生效", `正文计算字号中位数 ${lo}%→${medLo}px、${hi}%→${medHi}px（比值 ${medianRatio.toFixed(3)}，期望 ${expect.toFixed(2)}，相对偏差 ${(relErr * 100).toFixed(1)}%）—— 倍率可能根本没应用`)
  }
  // 直接钉住尺子：最高档的根字号必须真的等于该档位，而不是"和自己比出来的比值"
  const rootFontSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)
  const rootPx = parseFloat(rootFontSize)
  if (!Number.isFinite(rootPx) || Math.abs(rootPx - 16 * (hi / 100)) > 0.6) {
    fail("A/根字号不符", `最高档 ${hi}% 的根字号应为 ${(16 * hi / 100).toFixed(1)}px，实测 ${rootFontSize} —— 尺子本身没落在预期档位上`)
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

// 结论要在写证据之前算出来，否则证据里没有 verdict，读的人只能靠别的文件推断。
const worst = kindCount(hi, "dom-overflow") + kindCount(hi, "control-clip")
const base = kindCount(lo, "dom-overflow") + kindCount(lo, "control-clip")
const ok = guardFails.length === 0 && worst === 0 && base === 0

const payload = {
  scales: SCALES,
  surfaces: [...surfacesReached].sort(),
  appOverflow: Object.fromEntries(SCALES.map((s) => [s, byScale[s]])),
  measuredCount, probes, medianRatio,
  guardFails, errors: errors.slice(0, 5),
  verdict: {
    pass: ok,
    worstScale: hi, worstClipCount: worst,
    baseScale: lo, baseClipCount: base,
    note: "appOverflow 为空数组表示该档位没有元素被裁切；guardFails 为空表示尺子的四项对照全部成立。",
  },
}
writeOut(payload)

if (AS_JSON) {
  console.log(JSON.stringify(payload, null, 2))
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
console.log(`  ④ 覆盖面      ${surfacesReached.size}/${expectedSurfaces} 个界面（落地页 + 创建项目对话框 + 设置页 11 分区）`)
console.log(`  ⑥ 静默遮蔽    同键不同元素: ${shadowed.length}`)

console.log(`\n  最低档 ${lo}% 裁切 ${base} 个；最高档 ${hi}% 裁切 ${worst} 个（两类相加）`)

/*
 * 明细必须**逐档打印**，不能只打最高档。
 * 原来只在 `worst > 0` 时打印 `byScale[hi]`，于是"缩小方向"的裁切
 * （例如 80% 档：内边距不随根字号缩小，可用高度比行盒还小）会被
 * 计数捕捉到、却永远看不到明细 —— 有 finding 却查不到是什么，等于半盲。
 * 这个盲区正好把本轮"只换算 height、内边距留 px"的不完整修复藏了一半。
 */
for (const s of SCALES) {
  const items = byScale[s]
  if (items.length === 0) continue
  console.log(`\n  ${s}% 档位裁切明细（前 25 条，共 ${items.length} 条）：`)
  console.log("  " + "─".repeat(120))
  for (const it of items.slice(0, 25)) {
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

// ok 已在写证据前算好（见上方 payload 的注释），这里直接复用。
console.log(`\n  结论: ${hi}% 档裁切 ${worst} 个，${lo}% 档裁切 ${base} 个，守卫 ${guardFails.length} 项未通过 → ${ok ? "✓ 通过（当前档位范围无裁切）" : "✗ 未通过"}`)
await browser.close()
server.close()
process.exit(ok ? 0 : 1)
