// 用真实 Chromium 检查「角色条目的两个灵魂按钮 + 绑定对话框」的布局。
//
// 和上一轮（docs/book-analysis-legacy-merge-20261006/check.mjs）同样的两步走，理由也相同：
//   1) dump.html 由 dump-actions.spec.tsx 用**真实组件**渲染生成，不是手写快照；
//   2) 本脚本只负责把真实 CSS + 真实 markup 放进浏览器量尺寸。
// 手写快照的教训是：组件改完后快照没人更新，脚本照样报 0 失败，等于拿旧 DOM 当证据。
//
// 选择器全部对准组件真实结构（article.wb-skill-card / h3 / .wb-soul-actions / .wb-soul-status），
// 不依赖为测试而造的属性。唯一由 dump 提供的是外层 [data-dump-case]，
// 它说明「这一份渲染用的是哪种输入 fixture」，用来决定按钮该不该可点——
// 期望来自**输入**而不是从 DOM 反推，所以不是循环论证。
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

const here = path.resolve("docs/legacy-character-binding-20261006")
const markup = readFileSync(path.join(here, "dump.html"), "utf8")
const css = readFileSync(
  path.resolve("src/components/novel/book-analysis-workbench.css"),
  "utf8",
)

/**
 * 静态页面没有 Tailwind，下面这些工具类必须手工补上，否则量出来的尺寸不可信
 * ——它们全都直接决定宽高与是否换行。软件里由 Tailwind 提供。
 *
 * 对话框那几条尤其关键：DialogContent 自带的 w-full + max-w-[calc(100%-2rem)]
 * 正是「窄屏下不超出视口」的来源；漏掉它，420px 下量到的是桌面宽度，断言会假通过。
 * 上一轮就因为漏补工具类出现过假失败/假通过。
 */
const tailwindStandIns = `
  *,::before,::after{box-sizing:border-box}
  .grid{display:grid}
  .flex{display:flex}
  .flex-col{flex-direction:column}
  .flex-col-reverse{flex-direction:column-reverse}
  .items-center{align-items:center}
  .justify-end{justify-content:flex-end}
  .min-h-0{min-height:0}
  .flex-1{flex:1 1 0%}
  .overflow-y-auto{overflow-y:auto}
  .gap-2{gap:.5rem}
  .gap-4{gap:1rem}
  .p-4{padding:1rem}
  .py-1\\.5{padding-top:.375rem;padding-bottom:.375rem}
  .text-sm{font-size:.875rem;line-height:1.25rem}
  .rounded-xl{border-radius:.75rem}
  .w-full{width:100%}
  /* 对话框：宽度 = min(视口-2rem, 560px)。这是 DialogContent 自带的
     max-w-[calc(100%-2rem)] 与 sm:max-w-[560px] 合并后的结果。 */
  [data-slot="dialog-content"]{max-width:calc(100% - 2rem)}
  @media (min-width:640px){[data-slot="dialog-content"]{max-width:560px}}
  .max-h-\\[85vh\\]{max-height:85vh}
`

/** 软件里由主题提供；这里给出浅色皮肤的等价取值。 */
const themeVars = `
  :root{
    --ui-paper:#fdfdfb; --ui-panel:#f4f6f4; --ui-line:#c6d1cb; --ui-accent:#496b59;
    --ui-muted:#6b7a73; --ui-ink:#24332e; --ui-danger:#b42318; --ui-warning:#8a5a00;
    --background:#fdfdfb; --muted:#f4f6f4; --foreground:#24332e;
  }
  body{margin:0;padding:24px;background:#eef1ef;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#24332e}
`

/** 对话框由 Portal 渲染到 body 末尾；它自带 position:fixed，这里补上居中所需定位。 */
const dialogPositioning = `
  [data-slot="dialog-content"]{
    position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:50;
    background:#fff;border:1px solid #c6d1cb;font-size:.875rem;
  }
`

const html = `<!doctype html><html lang="zh-CN" data-ui-test-skin="light"><head><meta charset="utf-8">
<style>${themeVars}</style><style>${tailwindStandIns}</style><style>${dialogPositioning}</style><style>${css}</style></head>
<body>${markup}</body></html>`

async function measure(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  const pageErrors = []
  page.on("pageerror", (error) => pageErrors.push(String(error)))
  await page.setContent(html, { waitUntil: "load" })
  const result = await page.evaluate(() => {
    const out = []
    const log = (name, ok, detail) =>
      out.push((ok ? "PASS  " : "FAIL  ") + name + (detail ? "  — " + detail : ""))
    const rect = (el) => el.getBoundingClientRect()
    const r1 = (n) => n.toFixed(1)

    const cases = [...document.querySelectorAll("[data-dump-case]")]
    log("快照里有渲染用例", cases.length > 0, `找到 ${cases.length} 份`)

    // 三态必须都有用例，否则下面某条断言根本不会执行，等于假通过。
    const caseNames = cases.map((c) => c.dataset.dumpCase)
    for (const required of ["publishable", "unpublishable", "in-library", "bound"]) {
      log(`快照里有 ${required} 用例`, caseNames.includes(required), caseNames.join(" | "))
    }

    let cardCount = 0
    for (const dumpCase of cases) {
      /*
       * 期望来自输入 fixture，不是从 DOM 反推。
       *
       * 三态契约（设计 §5.4）里两个按钮的可用性**并不一样**，所以不能用一个
       * 布尔值套在两个按钮上——那正是这个脚本第一版的错：
       *   unpublishable（情况 W，毫无资料）→ 两个都禁用，点了只会报错
       *   in-library（已在库未绑定）       → 「加入」禁用，「绑定」仍必须可用
       *   bound（已绑定）                  → 「加入」禁用，「绑定」仍必须可用（继续绑给别人）
       *   publishable / legacy（尚未入库） → 两个都可用，即使 rules 为空
       * 最后一条是关键：可用性绝不能看 rules.length，六维路径的旧版角色就是空的。
       */
      const expect = dumpCase.dataset.dumpCase
      const expectedDisabled = (label) =>
        expect === "unpublishable" ? true
          : expect === "in-library" || expect === "bound" ? label.includes("加入自定义灵魂库")
            : false
      const expectedLabel = expect === "unpublishable" ? "两按钮均禁用"
        : expect === "in-library" ? "「加入」禁用、「绑定」可用"
          : expect === "bound" ? "「加入」禁用、「绑定」仍可用"
            : "两按钮均可用"
      const cards = [...dumpCase.querySelectorAll("article.wb-skill-card")]
      log(`[${expect}] 渲染出角色卡片`, cards.length > 0, `${cards.length} 张`)

      for (const card of cards) {
        cardCount++
        const subject = card.querySelector("h3")?.textContent?.trim() ?? "(未命名)"
        const actions = card.querySelector(".wb-soul-actions")
        const badge = actions?.querySelector(".wb-soul-status")
        const buttons = actions ? [...actions.querySelectorAll("button")] : []
        log(`[${expect}][${subject}] 有按钮行与状态徽标`, !!actions && !!badge)
        if (!actions || !badge) continue

        /*
         * 徽标文案必须随输入 fixture 变，否则「已入库/已绑定」就是写死的假状态。
         *
         * 情况 W 单独一档：设计 §5.4 的徽标三态讲的是**灵魂状态**，而设计
         * 另一个地方（§「角色既无人格块也无任何资料」）要求这种条目显示
         * 「无可用资料」。两者必须取后者——否则按钮明明置灰、徽标却写
         * 「未加入灵魂库」，等于骗用户去点一个点不动的按钮。
         * 所以「无可用资料」优先于灵魂状态。
         */
        const expectedBadge = expect === "unpublishable" ? "无可用资料"
          : expect === "in-library" ? "已在灵魂库"
            : expect === "bound" ? "已绑定" : "未加入灵魂库"
        const badgeText = badge.textContent?.trim() ?? ""
        log(`[${expect}][${subject}] 状态徽标与 fixture 相符（期望含「${expectedBadge}」）`,
          badgeText.includes(expectedBadge), badgeText)

        // 需求：两个按钮都要在——只给「绑定」是不合格的（用户就是这么反馈的）。
        const labels = buttons.map((b) => b.textContent?.trim() ?? "")
        log(`[${expect}][${subject}] 同时有「加入自定义灵魂库」和「绑定」两个按钮`,
          buttons.length === 2
            && labels.some((l) => l.includes("加入自定义灵魂库"))
            && labels.some((l) => l.includes("绑定")),
          labels.join(" | "))

        const row = rect(actions)
        const cardRect = rect(card)
        // 按钮行不能撑破卡片右边界；也不能横向溢出（窄屏 flex-wrap 没生效时就是这样）。
        log(`[${expect}][${subject}] 按钮行不超出卡片右边界`,
          row.right <= cardRect.right + 1,
          `row.right=${r1(row.right)} card.right=${r1(cardRect.right)}`)
        log(`[${expect}][${subject}] 按钮行没有横向溢出`,
          actions.scrollWidth <= actions.clientWidth + 1,
          `scrollWidth=${actions.scrollWidth} clientWidth=${actions.clientWidth}`)

        // 徽标与任一按钮的矩形都不能相交。
        const badgeRect = rect(badge)
        const overlap = buttons
          .map((b) => ({ label: b.textContent?.trim() ?? "", r: rect(b) }))
          .filter(({ r }) =>
            badgeRect.left < r.right - 1 && badgeRect.right > r.left + 1 &&
            badgeRect.top < r.bottom - 1 && badgeRect.bottom > r.top + 1)
          .map(({ label }) => label)
        log(`[${expect}][${subject}] 徽标与按钮不重叠`, overlap.length === 0, overlap.join(" | "))

        /*
         * 同一行内的徽标与按钮必须**垂直居中对齐**。
         *
         * 这里第一版写错了，是我自己的 bug：原来比较的是 rect.top 的极差 <= 2。
         * 但 .wb-soul-actions 是 align-items:center，徽标盒高 12px×1.5=18px，
         * 而按钮有 min-height:34px——同一行上居中对齐的两个盒子，
         * 顶边必然相差 (34-18)/2 = 8px，**永远不可能 <= 2**。
         * 那条断言把「在同一行」和「顶边相同」混为一谈，因此对任何真实 CSS 都恒假。
         * 正确判据是**中线**（top + height/2）对齐。
         *
         * 另外不能在 1200px 下假定「一定不换行」：默认三栏网格里卡片只有约 356px，
         * 而标签订+徽标+两个按钮要 ~500px，flex-wrap 必然把它折成两行——这是
         * 设计里就写明的预期行为（.wb-soul-actions 带 flex-wrap:wrap），不是缺陷。
         * 所以按**垂直重叠分组**成行，逐行校验中线对齐：
         * 换行时每行内部仍必须对齐，既不假失败也不放过真正的错位。
         */
        const items = [
          { label: `徽标「${badgeText}」`, r: badgeRect },
          ...buttons.map((b) => ({ label: b.textContent?.trim() ?? "", r: rect(b) })),
        ]
        const lines = []
        for (const item of items) {
          const line = lines.find((l) => item.r.top < l.bottom - 1 && item.r.bottom > l.top + 1)
          if (line) { line.members.push(item); line.top = Math.min(line.top, item.r.top); line.bottom = Math.max(line.bottom, item.r.bottom) }
          else lines.push({ top: item.r.top, bottom: item.r.bottom, members: [item] })
        }
        for (const line of lines) {
          const centers = line.members.map((m) => m.r.top + m.r.height / 2)
          const spread = Math.max(...centers) - Math.min(...centers)
          log(`[${expect}][${subject}] 同一行内徽标与按钮垂直居中（该行 ${line.members.length} 项）`,
            spread <= 2, `中线差 ${r1(spread)}px：${line.members.map((m) => m.label).join(" | ")}`)
        }

        /*
         * 按钮可用性逐按钮判定（见上面的三态契约）。
         * 注意 in-library 那一态：「绑定」必须仍然可用——用户反馈过
         * 「生成出来的角色可能第一时间没绑定」，所以入库不等于锁死绑定。
         */
        log(`[${expect}][${subject}] 按钮可用性与输入 fixture 相符（${expectedLabel}）`,
          buttons.every((b) => b.disabled === expectedDisabled(b.textContent ?? "")),
          buttons.map((b) => `${b.textContent?.trim()}=${b.disabled ? "disabled" : "enabled"}`).join(" | "))
      }
    }
    log("整份快照至少渲染出一个角色的按钮行", cardCount > 0, `${cardCount} 张卡片`)

    // —— 绑定对话框 ——
    // DialogContent 自带 w-full max-w-[calc(100%-2rem)]：任何视口下都应 <= 视口宽 - 32。
    const dialog = document.querySelector('[data-slot="dialog-content"]')
    log("快照里有绑定对话框", !!dialog)
    if (dialog) {
      const r = rect(dialog)
      log("对话框不超出视口宽度（含 32px 余量）",
        r.width <= window.innerWidth - 32 + 1,
        `width=${r1(r.width)} viewport=${window.innerWidth}`)
      log("对话框不超出视口高度",
        r.height <= window.innerHeight - 32 + 1,
        `height=${r1(r.height)} viewport=${window.innerHeight}`)
      // 内容超高时必须内部滚动，而不是把对话框撑出视口。
      log("对话框有可滚动的列表容器", !!dialog.querySelector(".overflow-y-auto"))
      // 没有大纲人物时的提示文案必须与 character-aura.ts 的常量一致。
      log("无候选人物时给出明确提示",
        !dialog.textContent.includes("请先在大纲中添加人物小传")
          || !!dialog.querySelector('[role="alert"]'),
        dialog.querySelector('[role="alert"]')?.textContent?.trim() ?? "(未出现提示)")
      const dialogButtons = [...dialog.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "")
      log("对话框有「取消」按钮", dialogButtons.some((l) => l.includes("取消")), dialogButtons.join(" | "))
      log("对话框有确认绑定按钮", dialogButtons.some((l) => l.includes("绑定所选")), dialogButtons.join(" | "))
      // 无障碍：仓库统一用 @base-ui/react 的 Dialog，它自带这两个语义。
      log("对话框有 role=dialog", dialog.getAttribute("role") === "dialog",
        dialog.getAttribute("role") ?? "(无)")
    }

    return { lines: out, failed: out.filter((l) => l.startsWith("FAIL")).length }
  })
  await page.close()
  return { ...result, pageErrors, width }
}

const browser = await chromium.launch()
const wide = await measure(browser, 1200)
const narrow = await measure(browser, 420)

const all = [
  ...wide.lines.map((l) => `[1200px] ${l}`),
  ...narrow.lines.map((l) => `[ 420px] ${l}`),
]
for (const line of all) console.log(line)

const pageErrors = [...wide.pageErrors, ...narrow.pageErrors]
const failed = wide.failed + narrow.failed
console.log(`\n失败项：${failed}`)
if (pageErrors.length) console.log(`页面异常：${pageErrors.join(" | ")}`)

// 留一张图，便于人工回看按钮行在窄屏下的换行情况。
const shot = await browser.newPage({ viewport: { width: 1200, height: 900 } })
await shot.setContent(html, { waitUntil: "load" })
await shot.screenshot({ path: path.join(here, "after-角色按钮与绑定对话框.png"), fullPage: true })
await shot.close()
await browser.close()

process.exit(failed === 0 && pageErrors.length === 0 ? 0 : 1)
