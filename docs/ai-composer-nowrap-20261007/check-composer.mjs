/**
 * AI 输入框底栏「收窄时不换行」的真实浏览器验证。
 *
 * 背景（用户反馈）：把 AI 对话输入框收窄时，底栏出现上下的两排结构
 * ——「快速 / 计划 / @」一行、模型与发送掉到第二行。用户要求：
 * 收窄应该让**模型框变窄**，而不该出现上下结构。
 *
 * 为什么必须用真实浏览器：这是纯布局问题。jsdom 不做布局、不算 flex，
 * 「同一行」和「被截断」在 jsdom 里根本无法观测。同目录的
 * ui-test-ai-input.spec.tsx 只能断言 CSS 文本，量不出换行与否。
 *
 * 保真度防护（沿用 docs/workbench-simplify-20261007/check-panel.mjs 的教训）：
 *   - dist 必须比源文件新，否则测的不是刚改的代码 → 直接失败，不自动构建；
 *   - 真实 dist CSS + 源 CSS 都注入（只注入一个会漏规则）；
 *   - 每个断言都配「改坏它就该失败」的负向对照当场跑，证明断言不是恒真的；
 *   - 负向对照必须复算**与正式断言完全相同的那个布尔**，只复算一半会让
 *     有效断言看起来像空话（本轮上一阶段刚踩过）。
 *
 * 运行：node docs/ai-composer-nowrap-20261007/check-composer.mjs
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

// ---- 1. dist 新鲜度 ----
const srcFiles = [
  "src/components/uitest/ui-test-ai.css",
  "src/components/reference/ReferenceInput.tsx",
  "src/components/chat/chat-panel.tsx",
]
const newestSrc = srcFiles.map((p) => statSync(join(repo, p)).mtimeMs).reduce((a, b) => Math.max(a, b), 0)
const distAssets = readdirSync(join(repo, "dist/assets"))
const newestDist = Math.max(...distAssets.filter((f) => f.endsWith(".js")).map((f) => statSync(join(repo, "dist/assets", f)).mtimeMs))
check(newestDist > newestSrc, "dist 比源文件新（否则下面测的不是刚改的代码）",
  `dist=${new Date(newestDist).toISOString()} src=${new Date(newestSrc).toISOString()}`)

let allCss = ""
for (const f of distAssets) if (f.endsWith(".css")) allCss += readFileSync(join(repo, "dist/assets", f), "utf8") + "\n"
// 变量与字体在 ui-test.css，底栏规则在 ui-test-ai.css，两者都要（真实页面也是两份都在）。
allCss += "\n" + readFileSync(join(repo, "src/components/uitest/ui-test.css"), "utf8")
allCss += "\n" + readFileSync(join(repo, "src/components/uitest/ui-test-ai.css"), "utf8")

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const browser = await (mod.chromium ?? mod.default.chromium).launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

/*
 * 结构照抄真实产物：
 *   chat-panel.tsx  <div data-ui-ai-panel="chapter"> … <div data-ui-ai-composer>
 *   ReferenceInput  footer[data-reference-input-footer] = [左控件组][@按钮][右控件组]
 *   左：ContextUsageRing / 快速下拉 / 计划；右：UiTestAiModel(思考深度 + 模型) / 发送
 * 文案用用户截图里的真实内容（最大 / deepseek-v4.1-flash）。
 *
 * 按钮 class 也照抄真实值：真实代码用的是 shadcn Button（基类含 inline-flex /
 * items-center / shrink-0）加各自的高度（h-8、p-1.5…）。省掉这些 class 会让按钮高度
 * 变矮，底栏的换行阈值就跟着变 —— 那样测出来的宽度阈值不是产品真实表现。
 */
const BTN = "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-transparent text-sm font-medium"
const composerHtml = () => `<!doctype html><html><head><meta charset="utf-8"><style>${allCss}</style>
<style>body{margin:0;background:#edf1ec;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif;padding:24px}
/* 容器宽度由外层决定：这里就是要复现"用户把输入框收窄"。 */
#frame{width:var(--w);margin:0 auto}
[data-ui-ai-panel]{display:flex;flex-direction:column;background:var(--ui-paper)}</style></head>
<body><div class="ui-test-root"><div id="frame" style="--w:900px">
<div data-ui-ai-panel="chapter">
  <div class="border-t px-3 py-2" data-ui-ai-composer>
    <div class="overflow-hidden rounded-lg border bg-background shadow-sm">
      <div role="separator" aria-label="拖动调整输入框高度" class="flex h-2 items-center justify-center"><span class="h-0.5 w-10 rounded-full"></span></div>
      <div class="relative px-3 py-2"><textarea rows="1" style="height:48px;max-height:48px" class="w-full resize-none bg-transparent px-0 py-1 text-sm outline-none" placeholder="写下你的想法，或 @ 引用资料..."></textarea></div>
      <div data-reference-input-footer class="flex items-center justify-between gap-2 border-t px-2 py-1.5">
        <div class="flex min-w-0 shrink-0 items-center gap-2">
          <button aria-label="上下文用量" type="button" class="${BTN}">1</button>
          <div class="relative"><button type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="工作流模式" class="${BTN} h-8 shrink-0 px-2 text-xs"><span>快速</span><svg width="14" height="14" viewBox="0 0 24 24"></svg></button></div>
          <button type="button" aria-pressed="false" disabled aria-label="快速模式下不支持计划，请切换到标准或严格模式" title="快速模式下不支持计划" class="${BTN} h-8 shrink-0 rounded-full border px-2.5 text-xs"><svg width="14" height="14" viewBox="0 0 24 24"></svg>计划</button>
        </div>
        <button type="button" aria-label="引用内容" title="引用内容" class="rounded-md p-1.5"><svg width="16" height="16" viewBox="0 0 24 24"></svg></button>
        <div class="ml-auto flex min-w-0 shrink-0 items-center gap-2">
          <div class="ui-test-ai-model" title="deepseek-v4.1-flash">
            <div class="relative"><button type="button" aria-haspopup="listbox" aria-label="思考深度" class="${BTN} h-8 shrink-0 gap-1.5 px-2 text-xs"><svg width="14" height="14" viewBox="0 0 24 24"></svg><span class="truncate">最大</span></button></div>
            <div class="relative"><button type="button" class="${BTN} h-8 w-fit max-w-40 justify-start gap-1 px-2 text-xs"><span class="max-w-32 truncate text-left">deepseek-v4.1-flash</span><svg width="14" height="14" viewBox="0 0 24 24"></svg></button></div>
          </div>
          <button type="button" aria-label="发送消息"><svg width="16" height="16" viewBox="0 0 24 24"></svg></button>
        </div>
      </div>
    </div>
  </div>
</div>
</div></div></body></html>`

await page.setContent(composerHtml())
await page.waitForTimeout(150)

/**
 * 量一次当前底栏状态。所有判据都在这里算好，负向对照会复用同一套定义，
 * 避免"断言"和"变异复算"两处判据漂移。
 */
const measure = (width) => page.evaluate((w) => {
  document.getElementById("frame").style.setProperty("--w", `${w}px`)
  const footer = document.querySelector("[data-reference-input-footer]")
  const left = footer.querySelector(":scope > div:first-child")
  const right = footer.querySelector(":scope > div:last-child")
  const atBtn = footer.querySelector(':scope > [aria-label="引用内容"]')
  const send = footer.querySelector('[aria-label="发送消息"]')
  const model = footer.querySelector(".ui-test-ai-model")
  const modelBtn = model.querySelector(":scope > .relative:last-child > button")
  const modelText = modelBtn.querySelector("span")
  const depth = footer.querySelector('[aria-label="思考深度"]')
  const usage = footer.querySelector('[aria-label="上下文用量"]')
  const plan = footer.querySelector('[aria-pressed]')
  const modeBtn = footer.querySelector('[aria-label="工作流模式"]')
  const r = (el) => el.getBoundingClientRect()
  const fr = r(footer), lr = r(left), rr = r(right), sr = r(send), ar = r(atBtn)
  const cs = getComputedStyle(footer)

  // 单排的判据：左组与右组的垂直区间相交（同一行）。
  const overlap = lr.top < rr.bottom && rr.top < lr.bottom
  // 内容区（去掉左右 padding）——发送按钮必须完整落在里面。
  const padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight)
  const innerLeft = fr.left + padL, innerRight = fr.right - padR
  const within = (x) => x.left >= innerLeft - 0.5 && x.right <= innerRight + 0.5
  /*
   * 左组有 overflow:hidden，所以「几何上还在底栏内」不等于「没被裁」——
   * 被裁掉的按钮 rect 仍然是它在布局里该在的位置，量不出视觉缺失。
   * 判据换成：控件必须完整落在**左组自己的矩形**内。
   */
  const notClippedByLeft = (x) => x.left >= lr.left - 0.5 && x.right <= lr.right + 0.5

  return {
    width: w,
    footerH: +fr.height.toFixed(1),
    overlap,
    // 有溢出说明是被挤出去而不是被压缩
    overflowX: footer.scrollWidth - footer.clientWidth,
    sendW: +sr.width.toFixed(1),
    sendWithin: within(sr),
    sendVisible: sr.width > 20 && sr.height > 20,
    atWithin: within(ar),
    modelBtnW: +r(modelBtn).width.toFixed(1),
    // 「模型框收窄」的直接证据：文字被省略号截断（scrollWidth 超出可视宽度）
    modelTextClipped: modelText.scrollWidth > modelText.clientWidth + 1,
    modelTextScrollW: modelText.scrollWidth,
    modelTextClientW: modelText.clientWidth,
    depthWithin: within(r(depth)),
    usageWithin: within(r(usage)),
    planWithin: within(r(plan)),
    modeWithin: within(r(modeBtn)),
    // 左组的功能控件不能被裁（用户要裁的是模型名，不是一个按钮）
    modeNotClipped: notClippedByLeft(r(modeBtn)),
    planNotClipped: notClippedByLeft(r(plan)),
    usageNotClipped: notClippedByLeft(r(usage)),
    leftRightGap: +(rr.left - lr.right).toFixed(1),
    // 诊断：换行时是"哪一组"变高的（定位是谁掉到了第二排）
    leftH: +lr.height.toFixed(1),
    rightH: +rr.height.toFixed(1),
    leftW: +lr.width.toFixed(1),
    rightW: +rr.width.toFixed(1),
    // 左组是否保住完整宽度（78.8 说明被压掉了，156 说明没被压）
    leftFull: +lr.width.toFixed(1),
  }
}, width)

/*
 * 真实可达宽度：章节 AI 面板的拖拽下限是 UI_TEST_AI_MIN_WIDTH = 400
 * （src/lib/ui-test-layout.ts），大纲面板下限 320。所以 400 是必须过的硬线；
 * 320/360 用来确认"比下限更窄时也不会摆成两排"这个更保守的保证。
 * 900 代表宽面板。
 */
const WIDTHS = [320, 360, 400, 446, 520, 620, 760, 900]
const rows = []
for (const w of WIDTHS) rows.push(await measure(w))

console.log("宽度  底栏高  同行  左组高  右组高  左组宽  右组宽  溢出  模型宽  截断")
for (const r of rows) {
  console.log(
    `${String(r.width).padStart(4)}  ${String(r.footerH).padStart(6)}  ${String(r.overlap).padStart(4)}  ` +
    `${String(r.leftH).padStart(6)}  ${String(r.rightH).padStart(6)}  ${String(r.leftW).padStart(6)}  ${String(r.rightW).padStart(6)}  ` +
    `${String(r.overflowX).padStart(4)}  ${String(r.modelBtnW).padStart(6)}  ${String(r.modelTextClipped).padStart(4)}`,
  )
}
console.log("")

// ---- 2. 核心断言：收窄不换行 ----
for (const r of rows) {
  check(r.overlap, `${r.width}px：左控件组与模型/发送在同一行（没有上下结构）`,
    r.overlap ? "" : `左组高 ${r.leftH} / 右组高 ${r.rightH}，左右间距 ${r.leftRightGap}`)
}
// 单排高度基准：用最宽的那次实测值，两排会接近翻倍 —— 这样阈值不写死魔数。
const singleRowH = rows[rows.length - 1].footerH
check(rows.every((r) => r.footerH < singleRowH * 1.4), `所有宽度下底栏都是单排高度（<最宽时 ${singleRowH}px 的 1.4 倍）`,
  rows.map((r) => `${r.width}:${r.footerH}`).join(" "))
check(rows.every((r) => r.overflowX <= 1), "所有宽度下底栏都没有水平溢出（被压缩而不是被挤出）",
  rows.map((r) => `${r.width}:${r.overflowX}`).join(" "))
check(rows.every((r) => r.sendWithin && r.sendVisible), "所有宽度下发送按钮都完整可见（没被裁掉）",
  rows.map((r) => `${r.width}:${r.sendWithin}`).join(" "))
check(rows.every((r) => r.atWithin), "所有宽度下 @ 按钮都完整可见",
  rows.map((r) => `${r.width}:${r.atWithin}`).join(" "))
check(rows.every((r) => r.depthWithin && r.usageWithin && r.planWithin && r.modeWithin),
  "思考深度/上下文用量/模式/计划在收窄后仍留在底栏内",
  rows.map((r) => `${r.width}:${r.depthWithin && r.usageWithin && r.planWithin && r.modeWithin}`).join(" "))

/*
 * 让位顺序：收窄时先压模型名（可截断、有 tooltip），不要裁掉左组的功能按钮。
 * 左组有 overflow:hidden，被裁的元素几何位置照样在底栏内，所以必须单独量"是否被左组裁剪"。
 */
check(rows.every((r) => r.modeNotClipped && r.planNotClipped && r.usageNotClipped),
  "收窄时左组的模式/计划/用量按钮都没被裁掉（让位的是模型名，不是功能按钮）",
  rows.map((r) => `${r.width}:模式${r.modeNotClipped}/计划${r.planNotClipped}/用量${r.usageNotClipped}`).join(" "))

// ---- 3. 「模型框收窄」：窄的时候真的把模型名截断，而不是整组掉行 ----
const narrow = rows.filter((r) => r.width <= 446)
check(narrow.every((r) => r.modelTextClipped), "窄宽度（≤446px）下模型名被省略号截断，即模型框确实收窄了",
  narrow.map((r) => `${r.width}:scroll=${r.modelTextScrollW}/client=${r.modelTextClientW}`).join(" "))
// 单调性：越窄模型按钮越窄（证明是"跟着收窄"而不是固定宽度）
const byWidth = [...rows].sort((a, b) => a.width - b.width)
const monotonic = byWidth.every((r, i) => i === 0 || r.modelBtnW >= byWidth[i - 1].modelBtnW - 0.5)
check(monotonic, "模型按钮宽度随容器变宽而不减（跟着容器收窄/放宽）",
  byWidth.map((r) => `${r.width}:${r.modelBtnW}`).join(" "))
// 很宽时不该无谓截断：模型名应该完整显示
const widest = rows[rows.length - 1]
check(!widest.modelTextClipped, "足够宽时模型名完整显示（没有无谓截断）",
  `${widest.width}px scroll=${widest.modelTextScrollW}/client=${widest.modelTextClientW}`)
/*
 * 模型框收窄要有下限：收到底只剩几像素就点不中也认不出。
 * 44px 是"还能看出是个模型选择器、点得中"的下限；面板真实下限 400px 处应远高于此。
 */
check(rows.every((r) => r.modelBtnW >= 44), "所有宽度下模型按钮都不小于 44px（收窄但有可用下限）",
  rows.map((r) => `${r.width}:${r.modelBtnW}`).join(" "))
// 面板真实下限（400px）处：模型名应还能看出若干字符，而不是被压成一条缝。
const atFloor = rows.find((r) => r.width === 400)
check(atFloor && atFloor.modelTextClientW >= 30, "面板真实下限 400px 处模型名仍留有 ≥30px 可见文字（认得出）",
  atFloor ? `可见 ${atFloor.modelTextClientW}px / 按钮 ${atFloor.modelBtnW}px` : "没测到 400px")

await page.setContent(composerHtml())
await page.waitForTimeout(120)
// 400px = 章节 AI 面板的真实拖拽下限，也是"最窄的正常使用状态"。
await page.evaluate(() => { document.getElementById("frame").style.setProperty("--w", "400px") })
await page.waitForTimeout(80)
await page.screenshot({ path: join(shots, "composer-400.png") })
await page.evaluate(() => { document.getElementById("frame").style.setProperty("--w", "446px") })
await page.waitForTimeout(80)
await page.screenshot({ path: join(shots, "composer-446.png") })
await page.evaluate(() => { document.getElementById("frame").style.setProperty("--w", "900px") })
await page.waitForTimeout(80)
await page.screenshot({ path: join(shots, "composer-900.png") })

// ---- 4. 负向对照 ----
/*
 * 每个对照都复算**与正式断言完全相同的判据**。
 * 上一阶段踩过的坑：只复算一半，于是变异"没被抓到"，让有效断言看起来像空话。
 * 这里量的是 400px —— 实测旧写法在这个宽度就会掉到第二排。
 *
 * `broken` 是一个**谓词**而不是等值比较：有些变异的表现是「溢出 > 0」这种不等号，
 * 写成等值比较会反过来把"没坏"判成通过。
 */
const negativeControl = async (mutate, broken, label) => {
  await page.setContent(composerHtml())
  await page.waitForTimeout(100)
  await page.evaluate(({ mutateSrc }) => {
    const tag = document.createElement("style")
    tag.textContent = mutateSrc
    document.head.appendChild(tag)
    document.getElementById("frame").style.setProperty("--w", "400px")
  }, { mutateSrc: mutate })
  await page.waitForTimeout(80)
  const r = await page.evaluate(() => {
    const footer = document.querySelector("[data-reference-input-footer]")
    const left = footer.querySelector(":scope > div:first-child")
    const right = footer.querySelector(":scope > div:last-child")
    const send = footer.querySelector('[aria-label="发送消息"]')
    const cs = getComputedStyle(footer)
    const lr = left.getBoundingClientRect(), rr = right.getBoundingClientRect()
    const fr = footer.getBoundingClientRect(), sr = send.getBoundingClientRect()
    const innerLeft = fr.left + parseFloat(cs.paddingLeft), innerRight = fr.right - parseFloat(cs.paddingRight)
    const t = footer.querySelector(".ui-test-ai-model > .relative:last-child > button > span")
    const mb = footer.querySelector(".ui-test-ai-model > .relative:last-child > button")
    return {
      overlap: lr.top < rr.bottom && rr.top < lr.bottom,
      footerH: +fr.height.toFixed(1),
      overflowX: footer.scrollWidth - footer.clientWidth,
      sendWithin: sr.left >= innerLeft - 0.5 && sr.right <= innerRight + 0.5,
      clipped: t.scrollWidth > t.clientWidth + 1,
      modelW: +mb.getBoundingClientRect().width.toFixed(1),
    }
  })
  check(broken(r) === true, `变异对照：${label}`, JSON.stringify(r))
}

// NC1：恢复旧的「放不下就整组换到第二排」写法 —— 这正是用户抱怨的行为
await negativeControl(
  `[data-ui-ai-composer] [data-reference-input-footer]{flex-wrap:wrap}
   [data-ui-ai-composer] [data-reference-input-footer] > div:last-child{flex:1 0 auto;min-width:min(100%,max-content)}`,
  (r) => r.overlap === false || r.footerH > 60,
  "恢复 flex-wrap:wrap + min-width:min(100%,max-content) 后，底栏重新变成上下两排（「同一行」断言确实失败）",
)
/*
 * NC2：让模型**不可收窄**（回到 flex:0 0 auto + max-content）。
 * 这直接证伪「收窄时模型框跟着变窄」这条主张：模型会维持原宽、不再截断，
 * 让位改由左组承担 —— 正是用户不想要的那种"该收的不收"。
 * 判据用 clipped（模型名是否被截断），而不是看发送按钮：nowrap 下发送按钮有
 * flex-shrink:0，模型再宽也挤不掉它，用"发送被挤出"来判会恒真。
 */
await negativeControl(
  `[data-ui-ai-composer] .ui-test-ai-model > .relative:last-child{flex:0 0 auto;display:block}
   [data-ui-ai-composer] .ui-test-ai-model > .relative:last-child > button{flex:0 0 auto;max-width:none;width:max-content}
   [data-ui-ai-composer] .ui-test-ai-model > .relative:last-child > button > span{max-width:none;overflow:visible;text-overflow:clip}`,
  (r) => r.clipped === false,
  "模型框不可收窄后，窄宽度下模型名不再被截断（「模型框确实收窄」断言确实失败）",
)
/*
 * NC3：整条底栏都不可收缩 —— nowrap 且没人让步时，只能水平溢出。
 * 证明「无水平溢出」不是恒真的：它确实在守"被压缩而非被挤出"。
 */
await negativeControl(
  `[data-ui-ai-composer] [data-reference-input-footer] > div:first-child{flex:0 0 auto;overflow:visible}
   [data-ui-ai-composer] [data-reference-input-footer] > div:last-child{flex:0 0 auto}
   [data-ui-ai-composer] .ui-test-ai-model > .relative:last-child{flex:0 0 auto;display:block}
   [data-ui-ai-composer] .ui-test-ai-model > .relative:last-child > button{flex:0 0 auto;max-width:none;width:max-content}
   [data-ui-ai-composer] .ui-test-ai-model > .relative:last-child > button > span{max-width:none;overflow:visible;text-overflow:clip}`,
  (r) => r.overflowX > 1,
  "整条底栏都不可收缩后，底栏出现水平溢出（「无溢出」断言确实失败）",
)

await browser.close()

const report = [...notes, ...(failures.length ? ["", ...failures] : [])].join("\n")
writeFileSync(join(here, "check-composer-report.txt"), report + "\n", "utf8")
console.log(report)
console.log(`\n通过 ${notes.length} 项，失败 ${failures.length} 项`)
process.exitCode = failures.length ? 1 : 0
