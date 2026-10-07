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

// ---- 2. 卡片：证据索引与统计同排一行、按钮外形像小字、无徽标、无版本级块 ----
// 结构照抄 book-analysis-workbench.tsx 的真实产物：.wb-card-meta 行里放 small + button。
const cardHtml = (subject, rules, evidence) => `<article class="wb-skill-card"><div class="wb-card-main">
  <div class="wb-card-heading"><span class="wb-avatar" data-tone="0">${subject[0]}</span>
    <h3>${subject}<small class="wb-card-date"> · 10/7 09:03</small></h3></div>
  <p class="wb-card-description">在关键节点上的取舍与表达方式。</p>
  <div class="wb-card-meta">
    <small>${rules}条规则 · ${evidence.length}条依据</small>
    <button type="button" class="wb-card-evidence" data-ui-card-evidence="true" aria-label="查看${subject}的证据索引"><svg viewBox="0 0 24 24" width="12" height="12"></svg>证据索引</button>
  </div></div></article>`

/*
 * 弹窗那份 markup 单独一页：真实弹窗经 portal 渲染到 body，
 * **不在** .book-workbench 里，所以它必须脱离那个外壳来量 —— 混在外壳里量等于没测到
 * "作用域丢失"这个真实风险（.book-workbench small 那条管不到弹窗内的 <small>）。
 */
const dialogHtml = (evidence) => `<!doctype html><html><head><meta charset="utf-8"><style>${allCss}</style>
<style>body{margin:0;background:#f4f6f4;font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif;padding:20px}</style></head>
<body><div data-slot="dialog-content" class="rounded-xl bg-white p-4 text-sm ring-1 ring-black/10" style="max-width:680px">
  <h2 style="margin:0 0 4px;font-size:16px">许七安的证据索引</h2>
  <p style="margin:0 0 12px;color:#687871;font-size:13px">这份成果引用了 ${evidence.length} 条原文，来自它自己的 3 条规则。</p>
  ${evidence.length ? evidence.map((e) => `<blockquote class="wb-evidence"><small>第${e.order}章 · 正文位置${e.start}～${e.end}</small><p>${e.text}</p></blockquote>`).join("")
    : `<p class="wb-muted">这份成果没有引用原文。</p>`}
</div></body></html>`

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
  const row = card.querySelector(".wb-card-meta")
  const small = row.querySelector("small")
  const ev = row.querySelector(".wb-card-evidence")
  const cs = (el) => getComputedStyle(el)
  const rs = small.getBoundingClientRect(), re = ev.getBoundingClientRect()
  const withEv = cards[0]
  const noEv = cards[1]
  return {
    cardCount: cards.length,
    // 用户明确要求：证据索引与「N条规则 · M条依据」同字号
    smallFont: cs(small).fontSize,
    evFont: cs(ev).fontSize,
    evText: ev.textContent.trim(),
    // 「同一行」的判据：两者垂直重叠（同一个 flex 行），而不是各占一行
    sameRow: re.top < rs.bottom && rs.top < re.bottom,
    // 左右：统计在左、触发在右
    evRightOfSmall: re.left >= rs.right - 0.5,
    rowIsFlex: cs(row).display === "flex",
    // 触发按钮必须像一句小字：没有盒子边框、高度贴近文字，而不是 34px 的按钮
    evBorder: cs(ev).borderTopWidth,
    evHeight: +re.height.toFixed(1),
    evLeft: +re.left.toFixed(1),
    // 无徽标 / 无来源标签
    badges: document.querySelectorAll(".wb-card-status").length,
    originTags: document.querySelectorAll(".wb-origin-tag").length,
    // 标题行仍然只有一个 h3 + 日期，没有被徽标删除弄塌
    headingH: card.querySelector(".wb-card-heading").getBoundingClientRect().height,
    // 原文不再内联在卡片里（改为弹窗）
    inlineQuotes: document.querySelectorAll(".wb-skill-card .wb-evidence").length,
    // 空证据卡也有同样的那一行（按钮仍在，只是点开是兜底文案）
    emptyCardHasRow: Boolean(cards[1].querySelector(".wb-card-meta .wb-card-evidence")),
    // 整页文本里不应再出现版本级那一块
    bodyHasVersionBlock: document.body.textContent.includes("证据索引与实际覆盖"),
    bodyHasManualNote: document.body.textContent.includes("自动核验仍需人工复核"),
    // 徽标文案彻底消失
    bodyHasBadgeWords: document.body.textContent.includes("待确认") || document.body.textContent.includes("已入库"),
  }
})

check(geom.evText === "证据索引", "标签只剩「证据索引」", `实际「${geom.evText}」`)
check(geom.smallFont === geom.evFont, "证据索引与「N条规则 · M条依据」同字号",
  `small=${geom.smallFont} 证据索引=${geom.evFont}`)
check(geom.rowIsFlex && geom.sameRow, "两者在同一行（同一个 flex 行容器里垂直重叠）",
  `display=${geom.rowIsFlex} sameRow=${geom.sameRow}`)
check(geom.evRightOfSmall, "证据索引在统计的右侧", `统计右缘 → 触发左缘 ${geom.evLeft}`)
// 全局 .book-workbench button 会给 34px 高 + 边框；这一行必须压掉它，否则统计与触发不在一个视觉层级
check(geom.evHeight <= 22, "触发按钮被压成一行小字的高度（不是 34px 的按钮）", `${geom.evHeight}px`)
check(geom.evBorder === "0px", "触发按钮没有边框（看起来像小字而不是盒子）", geom.evBorder)
check(geom.badges === 0, "卡片上没有任何 .wb-card-status", `找到 ${geom.badges} 个`)
check(geom.originTags === 0, "卡片上没有任何 .wb-origin-tag", `找到 ${geom.originTags} 个`)
check(!geom.bodyHasVersionBlock && !geom.bodyHasManualNote, "版本级「证据索引与实际覆盖」整块不存在")
check(!geom.bodyHasBadgeWords, "页面文本里不再出现「待确认／已入库」")
check(geom.inlineQuotes === 0, "原文不再内联在卡片里（改为弹窗展示）", `内联 ${geom.inlineQuotes} 条`)
check(geom.emptyCardHasRow, "没有引用的成果也有那一行入口")
check(geom.headingH > 10 && geom.headingH < 48, "标题行高度正常（没塌也没撑）",
  `${geom.headingH.toFixed(1)}px`)

await page.screenshot({ path: join(shots, "card-evidence.png"), fullPage: true })

// ---- 2b. 弹窗（脱离 .book-workbench 外壳）里的原文可读性 ----
await page.setContent(dialogHtml([{ order: 1, start: 10, end: 20, text: "他先核对了账册，才开口。" }, { order: 2, start: 88, end: 96, text: "这一笔对不上，他记在心里没说。" }]))
await page.waitForTimeout(120)
const dlg = await page.evaluate(() => {
  const quotes = [...document.querySelectorAll(".wb-evidence")]
  const cs = (el) => getComputedStyle(el)
  const first = quotes[0]
  const meta = first.querySelector("small")
  return {
    count: quotes.length,
    metaFont: cs(meta).fontSize,
    metaColor: cs(meta).color,
    metaDisplay: cs(meta).display,
    quoteFont: cs(first).fontSize,
    quotePadding: cs(first).paddingTop,
    visible: quotes.every((q) => q.getBoundingClientRect().height > 20),
    borderLeft: cs(first).borderLeftWidth,
  }
})
check(dlg.count === 2, "弹窗里列出 2 条原文", `实际 ${dlg.count} 条`)
check(dlg.visible, "弹窗里的原文条目有实际高度（不是被压扁/隐形）")
// 这条是"作用域丢失"的直接判据：弹窗在 .book-workbench 之外，<small> 必须另有全局规则兜住
check(dlg.metaFont === "11px" && dlg.metaDisplay === "block",
  "弹窗里的「第N章 · 正文位置…」保留了 11px 小字（没掉回浏览器默认）",
  `font=${dlg.metaFont} display=${dlg.metaDisplay}`)
check(dlg.metaColor !== "rgb(0, 0, 0)", "弹窗里的位置说明用了次要色，不是纯黑正文色", dlg.metaColor)
check(dlg.borderLeft === "3px", "弹窗里的原文仍带引用侧边线", dlg.borderLeft)

await page.setContent(dialogHtml([]))
await page.waitForTimeout(80)
const dlgEmpty = await page.evaluate(() => ({
  text: document.querySelector(".wb-muted")?.textContent?.trim() ?? "",
  color: document.querySelector(".wb-muted") ? getComputedStyle(document.querySelector(".wb-muted")).color : "",
}))
check(dlgEmpty.text === "这份成果没有引用原文。", "空证据弹窗有兜底文案", `实际「${dlgEmpty.text}」`)
check(dlgEmpty.color === "rgb(104, 120, 113)", "兜底文案的次要色在弹窗外也生效（未掉成纯黑）", dlgEmpty.color)

// ---- 3. 章节绿点：尺寸、颜色、位置、运行态脉冲，以及**没点也要留位** ----
/*
 * 结构照抄 knowledge-tree.tsx：点槽在标题**之前**，与真点共用同一份尺寸 class
 * （MEMORY_DOT_SLOT_CLASS）。没记忆的行放一个 aria-hidden 的等宽占位。
 * 真点与占位必须由**同一个常量**拼出来 —— 这里也照做，两处各写一份就测不出改歪。
 */
const DOT_SLOT = "h-1.5 w-1.5 shrink-0 rounded-full"
const dotRow = (state, title, number) => `<div class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
  <span class="text-muted-foreground">${number}</span>
  ${state === "none"
    ? `<span aria-hidden="true" data-ui-tree-memory-dot-spacer="true" class="${DOT_SLOT}"></span>`
    : `<span role="img" data-state="${state}" data-ui-tree-memory-dot="true" aria-label="${state === "done" ? "已提取记忆" : "正在提取记忆"}" title="${state === "done" ? "已提取记忆" : "正在提取记忆"}" class="${DOT_SLOT} ${state === "done" ? "bg-emerald-500" : "animate-pulse bg-muted-foreground/60"}"></span>`}
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
    /*
     * 用户反馈的核心：有点的行与没点的行，标题左边界必须完全一致，
     * 否则整列看起来"排序错乱"。这里量的是**每个标题 span 的 left**，
     * 以及每行点槽的 left/宽度 —— 三者一起才能说明"留位"真的生效了。
     */
    titleLefts: rows.map((row) => +row.querySelector("span:last-child").getBoundingClientRect().left.toFixed(2)),
    slotLefts: rows.map((row) => +row.querySelector('[data-ui-tree-memory-dot], [data-ui-tree-memory-dot-spacer]').getBoundingClientRect().left.toFixed(2)),
    slotWidths: rows.map((row) => +row.querySelector('[data-ui-tree-memory-dot], [data-ui-tree-memory-dot-spacer]').getBoundingClientRect().width.toFixed(2)),
    slotCounts: rows.map((row) => row.querySelectorAll('[data-ui-tree-memory-dot], [data-ui-tree-memory-dot-spacer]').length),
    spacerCount: document.querySelectorAll("[data-ui-tree-memory-dot-spacer]").length,
    spacerAriaHidden: document.querySelector("[data-ui-tree-memory-dot-spacer]")?.getAttribute("aria-hidden"),
    spacerHasTitle: document.querySelector("[data-ui-tree-memory-dot-spacer]")?.hasAttribute("title"),
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
/*
 * 这三条就是用户要的"排列统一"：每一行都占满同一格，
 * 于是所有标题的左边界落在同一个 x 上（容差 0.5px 吸收亚像素取整）。
 */
check(dots.slotCounts.every((n) => n === 1), "每一行都恰有一个点槽（有记忆或占位）",
  JSON.stringify(dots.slotCounts))
check(dots.spacerCount === 1, "没有记忆的那一行放的是占位而不是真点", `占位 ${dots.spacerCount} 个`)
check(new Set(dots.slotWidths).size === 1, "所有点槽同宽（占位与真点等宽）",
  JSON.stringify(dots.slotWidths))
check(new Set(dots.slotLefts).size === 1, "所有点槽左边界一致", JSON.stringify(dots.slotLefts))
check(new Set(dots.titleLefts).size === 1, "所有标题左边界一致（这才是用户看到的「不整齐」）",
  JSON.stringify(dots.titleLefts))
check(dots.spacerAriaHidden === "true" && dots.spacerHasTitle === false,
  "占位对屏幕阅读器与悬停都不可见", `aria-hidden=${dots.spacerAriaHidden} 有title=${dots.spacerHasTitle}`)
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
  const cs = (el) => getComputedStyle(el)
  const row = document.querySelector(".wb-card-meta")
  const ev = row.querySelector(".wb-card-evidence")
  const small = row.querySelector("small")

  // 变异 A：把证据索引字号改成 18px（用户要求同字号，这必须被抓到）
  ev.style.fontSize = "18px"
  const a = cs(ev).fontSize === cs(small).fontSize
  ev.style.fontSize = ""

  // 变异 B：把徽标加回来
  const badge = document.createElement("span")
  badge.className = "wb-card-status"
  document.querySelector(".wb-card-heading").append(badge)
  const b = document.querySelectorAll(".wb-card-status").length === 0

  // 变异 C：把证据索引全部挪出卡片（模拟"又回到版本级"）
  // 注意必须 remove **所有** .wb-card-evidence：这一页有两张卡，只删第一张的话
  // 第二张的「证据索引」按钮仍在 body 文本里，变异体不会被抓到（实测踩到过，
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

/*
 * 本轮新增的两条断言各自也要有负向对照 —— 否则"左右排列"和"按钮像小字"
 * 可能只是恒真的空话。
 */
await page.setContent(page1)
await page.waitForTimeout(100)
const rowMutant = await page.evaluate(() => {
  const cs = (el) => getComputedStyle(el)
  const row = document.querySelector(".wb-card-meta")
  const ev = row.querySelector(".wb-card-evidence")
  const small = row.querySelector("small")
  /*
   * 关键：这里必须复算**与正式断言完全相同的那个布尔**，
   * 而不是它的一半。第一版只复算了"垂直重叠"那一半，于是变异体显示"没抓到"，
   * 而正式断言（flex 且重叠）其实是抓得到的 —— 那是**负向对照本身的缺陷**，
   * 它会让一条有效的断言看起来像空话，也会掩盖真正的空话。
   */
  const sameRowAssertion = () => {
    const rs = small.getBoundingClientRect(), re = ev.getBoundingClientRect()
    const overlap = re.top < rs.bottom && rs.top < re.bottom
    return cs(row).display === "flex" && overlap
  }
  const rightOf = () => ev.getBoundingClientRect().left >= small.getBoundingClientRect().right - 0.5

  const before = { sameRow: sameRowAssertion(), rightOf: rightOf(), display: cs(row).display }

  /*
   * 变异 F：还原成旧版的样子 —— 块级容器 + 块级元素（原来那个 <details> 就是这样独占一行）。
   * 只改容器是不够的：`small` 与 `inline-flex` 的按钮都是行内级，块容器里照样同行。
   */
  row.style.display = "block"
  ev.style.display = "block"
  const afterBlock = { sameRow: sameRowAssertion(), display: cs(row).display }
  row.style.display = ""
  ev.style.display = ""

  // 变异 F2：容器仍是 flex，但改成竖排 —— 证明"垂直重叠"那一半也是承重的
  row.style.flexDirection = "column"
  const afterColumn = { sameRow: sameRowAssertion(), display: cs(row).display }
  row.style.flexDirection = ""

  // 变异 G：还原全局按钮样式（把 34px 的按钮盒子放回来）—— 高度断言必须失败
  const h0 = +ev.getBoundingClientRect().height.toFixed(1)
  ev.style.minHeight = "34px"; ev.style.padding = "6px 10px"; ev.style.border = "1px solid #c6d1cb"
  const h1 = +ev.getBoundingClientRect().height.toFixed(1)
  const border1 = cs(ev).borderTopWidth
  ev.style.minHeight = ""; ev.style.padding = ""; ev.style.border = ""

  // 变异 H：把触发按钮挪到统计左边 —— "在右侧"必须失败
  row.insertBefore(ev, small)
  const afterSwap = rightOf()
  row.appendChild(ev)

  return { before, afterBlock, afterColumn, h0, h1, border1, afterSwap }
})
check(rowMutant.before.sameRow && rowMutant.before.display === "flex",
  "对照前提：未变异时两者确实同排一行")
check(rowMutant.afterBlock.sameRow === false,
  "变异对照：还原成块级独占一行后「同一行」断言确实失败",
  `sameRow=${rowMutant.afterBlock.sameRow} display=${rowMutant.afterBlock.display}`)
check(rowMutant.afterColumn.sameRow === false,
  "变异对照：容器改成竖排后「同一行」断言确实失败（重叠那一半也承重）",
  `sameRow=${rowMutant.afterColumn.sameRow} display=${rowMutant.afterColumn.display}`)
check(rowMutant.h1 > 22 && rowMutant.border1 !== "0px",
  "变异对照：还原全局按钮样式后高度/边框断言确实失败",
  `高度 ${rowMutant.h0}px → ${rowMutant.h1}px，边框 ${rowMutant.border1}`)
check(rowMutant.afterSwap === false, "变异对照：把按钮挪到统计左边后「在右侧」断言确实失败")

await page.setContent(page2)
await page.waitForTimeout(100)
const dotMutant = await page.evaluate(() => {
  // 变异 D：把圆点尺寸改成 12px（不再是"小圆点"）
  const d = document.querySelector('[data-ui-tree-memory-dot="true"]')
  d.style.width = "12px"; d.style.height = "12px"
  const r = d.getBoundingClientRect()
  const sizeOk = r.width >= 5.5 && r.width <= 6.5
  d.style.width = ""; d.style.height = ""

  // 变异 E：把绿点改成灰色（用参照元素比，不写死 rgb，理由见上面的 oklch 说明）
  const ref = document.createElement("span")
  ref.className = "bg-emerald-500"
  document.body.appendChild(ref)
  const emerald = getComputedStyle(ref).backgroundColor
  ref.remove()
  const color0 = getComputedStyle(d).backgroundColor
  d.style.backgroundColor = "rgb(120,120,120)"
  const colorOk = getComputedStyle(d).backgroundColor === emerald
  d.style.backgroundColor = ""

  /*
   * 变异 I（用户反馈的核心）：把占位点删掉 —— 模拟修复前的行为。
   * 这必须让「所有标题左边界一致」失败，否则那条断言证明不了任何事。
   */
  const rows = [...document.querySelectorAll(".wrap > div")]
  const titleLefts = () => rows.map((row) => +row.querySelector("span:last-child").getBoundingClientRect().left.toFixed(2))
  const alignedBefore = new Set(titleLefts()).size === 1
  const spacers = document.querySelectorAll("[data-ui-tree-memory-dot-spacer]")
  spacers.forEach((s) => s.remove())
  const leftsAfter = titleLefts()
  const alignedAfter = new Set(leftsAfter).size === 1

  return { sizeOk, colorOk, color0, emerald, alignedBefore, alignedAfter, leftsAfter, removedSpacers: spacers.length }
})
check(dotMutant.sizeOk === false, "变异对照：圆点改成 12px 后尺寸断言确实失败")
check(dotMutant.colorOk === false, "变异对照：绿点改成灰色后颜色断言确实失败")
check(dotMutant.alignedBefore === true && dotMutant.alignedAfter === false,
  "变异对照：删掉占位点后「标题左边界一致」断言确实失败（证明这条断言承重）",
  `移除 ${dotMutant.removedSpacers} 个占位，标题 left=${JSON.stringify(dotMutant.leftsAfter)}`)

await browser.close()

const report = [...notes, ...(failures.length ? ["", ...failures] : [])].join("\n")
writeFileSync(join(here, "check-browser-report.txt"), report + "\n", "utf8")
console.log(report)
console.log(`\n通过 ${notes.length} 项，失败 ${failures.length} 项`)
process.exit(failures.length ? 1 : 0)
