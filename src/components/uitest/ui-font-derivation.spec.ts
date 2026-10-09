import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import postcss from "postcss"
import { describe, expect, it } from "vitest"
import { DEFAULT_UI_FONT_FAMILY, getUiFontFamilyCss } from "@/lib/font-settings"

const uitestCss = readFileSync(resolve(__dirname, "ui-test.css"), "utf8")
const indexCss = readFileSync(resolve(__dirname, "../../index.css"), "utf8")

/**
 * 界面/正文层可能消费字体变量的全部样式表。
 *
 * 必须扫**全目录**而不是只看 ui-test.css：字体变量是跨文件消费的
 * （`--serif` 的消费点分布在 6 个文件里），只扫定义处等于只检查了变量名，
 * 检查不到"谁在用它"—— 而用户报的缺陷恰恰是**消费点**错了。
 */
const CSS_FILES = [
  "ui-test.css",
  "ui-test-editor.css",
  "ui-test-tools.css",
  "ui-test-shelf.css",
  "ui-test-ai.css",
  "models/model-settings.css",
]

/* ────────────────────────────────────────────────────────────────────────
 * 正文作用域判定（放在模块级，好让反向控制直接测**这一个**函数本身）
 *
 * 判据要回答的问题是：*这条规则的**全部**命中目标里，有没有一个是界面元素？*
 * 只要有一个，正文字体就会漏到界面上 —— 正是用户报的那条缺陷。
 *
 * ── 为什么不能用 `selector.includes(".ui-test-editor-body")` 一票判定 ──
 *
 * 这个写法被证伪过两次，两次都是**真实泄漏**而判定为合规：
 *
 *   ① 顶层逗号（最终整体审查第 4 条）：
 *        `.ui-test-editor-body .x, .ui-test-root .ui-test-brand-name`
 *      整串含 DOC_SCOPE → 判绿；而第二个分支会把正文字体打到品牌名上。
 *      当时的修法是改用 postcss 的 `rule.selectors` 逐个分支判定。
 *
 *   ② `:is()` / `:where()` 的内部逗号（本轮终审第 1 条）：
 *        `.ui-test-root :is(.ui-test-editor-body, .ui-test-brand-name)`
 *      `rule.selectors` **只在顶层逗号切分**，`:is()` 里的逗号不切，
 *      于是整串仍然含 DOC_SCOPE → 又判绿。
 *      而这条是**真的会赢**的：`:is(...)` 取参数里最高的特异性，
 *      `.ui-test-root` + `:is(类, 类)` = (0,2,0)，压过
 *      `ui-test.css` 里 `.ui-test-brand-name { font: … var(--serif) }` 的 (0,1,0)。
 *      品牌名真的会被改成 var(--body-font)。
 *
 * 教训：**"整串里出现过某个子串"永远不等于"这条规则只作用于那个作用域"。**
 * 所以判定必须一直在做**语义展开**，而不是字符串包含。
 *
 * ── 两道互相独立的网 ──
 *
 *   A. 覆盖网：把 `:is()` / `:where()` 的并列分支**展开成具体变体**，
 *      **每一个**变体都必须落在正文作用域内（用类名 token 判定，不是子串 ——
 *      `.ui-test-editor-body-foo` 这种别的类名不许冒充）。
 *   B. 黑名单网：任何变体里出现**已知界面表面**的类名/属性即违规。
 *      它独立于 A：A 抓"根本没有正文作用域"的越界，
 *      B 抓"有正文作用域、但顺手把界面元素也写进去"的越界
 *      （`.ui-test-editor-body .ui-test-brand-name`），
 *      后者 A 单独看是合规的。
 *
 * `:not()` **不参与并列展开**，这是刻意的语义区分，不是遗漏：
 *   · `:is(a, b)` / `:where(a, b)` = **并列**（命中任一即生效）→ 会**放宽**作用域，
 *     所以每个分支都必须单独判定；
 *   · `:not(a, b)` = **排除**（命中任一即不生效）→ 只会**收窄**作用域，
 *     不可能让它多命中一个界面元素。
 * 把 `:not()` 也当并列展开会造出**假红**：`.ui-test-editor-body:not(.ui-test-brand-name)`
 * 其实完全合规（"正文里、但不是品牌名"，而品牌名本来就不在正文里）。
 * 所以黑名单扫描前必须先把 `:not(…)` 整段摘掉。
 * ──────────────────────────────────────────────────────────────────────── */

/** 正文作用域的类名 token。用负向先行断言挡住 `.ui-test-editor-body-foo` 这类同前缀的别的类。 */
const DOC_SCOPE_RE = /\.ui-test-editor-body(?![\w-])/

/**
 * 已知的**界面表面**标记：只出现在界面 chrome 上，任何消费 `var(--body-font)`
 * 的规则都不许把目标指到这里。
 *
 * 这是一份黑名单，天然不可能完备 —— 但它是**第二道**网，作用是在
 * "正文作用域确实写了、却顺手带上界面选择器"这种 A 网看不见的形态上报警。
 * 新增界面标题类时不需要维护它（A 网仍在守），
 * 但若某人把正文字体挂到一个新的界面类上，这里会缺一条 —— 属于**已知边界**。
 */
const UI_ONLY_MARKERS = [
  ".ui-test-brand-name",
  ".ui-test-page-title",
  ".ui-test-cover-title",
  ".ui-test-editor-title",
  ".ui-test-ai-empty",
  ".model-empty",
  '[data-ui="tool-title"]',
  '[data-ui-reference="dialog"]',
  '[data-slot="dialog-title"]',
]

/** 按**顶层**逗号切分（括号/方括号里的逗号不算）。 */
function splitTopLevel(input: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (c === "(" || c === "[") depth += 1
    else if (c === ")" || c === "]") depth -= 1
    else if (c === "," && depth === 0) { out.push(input.slice(start, i)); start = i + 1 }
  }
  out.push(input.slice(start))
  return out.map((s) => s.trim()).filter((s) => s.length > 0)
}

/**
 * 把选择器里所有 `:is()` / `:where()` 的并列分支**穷举展开**成具体变体。
 *
 * 展开是"删掉构造、留下参数"：`:is(a, b)` 在 `X :is(a, b) Y` 里
 * 等价于 `X a Y` 或 `X b Y` —— 两条都要判。
 * 递归处理嵌套（`:is(:where(a, b), c)`），因为嵌套同样能藏越界分支。
 *
 * 括号不配平（语法坏了）时**返回 null**，由调用方报红 —— 不许静默当成合规。
 * 超过步数上限同样返回 null（防构造出指数爆炸的选择器把测试挂死）。
 */
function expandAlternatives(selector: string, budget = { left: 64 }): string[] | null {
  const re = /:(?:is|where)\(/g
  const m = re.exec(selector)
  if (!m) return [selector]
  if (budget.left-- <= 0) return null

  const open = m.index + m[0].length - 1
  let depth = 0
  let close = -1
  for (let i = open; i < selector.length; i++) {
    if (selector[i] === "(") depth += 1
    else if (selector[i] === ")") { depth -= 1; if (depth === 0) { close = i; break } }
  }
  if (close < 0) return null

  const args = splitTopLevel(selector.slice(open + 1, close))
  if (args.length === 0) return null

  const out: string[] = []
  for (const arg of args) {
    const replaced = selector.slice(0, m.index) + arg + selector.slice(close + 1)
    const sub = expandAlternatives(replaced, budget)
    if (sub === null) return null
    out.push(...sub)
  }
  return out
}

/** 摘掉所有 `:not(…)` 整段（含嵌套），因为排除只会收窄作用域，不该触发黑名单。 */
function stripNegations(selector: string): string {
  let out = selector
  for (let guard = 0; guard < 32; guard++) {
    const m = /:not\(/.exec(out)
    if (!m) return out
    const open = m.index + m[0].length - 1
    let depth = 0
    let close = -1
    for (let i = open; i < out.length; i++) {
      if (out[i] === "(") depth += 1
      else if (out[i] === ")") { depth -= 1; if (depth === 0) { close = i; break } }
    }
    if (close < 0) return out // 括号坏了：原样返回，交给覆盖网报红
    out = out.slice(0, m.index) + out.slice(close + 1)
  }
  return out
}

/**
 * 一个**已展开的具体变体**是否只作用于文档正文。
 * 注意是"类名 token"判定（`DOC_SCOPE_RE`），不是子串包含。
 */
function variantIsDocContentOnly(variant: string): boolean {
  if (!DOC_SCOPE_RE.test(variant)) return false
  const bare = stripNegations(variant)
  return !UI_ONLY_MARKERS.some((marker) => bare.includes(marker))
}

/** 一条规则是否**整体**只作用于文档正文：展开后每个变体都必须满足。 */
function ruleIsDocContentOnly(rule: { selectors: string[] }): boolean {
  for (const selector of rule.selectors) {
    const variants = expandAlternatives(selector)
    if (variants === null) return false // 展开不了 = 判不了 = 不许放过
    if (variants.length === 0) return false
    if (!variants.every(variantIsDocContentOnly)) return false
  }
  return true
}

/** 报错时用：列出这条规则里具体哪些变体越界，省得人眼在长选择器里找。 */
function offenderVariants(rule: { selectors: string[] }): string[] {
  const bad: string[] = []
  for (const selector of rule.selectors) {
    const variants = expandAlternatives(selector)
    if (variants === null) { bad.push(`${selector} （:is()/:where() 括号不配平，无法判定）`); continue }
    for (const v of variants) if (!variantIsDocContentOnly(v)) bad.push(v)
  }
  return bad
}

/**
 * 界面字体（--ui）的生效链路回归防线。
 *
 * 背景：`--ui` 曾硬编码成一套字体栈，而 `applyUiFontFamily` 把用户选择写进
 * `--qmai-ui-font-family` —— 两者之间没有任何连接，于是「界面字体」设置
 * 形同虚设（实测：改 --qmai-ui-font-family 后 32 个界面文字元素中有 0 个变化）。
 * 这类缺陷不会报错、不会有类型问题，读代码时两个名字又都像"字体"，
 * 极易被改回去。所以这里用静态断言把链路钉住，
 * 配合 verify-ui-font-applies.mjs（真实浏览器 + Chromium 真实渲染字体）双重覆盖。
 */
describe("界面字体生效链路", () => {
  it("--ui 派生自 --qmai-ui-font-family，不再硬编码字体栈", () => {
    let value: string | undefined
    postcss.parse(uitestCss).walkDecls("--ui", (decl) => { value = decl.value })
    expect(value).toBe("var(--qmai-ui-font-family)")
    // 任何硬编码的中文字体名出现在 --ui 里都意味着通路又断了
    expect(value).not.toMatch(/PingFang|YaHei|SimSun|SimHei|serif/)
  })

  it("--ui、--serif、--body-font 各自只有一处定义，且互不牵连", () => {
    const collect = (prop: string) => {
      const out: string[] = []
      postcss.parse(uitestCss).walkDecls(prop, (decl) => { out.push(decl.value) })
      return out
    }
    const ui = collect("--ui")
    const serif = collect("--serif")
    const body = collect("--body-font")
    expect(ui).toHaveLength(1)
    expect(serif).toHaveLength(1)
    expect(body).toHaveLength(1)
    // 界面衬线层不能跟着界面字体走，也不能跟着正文字体走
    expect(serif[0]).not.toContain("--qmai-ui-font-family")
    expect(serif[0]).not.toContain("--qmai-body-font-family")
  })

  it("--serif 固定不派生；--body-font 派生自正文字体且回退栈与改造前逐字一致", () => {
    /*
     * ⚠ 本条**曾经断言的是相反的**：过去要求 `--serif` 必须包含
     * `var(--qmai-body-font-family`，即让整个界面衬线层跟随正文字体。
     *
     * 那条断言把用户要报的缺陷**钉成了"正确行为"** —— 真机实测（
     * verify-real-exe-settings-save.mjs 用例 5）当时打印的是
     * 「正文衬线层(brand): KaiTi（按设计跟随正文字体 = KaiTi）」，
     * 即品牌名跟着正文字体变了，脚本却判为"设计一致 ✓"。
     * 用户随后反馈「在章节正文里调整字体，整个界面的字体都变了」。
     *
     * 教训：**一条只描述现状的断言，会把缺陷固化成契约。**
     * 现在这里同时钉住两个相反方向 —— 只看其中一边都会漏：
     *   · --serif 必须固定（界面不跟着正文变）
     *   · --body-font 必须派生（正文真的跟着变）
     */
    let serifValue: string | undefined
    postcss.parse(uitestCss).walkDecls("--serif", (decl) => { serifValue = decl.value })
    expect(serifValue).not.toContain("var(")
    expect(serifValue).toBe('"Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif')

    let bodyValue: string | undefined
    postcss.parse(uitestCss).walkDecls("--body-font", (decl) => { bodyValue = decl.value })
    expect(bodyValue).toContain("var(--qmai-body-font-family")
    // 回退栈必须与改造前 --serif 的取值完全相同：未设置变量时
    // （首屏、以及任何不经过 JS 的场景）行为必须与改造前一致
    const fallback = bodyValue!.slice(bodyValue!.indexOf(",") + 1).replace(/\)\s*$/, "").trim()
    expect(fallback).toBe('"Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif')
  })

  it("--body-font 只允许文档正文消费；界面选择器一律用 --serif（用户报过的缺陷）", () => {
    /*
     * 用户缺陷的防回归线：在章节里改正文字体，**只能**改到文档正文，
     * 不能改到界面（品牌名 / 页面标题 / 书封标题 / 对话框标题 / 空状态标题）。
     *
     * 判据与它的两道网、以及"为什么不能拿整串 includes"的完整推演，
     * 都写在文件上方的 `ruleIsDocContentOnly` 注释里 —— 那里是判定本身，
     * 这里是它在**真实样式表**上的应用。
     *
     * 白名单本身可能因为变量改名而变成**空集**，那时"没有违规"是假绿 ——
     * 所以另加一条"必须真的有人在用"的下限。
     */
    const offenders: { file: string; selector: string; bad: string[] }[] = []
    let consumers = 0
    for (const file of CSS_FILES) {
      const css = readFileSync(resolve(__dirname, file), "utf8")
      postcss.parse(css).walkRules((rule) => {
        const usesBodyFont = rule.nodes?.some(
          (node) => node.type === "decl" && String((node as { value?: string }).value ?? "").includes("var(--body-font)"),
        )
        if (!usesBodyFont) return
        consumers += 1
        if (!ruleIsDocContentOnly(rule)) {
          offenders.push({ file, selector: rule.selector, bad: offenderVariants(rule) })
        }
      })
    }

    expect(consumers, "没有任何规则消费 --body-font —— 正文字体设置会完全失效（白名单成了空集）").toBeGreaterThanOrEqual(2)
    expect(offenders, `以下规则消费了 --body-font 但带有界面选择器分支，会把正文字体漏到界面上：${JSON.stringify(offenders, null, 2)}`).toEqual([])

    /*
     * ── 反向控制：判定函数必须能识破每一类越界写法 ──
     *
     * ⚠ 这里的**每一条**都是一次真实漏检换来的，不是凑数：
     *   · 单选择器：证判定不是恒 false 也不是恒 true；
     *   · 顶层逗号列表：第 4 条审查查出的洞；
     *   · `:is()` 并列：本轮终审查出的洞（`rule.selectors` 不切内部逗号）；
     *   · `:where()` 并列：与 `:is()` 同源，单独列是因为"只修了 :is()"是常见半修；
     *   · 正文作用域内嵌界面类：只有黑名单那道网能抓，覆盖网单独看是合规的。
     * 若只喂单选择器，这个洞会**永远**碰不到 —— 那就是"守卫恒绿"。
     */
    const parsed = (css: string) => {
      let rule: { selectors: string[] } | null = null
      postcss.parse(css).walkRules((r) => { rule = r as unknown as { selectors: string[] } })
      if (!rule) throw new Error(`反向控制的 CSS 没解析出规则：${css}`)
      return rule
    }

    // 合规侧（先证明判定**不是**"凡列表皆红"、也不是"凡伪类皆红"）
    expect(ruleIsDocContentOnly(parsed(".ui-test-root .ui-test-editor-body .ProseMirror { font-family: var(--body-font); }")))
      .toBe(true)
    expect(ruleIsDocContentOnly(parsed(".ui-test-root .ui-test-editor-body .x, .ui-test-root .ui-test-editor-body .y { font-family: var(--body-font); }")),
      "纯正文的逗号列表必须仍判合规，否则这条判据会退化成「凡列表皆红」").toBe(true)
    expect(ruleIsDocContentOnly(parsed(".ui-test-root :is(.ui-test-editor-body, .ui-test-editor-body) .p { font-family: var(--body-font); }")),
      "两个分支都在正文作用域内的 :is() 必须判合规，否则会误伤合法写法").toBe(true)
    expect(ruleIsDocContentOnly(parsed(".ui-test-root .ui-test-editor-body:not(.ui-test-brand-name) { font-family: var(--body-font); }")),
      ":not() 只会收窄作用域（排除界面类反而更安全），必须判合规 —— 把 :not() 当并列展开是假红").toBe(true)

    // 违规侧（每一类都必须被抓）
    const violations: [string, string][] = [
      ["单选择器：界面元素", ".ui-test-root .ui-test-brand-name { font-family: var(--body-font); }"],
      ["顶层逗号：正文 + 界面", ".ui-test-root .ui-test-editor-body .x, .ui-test-root .ui-test-brand-name { font-family: var(--body-font); }"],
      ["★ :is() 并列界面选择器（本轮终审的洞）", ".ui-test-root :is(.ui-test-editor-body, .ui-test-brand-name) { font-family: var(--body-font); }"],
      ["★ :where() 并列界面选择器", ".ui-test-root :where(.ui-test-editor-body, .ui-test-brand-name) { font-family: var(--body-font); }"],
      ["★ :is() 把界面选择器写在前面", ".ui-test-root:is(.ui-test-brand-name, .ui-test-editor-body) { font-family: var(--body-font); }"],
      ["★ 嵌套 :is(:where(…)）", ".ui-test-root :is(:where(.ui-test-editor-body), .ui-test-brand-name) { font-family: var(--body-font); }"],
      ["★ 正文作用域内嵌界面类（只有黑名单网能抓）", ".ui-test-root .ui-test-editor-body .ui-test-brand-name { font-family: var(--body-font); }"],
      ["★ 同前缀的别的类名不许冒充正文作用域", ".ui-test-root .ui-test-editor-body-wide { font-family: var(--body-font); }"],
    ]
    /*
     * ⚠ 每一项都必须先能被 postcss 解析出**一条规则**，然后才谈得上判定。
     * 否则"没被漏检"可能只是因为压根没解析出东西（假绿）。
     */
    const missed = violations.filter(([, css]) => ruleIsDocContentOnly(parsed(css)))
    expect(missed, `以下越界写法被判定为合规 —— 守卫有洞：${JSON.stringify(missed)}`).toEqual([])
    expect(violations.length).toBeGreaterThanOrEqual(8)

    /*
     * 括号不配平的 `:is(` **不能**放进上面那张表：postcss 自己就会拒绝它
     * （`Unclosed bracket`），走 `parsed()` 会抛在解析阶段，
     * 于是这条"断言"测的是 postcss 而不是我的判定 —— 我第一版就是这么写的，
     * 报错在 `postcss.parse` 上。所以直接测判定函数：
     * 展开不了就必须判 false（判不了 ≠ 可以放过）。
     */
    expect(expandAlternatives(".ui-test-root :is(.ui-test-editor-body")).toBeNull()
    expect(expandAlternatives(".ui-test-root :is(.ui-test-editor-body) .p")).toEqual([".ui-test-root .ui-test-editor-body .p"])
    expect(
      ruleIsDocContentOnly({ selectors: [".ui-test-root :is(.ui-test-editor-body"] }),
      "括号不配平（判不了）时必须判违规，不许因为「判不了」而放过",
    ).toBe(false)
  })

  it("index.css 的 :root 默认值与 font-settings 的默认选项逐字一致", () => {
    // 两处若不一致，applyUiFontFamily 生效前后会各用一套字体：
    // 首屏闪一下再变，且默认观感与设置里显示的"本机默认"不符。
    // 实测本机上"PingFang 优先"与"system-ui 优先"渲染结果完全相同，
    // 所以这种不一致不会被肉眼或像素测试发现，只能靠静态比对拦住。
    let rootValue = ""
    postcss.parse(indexCss).walkRules((rule) => {
      if (rule.selector !== ":root") return
      rule.walkDecls("--qmai-ui-font-family", (decl) => { rootValue = decl.value })
    })
    const normalize = (s: string) => s.replace(/\s+/g, " ").replace(/,\s*/g, ",").trim()
    expect(normalize(rootValue)).toBe(normalize(getUiFontFamilyCss(DEFAULT_UI_FONT_FAMILY)))
  })

  it("默认选项保留改造前的栈顺序，避免改变默认观感", () => {
    // 改造前 --ui 的实际取值（Windows 上真正命中的是 Microsoft YaHei UI）
    const css = getUiFontFamilyCss(DEFAULT_UI_FONT_FAMILY)
    expect(css.startsWith('"PingFang SC", "Microsoft YaHei UI"')).toBe(true)
    expect(css).toContain("Microsoft YaHei")
    expect(css.trim().endsWith("sans-serif")).toBe(true)
  })
})
