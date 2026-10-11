/**
 * 记忆中心单页重构的**真实浏览器几何**验证。
 *
 * 为什么 jsdom 那 68 条用例还不够：
 *   - jsdom 不做布局。而这次改动的核心命题全是布局命题 ——
 *     「8 个标签是否只有一排」「快照卡片是否占满整幅宽度」「内容区左边是否还立着一根竖栏」。
 *     在 jsdom 里这些只能写成"源码里有没有某个 class"，那是在测字符串，不是测界面。
 *   - 「标签条不换行」这条尤其危险：`overflow-x:auto` 单个存在时，
 *     flex 在窄屏照样折成两排。只有真实布局引擎能回答它到底折没折。
 *
 * 保真度防护：
 *   - dist 必须比源文件新，否则测的不是刚改的代码 → 直接失败，不自动构建。
 *   - 用真实 dist CSS（构建产物会被 lightningcss 重排，规则块仍在）。
 *   - **每个断言都配一个当场跑的负向对照**：把 CSS 改坏再量一次，证明测量真的会变。
 *     没有这一步，"标签只有一排"可能只是因为盒子太宽、根本没到折行的临界点。
 *
 * 运行：node docs/memory-center-single-page-20261007/check-browser.mjs
 */
import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
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

// ---- 1. dist 新鲜度 ----
const srcFiles = [
  "src/components/novel/memory-center-view.tsx",
  "src/components/novel/memory-center-snapshots.tsx",
  "src/components/novel/memory-center-tabs.ts",
  "src/components/uitest/ui-test-tools.css",
]
const newestSrc = srcFiles.map((p) => statSync(join(repo, p)).mtimeMs).reduce((a, b) => Math.max(a, b), 0)
const distAssets = readdirSync(join(repo, "dist/assets"))
const distCssFiles = distAssets.filter((f) => f.endsWith(".css"))
const newestDist = distCssFiles.map((f) => statSync(join(repo, "dist/assets", f)).mtimeMs).reduce((a, b) => Math.max(a, b), 0)
check(newestDist > newestSrc,
  "dist 比源文件新（否则下面测的不是刚改的代码）",
  `dist=${new Date(newestDist).toISOString()} src=${new Date(newestSrc).toISOString()}`)

const allCss = distCssFiles.map((f) => readFileSync(join(repo, "dist/assets", f), "utf8")).join("\n")

/*
 * lightningcss 会把属性选择器里的引号去掉：`[data-ui="memory-tabs"]` → `[data-ui=memory-tabs]`。
 * 拿带引号的形式去搜构建产物必然搜不到 —— 这条断言本来就该失败，只是失败的原因
 * 不是"规则没进产物"，而是"我在用源码的写法搜产物"。
 * 统一去掉属性值引号后再比，两种写法都能命中。
 */
const normalizedCss = allCss.replace(/(\[[\w-]+=)"([^"]*)"/g, "$1$2")
const hasRule = (selectorFragment) => normalizedCss.includes(selectorFragment)

/*
 * 断言前先在**构建产物**里确认这次的新规则确实进去了。
 * 否则浏览器量的是旧 CSS，下面全绿也只是在证明旧样式没问题。
 */
for (const probe of ["[data-ui=memory-tabs]", "[data-ui=memory-stats]", "[data-ui=memory-snapshot-collection]"]) {
  check(hasRule(probe), `构建产物含新规则 ${probe}`)
}
for (const probe of ["[data-ui=memory-snapshots]", "[data-ui=memory-chapter-filter]"]) {
  check(!hasRule(probe), `构建产物已清除旧双栏规则 ${probe}`)
}

// ---- 2. 照抄真实 DOM 结构 ----
const TAB_LABELS = ["章节快照", "大纲快照", "人物状态", "角色认知", "伏笔推进", "时间线", "设定事实", "冲突与矛盾"]
const TAB_KEYS = ["snapshots", "outline-snapshots", "character-states", "character-cognition", "foreshadowing-tracker", "timeline", "canon-facts", "conflicts"]
const TAB_COUNTS = [2, 3, 1, 4, 2, 6, 3, 1]

const tabHtml = (label, key, count, selected) => `<button type="button" role="tab" id="memory-tab-${key}"
  aria-selected="${selected}" data-ui="memory-tab" data-tab-key="${key}"
  class="flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-1.5 text-xs ${selected ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground"}">
  <svg viewBox="0 0 24 24" width="14" height="14" class="h-3.5 w-3.5 shrink-0"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>
  <span>${label}</span><span class="text-muted-foreground">${count}</span></button>`

const statHtml = (label, value) =>
  `<span class="shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-muted-foreground">${label} <b class="font-semibold text-foreground">${value}</b></span>`

/** 快照卡片：只保留决定"宽度与堆叠"的部分，内部四列表格对本轮无关。 */
const cardHtml = (n) => `<div data-ui="memory-snapshot" class="rounded-md border p-3">
  <div class="flex items-center justify-between gap-3">
    <div><div class="text-sm font-semibold">第${n}章</div>
      <div class="mt-1 text-[11px] text-muted-foreground">已同步到记忆</div></div>
    <div class="flex shrink-0 items-center gap-1">
      <button id="memory-center-snapshot-${n}" class="h-7 text-xs">查看记忆</button>
      <button class="h-7 text-xs">编辑</button><button class="h-7 text-xs">删除</button></div></div>
  <p class="mt-3 text-sm leading-6 text-foreground">第 ${n} 章的摘要内容，用来观察标题行与动作按钮的排布。</p>
  <div class="mt-3 grid gap-3 md:grid-cols-2">
    <div><div class="text-xs font-medium text-muted-foreground">人物状态变化</div>
      <ul class="mt-1 space-y-1 text-xs text-foreground"><li>许七安：警觉</li></ul></div>
    <div><div class="text-xs font-medium text-muted-foreground">角色认知变化</div>
      <ul class="mt-1 space-y-1 text-xs text-foreground"><li>得知监正身份</li></ul></div>
  </div></div>`

const pageHtml = `<!doctype html><html><head><meta charset="utf-8"><style>${allCss}</style>
<style>
  html,body{margin:0;height:100%}
  body{background:#edf1ec;font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif}
  .ui-test-root{height:100vh}
</style></head>
<body><div class="ui-test-root" data-skin="zhi" data-view="lint">
  <div data-ui-page="memory" data-ui-state="ready" class="flex h-full flex-col">
    <div data-ui="tool-heading" class="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
      <div class="min-w-0">
        <nav aria-label="面包屑" class="ui-test-breadcrumb"><span>他，只想活着</span><span aria-hidden="true">/</span><span aria-current="page">记忆中心</span></nav>
        <h2 data-ui="tool-title" class="text-sm font-semibold">记忆中心</h2>
        <p class="mt-1 text-xs text-muted-foreground">集中查看章节快照、人物状态、角色认知、伏笔推进和时间线记忆。</p>
      </div>
      <button id="memory-refresh" class="shrink-0 h-8 text-xs">刷新</button>
    </div>
    <div data-ui="memory-stats" class="flex shrink-0 flex-nowrap items-center gap-2 overflow-x-auto border-b px-4 py-2 text-xs">
      ${statHtml("快照总数", 5)}${statHtml("已同步快照", 2)}${statHtml("人物条目", 3)}${statHtml("进行中伏笔", 1)}
    </div>
    <div role="tablist" aria-label="记忆中心" data-ui="memory-tabs" class="flex shrink-0 flex-nowrap items-center gap-1 overflow-x-auto border-b px-4 pt-2">
      ${TAB_LABELS.map((label, i) => tabHtml(label, TAB_KEYS[i], TAB_COUNTS[i], i === 0)).join("")}
    </div>
    <div data-ui="memory-body" role="tabpanel" id="memory-tabpanel-snapshots" aria-labelledby="memory-tab-snapshots" class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div data-ui="memory-snapshot-collection" data-variant="chapter" class="space-y-3">
        <div id="memory-range-row" class="flex flex-nowrap items-center gap-2">
          <input type="number" placeholder="起始章" class="h-7 w-20 rounded border bg-background px-2 text-xs">
          <span class="shrink-0 text-xs text-muted-foreground">-</span>
          <input type="number" placeholder="结束章" class="h-7 w-20 rounded border bg-background px-2 text-xs">
          <p class="min-w-0 truncate text-xs text-muted-foreground">最近 2 章（共 2 章）</p>
        </div>
        ${[4, 2].map(cardHtml).join("")}
      </div>
    </div>
  </div>
</div></body></html>`

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const browser = await (mod.chromium ?? mod.default.chromium).launch()

async function measure(width, height = 900) {
  const page = await browser.newPage({ viewport: { width, height } })
  await page.setContent(pageHtml)
  const data = await page.evaluate(() => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom, right: r.right } }
    const tabs = [...document.querySelectorAll('[data-ui="memory-tab"]')]
    const strip = document.querySelector('[data-ui="memory-tabs"]')
    const stats = document.querySelector('[data-ui="memory-stats"]')
    const body = document.querySelector('[data-ui="memory-body"]')
    const collection = document.querySelector('[data-ui="memory-snapshot-collection"]')
    const cards = [...document.querySelectorAll('[data-ui="memory-snapshot"]')]
    const rangeRow = document.querySelector('#memory-range-row')
    const statChips = [...stats.children]
    const cs = getComputedStyle(strip)
    return {
      tabs: tabs.map((t) => ({ key: t.getAttribute("data-tab-key"), ...rect(t) })),
      // 用 offsetTop 判定换行：折到第二排的标签 top 会不同
      tabTops: [...new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top)))],
      tabStrip: { ...rect(strip), flexWrap: cs.flexWrap, overflowX: cs.overflowX, scrollWidth: strip.scrollWidth, clientWidth: strip.clientWidth },
      statTops: [...new Set(statChips.map((c) => Math.round(c.getBoundingClientRect().top)))],
      statStrip: { ...rect(stats), scrollWidth: stats.scrollWidth, clientWidth: stats.clientWidth },
      body: rect(body),
      bodyPadding: { l: parseFloat(getComputedStyle(body).paddingLeft), r: parseFloat(getComputedStyle(body).paddingRight) },
      collection: rect(collection),
      collectionDir: getComputedStyle(collection).flexDirection,
      cards: cards.map(rect),
      rangeRow: rect(rangeRow),
    }
  })
  return { page, data }
}

const NARROW = 620
const WIDE = 1280

// ---- 3. 标签条：单排不换行 ----
for (const width of [NARROW, WIDE]) {
  const { page, data } = await measure(width)
  check(data.tabTops.length === 1,
    `${width}px：8 个标签在同一排（只有 1 个 top 值）`,
    `tops=${JSON.stringify(data.tabTops)}`)
  check(data.tabStrip.flexWrap === "nowrap",
    `${width}px：标签条计算样式 flex-wrap:nowrap`,
    `实际 ${data.tabStrip.flexWrap}`)
  check(data.statTops.length === 1,
    `${width}px：统计条 chip 在同一排`,
    `tops=${JSON.stringify(data.statTops)}`)
  await page.screenshot({ path: join(shots, `memory-${width}.png`), fullPage: false })
  await page.close()
}

// ---- 4. 负向对照：把 nowrap 改回 wrap，标签必须真的折成两排 ----
{
  const { page, data: before } = await measure(NARROW)
  await page.addStyleTag({ content: `.ui-test-root [data-ui="memory-tabs"] { flex-wrap: wrap !important; }` })
  const after = await page.evaluate(() => ({
    tabTops: [...new Set([...document.querySelectorAll('[data-ui="memory-tab"]')]
      .map((t) => Math.round(t.getBoundingClientRect().top)))],
  }))
  /*
   * 这一步证明"只有一排"不是恒真的：620px 下把 nowrap 换成 wrap，
   * 标签**确实**会折起来。否则上面的断言可能只是因为宽度够、根本没到临界点。
   */
  check(before.tabTops.length === 1 && after.tabTops.length > 1,
    "负向对照：改成 wrap 后 620px 下标签确实折成多排（证明上面的单排断言非恒真）",
    `改造前 ${before.tabTops.length} 排 → 改造后 ${after.tabTops.length} 排`)
  await page.close()
}

// ---- 5. 快照卡片占满整幅宽度（没有左竖栏）----
{
  const { page, data } = await measure(WIDE)
  const contentWidth = data.body.w - data.bodyPadding.l - data.bodyPadding.r
  const cardWidth = data.cards[0]?.w ?? 0
  const ratio = cardWidth / contentWidth
  check(data.cards.length === 2, "宽屏下渲染 2 张章节快照卡片", `实际 ${data.cards.length} 张`)
  check(ratio > 0.98,
    "快照卡片占满内容区整幅宽度（双栏时只会有约一半）",
    `卡片 ${cardWidth.toFixed(1)}px / 内容区 ${contentWidth.toFixed(1)}px = ${(ratio * 100).toFixed(1)}%`)

  /*
   * 「左边还有没有一根竖栏」的直接证据：卡片的左边缘必须与工具行左边缘对齐。
   * 双栏结构里章节列表会占据左侧，卡片左边缘会明显右移。
   */
  check(Math.abs(data.cards[0].x - data.rangeRow.x) < 2,
    "卡片左边缘与工具行左边缘对齐（左侧没有任何竖栏）",
    `卡片 x=${data.cards[0].x.toFixed(1)} 工具行 x=${data.rangeRow.x.toFixed(1)}`)

  check(data.collectionDir === "column",
    "快照集合是纵向堆叠（flex-direction:column）",
    `实际 ${data.collectionDir}`)

  // 两张卡片纵向排列：第二张在第一张下方，且左右对齐
  check(data.cards[1].top >= data.cards[0].bottom - 1 && Math.abs(data.cards[1].x - data.cards[0].x) < 2,
    "卡片纵向依次堆叠，而不是并排",
    `卡1 bottom=${data.cards[0].bottom.toFixed(1)} 卡2 top=${data.cards[1].top.toFixed(1)}`)
  await page.close()
}

// ---- 6. 负向对照：把集合改回横向，卡片就不再纵向堆叠 ----
{
  const { page } = await measure(WIDE)
  await page.addStyleTag({ content: `.ui-test-root [data-ui="memory-snapshot-collection"] { flex-direction: row !important; }` })
  const after = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-ui="memory-snapshot"]')].map((c) => c.getBoundingClientRect())
    return { sameRow: Math.abs(cards[0].top - cards[1].top) < 2, dir: getComputedStyle(document.querySelector('[data-ui="memory-snapshot-collection"]')).flexDirection }
  })
  check(after.sameRow && after.dir === "row",
    "负向对照：改成 row 后两张卡片确实并排（证明纵向堆叠断言非恒真）",
    `并排=${after.sameRow} dir=${after.dir}`)
  await page.close()
}

// ---- 7. 窄屏：标签条靠横向滚动而不是折行 ----
{
  const { page, data } = await measure(NARROW)
  check(data.tabStrip.scrollWidth > data.tabStrip.clientWidth,
    `窄屏(${NARROW}px)下标签条内容超出可视宽度，靠横向滚动承载`,
    `scrollWidth=${data.tabStrip.scrollWidth} clientWidth=${data.tabStrip.clientWidth}`)
  check(data.tabStrip.overflowX === "auto",
    "标签条 overflow-x:auto（可横向滚动）",
    `实际 ${data.tabStrip.overflowX}`)
  await page.close()
}

// ---- 8. 无横向溢出（页面本身不该出现横向滚动条）----
{
  const { page } = await measure(NARROW)
  const overflow = await page.evaluate(() => ({
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
  }))
  check(overflow.docScroll <= overflow.docClient + 1,
    `窄屏(${NARROW}px)下页面无横向溢出`,
    `scrollWidth=${overflow.docScroll} clientWidth=${overflow.docClient}`)
  await page.close()
}

await browser.close()

console.log(notes.join("\n"))
if (failures.length) {
  console.log("\n" + failures.join("\n"))
  console.log(`\n通过 ${notes.length}，失败 ${failures.length}`)
  process.exitCode = 1
} else {
  console.log(`\n全部通过：${notes.length} 项`)
}
