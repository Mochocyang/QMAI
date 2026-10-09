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
     * 判据做成"白名单 + 反向控制"，而不是"数一数有几个"：
     *   · 每个消费 --body-font 的选择器都必须落在文档正文作用域内
     *     （即必须包含 `.ui-test-editor-body`）；新增一条漏到界面的规则会立刻红。
     *   · 白名单本身可能因为变量改名而变成**空集**，那时"没有违规"是假绿 ——
     *     所以另加一条"必须真的有人在用"的下限。
     *   · 反向控制：把一条已知的界面选择器喂给同一个判定函数，必须被判违规。
     *     否则"没报违规"可能只是判定函数恒不返回违规。
     *
     * ⚠ **必须按逗号逐个判定，不能拿整串 `rule.selector` 去 includes**
     * （最终整体审查第 4 条查出的真实漏洞）：
     *   `.ui-test-editor-body .x, .ui-test-root .ui-test-brand-name { font-family: var(--body-font) }`
     * 整串里含 `.ui-test-editor-body`，用 `includes` 会判成合规 → 漏检。
     * 而"在一条已有规则后面顺手追加一个界面选择器"恰恰是这条缺陷最可能的复发姿势，
     * 因为把两条选择器合并成一条是最省事的写法。
     * PostCSS 的 `rule.selectors` 已经帮我们分好了，用它逐个判即可。
     * 反向控制也因此必须**专门喂一条逗号列表** —— 只喂单选择器永远碰不到这个洞，
     * 会给"判定函数是活的"一种虚假的安心。
     */
    const DOC_SCOPE = ".ui-test-editor-body"
    const isDocContentSelector = (selector: string) => selector.includes(DOC_SCOPE)
    /** 一条规则是否**整体**落在文档正文作用域内：每个逗号分支都必须满足。 */
    const ruleIsDocContentOnly = (rule: { selectors: string[] }) => rule.selectors.every(isDocContentSelector)

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
          // 记下具体是哪几个分支越界 —— 只报整串的话，长选择器里要人眼自己找
          offenders.push({ file, selector: rule.selector, bad: rule.selectors.filter((s) => !isDocContentSelector(s)) })
        }
      })
    }

    expect(consumers, "没有任何规则消费 --body-font —— 正文字体设置会完全失效（白名单成了空集）").toBeGreaterThanOrEqual(2)
    expect(offenders, `以下规则消费了 --body-font 但带有界面选择器分支，会把正文字体漏到界面上：${JSON.stringify(offenders, null, 2)}`).toEqual([])

    // 反向控制：同一判定必须能识破界面选择器
    expect(isDocContentSelector(".ui-test-root .ui-test-brand-name")).toBe(false)
    expect(isDocContentSelector(".ui-test-root [data-ui='tool-title']")).toBe(false)
    expect(isDocContentSelector(".ui-test-root .ui-test-editor-body .ProseMirror")).toBe(true)
    /*
     * 反向控制（针对上面那个洞本身）：逗号列表里只要**有一个**分支越界，
     * 整条规则就必须被判违规。分号后两段是断言的两个方向 ——
     * 纯正文的列表仍须合规，否则这条判据会变成"凡列表皆红"。
     */
    const mixed = postcss.parse(
      ".ui-test-root .ui-test-editor-body .x, .ui-test-root .ui-test-brand-name { font-family: var(--body-font); }",
    )
    let sawRule = false
    mixed.walkRules((rule) => { sawRule = true; expect(ruleIsDocContentOnly(rule), `逗号列表混入界面选择器却判为合规：${rule.selector}`).toBe(false) })
    expect(sawRule, "反向控制的前提：上面那段 CSS 必须能解析出一条规则").toBe(true)
    const pureList = postcss.parse(
      ".ui-test-root .ui-test-editor-body .x, .ui-test-root .ui-test-editor-body .y { font-family: var(--body-font); }",
    )
    pureList.walkRules((rule) => { expect(ruleIsDocContentOnly(rule)).toBe(true) })
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
