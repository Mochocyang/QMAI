/**
 * 拆书库结果面板简化的真实浏览器几何检查。
 *
 * 为什么需要它：单元 B 自述「没做浏览器几何验证」——对象名后新增的日期
 * （`许七安 · 10/7 09:03`）在小屏/长名下会不会被裁、标题行会不会撑破卡片、
 * 卡片底部从 2 个按钮变 3 个按钮后会不会挤爆，都只有真实布局引擎能回答。
 *
 * 上一轮我在这里踩过 4 个「harness 保真度」坑，这次逐一防住：
 *   1. 只拼一个 CSS 包 → 漏掉另一包里的规则（如 .flex）：这里把 dist 全部 CSS
 *      再加上源文件 book-analysis-workbench.css 一起注入。
 *   2. 用宽泛正则抓 class 抓错兄弟节点：这里每一处都锚定到唯一上下文。
 *   3. 忘了用 cn()/tailwind-merge 合并而用字符串拼接：这里实现了 twMerge。
 *   4. 非空洞证明用 Tailwind 根本不生成的类（如 md:grid-cols-1）当变异体：
 *      下面用「真实存在过的旧写法」当 BEFORE，并断言它确实能抓到问题。
 *
 * 运行：node docs/workbench-simplify-20261007/check-panel.mjs
 */
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const tsx = readFileSync(join(repo, "src/components/novel/book-analysis-workbench.tsx"), "utf8")
const panelCss = readFileSync(join(repo, "src/components/novel/book-analysis-workbench.css"), "utf8")

const notes = []
const failures = []
const check = (ok, label, detail = "") => {
  if (ok) notes.push(`  OK   ${label}${detail ? `  — ${detail}` : ""}`)
  else failures.push(`  FAIL ${label}${detail ? `  — ${detail}` : ""}`)
}
const grab = (src, re, label) => {
  const m = src.match(re)
  if (!m) { failures.push(`  FAIL 取不到「${label}」（源码结构变了，检查脚本要同步）`); return "" }
  return m[1]
}

// ---- 从真实源码里取 class（每处都锚定唯一上下文）----
// 对象卡片标题：h3 里嵌 <small className="wb-card-date">
const cardDateClass = grab(tsx, /<small className="(wb-card-date)">/, "对象日期 class")
// 卡片页脚第三个按钮：删除
const removeBtnClass = grab(tsx, /<button className="(wb-icon wb-card-remove)" aria-label=\{`删除\$\{item\.subject\}`\}/, "删除按钮 class")
// 版本标题行
const revisionHeadingClass = grab(tsx, /<div className="(wb-revision-heading)">/, "版本标题行 class")
const revisionMetaClass = grab(tsx, /<span className="(wb-revision-meta)">\{revisionMeta\(revision\)\}<\/span>/, "版本标题文本 class")
// 版本块容器
const revisionBlockClass = grab(tsx, /<section className="(wb-revision-block)" data-revision-id/, "版本块 class")

// 卡片页脚的前两个按钮（查看规则 / 补充修订）
const viewRulesBtn = grab(tsx, /<button aria-label=\{`查看\$\{item\.subject\}规则`\}[^>]*>/, "查看规则按钮")
const reviseBtnClass = grab(tsx, /<button className="(wb-icon)" aria-label=\{`补充\$\{item\.subject\}修订要求`\}/, "补充修订按钮 class")

// 注入 CSS：dist 全部 CSS + 源文件里的 workbench CSS（后者比 dist 新）
let allCss = ""
for (const f of readdirSync(join(repo, "dist/assets"))) {
  if (f.endsWith(".css")) allCss += readFileSync(join(repo, "dist/assets", f), "utf8") + "\n"
}
allCss += "\n" + panelCss

// 断言 workbench CSS 真的被注入（否则测的是无样式 DOM，几何无意义）
check(/\.wb-revision-heading\s*\{/.test(allCss), "注入的 CSS 里确实有 .wb-revision-heading（不是无样式 DOM）")
check(/\.wb-card-date/.test(allCss), "注入的 CSS 里确实有 .wb-card-date")
check(/\.wb-card-remove/.test(allCss), "注入的 CSS 里确实有 .wb-card-remove")

if (failures.length) { console.log(failures.join("\n")); process.exit(1) }

// 与 cn() 同语义的最小 tailwind-merge
const GROUPS = [
  /^(?:(?:sm|md|lg|xl|2xl):)?(?:block|inline|inline-block|flex|inline-flex|grid|inline-grid|contents|hidden|flow-root)$/,
  /^(?:(?:sm|md|lg|xl|2xl):)?w-/, /^(?:(?:sm|md|lg|xl|2xl):)?max-w-/,
  /^(?:(?:sm|md|lg|xl|2xl):)?min-w-/, /^(?:(?:sm|md|lg|xl|2xl):)?overflow(-[xy])?/,
  /^(?:(?:sm|md|lg|xl|2xl):)?flex-/, /^(?:(?:sm|md|lg|xl|2xl):)?gap(-[xy])?-/,
  /^(?:(?:sm|md|lg|xl|2xl):)?shrink(-0)?$/,
]
const gOf = (t) => GROUPS.findIndex((g) => g.test(t))

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const browser = await (mod.chromium ?? mod.default.chromium).launch()

// 一份卡片 + 一个版本块的最小组件树（结构与真实 DOM 同构）
const card = (subject, date) => `
<article class="wb-skill-card">
  <div class="wb-card-main">
    <div class="wb-card-heading">
      <span class="wb-avatar" data-tone="0">${subject.slice(0, 1)}</span>
      <h3>${subject}${date ? `<small class="${cardDateClass}"> · ${date}</small>` : ""}</h3>
      <span class="wb-card-status" data-confirmed="false">待确认</span>
    </div>
    <p class="wb-card-description">这个角色在关键节点上的取舍与表达方式，以及他如何对待承诺与代价。</p>
    <div class="wb-traits"><span>决策</span><span>表达</span></div>
    <small>3条规则 · 5条依据</small>
  </div>
  <footer class="wb-card-footer">
    <button aria-label="查看${subject}规则">查看规则</button>
    <button class="${reviseBtnClass}" aria-label="补充${subject}修订要求">改</button>
    <button class="${removeBtnClass}" aria-label="删除${subject}">删</button>
  </footer>
</article>`

const revisionBlock = (meta, cards) => `
<section class="${revisionBlockClass}" data-revision-id="rev-1">
  <div class="${revisionHeadingClass}"><span class="${revisionMetaClass}">${meta}</span></div>
  <div class="wb-skill-grid" data-view="grid">${cards}</div>
</section>`

// 真实的标题行文案（含最长的几种组合）
const METAS = [
  "2026/10/7 09:03 · 9章 · 1个对象",
  "2026/10/7 09:03 · 120章 · 24个对象 · 6项未采纳 · 尚未入库",
  "2026/12/31 23:59 · 1200章 · 240个对象 · 60项未采纳 · 旧版导入",
]

// 长名 + 各种日期：全部必须完整显示（不能靠裁切蒙过去）
const CASES = [
  "许七安|10/7 09:03", "林烬|10/7 09:03",
  "怀庆长公主|10/7 09:03", "城防统领|10/7 09:03",
  "一个非常非常长的角色名字用来试探溢出边界|10/7 09:03",
  "阿|10/7 09:03", "许七安|12/31 23:59",
]

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.setContent(`<!doctype html><html><head><style>${allCss}</style>
  <style>body{margin:0;background:#fff;font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif}
  .book-workbench{--ui-line:#c6d1cb;--ui-muted:#687871;--ui-accent:#496b59;--ui-paper:#fff;--ui-panel:#f2f5f3;--ui-ink:#1d2321;--ui-warning:#88641d;--ui-danger:#a83e3e}
  </style></head><body><div class="book-workbench" id="host"></div></body></html>`)

async function measure(w, view, metas, cards) {
  await page.setViewportSize({ width: w, height: 900 })
  await page.evaluate(([v, ms, cs]) => {
    const headingOnly = ms.map((m) =>
      `<section class="wb-revision-block" data-revision-id="m">
         <div class="wb-revision-heading"><span class="wb-revision-meta">${m}</span></div>
       </section>`).join("")
    // 卡片只放在一个块里，避免「卡片数 × 标题数」把计数断言搞错
    document.getElementById("host").innerHTML = headingOnly +
      `<section class="wb-revision-block" data-revision-id="r">
         <div class="wb-revision-heading"><span class="wb-revision-meta">2026/10/7 09:03 · 9章 · 7个对象</span></div>
         <div class="wb-skill-grid" data-view="${v}">${cs}</div>
       </section>`
  }, [view, metas, cards])
  await page.waitForTimeout(60)
  return page.evaluate(() => {
    const out = { names: [], metas: [], footer: [], overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth }
    for (const h3 of document.querySelectorAll(".wb-card-heading h3")) {
      const date = h3.querySelector(".wb-card-date")
      const nameNodes = [...h3.childNodes].filter((n) => n.nodeType === 3)
      const nameText = nameNodes.map((n) => n.textContent).join("")
      // 名字用 Range 量真实占位宽（h3 是 flex 子项，其自身宽度不等于文本宽度）
      const r = document.createRange(); r.selectNodeContents(h3)
      const card = h3.closest(".wb-skill-card")
      const status = h3.parentElement.querySelector(".wb-card-status")
      const cardRect = card.getBoundingClientRect()
      const cs = getComputedStyle(card)
      const innerRight = cardRect.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight)
      out.names.push({
        subject: nameText.trim(),
        h3W: Math.round(h3.getBoundingClientRect().width),
        contentW: Math.round(r.getBoundingClientRect().width),
        dateW: date ? Math.round(date.getBoundingClientRect().width) : 0,
        dateH: date ? Math.round(date.getBoundingClientRect().height) : 0,
        dateLineH: date ? Math.round(parseFloat(getComputedStyle(date).lineHeight) || 0) : 0,
        // 裁切判定：内容宽超过容器宽 ⇒ 末尾（日期）会被截掉
        clipped: Math.round(r.getBoundingClientRect().width) - Math.round(h3.getBoundingClientRect().width),
        // h3 不肯收缩时会把「待确认」徽标顶出卡片，再被卡片 overflow:hidden 裁掉
        statusSpill: status ? Math.round(status.getBoundingClientRect().right - innerRight) : 0,
      })
    }
    for (const m of document.querySelectorAll(".wb-revision-meta")) {
      const el = m
      out.metas.push({ text: el.textContent, overflow: el.scrollWidth - el.clientWidth, h: Math.round(el.getBoundingClientRect().height) })
    }
    for (const f of document.querySelectorAll(".wb-card-footer")) {
      const r = f.getBoundingClientRect()
      const btns = [...f.children].map((b) => b.getBoundingClientRect())
      const last = btns[btns.length - 1]
      out.footer.push({
        h: Math.round(r.height),
        count: btns.length,
        // 最后一个按钮（删除）的右边缘是否超出页脚内容盒
        spill: last ? Math.round(last.right - r.right) : 0,
        wrapped: btns.length > 1 ? Math.round(btns[0].top) !== Math.round(last.top) : false,
      })
    }
    return out
  })
}

const AFTER_CARDS = CASES.map((c) => { const [s, d] = c.split("|"); return card(s, d) }).join("")

for (const [w, view, label] of [[1280, "grid", "1280px 卡片视图"], [1280, "list", "1280px 列表视图"], [900, "grid", "900px 卡片视图"], [700, "grid", "700px 两列卡片（最紧断点）"], [620, "grid", "620px 窄屏卡片"], [600, "list", "600px 窄屏列表"]]) {
  const r = await measure(w, view, METAS, AFTER_CARDS)
  const worst = r.names.reduce((a, b) => (b.clipped > a.clipped ? b : a), { clipped: -1 })
  const worstSpill = r.names.reduce((a, b) => (b.statusSpill > a.statusSpill ? b : a), { statusSpill: -1 })
  check(r.names.length === CASES.length, `${label}：量到全部 ${CASES.length} 张卡`, `实得 ${r.names.length}`)
  check(worst.clipped <= 0, `${label}：对象名+日期都不被裁切`, worst.clipped > 0 ? `最差「${worst.subject}」超出 ${worst.clipped}px` : `最大余量 ${-worst.clipped}px`)
  check(worstSpill.statusSpill <= 0, `${label}：长名不会把「待确认」徽标顶出卡片`, `最差溢出 ${worstSpill.statusSpill}px`)
  check(r.names.every((n) => n.dateW > 0), `${label}：每张卡上的日期都真的渲染出来了`)
  // 日期必须单行：内联盒高度超过一个行高就说明 10/7 与 09:03 被折到了两行
  check(r.names.every((n) => n.dateH <= Math.ceil(n.dateLineH)), `${label}：日期保持单行未被折断`,
    r.names.map((n) => `${n.dateH}/${Math.ceil(n.dateLineH)}`).join(" "))
  check(r.metas.every((m) => m.overflow <= 0), `${label}：版本标题行不溢出容器`, r.metas.map((m) => m.overflow).join("/"))
  if (view === "grid") {
    check(r.footer.every((f) => f.count === 3 && !f.wrapped && f.spill <= 1), `${label}：页脚 3 个按钮同排且不溢出`, JSON.stringify(r.footer[0]))
  } else {
    // 列表视图的页脚本来就是 160px 侧栏，按钮竖排是设计如此（CSS 里 flex-wrap:wrap）
    check(r.footer.every((f) => f.count === 3 && f.spill <= 1), `${label}：页脚 3 个按钮都在，且不横向溢出`, JSON.stringify(r.footer[0]))
  }
  check(r.overflowX <= 0, `${label}：页面无横向溢出`, `溢出 ${r.overflowX}px`)
}

// ---- 非空洞证明：把日期样式改回「会出问题」的旧写法，必须被抓到 ----
// 实测结论（见 docs/workbench-simplify-20261007/plan.html 的验证记录）：
//   - 真正承重的是日期上的 `white-space:nowrap`。在「2 列」的容器查询断点（约 700px 视口）
//     卡片只有 315px，去掉 nowrap 后日期会折成 3 行（dateH 14 → 44）。
//   - h3 上的 `min-width:0` 在本次夹具里**没能证明承重**：h3 宽与徽标位置在
//     加/不加它时完全一致（因为 overflow-wrap:anywhere 已经让文本随时可换行）。
//     故下面只对 nowrap 做非空洞证明，不假装 min-width:0 挡住了什么。
{
  /*
   * allCss = dist 里所有 CSS + 源文件 CSS，所以同一条 `.wb-card-date` 规则可能出现**两次**
   * （dist 是构建产物，源文件是当前真相）。必须全局替换：只换第一处的话，留在后面的
   * 那一份仍带 white-space:nowrap，变异体根本不会被削弱，这条「非空洞证明」就会
   * 变成永远通过的空洞断言 —— 构建刷新 dist 之后确实这么假绿过一次，故在此钉死替换份数。
   */
  const dateRule = /\.book-workbench \.wb-card-heading h3 \.wb-card-date\{[^}]*\}/g
  const occurrences = (allCss.match(dateRule) ?? []).length
  const beforeCss = allCss.replace(
    dateRule,
    ".book-workbench .wb-card-heading h3 .wb-card-date{color:#687871;font-size:11px;font-weight:400}",
  )
  check(occurrences >= 1, "非空洞证明①a：CSS 里确实找得到日期规则", `实得 ${occurrences} 处`)
  check(beforeCss !== allCss, "非空洞证明①：确实构造出了「去掉 nowrap」的 CSS 变异体")
  const leftoverNowrap = (beforeCss.match(dateRule) ?? []).filter((rule) => rule.includes("nowrap")).length
  check(leftoverNowrap === 0,
    "非空洞证明①b：变异后不再有任何一份带 nowrap 的日期规则残留", `残留 ${leftoverNowrap} 处`)
  await page.setContent(`<!doctype html><html><head><style>${beforeCss}</style>
    <style>body{margin:0;font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif}
    .book-workbench{--ui-line:#c6d1cb;--ui-muted:#687871;--ui-accent:#496b59;--ui-paper:#fff;--ui-panel:#f2f5f3;--ui-ink:#1d2321;--ui-warning:#88641d;--ui-danger:#a83e3e}
    </style></head><body><div class="book-workbench" id="host"></div></body></html>`)
  // 700px 是「2 列」断点：卡片最窄（315px），最能逼出折行
  const rBefore = await measure(700, "grid", METAS, AFTER_CARDS)
  const bad = rBefore.names.filter((n) => n.dateH > Math.ceil(n.dateLineH))
  check(bad.length > 0,
    "非空洞证明②：去掉 nowrap 后，日期确实会被折断（证明上面的通过不是蒙的）",
    `折断 ${bad.length}/${rBefore.names.length} 张，最差「${bad[0]?.subject ?? "-"}」dateH=${bad[0]?.dateH ?? "-"} 行高=${bad[0] ? Math.ceil(bad[0].dateLineH) : "-"}`)
  // 同一视口下把 CSS 换回修好的版本，证明差别确实来自 nowrap 而不是视口本身
  await page.setContent(`<!doctype html><html><head><style>${allCss}</style>
    <style>body{margin:0;font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif}
    .book-workbench{--ui-line:#c6d1cb;--ui-muted:#687871;--ui-accent:#496b59;--ui-paper:#fff;--ui-panel:#f2f5f3;--ui-ink:#1d2321;--ui-warning:#88641d;--ui-danger:#a83e3e}
    </style></head><body><div class="book-workbench" id="host"></div></body></html>`)
  const rAfter = await measure(700, "grid", METAS, AFTER_CARDS)
  const stillBad = rAfter.names.filter((n) => n.dateH > Math.ceil(n.dateLineH))
  check(stillBad.length === 0,
    "非空洞证明③：同一 700px 视口下，带 nowrap 的版本日期全部单行（差别确实来自这一条规则）",
    stillBad.map((n) => `${n.subject}:${n.dateH}`).join(" "))
}

// ---- 顺序不变量：源码必须仍按 createdAt 升序渲染（旧在前）----
{
  const order = tsx.match(/const orderedRevisions = useMemo\(([\s\S]{0,240}?)\)\s*\n/)
  check(Boolean(order) && /a\.createdAt\s*-\s*b\.createdAt/.test(order[1]),
    "渲染顺序按 createdAt 升序（旧版本在前）", order ? order[1].replace(/\s+/g, " ").trim().slice(0, 80) : "找不到 orderedRevisions")
  // 存储层仍必须降序（组件注释警告过的不变量）
  const store = readFileSync(join(repo, "src/lib/novel/book-analysis/workbench-storage.ts"), "utf8")
  check(/sort\(\(a, b\) => b\.createdAt - a\.createdAt\)/.test(store), "loadWorkbenchRevisions 仍保持 newest-first（未被改动）")
  // 过滤已删除项
  check(/removedSubjects/.test(tsx) && /removed\.includes\(item\.subject\)|removedSubjects\?*\.includes/.test(tsx), "已删除项在渲染时被过滤掉")
}

// ---- 结果区工具条：页签 + 视图切换必须在同一行、互不重叠、不溢出 ----
{
  // 结构性不变量：视图切换在源码里只能出现一次（全版本平铺后不能每块一个开关）。
  const switchCount = (tsx.match(/className="wb-view-switch"/g) ?? []).length
  check(switchCount === 1, "视图切换在组件源码里只渲染一份", `实得 ${switchCount} 份`)
  check(/className="wb-results-bar"/.test(tsx), "页签与视图切换被包在同一个 wb-results-bar 里")
  check(readFileSync(join(repo, "src/components/novel/book-analysis-workbench.css"), "utf8")
    .includes(".wb-results-bar .wb-tabs{flex:1;min-width:0;border-bottom:0;margin-bottom:0}"),
    "CSS 里 .wb-results-bar 收编了页签原有的 border/margin（否则会出现双下边框）")

  const barHtml = `<section class="wb-section wb-results-section">
    <div class="wb-results-bar">
      <div class="wb-tabs" role="tablist" aria-label="分析结果">
        <button role="tab" aria-selected="true">角色 Skill</button>
        <button role="tab" aria-selected="false">文风 Skill</button>
        <button role="tab" aria-selected="false">故事 Skill</button>
      </div>
      <div class="wb-view-switch" role="group" aria-label="成果展示方式">
        <button class="wb-icon" aria-label="卡片视图" aria-pressed="true">g</button>
        <button class="wb-icon" aria-label="列表视图" aria-pressed="false">l</button>
      </div>
    </div></section>`

  for (const w of [1280, 900, 700, 620, 600, 420]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.evaluate((html) => { document.getElementById("host").innerHTML = html }, barHtml)
    await page.waitForTimeout(40)
    const m = await page.evaluate(() => {
      const host = document.getElementById("host")
      const bar = host.querySelector(".wb-results-bar")
      const tabs = host.querySelector(".wb-tabs")
      const sw = host.querySelector(".wb-view-switch")
      const tr = tabs.getBoundingClientRect(), sr = sw.getBoundingClientRect(), br = bar.getBoundingClientRect()
      return {
        overlap: Math.round(tr.right - sr.left),
        swRightSpill: Math.round(sr.right - br.right),
        swCount: host.querySelectorAll(".wb-view-switch").length,
        sameRow: Math.abs(tr.top - sr.top) < Math.max(tr.height, sr.height),
        barH: Math.round(br.height),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        borderBottom: getComputedStyle(bar).borderBottomWidth,
        tabsBorder: getComputedStyle(tabs).borderBottomWidth,
      }
    })
    check(m.swCount === 1, `${w}px：结果区只有一个视图切换`, `实得 ${m.swCount}`)
    check(m.overlap <= 0, `${w}px：页签与视图切换不重叠`, `重叠 ${m.overlap}px`)
    check(m.swRightSpill <= 0, `${w}px：视图切换不超出工具条右边缘`, `溢出 ${m.swRightSpill}px`)
    check(m.overflowX <= 0, `${w}px：工具条不造成横向溢出`, `溢出 ${m.overflowX}px`)
    // 双下边框：页签自己那份必须已被收编为 0（真正的下边框挂在 bar 上）
    check(m.borderBottom !== "0px" && m.tabsBorder === "0px",
      `${w}px：下边框只在工具条上有一份（页签那份为 0）`, `bar=${m.borderBottom} tabs=${m.tabsBorder}`)
    if (w >= 620) check(m.sameRow, `${w}px：页签与视图切换确实在同一行`, `bar 高 ${m.barH}px`)
  }
  // 恢复默认视口，避免影响后续断言
  await page.setViewportSize({ width: 1280, height: 900 })
}

await browser.close()

console.log(notes.join("\n"))
if (failures.length) { console.log("\n" + failures.join("\n")); console.log(`\n失败项 ${failures.length}`); process.exit(1) }
console.log(`\n失败项 0（通过 ${notes.length} 项）`)
