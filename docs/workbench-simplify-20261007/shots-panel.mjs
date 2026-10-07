/**
 * 拆书库结果面板简化后的截图（真机渲染，几何检查的视觉留痕）。
 * 运行：node docs/workbench-simplify-20261007/shots-panel.mjs
 */
import { readFileSync, readdirSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, "..", "..")
const outDir = join(here, "shots")
mkdirSync(outDir, { recursive: true })

let allCss = ""
for (const f of readdirSync(join(repo, "dist/assets"))) if (f.endsWith(".css")) allCss += readFileSync(join(repo, "dist/assets", f), "utf8") + "\n"
allCss += "\n" + readFileSync(join(repo, "src/components/novel/book-analysis-workbench.css"), "utf8")

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const browser = await (mod.chromium ?? mod.default.chromium).launch()

const card = (s, d) => `<article class="wb-skill-card"><div class="wb-card-main">
  <div class="wb-card-heading"><span class="wb-avatar" data-tone="0">${s[0]}</span>
    <h3>${s}<small class="wb-card-date"> · ${d}</small></h3>
    <span class="wb-card-status" data-confirmed="true">已入库</span></div>
  <p class="wb-card-description">在关键节点上的取舍与表达方式：他先算代价，再决定要不要承诺；一旦承诺就绝不回头。</p>
  <div class="wb-traits"><span>决策</span><span>表达</span><span>边界</span></div>
  <small>3条规则 · 5条依据</small></div>
  <footer class="wb-card-footer">
    <button aria-label="查看${s}规则">查看规则</button>
    <span class="wb-card-actions">
      <button class="wb-icon" aria-label="补充${s}修订要求">改</button>
      <button class="wb-icon wb-card-remove" aria-label="删除${s}">删</button>
    </span>
  </footer></article>`

// 一个版本 = 一个带网格的版本块（标题行已删，只剩卡片网格）
const block = (id, cards, view = "grid") => `<section class="wb-revision-block" data-revision-id="${id}">
  <div class="wb-skill-grid" data-view="${view}">${cards}</div></section>`

// 版本级内容：导图/规则详情/证据索引/补充修订；带年份的日期标签标明归属
const extras = (id, date) => `<section class="wb-revision-extras" data-revision-extras="${id}">
  <details class="wb-result"><summary>证据索引与实际覆盖</summary><p class="wb-muted">已读取90章、31个正文分段；规则引用12条原文。自动核验仍需人工复核。</p></details>
  <div class="wb-revision-section"><span class="wb-revision-date">${date}</span><button>补充修订</button></div></section>`

const oldCards = ["许七安|10/4 08:12", "怀庆长公主|10/4 08:12", "城防统领|10/4 08:12"].map((c) => card(...c.split("|"))).join("")
const newCards = ["许七安|10/7 09:03", "林烬|10/7 09:03", "一个非常非常长的角色名字用来试探溢出边界|10/7 09:03"].map((c) => card(...c.split("|"))).join("")

const HTML = (body) => `<!doctype html><html><head><style>${allCss}</style>
<style>body{margin:0;background:#f4f6f4;font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif}
.book-workbench{--ui-line:#c6d1cb;--ui-muted:#687871;--ui-accent:#496b59;--ui-paper:#fff;--ui-panel:#f2f5f3;--ui-ink:#1d2321;--ui-warning:#88641d;--ui-danger:#a83e3e;padding:18px;max-width:1180px;margin:0 auto}
h4{margin:22px 0 6px;font-size:13px;color:#5f6b66;font-weight:600}</style></head>
<body><div class="book-workbench">${body}</div></body></html>`

// 结果区工具条：页签 + **一份**视图切换（全版本平铺后不再每块一个开关）
const bar = `<section class="wb-section wb-results-section"><div class="wb-results-bar">
  <div class="wb-tabs" role="tablist" aria-label="分析结果">
    <button role="tab" aria-selected="true">角色 Skill</button>
    <button role="tab" aria-selected="false">文风 Skill</button>
    <button role="tab" aria-selected="false">故事 Skill</button>
  </div>
  <div class="wb-view-switch" role="group" aria-label="成果展示方式">
    <button class="wb-icon" title="卡片视图" aria-label="卡片视图" aria-pressed="true">▦</button>
    <button class="wb-icon" title="列表视图" aria-label="列表视图" aria-pressed="false">☰</button>
  </div>
</div>`

// 场景一：合并列表 —— 旧版在前、新版在后连成一份；版本级内容排在后面并带日期标签
const stacked = `<h4>合并列表：旧版本在前、新版本在后连成一份（每个对象名后带生成日期）</h4>` + bar +
  `<div class="wb-card-list">` +
  block("rev-old", oldCards) + block("rev-new", newCards) +
  `</div>` +
  `<h4 style="margin-top:26px">版本级内容排在合并列表之后（日期标签标明属于哪一版）</h4>` +
  extras("rev-old", "2026/10/4 08:12") + extras("rev-new", "2026/10/7 09:03") + `</section>`

for (const [w, h, name] of [[1280, 980, "panel-stacked-1280.png"], [760, 1100, "panel-stacked-760.png"]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.setContent(HTML(stacked))
  await page.waitForTimeout(120)
  await page.screenshot({ path: join(outDir, name), fullPage: true })
  await page.close()
  console.log("已写出", name)
}

// 场景二：删除确认弹窗（三个技能页三种文案）
for (const [label, title, body, name] of [
  ["角色", "从角色灵魂库删除「许七安」？", "将删除该角色的灵魂及其规则，并解除它已绑定的小说人物。此操作不可撤销。", "panel-delete-character.png"],
  ["文风", "删除文风预设《拆书库测试作品》 · 文风？", "将删除该文风预设。此操作不可撤销。", "panel-delete-style.png"],
]) {
  const page = await browser.newPage({ viewport: { width: 900, height: 620 } })
  await page.setContent(HTML(`<h4>删除确认弹窗（${label}页文案）</h4>` + block("rev-new", newCards.slice(0, 900)) + `
    <div style="position:fixed;inset:0;background:#0006;display:grid;place-items:center">
      <div style="background:#fff;border-radius:12px;padding:22px 24px;max-width:430px;box-shadow:0 12px 40px #0003">
        <div style="font-size:17px;font-weight:600;margin-bottom:8px">${title}</div>
        <p style="font-size:14px;color:#5f6b66;margin:0 0 18px">${body}</p>
        <div style="display:flex;gap:9px;justify-content:flex-end">
          <button>取消</button><button style="background:#a83e3e;color:#fff;border-color:transparent">删除</button>
        </div></div></div>`))
  await page.waitForTimeout(120)
  await page.screenshot({ path: join(outDir, name) })
  await page.close()
  console.log("已写出", name)
}

await browser.close()
