/**
 * 绑定对话框「每行 5 个」的几何检查（真实浏览器 + 真实 Tailwind 产物）。
 *
 * 三条保真原则（上一版几何检查踩过的坑，这里逐条堵住）：
 *  1. CSS 用 `vite build` 的全部产物一起注入，而不是手写替身或单个包
 *     —— 只注入单个包会漏掉 `.flex` 等基础工具类，量出来的布局是假的。
 *  2. class 字符串从源码里**按区域**抠出来（锚定 bindable-name-grid 那一段），
 *     而不是全文第一个匹配 —— 全文匹配会抓到别的 label。
 *  3. 断言的是**行为**（每行列数、是否溢出、是否真的出现省略号），
 *     不是断言 class 文本；class 文本只用于第 4 步的非空洞证明。
 *
 * 运行：node docs/soul-binding-perf-20261006/check.mjs
 */
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, "..", "..")

const notes = []
const failures = []
const check = (ok, label, detail = "") => {
  if (ok) notes.push(`  OK   ${label}${detail ? `  ${detail}` : ""}`)
  else failures.push(`  FAIL ${label}${detail ? `  ${detail}` : ""}`)
}

// ---------------------------------------------------------------- 源码取 class
const workbench = readFileSync(join(repo, "src/components/novel/book-analysis-workbench.tsx"), "utf8")
const dialogFile = readFileSync(join(repo, "src/components/ui/dialog.tsx"), "utf8")

// 把范围锚定在栅格那一段，避免全文第一个匹配抓到别的 label/span
const gridAnchor = workbench.indexOf('data-testid="bindable-name-grid"')
const regionEnd = workbench.indexOf("没有可绑定的小说人物", gridAnchor)
if (gridAnchor < 0 || regionEnd < 0) {
  console.log("  FAIL 无法定位 bindable-name-grid 区块（源码结构变了，检查脚本必须同步）")
  process.exit(1)
}
const region = workbench.slice(gridAnchor, regionEnd)

const grab = (source, pattern, label) => {
  const m = source.match(pattern)
  if (!m) {
    failures.push(`  FAIL 在栅格区块里取不到 ${label}（源码结构变了，检查脚本必须同步）`)
    return null
  }
  return m[1]
}
// 栅格 class 在 data-testid 之前，所以用「两者相邻」的全文件匹配（唯一且不含歧义）；
// 单元格/label/名字都在 testid 之后，用锚定区间取，避免抓到别处的 label。
const gridClass = grab(workbench, /className="([^"]+)"\s+data-testid="bindable-name-grid"/, "栅格 class")
const cellClass = grab(region, /<div key=\{name\} className="([^"]+)"/, "单元格 class")
const labelClass = grab(region, /<label className="([^"]+)">/, "label class")
const nameSpanClass = grab(region, /<span className="([^"]+)" title=\{name\}>/, "名字 class")
const listWrapClass = grab(workbench, /className="([^"]+)" data-testid="bindable-name-list"/, "列表容器 class")
const dialogBaseClass = grab(dialogFile, /"(fixed top-1\/2[^"]*)"/, "DialogContent 基础 class")
const dialogOverride = grab(workbench, /<DialogContent className="([^"]+)">/, "DialogContent 覆盖 class")

// 对话框实际生效的 class：DialogContent 用 cn()（clsx + tailwind-merge）合并基础样式与覆盖样式，
// 早期版本直接字符串拼接，于是 `grid` 和 `sm:max-w-sm` 都没被顶掉，量出来的宽度是 384px
// 而不是真实的 640px —— 量到的是假象。这里补一个「同类后者胜」的合并，
// 只覆盖本页会冲突的几组工具类（display / width / max-width），够用且诚实。
const DIALOG_GROUP_PATTERNS = [
  /^(?:(?:sm|md|lg|xl|2xl):)?(?:block|inline-block|inline|flex|inline-flex|grid|inline-grid|contents|hidden|flow-root)$/,
  /^(?:(?:sm|md|lg|xl|2xl):)?w-/,
  /^(?:(?:sm|md|lg|xl|2xl):)?max-w-/,
]
function mergeTailwind(...classLists) {
  const tokens = classLists.filter(Boolean).join(" ").split(/\s+/).filter(Boolean)
  const groupOf = (token) => DIALOG_GROUP_PATTERNS.findIndex((re) => re.test(token))
  const survivors = []
  for (let i = 0; i < tokens.length; i++) {
    const group = groupOf(tokens[i])
    if (group < 0) { survivors.push(tokens[i]); continue }
    // 同组里若后面还有，则本条被后面的顶掉（tailwind-merge 的后者胜）
    const overridden = tokens.slice(i + 1).some((later) => groupOf(later) === group)
    if (!overridden) survivors.push(tokens[i])
  }
  return survivors.join(" ")
}
const dialogClass = mergeTailwind(dialogBaseClass, dialogOverride)
const ignoreButtonClass = grab(region, /className="([^"]*)"[\s\S]{0,120}?>忽略<\/button>/, "忽略按钮 class")

// 栅格必须真的声明了 5 列，否则后面全是自欺欺人
check(/grid-cols-5/.test(gridClass ?? ""), "源码栅格声明了 grid-cols-5", gridClass ?? "")
if (failures.length) { console.log(failures.join("\n")); process.exit(1) }
notes.push(`  栅格 class：${gridClass}`)
notes.push(`  单元格 class：${cellClass}`)
notes.push(`  label class：${labelClass}`)
notes.push(`  名字 class：${nameSpanClass}`)
notes.push(`  对话框合并后 class：${dialogClass}`)

// --------------------------------------------------- 全部真实 CSS（贴近 app）
const assetDir = join(repo, "dist/assets")
const cssFiles = readdirSync(assetDir).filter((f) => f.endsWith(".css"))
const allCss = cssFiles.map((f) => readFileSync(join(assetDir, f), "utf8")).join("\n")
if (!allCss.includes("grid-cols-5") || !/\.flex\{[^}]*display:flex/.test(allCss)) {
  console.log("  FAIL 产物 CSS 里缺 grid-cols-5 或 .flex，请先跑 npx vite build")
  process.exit(1)
}
notes.push(`  CSS：dist/assets 全部 ${cssFiles.length} 个包一起注入（含 .flex 与 grid-cols-5）`)

// ---------------------------------------------------------------- 组装真实结构
const LONG = "一个特别特别长的名字用来验证截断不会溢出单元格"
const NAMES = [
  "许七安", "许平志", LONG, "陈玄", "杨妙萍",
  "林小满", "杨寒", "白依", "阿禾", "阿七",
  "陈十七", "城防统领", "城中百姓", "采药老人", "回收者",
  "乙", "丙", "丁", "戊", "己",
]

function cellMarkup(name) {
  return `<div class="${cellClass}"><label class="${labelClass}"><input type="checkbox" /><span class="${nameSpanClass}" title="${name}">${name}</span></label><button type="button" class="${ignoreButtonClass}" title="忽略「${name}」">忽略</button></div>`
}
function pageMarkup(names, opts = {}) {
  return `<div class="${dialogClass}" data-testid="dialog">
    <div class="${listWrapClass}"><div class="${opts.gridClass ?? gridClass}" ${opts.testId ?? 'data-testid="bindable-name-grid"'} data-mut="${opts.mutId ?? ""}">${names.map(cellMarkup).join("")}</div></div>
  </div>`
}

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const browser = await (mod.chromium ?? mod.default.chromium).launch()

const rowsOf = (page, selector) => page.$$eval(selector, (nodes) => {
  const lines = []
  for (const node of nodes) {
    const rect = node.getBoundingClientRect()
    const line = lines.find((entry) => Math.abs(entry.top - rect.top) <= 2)
    if (line) line.count += 1
    else lines.push({ top: rect.top, count: 1 })
  }
  return lines.map((line) => line.count)
})

/** 单元格/名字/按钮的越界与截断情况。 */
const geometry = (page, gridTestId) => page.evaluate((id) => {
  const grid = document.querySelector(`[data-testid="${id}"]`)
  const gridRect = grid.getBoundingClientRect()
  let cellOverflow = null
  let buttonOutside = null
  for (const cell of grid.children) {
    const cellRect = cell.getBoundingClientRect()
    const over = cellRect.right - gridRect.right
    if (over > 0.5 && (!cellOverflow || over > cellOverflow.over)) {
      cellOverflow = { over: Math.round(over * 10) / 10, text: (cell.textContent ?? "").slice(0, 10) }
    }
    const btn = cell.querySelector("button")
    if (btn) {
      const btnRect = btn.getBoundingClientRect()
      if (btnRect.right > cellRect.right + 0.5 && !buttonOutside) {
        buttonOutside = { by: Math.round((btnRect.right - cellRect.right) * 10) / 10, text: (cell.textContent ?? "").slice(0, 10) }
      }
    }
  }
  const spans = [...grid.querySelectorAll("span")]
  const longSpan = spans.find((node) => (node.textContent ?? "").length > 20) ?? null
  const long = longSpan ? {
    clientWidth: longSpan.clientWidth,
    scrollWidth: longSpan.scrollWidth,
    truncated: longSpan.clientWidth > 0 && longSpan.scrollWidth > longSpan.clientWidth,
    hasFullTitle: longSpan.getAttribute("title") === longSpan.textContent,
    overflowsCell: longSpan.getBoundingClientRect().right > longSpan.closest("div").getBoundingClientRect().right + 0.5,
    minWidth: getComputedStyle(longSpan).minWidth,
  } : null
  // 用户反馈「内容显示不完全」：真实小说里 2–6 字的角色名必须完整显示，
  // 不能被「忽略」按钮挤到只剩开头一两个字。这里逐个量。
  const common = spans
    .filter((node) => {
      const n = (node.textContent ?? "").length
      return n >= 2 && n <= 6
    })
    .map((node) => ({
      name: node.textContent ?? "",
      chars: (node.textContent ?? "").length,
      available: node.clientWidth,
      needed: node.scrollWidth,
      // truncate 是 overflow:hidden，哪怕只差 1px 也会显示省略号，
      // 所以容差只能给到亚像素级，不能用 +1（那会把「采药老人」这种放过去）。
      clipped: node.clientWidth > 0 && node.scrollWidth - node.clientWidth > 0.5,
    }))
  return {
    gridOverflow: Math.round((grid.scrollWidth - grid.clientWidth) * 10) / 10,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    cellOverflow,
    buttonOutside,
    long,
    common,
  }
}, gridTestId)

async function runAt(width, height, expectedPerRow, label) {
  const page = await browser.newPage({ viewport: { width, height } })
  await page.setContent(`<!doctype html><html><head><style>${allCss}</style>
    <style>body{margin:0;background:#fff;font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif;}</style>
    </head><body>${pageMarkup(NAMES)}</body></html>`)
  await page.waitForTimeout(60)

  const perRow = await rowsOf(page, '[data-testid="bindable-name-grid"] > div')
  const first = perRow[0] ?? 0
  check(first === expectedPerRow, `${label}：每行 ${expectedPerRow} 个`, `首行 ${first} 个，全部行=[${perRow.join(", ")}]`)
  check(perRow.slice(0, -1).every((c) => c === expectedPerRow), `${label}：除末行外每行都排满`, `[${perRow.join(", ")}]`)

  const geo = await geometry(page, "bindable-name-grid")
  // 保真自检：对话框最大宽是 sm:max-w-[760px]，窗口够宽时容器就该是 760px。
  // 早期版本因为拼接没做冲突合并，这里只有 384px —— 那样量出来的一切都不可信。
  // 760px 也是为了让 5 列每格约 136px：名字 + 复选 + 「忽略」按钮都装得下。
  const dialogWidth = await page.$eval('[data-testid="dialog"]', (el) => Math.round(el.getBoundingClientRect().width))
  if (width >= 768) {
    check(dialogWidth === 760, `${label}：对话框宽度就是 sm:max-w-[760px] 的 760px（合并后样式保真）`, `实测 ${dialogWidth}px`)
  }
  check(geo.pageOverflow <= 0, `${label}：页面无横向溢出`, `溢出 ${geo.pageOverflow}px`)
  check(geo.gridOverflow <= 0, `${label}：栅格无横向溢出`, `溢出 ${geo.gridOverflow}px`)
  check(geo.cellOverflow === null, `${label}：没有单元格越出栅格`,
    geo.cellOverflow ? `越界 ${geo.cellOverflow.over}px「${geo.cellOverflow.text}」` : "")
  check(geo.buttonOutside === null, `${label}：忽略按钮都在自己的单元格内`,
    geo.buttonOutside ? `越界 ${geo.buttonOutside.by}px「${geo.buttonOutside.text}」` : "")

  check(geo.long !== null, `${label}：找到超长名字样本`)
  if (geo.long) {
    check(geo.long.truncated, `${label}：超长名字真的出现省略号（可收缩）`,
      `clientWidth=${geo.long.clientWidth} scrollWidth=${geo.long.scrollWidth} min-width=${geo.long.minWidth}`)
    check(!geo.long.overflowsCell, `${label}：超长名字不越出单元格`)
    check(geo.long.hasFullTitle, `${label}：截断后仍保留完整 title`)
  }
  // 用户原话「内容显示得不完全」：常见长度的名字必须完整可见，一个都不许被挤掉
  const clippedCommon = geo.common.filter((c) => c.clipped)
  check(clippedCommon.length === 0, `${label}：2–6 字的常见角色名全部完整显示`,
    clippedCommon.length
      ? clippedCommon.map((c) => `「${c.name}」只剩 ${c.available}px/需 ${c.needed}px`).join("；")
      : `${geo.common.length} 个常见名字都没被截断`)
  check(geo.common.length >= 5, `${label}：常见名字样本足够多`, `${geo.common.length} 个`)
  await page.close()
  return perRow
}

// Tailwind 断点按视口宽度：md(768) 起 5 列，sm(640) 起 3 列，更窄 2 列。
// 对话框最大宽 sm:max-w-[640px]，所以宽窗口下容器就是 640px，5 列每列约 118px。
await runAt(1200, 800, 5, "1200px")
await runAt(700, 800, 3, "700px（sm，3 列）")
await runAt(600, 800, 2, "600px（窄屏，2 列）")

// ------------------------------------------------- 非空洞证明（两组，自带 data-testid）
{
  // 证明 1：删掉 md:grid-cols-5 这一条规则后，「每行 5 个」必须不再成立。
  // 注意不能改成 md:grid-cols-1 —— Tailwind 是按源码用到的类按需生成的，
  // 产物里根本没有 md:grid-cols-1 这条规则，那样量到的还是 sm:grid-cols-3 的 3 列，
  // 属于「变异没有真正生效」的假证明。删掉规则才会退回到 sm:grid-cols-3。
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const mutated = (gridClass ?? "").replace(/\bmd:grid-cols-5\b/, "").replace(/\s+/g, " ").trim()
  await page.setContent(`<!doctype html><html><head><style>${allCss}</style></head><body style="margin:0">
    ${pageMarkup(NAMES.slice(0, 10), { gridClass: mutated, testId: 'data-testid="g-mut"', mutId: "col" })}</body></html>`)
  await page.waitForTimeout(60)
  const perRow = await rowsOf(page, '[data-testid="g-mut"] > div')
  check(perRow[0] !== 5 && perRow[0] === 3,
    "非空洞证明①：删掉 md:grid-cols-5 后退回 3 列（「每行 5 个」的断言确实会失败）",
    `首行 ${perRow[0]} 个，变异后 class = "${mutated}"`)
  await page.close()
}
{
  // 证明 2：截断断言能抓到「名字撑破单元格」。去掉名字上的 min-w-0（真实缺陷就是这个形状）
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const broken = (nameSpanClass ?? "").replace(/\bmin-w-0\b/g, "").trim()
  const brokenCell = cellMarkup(LONG).replace(`class="${nameSpanClass}"`, `class="${broken}"`)
  const brokenLabel = labelClass.replace(/\bmin-w-0\b/g, "").replace(/\bflex-1\b/g, "")
  await page.setContent(`<!doctype html><html><head><style>${allCss}</style></head><body style="margin:0">
    <div class="${dialogClass}"><div class="${listWrapClass}">
      <div class="${gridClass}" data-testid="g-mut2">${brokenCell.replace(`class="${labelClass}"`, `class="${brokenLabel}"`)}</div>
    </div></div></body></html>`)
  await page.waitForTimeout(60)
  const geo2 = await geometry(page, "g-mut2")
  const overflowed = geo2.long !== null && !geo2.long.truncated
  check(overflowed, "非空洞证明②：去掉可收缩约束后，超长名字不再截断（截断断言确实会失败）",
    geo2.long ? `clientWidth=${geo2.long.clientWidth} scrollWidth=${geo2.long.scrollWidth}` : "无样本")
  await page.close()
}

{
  // 证明 3：回到用户截图时的状态，「2–6 字常见名字完整显示」这条必须失败。
  // 这里刻意用「历史快照」而不是对当前 class 做字符串替换：
  // 三处都要回到修复前（对话框 640px、label gap-2、按钮 px-1 text-xs），
  // 少还原一处就量不出问题 —— 我第一版只还原了两处，证明 ③ 假绿了。
  const BEFORE = {
    dialog: "flex max-h-[85vh] flex-col sm:max-w-[640px]",
    label: "flex min-w-0 flex-1 items-center gap-2 py-1.5 text-sm",
    button: "shrink-0 rounded px-1 text-xs text-muted-foreground hover:text-foreground",
  }
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const narrowDialog = mergeTailwind(dialogBaseClass, BEFORE.dialog)
  const cells = NAMES.map((name) =>
    `<div class="${cellClass}"><label class="${BEFORE.label}"><input type="checkbox" /><span class="${nameSpanClass}" title="${name}">${name}</span></label><button type="button" class="${BEFORE.button}">忽略</button></div>`).join("")
  await page.setContent(`<!doctype html><html><head><style>${allCss}</style></head><body style="margin:0">
    <div class="${narrowDialog}" data-testid="g-mut3-dialog"><div class="${listWrapClass}">
      <div class="${gridClass}" data-testid="g-mut3">${cells}</div>
    </div></div></body></html>`)
  await page.waitForTimeout(60)
  const w3 = await page.$eval('[data-testid="g-mut3-dialog"]', (el) => Math.round(el.getBoundingClientRect().width))
  const geo3 = await geometry(page, "g-mut3")
  const clipped3 = geo3.common.filter((c) => c.clipped)
  check(clipped3.length > 0,
    "非空洞证明③：回到修复前的 640px + gap-2 + 大按钮后，常见名字会被挤掉（「完整显示」断言确实会失败）",
    clipped3.length
      ? `对话框 ${w3}px，${clipped3.length} 个被截断，例：${clipped3.slice(0, 3).map((c) => `「${c.name}」只剩 ${c.available}px/需 ${c.needed}px`).join("；")}`
      : `!!! 仍然全绿 —— 该断言无效（对话框实测 ${w3}px）`)
  await page.close()
}

await browser.close()

console.log(notes.join("\n"))
console.log("")
if (failures.length) {
  console.log(`失败项 ${failures.length}：`)
  console.log(failures.join("\n"))
  process.exit(1)
}
console.log("失败项 0")
