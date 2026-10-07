/**
 * 生成绑定对话框「修复前 / 修复后」在矮窗口下的对照截图，作为目视证据。
 * 运行：node docs/soul-binding-perf-20261006/shots-layout.mjs
 */
import { readFileSync, readdirSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const outDir = join(repo, "docs/soul-binding-perf-20261006/shots")
mkdirSync(outDir, { recursive: true })

const wb = readFileSync(join(repo, "src/components/novel/book-analysis-workbench.tsx"), "utf8")
const dlg = readFileSync(join(repo, "src/components/ui/dialog.tsx"), "utf8")
const grab = (s, re) => { const m = s.match(re); if (!m) throw new Error("miss " + re); return m[1] }

const dialogBase = grab(dlg, /"(fixed top-1\/2[^"]*)"/)
const headerBase = grab(dlg, /data-slot="dialog-header"\s+className=\{cn\("([^"]+)"/)
const footerBase = grab(dlg, /"(-mx-4 -mb-4 flex[^"]*)"/)
const dialogOverride = grab(wb, /<DialogContent className="([^"]+)">/)
const headerExtra = grab(wb, /<DialogHeader className="([^"]*)"/)
const descClass = grab(wb, /<p className="([^"]+)">绑定后会自动把该角色灵魂加入/)
const region = (() => { const i = wb.indexOf('data-testid="bindable-name-list"'); return wb.slice(wb.lastIndexOf("<DialogContent", i), i + 400) })()
// 单元格/label/名字/按钮都要在「栅格那一段」里取：
// 全文取第一个 <label className="..."> 会抓到拆书库残留的 .wb-pending-filter，
// 那个类没有 flex-1/min-w-0，名字不会收缩，于是「忽略」按钮被挤出单元格 ——
// 那是夹具的假象，不是应用的问题（第一版截图就这么误报过）。
const gridAnchor = wb.indexOf('data-testid="bindable-name-grid"')
const gridRegion = wb.slice(gridAnchor, wb.indexOf("没有可绑定的小说人物", gridAnchor))
const searchLabel = grab(region, /<label className="([^"]+)">\s*<Search className="size-4 shrink-0 opacity-60"/)
const countsClass = grab(wb, /<p className="([^"]+)">已选 \{picked\.length\}/)
const listClass = grab(wb, /className="([^"]+)" data-testid="bindable-name-list"/)
const footerExtra = grab(wb, /<DialogFooter className="([^"]*)"/)
const gridClass = grab(wb, /className="([^"]+)"\s+data-testid="bindable-name-grid"/)
const cellClass = grab(gridRegion, /<div key=\{name\} className="([^"]+)"/)
const itemLabel = grab(gridRegion, /<label className="([^"]+)">/)
const nameSpan = grab(gridRegion, /<span className="([^"]+)" title=\{name\}>/)
// 「忽略」按钮的真实 class：必须照抄，否则夹具里的裸 button 会被压到文字换行，
// 那是我夹具的假象、不是应用的问题（第一版截图就这么误报过一次）。
const ignoreBtn = grab(gridRegion, /className="([^"]+)"\s*\n\s*onClick=\{\(\) => void ignoreName\(name\)\}/)

let css = ""
for (const f of readdirSync(join(repo, "dist/assets"))) if (f.endsWith(".css")) css += readFileSync(join(repo, "dist/assets", f), "utf8") + "\n"

const GROUPS = [
  /^(?:(?:sm|md|lg|xl|2xl):)?(?:block|inline-block|inline|flex|inline-flex|grid|inline-grid|contents|hidden|flow-root)$/,
  /^(?:(?:sm|md|lg|xl|2xl):)?w-/, /^(?:(?:sm|md|lg|xl|2xl):)?max-w-/, /^(?:(?:sm|md|lg|xl|2xl):)?max-h-/,
  /^(?:(?:sm|md|lg|xl|2xl):)?min-h-/, /^(?:(?:sm|md|lg|xl|2xl):)?min-w-/,
  /^(?:(?:sm|md|lg|xl|2xl):)?overflow(-[xy])?/, /^(?:(?:sm|md|lg|xl|2xl):)?flex-/,
  /^(?:(?:sm|md|lg|xl|2xl):)?gap(-[xy])?-/, /^(?:(?:sm|md|lg|xl|2xl):)?shrink(-0)?$/, /^(?:(?:sm|md|lg|xl|2xl):)?items-/,
]
const gOf = (t) => GROUPS.findIndex((g) => g.test(t))
const twMerge = (...ls) => {
  const t = ls.filter(Boolean).join(" ").split(/\s+/).filter(Boolean)
  return t.filter((x, i) => { const g = gOf(x); return g < 0 || !t.slice(i + 1).some((l) => gOf(l) === g) }).join(" ")
}

const NAMES = ["许七安", "临安", "楚元缜", "怀庆长公主", "魏渊", "李妙真", "褚采薇", "采药老人", "城中守卫统领", "编号派通用手段",
  ...Array.from({ length: 40 }, (_, i) => `龙套角色${i + 1}`)]

const cellMarkup = (c) => NAMES.map((n) => `<div class="${cellClass}"><label class="${c.label}"><input type="checkbox"${n === "许七安" ? " checked" : ""}/><span class="${nameSpan}" title="${n}">${n}</span></label><button type="button" class="${c.ignore}">忽略</button></div>`).join("")

const after = {
  dialog: twMerge(dialogBase, dialogOverride), header: twMerge(headerBase, headerExtra), desc: descClass,
  search: searchLabel, counts: countsClass, list: listClass, grid: gridClass,
  footer: twMerge(footerBase, footerExtra), label: itemLabel, ignore: ignoreBtn,
}
// 修复前的真实快照（对话框 640px、label gap-2、按钮 px-1 text-xs），三处都要还原
const before = {
  dialog: twMerge(dialogBase, "flex max-h-[85vh] flex-col sm:max-w-[640px]"),
  header: headerBase, desc: "text-sm text-muted-foreground",
  search: "flex items-center gap-2 rounded-md border px-2",
  counts: "text-xs text-muted-foreground", list: "min-h-0 flex-1 overflow-y-auto", grid: gridClass,
  footer: twMerge(footerBase, "items-center"),
  label: "flex min-w-0 flex-1 items-center gap-2 py-1.5 text-sm",
  ignore: "shrink-0 rounded px-1 text-xs text-muted-foreground hover:text-foreground",
}

const stack = (c, countsText) => `
<div class="${c.dialog}" data-testid="dialog">
  <div class="${c.header}"><h2 class="text-lg leading-none font-semibold">绑定「许七安」</h2></div>
  <p class="${c.desc}">绑定后会自动把该角色灵魂加入自定义灵魂库。</p>
  <label class="${c.search}"><svg class="size-4 shrink-0 opacity-60"></svg><input aria-label="搜索小说人物" placeholder="搜索小说人物" class="h-9 w-full bg-transparent text-sm outline-none"></label>
  <p class="${c.counts}">${countsText}</p>
  <div class="${c.list}" data-testid="bindable-name-list"><div class="${c.grid}" data-testid="bindable-name-grid">${cellMarkup(c)}</div></div>
  <div class="${c.footer}"><button class="dlg-btn">取消</button><button class="dlg-btn">绑定所选 1 个人物</button></div>
</div>`

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const browser = await (mod.chromium ?? mod.default.chromium).launch()

for (const [name, classes] of [["before", before], ["after", after]]) {
  for (const [w, h] of [[1280, 560], [1100, 360]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
    await page.setContent(`<!doctype html><html><head><style>${css}</style>
      <style>body{margin:0;background:#eef2f0;font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif}
      /* 只给页脚按钮加外观。绝不能写成全局 button{padding:...}：
         那会把每行那个「忽略」按钮也撑大，把名字挤掉，截图就成了夹具的假象
         （第一版「修复后」截图里「怀庆长公主」被截断就是这么来的）。*/
      .dlg-btn{border:1px solid #cbd5e1;border-radius:6px;padding:6px 14px;background:#fff;font:inherit}
      h2{font-size:17px}</style></head><body>${stack(classes, "已选 1 个 · 匹配 50 / 共 50")}</body></html>`)
    await page.waitForTimeout(80)
    const box = await page.locator('[data-testid="dialog"]').boundingBox()
    const path = join(outDir, `dialog-${name}-${w}x${h}.png`)
    await page.screenshot({ path, clip: { x: Math.max(0, box.x - 12), y: Math.max(0, box.y - 12), width: Math.min(w, box.width + 24), height: Math.min(h, box.height + 24) } })
    console.log(`${name} ${w}x${h}  对话框 ${Math.round(box.height)}px  ->  ${path}`)
    await page.close()
  }
}
await browser.close()
