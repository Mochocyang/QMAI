// 用真实 Chromium 检查拆书库顶部改版后的布局。
// 结果只来自 getBoundingClientRect，不看截图印象。
// playwright 是全局安装的，ESM 不认 NODE_PATH，所以按绝对路径引入。
import { pathToFileURL } from "node:url"
import { readFileSync } from "node:fs"
import path from "node:path"

const playwrightEntry = path.join(
  process.env.APPDATA ?? "",
  "npm/node_modules/playwright/index.js",
)
// 全局 playwright 是 CJS，作为 ESM 引入时可能挂在 default 上。
const playwrightModule = await import(pathToFileURL(playwrightEntry).href)
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium

const here = path.resolve("docs/book-workbench-relayout")
const markup = readFileSync(path.join(here, "dump.html"), "utf8")
const css = readFileSync(
  path.resolve("src/components/novel/book-analysis-workbench.css"),
  "utf8",
)

// 这套变量在软件里由主题提供；这里给出浅色皮肤的等价取值。
const themeVars = `
  /* 软件里由 Tailwind preflight 提供，静态检查要补上，否则量出来的宽度不可信。 */
  *,::before,::after{box-sizing:border-box}
  :root{
    --ui-paper:#fdfdfb; --ui-panel:#f4f6f4; --ui-line:#c6d1cb; --ui-accent:#496b59;
    --background:#fdfdfb; --muted:#f4f6f4;
  }
  body{margin:0;padding:24px;background:#eef1ef;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#24332e}
  .frame{width:1180px;margin:0 auto;background:var(--ui-paper);border:1px solid var(--ui-line);border-radius:10px;padding:0 26px 26px}
  /* 静态检查里让下拉菜单直接可见（真实交互由组件测试覆盖）。 */
  .wb-book-menu{display:block !important}
`

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>${themeVars}</style><style>${css}</style></head>
<body><div class="frame">${markup}</div></body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
const pageErrors = []
page.on("pageerror", (error) => pageErrors.push(String(error)))
await page.setContent(html, { waitUntil: "load" })

const { lines, failed } = await page.evaluate(() => {
  const out = []
  const log = (name, ok, detail) => out.push((ok ? "PASS  " : "FAIL  ") + name + (detail ? "  — " + detail : ""))
  const rect = (el) => el.getBoundingClientRect()
  const q = (s) => document.querySelector(s)
  const r1 = (n) => n.toFixed(1)

  const refresh = q('[aria-label="刷新作品"]')
  const importBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "导入作品")
  const delCurrent = q('[aria-label="删除当前作品"]')
  const meta = q(".wb-header .wb-muted")

  log("刷新作品在「导入作品」左侧",
    refresh && importBtn && rect(refresh).right <= rect(importBtn).left + 1,
    refresh && importBtn ? `refresh.right=${r1(rect(refresh).right)} import.left=${r1(rect(importBtn).left)}` : "缺少按钮")
  log("刷新作品与「导入作品」同一行对齐",
    refresh && importBtn && Math.abs(rect(refresh).top - rect(importBtn).top) < 2, "")
  log("不再存在「更多」菜单", q(".wb-management") === null)
  log("不再存在「旧版任务与结果」入口", q('[aria-label="旧版任务与结果"]') === null)

  log("删除当前作品按钮尺寸正常",
    delCurrent && rect(delCurrent).width <= 40 && rect(delCurrent).height <= 40,
    delCurrent ? `${r1(rect(delCurrent).width)}x${r1(rect(delCurrent).height)}` : "缺失")
  log("删除当前作品按钮在章字数右侧",
    delCurrent && meta && rect(meta).right <= rect(delCurrent).left + 1,
    delCurrent && meta ? `meta.right=${r1(rect(meta).right)} del.left=${r1(rect(delCurrent).left)}` : "")

  const option = q(".wb-book-option")
  const rowDelete = option && option.querySelector("button.wb-icon")
  const rowPick = option && option.querySelector("button:first-child")
  log("下拉列表每项都有删除按钮", !!rowDelete)
  log("下拉项删除按钮尺寸正常（未被菜单整行样式撑满）",
    rowDelete && rect(rowDelete).width <= 40,
    rowDelete ? `${r1(rect(rowDelete).width)}x${r1(rect(rowDelete).height)}` : "缺失")
  log("下拉项删除按钮贴在该行最右端",
    rowDelete && option && rect(rowDelete).right >= rect(option).right - 2,
    rowDelete && option ? `del.right=${r1(rect(rowDelete).right)} row.right=${r1(rect(option).right)}` : "")
  log("下拉项选中区比删除按钮宽（不重叠）",
    rowDelete && rowPick && rect(rowPick).width > rect(rowDelete).width,
    rowDelete && rowPick ? `pick=${r1(rect(rowPick).width)} del=${r1(rect(rowDelete).width)}` : "")
  // align-items:center 下两按钮高度不同，顶部本来就不会齐平；要检查的是同一行、垂直方向有重叠。
  log("下拉项两按钮在同一行（垂直方向重叠，未换行）",
    rowDelete && rowPick && rect(rowDelete).top < rect(rowPick).bottom && rect(rowDelete).bottom > rect(rowPick).top,
    rowDelete && rowPick ? `pick=[${r1(rect(rowPick).top)},${r1(rect(rowPick).bottom)}] del=[${r1(rect(rowDelete).top)},${r1(rect(rowDelete).bottom)}]` : "")
  log("下拉项删除按钮是正方形图标按钮",
    rowDelete && Math.abs(rect(rowDelete).width - rect(rowDelete).height) < 1,
    rowDelete ? `${r1(rect(rowDelete).width)}x${r1(rect(rowDelete).height)} 计算高度=${getComputedStyle(rowDelete).height}` : "")

  const toolbar = q(".wb-demand-toolbar")
  const model = toolbar && toolbar.querySelector(".wb-model")
  const primary = toolbar && toolbar.querySelector(".wb-primary")
  log("工具条内不再有「分析模型」字样", !!toolbar && !toolbar.textContent.includes("分析模型"))
  log("模型选择框紧接在「开始分析」之前", !!model && !!primary && model.nextElementSibling === primary)
  log("模型选择框与「开始分析」相邻且不重叠",
    model && primary && rect(model).right <= rect(primary).left + 1,
    model && primary ? `model.right=${r1(rect(model).right)} primary.left=${r1(rect(primary).left)}` : "")
  log("两者一起靠右（右侧留白小于左侧）",
    !!(model && primary && toolbar) && (rect(primary).right - rect(toolbar).left) > (rect(model).left - rect(toolbar).left),
    model && primary && toolbar ? `左空=${r1(rect(model).left - rect(toolbar).left)} 右空=${r1(rect(toolbar).right - rect(primary).right)}` : "")

  const results = q(".wb-results-section")
  const legacy = q(".wb-legacy")
  log("旧版结果区存在（常显）", !!legacy)
  log("旧版结果区在新版结果区下方",
    !!(results && legacy) && rect(legacy).top >= rect(results).top - 1,
    results && legacy ? `results.top=${r1(rect(results).top)} legacy.top=${r1(rect(legacy).top)}` : "")

  return { lines: out, failed: out.filter((l) => l.startsWith("FAIL")).length }
})

for (const line of lines) console.log(line)
console.log(`\n失败项：${failed}`)
if (pageErrors.length) console.log(`页面异常：${pageErrors.join(" | ")}`)
await page.screenshot({ path: path.join(here, "after-改版后.png"), fullPage: true })
await browser.close()
process.exit(failed === 0 && pageErrors.length === 0 ? 0 : 1)
