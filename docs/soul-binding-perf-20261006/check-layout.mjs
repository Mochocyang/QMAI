/**
 * 绑定对话框「纵向不裁切」的真实浏览器检查。
 *
 * 背景：用户截图反馈标题/说明/搜索框/计数那几行被裁掉一半、还带滚动条。
 * 前一版 check.mjs 只拼了「对话框 class + 名单区」，把这几行兄弟节点漏了，
 * 所以这类问题它一个都抓不到。这里补齐完整纵向栈，并钉住三条不变量：
 *   1. 名单区之外的每一行都按内容占位，绝不被压扁（高度不小于自身内容高度）；
 *   2. 「绑定所选」页脚可达（要么本来就在视口内，要么把对话框滚到底就能完整看到）；
 *   3. 纵向压力全部由名单区吸收，名单区不会被压成 0。
 * 名单区自己是唯一允许滚动的容器。
 *
 * 运行：node docs/soul-binding-perf-20261006/check-layout.mjs
 */
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const wb = readFileSync(join(repo, "src/components/novel/book-analysis-workbench.tsx"), "utf8")
const dlg = readFileSync(join(repo, "src/components/ui/dialog.tsx"), "utf8")

const notes = []
const failures = []
const check = (ok, label, detail = "") => {
  if (ok) notes.push(`  OK   ${label}${detail ? `  — ${detail}` : ""}`)
  else failures.push(`  FAIL ${label}${detail ? `  — ${detail}` : ""}`)
}
// 只在「绑定目标对话框」那一段源码里取 class，避免抓到页面上别的同名结构
const dialogRegion = (() => {
  const start = wb.indexOf('data-testid="bindable-name-list"')
  if (start < 0) throw new Error("找不到 bindable-name-list，检查脚本要同步")
  return wb.slice(wb.lastIndexOf("<DialogContent", start), start + 400)
})()
const grab = (src, re, l) => {
  const m = src.match(re)
  if (!m) { failures.push(`  FAIL 取不到 ${l}（源码结构变了，检查脚本要同步）`); return "" }
  return m[1]
}

const dialogBase = grab(dlg, /"(fixed top-1\/2[^"]*)"/, "DialogContent 基础 class")
const headerBase = grab(dlg, /data-slot="dialog-header"\s+className=\{cn\("([^"]+)"/, "DialogHeader 基础 class")
const footerBase = grab(dlg, /"(-mx-4 -mb-4 flex[^"]*)"/, "DialogFooter 基础 class")
const dialogOverride = grab(wb, /<DialogContent className="([^"]+)">/, "DialogContent 覆盖 class")
const headerExtra = grab(wb, /<DialogHeader className="([^"]*)"/, "DialogHeader 追加 class")
const descClass = grab(wb, /<p className="([^"]+)">绑定后会自动把该角色灵魂加入/, "说明行 class")
// 锚定到这个对话框独有的 Search 图标 class（size-4 shrink-0 opacity-60），
// 否则会抓到拆书库「搜索成果」那个 label（上一版就是这么抓错的）
const searchLabel = grab(dialogRegion, /<label className="([^"]+)">\s*<Search className="size-4 shrink-0 opacity-60"/, "搜索框 class")
const countsClass = grab(wb, /<p className="([^"]+)">已选 \{picked\.length\}/, "计数行 class")
const listClass = grab(wb, /className="([^"]+)" data-testid="bindable-name-list"/, "名单区 class")
const footerExtra = grab(wb, /<DialogFooter className="([^"]*)"/, "DialogFooter 追加 class")
const gridClass = grab(wb, /className="([^"]+)"\s+data-testid="bindable-name-grid"/, "栅格 class")
const cellClass = grab(wb, /<div key=\{name\} className="([^"]+)"/, "单元格 class")
const itemLabelClass = grab(wb, /<label className="([^"]+)">\s*<input type="checkbox"/, "条目 label class")
const nameSpanClass = grab(wb, /<span className="([^"]+)" title=\{name\}>/, "名字 class")

if (failures.length) { console.log(failures.join("\n")); process.exit(1) }

let allCss = ""
for (const f of readdirSync(join(repo, "dist/assets"))) {
  if (f.endsWith(".css")) allCss += readFileSync(join(repo, "dist/assets", f), "utf8") + "\n"
}

// 与 cn() 同语义的最小合并：后者胜，只覆盖本次会冲突的组
const GROUPS = [
  /^(?:(?:sm|md|lg|xl|2xl):)?(?:block|inline-block|inline|flex|inline-flex|grid|inline-grid|contents|hidden|flow-root)$/,
  /^(?:(?:sm|md|lg|xl|2xl):)?w-/, /^(?:(?:sm|md|lg|xl|2xl):)?max-w-/,
  /^(?:(?:sm|md|lg|xl|2xl):)?max-h-/, /^(?:(?:sm|md|lg|xl|2xl):)?min-h-/,
  /^(?:(?:sm|md|lg|xl|2xl):)?min-w-/, /^(?:(?:sm|md|lg|xl|2xl):)?overflow(-[xy])?/,
  /^(?:(?:sm|md|lg|xl|2xl):)?flex-/, /^(?:(?:sm|md|lg|xl|2xl):)?gap(-[xy])?-/,
  /^(?:(?:sm|md|lg|xl|2xl):)?shrink(-0)?$/, /^(?:(?:sm|md|lg|xl|2xl):)?items-/,
]
const gOf = (t) => GROUPS.findIndex((g) => g.test(t))
const twMerge = (...lists) => {
  const toks = lists.filter(Boolean).join(" ").split(/\s+/).filter(Boolean)
  return toks.filter((t, i) => { const g = gOf(t); return g < 0 || !toks.slice(i + 1).some((l) => gOf(l) === g) }).join(" ")
}

const headerClass = twMerge(headerBase, headerExtra)
const footerClass = twMerge(footerBase, footerExtra)

// 未来若有人把 shrink-0 去掉，这几行就会重新变成可压缩的 —— 直接钉住源码
for (const [label, cls] of [
  ["DialogHeader", headerClass], ["说明行", descClass], ["搜索框", searchLabel],
  ["计数行", countsClass], ["DialogFooter", footerClass],
]) {
  check(/(^|\s)shrink-0(\s|$)/.test(cls), `${label} 声明了 shrink-0（不会被压扁）`, cls)
}
check(/min-h-0/.test(listClass), "名单区用 min-h-0 当唯一的压力出口", listClass)

const NAMES = Array.from({ length: 113 }, (_, i) => `角色名字${i + 1}`)
const cells = NAMES.map((n) =>
  `<div class="${cellClass}"><label class="${itemLabelClass}"><input type="checkbox"/><span class="${nameSpanClass}" title="${n}">${n}</span></label><button type="button">忽略</button></div>`).join("")

const buildStack = (c) => `
<div class="${c.dialog}" data-testid="dialog">
  <div class="${c.header}"><h2 class="text-lg leading-none font-semibold">绑定「许七安」</h2></div>
  <p class="${c.desc}">绑定后会自动把该角色灵魂加入自定义灵魂库。</p>
  <label class="${c.search}"><svg class="size-4 shrink-0 opacity-60"></svg>
    <input aria-label="搜索小说人物" placeholder="搜索小说人物" class="h-9 w-full bg-transparent text-sm outline-none"></label>
  <p class="${c.counts}">已选 0 个 · 匹配 113 / 共 113</p>
  <div class="${c.list}" data-testid="bindable-name-list"><div class="${c.grid}" data-testid="bindable-name-grid">${cells}</div></div>
  <div class="${c.footer}"><button>取消</button><button>绑定所选 0 个人物</button></div>
</div>`

const after = {
  dialog: twMerge(dialogBase, dialogOverride), header: headerClass, desc: descClass,
  search: searchLabel, counts: countsClass, list: listClass, grid: gridClass, footer: footerClass,
}
// 修复前的真实写法：对话框没有 gap-3/overflow、几行都没有 shrink-0、名单区 min-h-0
const before = {
  dialog: twMerge(dialogBase, "flex max-h-[85vh] flex-col sm:max-w-[640px]"),
  header: headerBase, desc: "text-sm text-muted-foreground",
  search: "flex items-center gap-2 rounded-md border px-2",
  counts: "text-xs text-muted-foreground", list: "min-h-0 flex-1 overflow-y-auto",
  grid: gridClass, footer: twMerge(footerBase, "items-center"),
}

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const browser = await (mod.chromium ?? mod.default.chromium).launch()

async function measure(classes, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.setContent(`<!doctype html><html><head><style>${allCss}</style>
    <style>body{margin:0;background:#fff;font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif}</style></head>
    <body>${buildStack(classes)}</body></html>`)
  await page.waitForTimeout(60)
  const snap = () => page.evaluate(() => {
    const dlg = document.querySelector('[data-testid="dialog"]')
    const list = document.querySelector('[data-testid="bindable-name-list"]')
    const dlgRect = dlg.getBoundingClientRect()
    return {
      viewportH: window.innerHeight,
      dialogH: Math.round(dlgRect.height),
      listH: Math.round(list.getBoundingClientRect().height),
      rows: [...dlg.children].map((el) => {
        const cs = getComputedStyle(el)
        let natural = 0
        if (el.tagName === "P") {
          const range = document.createRange(); range.selectNodeContents(el)
          natural = Math.ceil(range.getBoundingClientRect().height)
        } else {
          natural = [...el.children].reduce((mx, c) => Math.max(mx, c.getBoundingClientRect().height), 0)
        }
        return {
          text: (el.textContent ?? "").slice(0, 12).replace(/\s+/g, " "),
          h: Math.round(el.getBoundingClientRect().height),
          natural: Math.round(natural),
          isList: el.hasAttribute("data-testid"),
          isFooter: (el.textContent ?? "").includes("绑定所选"),
          bottom: el.getBoundingClientRect().bottom,
          overflowY: cs.overflowY,
        }
      }),
    }
  })
  let m = await snap()
  const footer = m.rows.find((r) => r.isFooter)
  // 页脚被挤出视口时，把对话框滚到底再看 —— 这才是「可达」的真实判定
  let scrolled = false
  if (footer && footer.bottom > m.viewportH + 1) {
    await page.evaluate(() => {
      const d = document.querySelector('[data-testid="dialog"]')
      d.scrollTop = d.scrollHeight
    })
    await page.waitForTimeout(40)
    m = await snap(); scrolled = true
  }
  m.scrolled = scrolled
  await page.close()
  return m
}

const VIEWPORTS = [[1280, 900], [1280, 700], [1280, 560], [1100, 430], [1100, 320]]
for (const [w, h] of VIEWPORTS) {
  const m = await measure(after, w, h)
  const label = `${w}x${h}`
  const nonList = m.rows.filter((r) => !r.isList)
  const squashed = nonList.filter((r) => r.natural > 0 && r.h + 1 < r.natural)
  check(squashed.length === 0, `${label}：标题/说明/搜索框/计数/页脚都没有被压扁`,
    squashed.length ? squashed.map((r) => `「${r.text}」${r.h}px<内容${r.natural}px`).join("；") : `${nonList.length} 行全部按内容占位`)
  // 名单区是压力出口，但绝不该被压成一条缝（修复前在 320px 高度下只剩 31px）
  check(m.listH >= 40, `${label}：名单区没有被压成一条缝`, `实测 ${m.listH}px`)
  const footer = m.rows.find((r) => r.isFooter)
  check(Boolean(footer) && footer.bottom <= m.viewportH + 1, `${label}：「绑定所选」页脚可达`,
    footer ? `页脚底 ${Math.round(footer.bottom)}px / 视口 ${m.viewportH}px${m.scrolled ? "（滚动对话框后）" : ""}` : "找不到页脚")
  const scrollers = nonList.filter((r) => r.overflowY === "auto" || r.overflowY === "scroll")
  check(scrollers.length === 0, `${label}：名单区之外没有额外的滚动容器`,
    scrollers.length ? scrollers.map((r) => `「${r.text}」overflowY=${r.overflowY}`).join("；") : "只有名单区可滚")
  notes.push(`  --- ${label}: 对话框 ${m.dialogH}px，名单区 ${m.listH}px，行高 [${m.rows.map((r) => r.h).join(", ")}]`)
}

// 非空洞证明：拿修复前的真实 class 重跑同一套断言，必须至少踩中一条
{
  // ① 源码级：修复前那几行没有 shrink-0，所以「声明了 shrink-0」这类断言必然失败
  const beforeRows = [
    ["DialogHeader", before.header], ["说明行", before.desc], ["搜索框", before.search],
    ["计数行", before.counts], ["DialogFooter", before.footer],
  ]
  const noShrink = beforeRows.filter(([, cls]) => !/(^|\s)shrink-0(\s|$)/.test(cls)).map(([n]) => n)
  check(noShrink.length > 0, "非空洞证明①：修复前的 class 确实缺少 shrink-0（源码级断言会失败）",
    noShrink.length ? `${noShrink.join("、")} 都没有 shrink-0` : "!!! 修复前也有 shrink-0，断言无效")

  // ② 几何级：修复前在矮窗口下名单区被压得更扁
  const caught = []
  for (const [w, h] of [[1280, 560], [1100, 430], [1100, 320]]) {
    const m = await measure(before, w, h)
    const nonList = m.rows.filter((r) => !r.isList)
    const squashed = nonList.filter((r) => r.natural > 0 && r.h + 1 < r.natural)
    const footer = m.rows.find((r) => r.isFooter)
    if (squashed.length) caught.push(`${w}x${h} 行被压扁（${squashed.map((r) => `「${r.text}」${r.h}<${r.natural}`).join("、")}）`)
    if (m.listH < 40) caught.push(`${w}x${h} 名单区只剩 ${m.listH}px`)
    if (footer && footer.bottom > m.viewportH + 1) caught.push(`${w}x${h} 页脚滚到底仍然够不到`)
  }
  check(caught.length > 0, "非空洞证明②：修复前的几何在矮窗口下会被抓住",
    caught.length ? caught.join("；") : "!!! 修复前也全绿 —— 说明几何断言无效")
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
