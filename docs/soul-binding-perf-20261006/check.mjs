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

// 栅格必须真的声明了 5 列，否则后面全是自欺欺人
check(/grid-cols-5/.test(gridClass ?? ""), "源码栅格声明了 grid-cols-5", gridClass ?? "")
if (failures.length) { console.log(failures.join("\n")); process.exit(1) }
notes.push(`  栅格 class：${gridClass}`)
notes.push(`  单元格 class：${cellClass}`)
notes.push(`  label class：${labelClass}`)
notes.push(`  名字 class：${nameSpanClass}`)

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
  return `<div class="${cellClass}"><label class="${labelClass}"><input type="checkbox" /><span class="${nameSpanClass}" title="${name}">${name}</span></label><button type="button" title="忽略「${name}」">忽略</button></div>`
}
function pageMarkup(names, opts = {}) {
  return `<div class="${dialogBaseClass} ${dialogOverride}" data-testid="dialog">
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
  return {
    gridOverflow: Math.round((grid.scrollWidth - grid.clientWidth) * 10) / 10,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    cellOverflow,
    buttonOutside,
    long,
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
    <div class="${dialogBaseClass} ${dialogOverride}"><div class="${listWrapClass}">
      <div class="${gridClass}" data-testid="g-mut2">${brokenCell.replace(`class="${labelClass}"`, `class="${brokenLabel}"`)}</div>
    </div></div></body></html>`)
  await page.waitForTimeout(60)
  const geo2 = await geometry(page, "g-mut2")
  const overflowed = geo2.long !== null && !geo2.long.truncated
  check(overflowed, "非空洞证明②：去掉可收缩约束后，超长名字不再截断（截断断言确实会失败）",
    geo2.long ? `clientWidth=${geo2.long.clientWidth} scrollWidth=${geo2.long.scrollWidth}` : "无样本")
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
