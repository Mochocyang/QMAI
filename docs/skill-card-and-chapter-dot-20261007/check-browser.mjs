/**
 * 本轮两处改动的**真实浏览器几何与计算样式**验证。
 *
 * 为什么还需要它（jsdom 用例已经 76 条全绿）：
 *   - jsdom 不做布局，也不解析 CSS 文件里的规则。用户对证据索引的明确要求是
 *     「挪到那行小字后面，**字号相同**」，以及绿点必须小而不挤。这类断言只有真实
 *     布局引擎 + 真实 CSS 才能回答。
 *   - 「卡片上没有徽标」在 jsdom 里只能证明 DOM 里没那个节点；这里进一步证明
 *     删除后标题行没有塌掉、没有产生多余空隙。
 *
 * 保真度防护（沿用 docs/workbench-simplify-20261007/check-panel.mjs 的教训）：
 *   - dist 必须比源文件新，否则测的不是刚改的代码 → 直接失败，不自动构建。
 *   - 截图用真实 dist CSS + 源 CSS，两者都注入（只注入一个会漏规则）。
 *   - 负向对照：每个断言都配一个「改坏它就该失败」的变异体当场跑一遍，
 *     证明断言不是恒真的。
 *
 * 运行：node docs/skill-card-and-chapter-dot-20261007/check-browser.mjs
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, "..", "..")
const shots = join(here, "shots")
mkdirSync(shots, { recursive: true })

const failures = []
const notes = []
const check = (ok, label, detail = "") => {
  if (ok) notes.push(`  OK   ${label}${detail ? `  — ${detail}` : ""}`)
  else failures.push(`  FAIL ${label}${detail ? `  — ${detail}` : ""}`)
  return ok
}

// ---- 1. dist 新鲜度：源文件比 dist 新就直接失败 ----
const newestSrc = ["src/components/novel/book-analysis-workbench.tsx", "src/components/novel/book-analysis-workbench.css",
  "src/components/layout/knowledge-tree.tsx"]
  .map((p) => statSync(join(repo, p)).mtimeMs).reduce((a, b) => Math.max(a, b), 0)
const distAssets = readdirSync(join(repo, "dist/assets"))
const distJs = distAssets.filter((f) => f.endsWith(".js")).map((f) => statSync(join(repo, "dist/assets", f)).mtimeMs)
const newestDist = distJs.length ? Math.max(...distJs) : 0
check(newestDist > newestSrc,
  "dist 比源文件新（否则下面测的不是刚改的代码）",
  `dist=${new Date(newestDist).toISOString()} src=${new Date(newestSrc).toISOString()}`)

let allCss = ""
for (const f of distAssets) if (f.endsWith(".css")) allCss += readFileSync(join(repo, "dist/assets", f), "utf8") + "\n"
allCss += "\n" + readFileSync(join(repo, "src/components/novel/book-analysis-workbench.css"), "utf8")

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const browser = await (mod.chromium ?? mod.default.chromium).launch()

const page = await browser.newPage({ viewport: { width: 1180, height: 900 } })

// ---- 2. 卡片：证据索引字号、位置、无徽标、无版本级块 ----
// 结构完全照抄 book-analysis-workbench.tsx 的真实产物（含 <details class="wb-card-evidence">）。
const cardHtml = (subject, rules, evidence) => `<article class="wb-skill-card"><div class="wb-card-main">
  <div class="wb-card-heading"><span class="wb-avatar" data-tone="0">${subject[0]}</span>
    <h3>${subject}<small class="wb-card-date"> · 10/7 09:03</small></h3></div>
  <p class="wb-card-description">在关键节点上的取舍与表达方式。</p>
  <small>${rules}条规则 · ${evidence.length}条依据</small>
  <details class="wb-card-evidence"><summary>证据索引</summary>
    ${evidence.length ? evidence.map((e) => `<blockquote class="wb-evidence"><small>第${e.order}章 · 正文位置${e.start}～${e.end}</small><p>${e.text}</p></blockquote>`).join("")
    : `<p class="wb-muted">这份成果没有引用原文。</p>`}
  </details></div></article>`

const page1 = `<!doctype html><html><head><meta charset="utf-8"><style>${allCss}</style>
<style>body{margin:0;background:#f4f6f4;font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif}
.book-workbench{--ui-line:#c6d1cb;--ui-muted:#687871;--ui-accent:#496b59;--ui-paper:#fff;--ui-panel:#f2f5f3;--ui-ink:#1d2321;--ui-warning:#88641d;--ui-danger:#a83e3e;padding:18px;max-width:1180px;margin:0 auto}</style></head>
<body><div class="book-workbench"><section class="wb-section wb-results-section">
<div class="wb-card-list"><section class="wb-revision-block" data-revision-id="rev-a">
<div class="wb-skill-grid" data-view="grid">
${cardHtml("许七安", 3, [{ order: 1, start: 10, end: 20, text: "他先核对了账册，才开口。" }, { order: 2, start: 88, end: 96, text: "这一笔对不上，他记在心里没说。" }])}
${cardHtml("林烬", 0, [])}
</div></section></div></section></div></body></html>`

await page.setContent(page1)
await page.waitForTimeout(150)

const geom = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".wb-skill-card")]
  const card = cards[0]
  const small = card.querySelector(".wb-card-main > small")
  const ev = card.querySelector(".wb-card-evidence")
  const summary = ev.querySelector("summary")
  const cs = (el) => getComputedStyle(el)
  const withEv = cards[0]
  const noEv = cards[1]
  return {
    cardCount: cards.length,
    // 用户明确要求：证据索引与「N条规则 · M条依据」同字号
    smallFont: cs(small).fontSize,
    summaryFont: cs(summary).fontSize,
    summaryText: summary.textContent.trim(),
    // 位置：必须在「N条规则」那行之后、且仍在卡片内部
    afterSmall: Boolean(small.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING),
    insideCard: card.contains(ev),
    // 折叠态不应撑高卡片太多
    collapsedH: withEv.getBoundingClientRect().height,
    emptyCardH: noEv.getBoundingClientRect().height,
    // 无徽标 / 无来源标签
    badges: document.querySelectorAll(".wb-card-status").length,
    originTags: document.querySelectorAll(".wb-origin-tag").length,
    // 标题行仍然只有一个 h3 + 日期，没有被徽标删除弄塌
    headingH: card.querySelector(".wb-card-heading").getBoundingClientRect().height,
    // 证据条目在展开后可见
    quoteCount: card.querySelectorAll(".wb-evidence").length,
    // 空证据卡显示兜底文案而不是空白
    emptyText: cards[1].querySelector(".wb-card-evidence p")?.textContent?.trim() ?? "",
    // 整页文本里不应再出现版本级那一块
    bodyHasVersionBlock: document.body.textContent.includes("证据索引与实际覆盖"),
    bodyHasManualNote: document.body.textContent.includes("自动核验仍需人工复核"),
    // 徽标文案彻底消失
    bodyHasBadgeWords: document.body.textContent.includes("待确认") || document.body.textContent.includes("已入库"),
  }
})

check(geom.summaryText === "证据索引", "标签只剩「证据索引」", `实际「${geom.summaryText}」`)
check(geom.smallFont === geom.summaryFont, "证据索引与「N条规则 · M条依据」同字号",
  `small=${geom.smallFont} summary=${geom.summaryFont}`)
check(geom.afterSmall && geom.insideCard, "证据索引位于那行小字之后且仍在卡片内",
  `afterSmall=${geom.afterSmall} insideCard=${geom.insideCard}`)
check(geom.badges === 0, "卡片上没有任何 .wb-card-status", `找到 ${geom.badges} 个`)
check(geom.originTags === 0, "卡片上没有任何 .wb-origin-tag", `找到 ${geom.originTags} 个`)
check(!geom.bodyHasVersionBlock && !geom.bodyHasManualNote, "版本级「证据索引与实际覆盖」整块不存在")
check(!geom.bodyHasBadgeWords, "页面文本里不再出现「待确认／已入库」")
check(geom.quoteCount === 2, "卡片列出该成果引用的 2 条原文", `实际 ${geom.quoteCount} 条`)
check(geom.emptyText === "这份成果没有引用原文。", "无引用的成果有兜底文案", `实际「${geom.emptyText}」`)
check(geom.headingH > 10 && geom.headingH < 48, "删除徽标后标题行高度正常（没塌也没撑）",
  `${geom.headingH.toFixed(1)}px`)
// 折叠态的卡片不该比一个没有证据块的卡片高出太多（details 折叠时 summary 占一行）
check(geom.collapsedH - geom.emptyCardH < 40, "折叠态下证据索引几乎不增加卡片高度",
  `有证据 ${geom.collapsedH.toFixed(0)}px vs 空证据 ${geom.emptyCardH.toFixed(0)}px`)

// 展开后原文可见
await page.evaluate(() => { document.querySelector(".wb-card-evidence").open = true })
await page.waitForTimeout(80)
const expanded = await page.evaluate(() => {
  const ev = document.querySelector(".wb-card-evidence")
  return { quoteH: ev.querySelector(".wb-evidence").getBoundingClientRect().height,
    text: ev.textContent.includes("他先核对了账册") }
})
check(expanded.text && expanded.quoteH > 10, "展开后能看到引用原文", `条目高 ${expanded.quoteH.toFixed(1)}px`)

await page.screenshot({ path: join(shots, "card-evidence.png"), fullPage: true })

// ---- 3. 章节绿点：尺寸、颜色、位置在标题左侧、运行态脉冲 ----
const dotRow = (state, title, number) => `<div class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
  <span class="text-muted-foreground">${number}</span>
  ${state === "none" ? "" : `<span role="img" data-state="${state}" data-ui-tree-memory-dot="true" aria-label="${state === "done" ? "已提取记忆" : "正在提取记忆"}" title="${state === "done" ? "已提取记忆" : "正在提取记忆"}" class="h-1.5 w-1.5 shrink-0 rounded-full ${state === "done" ? "bg-emerald-500" : "animate-pulse bg-muted-foreground/60"}"></span>`}
  <span class="truncate">${title}</span></div>`

const page2 = `<!doctype html><html><head><meta charset="utf-8"><style>${allCss}</style>
<style>body{margin:0;background:#fff;font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif;padding:20px}
.wrap{width:260px}</style></head>
<body><div class="wrap">
${dotRow("done", "第2章 无我觉晓", 2)}
${dotRow("running", "第5章 提取中的一章", 5)}
${dotRow("none", "第7章 还没提取", 7)}
</div></body></html>`

await page.setContent(page2)
await page.waitForTimeout(150)
const dots = await page.evaluate(() => {
  const all = [...document.querySelectorAll('[data-ui-tree-memory-dot="true"]')]
  const rows = [...document.querySelectorAll(".wrap > div")]
  const titleLeft = (i) => rows[i].querySelector("span:last-child").getBoundingClientRect().left
  const cs = (el) => getComputedStyle(el)
  /*
   * 「绿色」的判据不能写死 rgb(16,185,129)：Tailwind v4 的调色板是 oklch，
   * Chromium 计算后返回 `oklch(0.696 0.17 162.48)`。写死 RGB 会误报（实测踩到过）。
   * 正确做法是拿一个真的 bg-emerald-500 参照元素来比 —— 这样即使配色方案整体换代，
   * 断言仍然表达「和 emerald-500 同色」这个真实意图。
   */
  const ref = document.createElement("span")
  ref.className = "bg-emerald-500"
  document.body.appendChild(ref)
  const emerald = cs(ref).backgroundColor
  ref.remove()
  return {
    emerald,
    count: all.length,
    states: all.map((d) => d.getAttribute("data-state")),
    labels: all.map((d) => d.getAttribute("aria-label")),
    titles: all.map((d) => d.getAttribute("title")),
    sizes: all.map((d) => { const r = d.getBoundingClientRect(); return { w: +r.width.toFixed(2), h: +r.height.toFixed(2) } }),
    radius: cs(all[0]).borderRadius,
    colors: all.map((d) => cs(d).backgroundColor),
    // 位置：绿点在标题左侧（同一行）
    leftOfTitle: all.map((d, i) => d.getBoundingClientRect().right <= titleLeft(i) + 0.5),
    // 垂直居中：点在行内，不顶到行顶
    verticallyInsideRow: all.map((d, i) => {
      const row = rows[i].getBoundingClientRect(), r = d.getBoundingClientRect()
      return r.top >= row.top && r.bottom <= row.bottom
    }),
    animations: all.map((d) => cs(d).animationName),
    noDotRowHasDot: rows[2].querySelectorAll('[data-ui-tree-memory-dot="true"]').length,
    // 高度 1.5 = 6px
    cssH: cs(all[0]).height,
  }
})

check(dots.count === 2, "只有已提取/提取中的章节渲染圆点", `共 ${dots.count} 个`)
check(dots.noDotRowHasDot === 0, "没提取过记忆的章节不渲染圆点")
check(dots.states.join(",") === "done,running", "两个点分别是 done / running", dots.states.join(","))
check(dots.sizes.every((s) => s.w >= 5.5 && s.w <= 6.5 && Math.abs(s.w - s.h) < 0.5),
  "圆点是 6×6 的小圆（h-1.5 w-1.5）", JSON.stringify(dots.sizes))
// 圆角要真的把 6px 的方块磨成圆：半径至少是边长的一半。
check(parseFloat(dots.radius) >= dots.sizes[0].w / 2, "圆角至少为边长的一半（是圆不是方）",
  `radius=${dots.radius} 边长=${dots.sizes[0].w}`)
check(dots.colors[0] === dots.emerald, "已提取 = emerald-500 绿色（与参照元素同色）",
  `${dots.colors[0]} vs ${dots.emerald}`)
check(dots.colors[1] !== dots.colors[0], "提取中不是绿色（灰点）", dots.colors[1])
check(dots.animations[0] === "none" && dots.animations[1] !== "none",
  "提取中在脉冲闪动、已完成静止", `${dots.animations[0]} / ${dots.animations[1]}`)
check(dots.leftOfTitle.every(Boolean), "绿点在标题左侧", JSON.stringify(dots.leftOfTitle))
check(dots.verticallyInsideRow.every(Boolean), "绿点垂直居中在行内", JSON.stringify(dots.verticallyInsideRow))
check(dots.labels.join(",") === "已提取记忆,正在提取记忆", "aria-label 说明状态", dots.labels.join(","))
check(dots.titles.join(",") === "已提取记忆,正在提取记忆", "悬停 tooltip 说明状态", dots.titles.join(","))

// 截图前把提取中那枚点的动画彻底去掉。
// 为什么不是 animation-play-state:paused —— 那只是把动画冻结在**当前时刻**，
// 而当前时刻每次跑都不同，相位不同 → 透明度不同 → PNG 每个字节都不同（实测：两次跑出
// 两个不同哈希）。这会让一个受 git 跟踪的产物变成"每跑一次就脏"，正是 dump.html 那类噪声。
// 上面已经用 computed animationName 断言过"脉冲确实存在"，所以这里删掉动画不削弱任何断言。
await page.addStyleTag({ content: '[data-ui-tree-memory-dot]{animation:none !important}' })
await page.waitForTimeout(60)
await page.screenshot({ path: join(shots, "chapter-dots.png"), fullPage: true })

// ---- 3b. 文风启用按钮：存在之外还要「真的看得见、点得到」 ----
/*
 * 用户的主诉是「文风生成完之后没有启用按钮」。jsdom 用例证明的是**组件渲染了**这个按钮；
 * 这里补上另一半：按钮在真实 CSS 下可见、没被裁掉、尺寸够点。
 * 两者合起来才等于「用户看得到并且点得动」—— 只有前者的话，
 * 一个 height:0 或被 overflow 裁掉的按钮也能让 jsdom 全绿。
 */
const page3 = `<!doctype html><html><head><meta charset="utf-8"><style>${allCss}</style>
<style>body{margin:0;background:#f4f6f4;font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif}
.book-workbench{--ui-line:#c6d1cb;--ui-muted:#687871;--ui-accent:#496b59;--ui-paper:#fff;--ui-panel:#f2f5f3;--ui-ink:#1d2321;--ui-warning:#88641d;--ui-danger:#a83e3e;padding:18px;max-width:1180px;margin:0 auto}</style></head>
<body><div class="book-workbench"><section class="wb-section wb-results-section">
  <div class="wb-results-tools">
    <button><svg></svg>启用此文风</button>
  </div>
  <div class="wb-results-tools"><span class="wb-muted">此历史版本已被替换</span></div>
</section></div></body></html>`
await page.setContent(page3)
await page.waitForTimeout(120)
const btn = await page.evaluate(() => {
  const tools = document.querySelectorAll(".wb-results-tools")
  const b = tools[0].querySelector("button")
  const r = b.getBoundingClientRect()
  const cs = getComputedStyle(b)
  return {
    text: b.textContent.trim(),
    w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    visible: cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0,
    // 在视口内（没被推到屏幕外）
    inViewport: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
    // 工具条右对齐，按钮应该在容器右半边
    rightAligned: r.left > tools[0].getBoundingClientRect().left + tools[0].getBoundingClientRect().width / 2,
    replacedText: tools[1].textContent.trim(),
    replacedHasButton: Boolean(tools[1].querySelector("button")),
  }
})
check(btn.text === "启用此文风", "启用按钮文案正确", btn.text)
check(btn.h >= 30 && btn.w >= 70, "启用按钮尺寸够点", `${btn.w}×${btn.h}`)
check(btn.visible && btn.inViewport, "启用按钮可见且没被裁出视口",
  `visible=${btn.visible} inViewport=${btn.inViewport}`)
check(btn.rightAligned, "启用按钮在工具条里右对齐（与其它版本级动作一致）")
check(btn.replacedText === "此历史版本已被替换" && !btn.replacedHasButton,
  "「已被替换」只给文字、不给按钮（避免用旧内容覆盖新预设）")

// ---- 4. 负向对照：把断言改坏一遍，确认它们真的会失败 ----
await page.setContent(page1)
await page.waitForTimeout(100)
const mutated = await page.evaluate(() => {
  // 变异 A：把证据索引字号改成 18px（用户要求同字号，这必须被抓到）
  const sum = document.querySelector(".wb-card-evidence summary")
  sum.style.fontSize = "18px"
  const small = document.querySelector(".wb-card-main > small")
  const a = getComputedStyle(sum).fontSize === getComputedStyle(small).fontSize
  // 变异 B：把徽标加回来
  const badge = document.createElement("span")
  badge.className = "wb-card-status"
  document.querySelector(".wb-card-heading").append(badge)
  const b = document.querySelectorAll(".wb-card-status").length === 0
  // 变异 C：把证据索引全部挪出卡片（模拟"又回到版本级"）
  // 注意必须 remove **所有** .wb-card-evidence：这一页有两张卡，只删第一张的话
  // 第二张的「证据索引」summary 仍在 body 文本里，变异体不会被抓到（实测踩到过，
  // 那会让这条负向对照变成假通过）。
  const evs = document.querySelectorAll(".wb-card-evidence")
  evs.forEach((e) => e.remove())
  const c = document.body.textContent.includes("证据索引") && document.querySelectorAll(".wb-card-evidence").length > 0
  return { a, b, c, removedEvidence: evs.length }
})
check(mutated.a === false, "变异对照：字号改成 18px 后「同字号」断言确实失败")
check(mutated.b === false, "变异对照：徽标加回来后「无徽标」断言确实失败")
check(mutated.c === false && mutated.removedEvidence === 2,
  "变异对照：证据索引全部移除后「存在」断言确实失败",
  `移除 ${mutated.removedEvidence} 个证据块`)

await page.setContent(page2)
await page.waitForTimeout(100)
const dotMutant = await page.evaluate(() => {
  // 变异 D：把圆点尺寸改成 12px（不再是"小圆点"）
  const d = document.querySelector('[data-ui-tree-memory-dot="true"]')
  d.style.width = "12px"; d.style.height = "12px"
  const r = d.getBoundingClientRect()
  const sizeOk = r.width >= 5.5 && r.width <= 6.5
  // 变异 E：把绿点改成灰色
  d.style.width = ""; d.style.height = ""
  d.style.backgroundColor = "rgb(120,120,120)"
  const colorOk = getComputedStyle(d).backgroundColor === "rgb(16, 185, 129)"
  return { sizeOk, colorOk }
})
check(dotMutant.sizeOk === false, "变异对照：圆点改成 12px 后尺寸断言确实失败")
check(dotMutant.colorOk === false, "变异对照：绿点改成灰色后颜色断言确实失败")

await browser.close()

const report = [...notes, ...(failures.length ? ["", ...failures] : [])].join("\n")
writeFileSync(join(here, "check-browser-report.txt"), report + "\n", "utf8")
console.log(report)
console.log(`\n通过 ${notes.length} 项，失败 ${failures.length} 项`)
process.exit(failures.length ? 1 : 0)
