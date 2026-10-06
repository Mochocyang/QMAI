/**
 * 需求分析浮层的几何核验（真实 Chromium）。
 *
 * 断言的是「位置/层级」这类只有真浏览器能算准的东西：
 *  - 宽度 = AI 会话面板宽度，底边贴面板底部
 *  - 盖在输入区上层（输入框中心的命中测试落在浮层上）
 *  - 不是全屏：既没有铺满面板，也没有全屏 fixed 遮罩
 * 旧写法（居中 Dialog）作为对照一并测量，输出前后差异。
 *
 * 用法：node docs/outline-intent-popup/geometry-check.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { chromium } = require("C:/Users/Administrator/AppData/Roaming/npm/node_modules/playwright")

const ROOT = process.cwd()
const ASSETS = join(ROOT, "dist", "assets")
const OUT_DIR = join(ROOT, "docs", "outline-intent-popup")

const cssFiles = readdirSync(ASSETS).filter((name) => name.endsWith(".css"))
if (cssFiles.length === 0) throw new Error("dist/assets 下没有 CSS，请先构建")
const css = cssFiles
  .map((name) => readFileSync(join(ASSETS, name), "utf8"))
  .join("\n")
console.log(`已载入 ${cssFiles.length} 个 CSS 文件，共 ${css.length} 字节`)

const PANEL_W = 420
const PANEL_H = 700
const INPUT_H = 132

/** 面板骨架：与大纲面板真实结构一致（relative 根 + 滚动区 + 底部输入区）。 */
function panelShell({ panelId, popup, backdrop = "" }) {
  return `
  <div id="${panelId}" class="relative flex h-full flex-col overflow-hidden border-border bg-background"
       data-ui-ai-panel="outline" style="width:${PANEL_W}px;height:${PANEL_H}px">
    <div class="flex h-12 shrink-0 items-center gap-2 border-b bg-muted/20 px-2">大纲对话</div>
    <div class="flex-1 overflow-y-auto p-3 text-sm">
      <div class="mb-3">这是一条历史消息，浮层不该把它全遮住。</div>
      <div class="mb-3">第二条历史消息。</div>
    </div>
    <div id="${panelId}-input" class="shrink-0 border-t px-3 py-2" data-ui-ai-input-area
         style="height:${INPUT_H}px">
      <div class="mb-2 flex items-center justify-between gap-2">
        <p class="text-xs text-muted-foreground">通过固定选项生成大纲需求</p>
      </div>
      <div data-ui-ai-composer>
        <textarea id="${panelId}-composer" aria-label="引用输入框" rows="3"
                  class="w-full rounded-md border bg-background px-3 py-2 text-sm"></textarea>
      </div>
    </div>
    ${backdrop}
    ${popup}
  </div>`
}

const OPTIONS = ["第二卷归墟寄魂", "第三卷记忆深渊", "第四卷无名样本"]
  .map((label) => `<button type="button" class="w-full rounded-lg border px-3 py-2 text-left text-sm">${label}</button>`)
  .join("")

// 新实现：面板内锚定浮层（与 outline-intent-dialog.tsx 的类名逐字一致）。
const AFTER_POPUP = `
  <div id="after-popup" role="dialog" aria-modal="false" aria-label="需求分析"
       data-testid="outline-intent-dialog"
       class="absolute inset-x-0 bottom-0 z-50 flex max-h-[78%] min-w-0 flex-col gap-2.5 overflow-y-auto rounded-t-xl border-t bg-popover p-3 text-sm text-popover-foreground shadow-[0_-10px_30px_-6px_rgba(0,0,0,0.22)]">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="text-sm font-medium">请选择本次要生成哪一卷的折叠树卷纲。</div>
        <div class="mt-0.5 text-xs text-muted-foreground">本次目标：卷纲</div>
      </div>
    </div>
    <div class="flex min-w-0 flex-col gap-1.5">${OPTIONS}</div>
    <details class="rounded-md border bg-muted/30 px-3 py-2 text-xs">
      <summary class="cursor-pointer list-none text-muted-foreground">判断依据</summary>
      <p class="mt-2 text-muted-foreground">已读取《总纲》与《设定总索引》。</p>
    </details>
  </div>`

// 旧实现：全局居中 Dialog + 全屏黑色遮罩（作为对照）。
const BEFORE = `
  <div id="before-backdrop" class="fixed inset-0 isolate z-50 bg-black/10"></div>
  <div id="before-popup" role="dialog" data-testid="outline-intent-dialog"
       class="fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm sm:max-w-sm">
    <div class="text-sm font-medium">请选择本次要生成哪一卷的折叠树卷纲。</div>
    <div class="flex flex-col gap-1.5">${OPTIONS}</div>
  </div>`

const page1 = panelShell({ panelId: "panel-after", popup: AFTER_POPUP })
const page2 = panelShell({ panelId: "panel-before", popup: "", backdrop: BEFORE })

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>${css}</style>
<style>body{margin:0;padding:24px;background:#eef1ee;display:flex;gap:24px;align-items:flex-start;font-family:system-ui}
.holder{background:#fff}</style>
</head><body>
<div class="holder" id="after-holder">${page1}</div>
<div class="holder" id="before-holder">${page2}</div>
</body></html>`

const htmlPath = join(OUT_DIR, "geometry-check.html")
writeFileSync(htmlPath, html, "utf8")

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`)

const measure = async (panelId, popupId, otherHolderId) =>
  page.evaluate(({ panelId, popupId, otherHolderId }) => {
    // 对照组的旧实现带全屏 fixed 遮罩，会盖住整个视口并抢走命中测试；
    // 量哪一侧就把另一侧隐藏，保证命中测试只反映被测实现。
    const other = document.getElementById(otherHolderId)
    if (other) other.style.display = "none"
    const panel = document.getElementById(panelId)
    const popup = document.getElementById(popupId)
    const input = document.getElementById(`${panelId}-input`)
    const composer = document.getElementById(`${panelId}-composer`)
    const p = panel.getBoundingClientRect()
    const d = popup.getBoundingClientRect()
    const i = input.getBoundingClientRect()
    const c = composer.getBoundingClientRect()
    const cs = getComputedStyle(popup)
    const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2)
    const result = {
      panel: { w: Math.round(p.width), h: Math.round(p.height), bottom: Math.round(p.bottom) },
      popup: {
        w: Math.round(d.width),
        h: Math.round(d.height),
        bottom: Math.round(d.bottom),
        position: cs.position,
        zIndex: cs.zIndex,
      },
      inputArea: { h: Math.round(i.height), top: Math.round(i.top) },
      // 浮层是否盖住输入框中心（层级高于输入区即命中浮层）
      hitIsPopup: popup.contains(hit),
      hitTag: hit ? `${hit.tagName.toLowerCase()}${hit.id ? "#" + hit.id : ""}` : "null",
      // 浮层是否铺满整个面板（全屏感）
      coversWholePanel: Math.abs(d.height - p.height) < 2,
      bottomAligned: Math.abs(d.bottom - p.bottom) < 2,
      widthMatchesPanel: Math.abs(d.width - p.width) < 2,
    }
    if (other) other.style.display = ""
    return result
  }, { panelId, popupId, otherHolderId })

const after = await measure("panel-after", "after-popup", "before-holder")
const before = await measure("panel-before", "before-popup", "after-holder")

// 全屏 fixed 遮罩检测：旧实现应有，新实现必须没有。
const beforeBackdrops = await page.evaluate(() =>
  Array.from(document.querySelectorAll("#before-holder *")).filter((el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return cs.position === "fixed" && r.width >= innerWidth - 4 && r.height >= innerHeight - 4
  }).length)
const afterBackdrops = await page.evaluate(() =>
  Array.from(document.querySelectorAll("#after-holder *")).filter((el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return cs.position === "fixed" && r.width >= innerWidth - 4 && r.height >= innerHeight - 4
  }).length)

await page.screenshot({ path: join(OUT_DIR, "popup-before-after.png"), fullPage: false })
await page.locator("#after-holder").screenshot({ path: join(OUT_DIR, "popup-after.png") })

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}  ${detail}`)
}

console.log("\n=== 修复前（全局居中 Dialog）===")
console.log("  ", JSON.stringify(before, null, 0))
console.log("\n=== 修复后（面板内锚定浮层）===")
console.log("  ", JSON.stringify(after, null, 0))

console.log("\n=== 断言 ===")
check("定位方式为 absolute（不再 fixed）", after.popup.position === "absolute", `position=${after.popup.position}（旧=${before.popup.position}）`)
check("宽度等于 AI 会话面板宽度", after.widthMatchesPanel, `浮层 ${after.popup.w}px / 面板 ${after.panel.w}px`)
check("底边贴面板底部", after.bottomAligned, `浮层底 ${after.popup.bottom} / 面板底 ${after.panel.bottom}`)
check("盖在输入框上层（命中测试落在浮层）", after.hitIsPopup, `输入框中心命中 ${after.hitTag}`)
check("不铺满面板（不是全屏）", !after.coversWholePanel, `浮层高 ${after.popup.h}px / 面板高 ${after.panel.h}px`)
check("浮层保留可见历史消息区", after.panel.h - after.popup.h > 100, `上方留白 ${after.panel.h - after.popup.h}px`)
check("无全屏 fixed 遮罩", afterBackdrops === 0, `新实现 ${afterBackdrops} 个（旧实现 ${beforeBackdrops} 个）`)
check("旧写法确实铺满全屏遮罩（对照）", beforeBackdrops > 0, `旧实现 ${beforeBackdrops} 个`)

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? "✅ 全部通过" : `❌ ${failed.length} 项未通过`}（共 ${results.length} 项）`)
console.log(`截图：${join("docs", "outline-intent-popup", "popup-before-after.png")}`)
process.exit(failed.length === 0 ? 0 : 1)
