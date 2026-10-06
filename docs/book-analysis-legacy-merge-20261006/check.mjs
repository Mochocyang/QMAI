// 用真实 Chromium 检查「旧版结果并入新版页签」之后的布局。
//
// 上一轮（docs/book-workbench-relayout/check.mjs）手写了一份 dump.html，
// 组件改完后快照没人更新，脚本却照样报 0 失败——等于拿旧 DOM 当证据。
// 这里改成两步，避免同样的问题：
//   1) dump.html 由 dump-legacy-markup.spec.tsx 用**真实组件**渲染生成；
//   2) 本脚本只负责把真实 CSS + 真实 markup 放进浏览器量尺寸。
//
// markup 用 page.setContent 内联注入：file:// 下 fetch 会被拦。
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

const here = path.resolve("docs/book-analysis-legacy-merge-20261006")
const markup = readFileSync(path.join(here, "dump.html"), "utf8")
const css = readFileSync(
  path.resolve("src/components/novel/book-analysis-workbench.css"),
  "utf8",
)

/**
 * 导入弹窗的宽度规则紧贴在 .wb-legacy 那几条规则上方（css:69）。
 * Task 8 按行号删样式时很容易把它一起删掉，而没有任何用例断言这个宽度，
 * 所以这里单独钉一条。它需要 html[data-ui-test-skin] 才会命中。
 */
const importDialogMarkup =
  '<div data-slot="dialog-content" class="wb-import-dialog" style="position:absolute;left:-9999px">导入弹窗</div>'

// 这套变量在软件里由主题提供；这里给出浅色皮肤的等价取值。
const themeVars = `
  /* 软件里由 Tailwind preflight 提供，静态检查要补上，否则量出来的宽度不可信。 */
  *,::before,::after{box-sizing:border-box}
  /* Tailwind 工具类同样不在静态页面里。角色面板靠 class="grid" 才是网格容器，
     不补上的话 display 仍是 block，量到的 grid-template-columns 只是声明值（"…1fr"），
     两栏/单列都无从判断——断言就会变成看字符串猜。 */
  .grid{display:grid}
  .min-h-0{min-height:0}
  .flex-1{flex:1 1 0%}
  :root{
    --ui-paper:#fdfdfb; --ui-panel:#f4f6f4; --ui-line:#c6d1cb; --ui-accent:#496b59;
    --background:#fdfdfb; --muted:#f4f6f4;
  }
  body{margin:0;padding:24px;background:#eef1ef;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#24332e}
`

const html = `<!doctype html><html lang="zh-CN" data-ui-test-skin="light"><head><meta charset="utf-8">
<style>${themeVars}</style><style>${css}</style></head>
<body>${markup}${importDialogMarkup}</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
const pageErrors = []
page.on("pageerror", (error) => pageErrors.push(String(error)))
await page.setContent(html, { waitUntil: "load" })

const { lines, failed } = await page.evaluate(() => {
  const out = []
  const log = (name, ok, detail) => out.push((ok ? "PASS  " : "FAIL  ") + name + (detail ? "  — " + detail : ""))
  const rect = (el) => el.getBoundingClientRect()
  const r1 = (n) => n.toFixed(1)
  const groups = [...document.querySelectorAll("[data-skill]")]

  log("快照里三个页签都在", groups.length === 3, `找到 ${groups.length} 组`)

  const MANAGEMENT = ["重新提取文风", "启用此文风", "取消启用", "删除文风", "选择角色生成 Skill", "自定义灵魂库"]

  // —— 每个页签各自的旧版结果区 ——
  for (const group of groups) {
    const skill = group.dataset.skill
    const results = group.querySelector(".wb-results-section")
    const legacy = group.querySelector(".wb-legacy-results")
    const hint = group.querySelector(".wb-legacy-hint")

    log(`[${skill}] 旧版结果区在结果区内部`, !!(results && legacy) && results.contains(legacy))
    log(`[${skill}] 旧版结果区带 role=region 与可访问名`,
      legacy?.getAttribute("role") === "region" && legacy?.getAttribute("aria-label") === "旧版资料")

    // 管理类控件必须全部消失（本组件刻意不传任何管理回调）
    const labels = legacy ? [...legacy.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "") : []
    const leaked = MANAGEMENT.filter((text) => labels.some((label) => label.includes(text)))
    log(`[${skill}] 旧版结果区不出现任何管理类控件`, leaked.length === 0, leaked.join("、"))
    log(`[${skill}] 旧版结果区不出现逐条「删除」`, !labels.includes("删除"), labels.join(" | "))

    // 旧版结果在新版结果下方
    const newResult = results?.querySelector(".wb-muted")
    log(`[${skill}] 旧版结果区排在新版结果下方`,
      !!(newResult && legacy) && rect(legacy).top >= rect(newResult).bottom - 1,
      newResult && legacy ? `new.bottom=${r1(rect(newResult).bottom)} legacy.top=${r1(rect(legacy).top)}` : "")

    // 「旧版资料」提示的上边距必须被压成 0：
    // .book-workbench p{margin:8px 0} 特异性 0,1,1 会压过单独的 .wb-legacy-hint（0,1,0）。
    // 这条只有真实浏览器算得出计算值，jsdom 查不出来。
    log(`[${skill}] 「旧版资料」上边距被压成 0`,
      !!hint && getComputedStyle(hint).marginTop === "0px",
      hint ? `margin-top=${getComputedStyle(hint).marginTop}` : "缺少提示元素")
  }

  // —— 旧区块必须彻底不存在 ——
  log("不再存在 .wb-legacy 旧区块", document.querySelector(".wb-legacy") === null)
  log("不再出现「旧版结果」区块标题", !document.body.textContent.includes("旧版结果"))

  // —— 页签内保留的预览开关 ——
  const storyGroup = groups.find((g) => g.dataset.skill === "story")
  const storyLabels = storyGroup
    ? [...storyGroup.querySelectorAll(".wb-legacy-results button")].map((b) => b.textContent?.trim() ?? "")
    : []
  log("故事页签保留「查看全部」预览开关", storyLabels.includes("查看全部"), storyLabels.join(" | "))
  log("故事页签渲染出历史导图列表", !!storyGroup?.querySelector('[aria-label="故事导图历史列表"]'))

  // —— 角色页签仍是两栏（内联值就是两栏，不该被旧版的单列规则压掉）——
  const charGroup = groups.find((g) => g.dataset.skill === "characters")
  const grid = charGroup?.querySelector('[style*="grid-template-columns"]')
  log("角色页签在宽容器下保持两栏",
    !!grid && getComputedStyle(grid).gridTemplateColumns.split(" ").length === 2,
    grid ? `columns=${getComputedStyle(grid).gridTemplateColumns}` : "缺少网格容器")

  // —— 导入弹窗宽度规则不能被样式清理误删 ——
  const dialog = document.querySelector(".wb-import-dialog")
  log("导入弹窗宽度规则仍然生效（未被按行号删样式误删）",
    !!dialog && getComputedStyle(dialog).maxWidth === "640px",
    dialog ? `max-width=${getComputedStyle(dialog).maxWidth}` : "缺少弹窗元素")

  return { lines: out, failed: out.filter((l) => l.startsWith("FAIL")).length }
})

for (const line of lines) console.log(line)
console.log(`\n失败项：${failed}`)
if (pageErrors.length) console.log(`页面异常：${pageErrors.join(" | ")}`)
await page.screenshot({ path: path.join(here, "after-旧版并入页签.png"), fullPage: true })

// 窄容器下角色页签应收成单列：换个视口再量一次。
const narrow = await (async () => {
  const p = await browser.newPage({ viewport: { width: 620, height: 1000 } })
  await p.setContent(html, { waitUntil: "load" })
  const result = await p.evaluate(() => {
    const group = [...document.querySelectorAll("[data-skill]")].find((g) => g.dataset.skill === "characters")
    const grid = group?.querySelector('[style*="grid-template-columns"]')
    return {
      columns: grid ? getComputedStyle(grid).gridTemplateColumns : "",
      hintMargin: group ? getComputedStyle(group.querySelector(".wb-legacy-hint")).marginTop : "",
    }
  })
  await p.close()
  return result
})()
const narrowColumns = narrow.columns.trim().split(/\s+/).filter(Boolean).length
console.log(`\n窄容器（620px）角色页签列数：${narrowColumns}  — ${narrow.columns}`)
console.log(`窄容器「旧版资料」上边距：${narrow.hintMargin}`)

await browser.close()
const narrowOk = narrowColumns === 1 && narrow.hintMargin === "0px"
console.log(`窄容器断言：${narrowOk ? "PASS" : "FAIL"}`)
process.exit(failed === 0 && pageErrors.length === 0 && narrowOk ? 0 : 1)
