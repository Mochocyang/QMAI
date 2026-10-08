import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const interfaceSectionSource = readFileSync(resolve(__dirname, "sections/interface-section.tsx"), "utf8")
const settingsTypesSource = readFileSync(resolve(__dirname, "settings-types.ts"), "utf8")
const settingsViewSource = readFileSync(resolve(__dirname, "settings-view.tsx"), "utf8")
const bodyTypographySource = readFileSync(resolve(__dirname, "sections/body-typography-fields.tsx"), "utf8")
const wikiStoreSource = readFileSync(resolve(__dirname, "../../stores/wiki-store.ts"), "utf8")

describe("settings sidebar nav preferences", () => {
  it("stores sidebar nav config in the settings draft and saves it through the wiki store", () => {
    expect(settingsTypesSource).toContain("sidebarNavConfig")
    expect(settingsViewSource).toContain("const sidebarNavConfig = useWikiStore((s) => s.sidebarNavConfig)")
    expect(settingsViewSource).toContain("const setSidebarNavConfig = useWikiStore((s) => s.setSidebarNavConfig)")
    expect(settingsViewSource).toContain("setSidebarNavConfig(draft.sidebarNavConfig)")
  })

  it("renders a Chinese appearance section (skins + font settings) in interface settings", () => {
    expect(interfaceSectionSource).toContain("UI_TEST_SKINS")
    expect(interfaceSectionSource).toContain('data-ui="interface-skins"')
    expect(interfaceSectionSource).toContain("data-ui-skin-choice")
    expect(interfaceSectionSource).toContain('aria-label="推荐外观"')
    expect(interfaceSectionSource).toContain('setDraft("uiFontFamily"')
    expect(interfaceSectionSource).toContain('setDraft("uiFontSizeScale"')
    expect(interfaceSectionSource).toContain('type="range"')
  })

  /**
   * 界面字号范围的回归防线。
   *
   * 这个值原先在 wiki-store.ts 里硬编码两遍（读取已存值 / 写入时各一遍），
   * 只改一处会造成"设成 150%，下次启动读回被截成 130%"这种极难定位的缺陷。
   * 所以这里不只断言"当前值对"，而是断言"范围是单一来源"——
   * 任何一处重新出现硬编码数字都会让本用例变红。
   */
  it("界面字号范围的钳制逻辑是单一来源，不在 store 里各写一遍", () => {
    expect(interfaceSectionSource).toContain("UI_FONT_SIZE_MIN")
    expect(interfaceSectionSource).toContain("UI_FONT_SIZE_MAX")
    expect(interfaceSectionSource).not.toMatch(/min=\{85\}|max=\{130\}/)
    // store 的两处钳制都必须走同一个函数
    expect(wikiStoreSource.match(/clampUiFontSizeScale\(/g)?.length).toBe(2)
    // 且不得残留旧的硬编码边界（0.85/1.3 曾各自写在两处）
    expect(wikiStoreSource).not.toMatch(/Math\.max\(0\.85,\s*Math\.min\(1\.3/)
  })

  /**
   * 保存接线的回归防线。
   *
   * 为什么需要这条：现有渲染测试（ui-test-tools.spec.tsx）只渲染 InterfaceSection
   * 并传入 mock 的 setDraft，**从不经过 SettingsView.handleSave**。
   * 而在普通浏览器里 handleSave 会在第一个 Tauri 存储调用处抛错中断
   * （没有 Tauri 环境），所以"改字号 → 保存 → 真的生效"这条链路
   * 既没有被单元测试覆盖，也无法在浏览器里跑通。
   * 这是一段真实存在的覆盖空白，用源码断言先钉住接线本身，
   * 真正的端到端验证放在真实 exe（任务 10）。
   */
  it("保存时把草稿字号同时写入 store 与持久化，两者都来自 draft", () => {
    expect(settingsViewSource).toContain("setUiFontSizeScale(draft.uiFontSizeScale)")
    expect(settingsViewSource).toContain("saveUiFontSizeScale(draft.uiFontSizeScale")
    expect(settingsViewSource).toContain('const setUiFontSizeScale = useWikiStore((s) => s.setUiFontSizeScale)')
    // 只写 store 不持久化（或反之）都会造成"这次生效、下次启动丢失"
    const applyAt = settingsViewSource.indexOf("setUiFontSizeScale(draft.uiFontSizeScale)")
    const persistAt = settingsViewSource.indexOf("saveUiFontSizeScale(draft.uiFontSizeScale")
    expect(applyAt).toBeGreaterThan(-1)
    expect(persistAt).toBeGreaterThan(applyAt)
  })

  /**
   * 正文字体（独立设置）的接线防线。
   *
   * 计划的任务 6 只列了 font-settings.ts / ui-test.css / spec 三个文件，
   * **漏掉了让用户真正能用上它的那一段接线**（设置项、草稿字段、store、
   * 持久化、启动应用）。只改那三个文件的话：字体选项存在、CSS 也派生好了，
   * 但界面上没有地方可选 —— 功能等于没做。
   * 故在此把整条链路钉住，任何一环断掉都会变红。
   */
  it("正文字体接成完整一条链路：控件、草稿字段、store、持久化", () => {
    // 1) 控件在**共享组件**里（Task 9 把正文字体那一行搬进了 BodyTypographyFields：
    //    设置页与写作现场浮层共用同一份 JSX），接线仍要问设置页
    expect(bodyTypographySource).toContain("BODY_FONT_OPTIONS")
    expect(bodyTypographySource).toContain('aria-label="正文字体"')
    expect(interfaceSectionSource).toContain('setDraft("uiBodyFontFamily"')
    // 2) 草稿类型里有该字段（否则 setDraft 的类型对不上，tsc 会先报错）
    expect(settingsTypesSource).toContain("uiBodyFontFamily")
    // 3) store 有状态与 setter，且用**独立**的 localStorage 键
    expect(wikiStoreSource).toContain("uiBodyFontFamily: readStoredBodyFontFamily()")
    expect(wikiStoreSource).toContain("setUiBodyFontFamily:")
    expect(wikiStoreSource).toContain('const BODY_FONT_FAMILY_KEY = "qmai-body-font-family"')
    // 共用同一个键会让两个设置互相覆盖 —— 这正是要防的
    expect(wikiStoreSource).not.toContain('const BODY_FONT_FAMILY_KEY = "qmai-ui-font-family"')
    // 4) 保存时既写 store 也持久化（只做一个会"这次生效下次丢失"或反之）
    expect(settingsViewSource).toContain("setUiBodyFontFamily(draft.uiBodyFontFamily)")
    expect(settingsViewSource).toContain("saveUiBodyFontFamily(draft.uiBodyFontFamily")
    // 5) 界面字体也要照旧保存，不能被新字段挤掉
    expect(settingsViewSource).toContain("saveUiFontFamily(draft.uiFontFamily)")
  })

  /**
   * 正文字号（独立设置）的接线防线 —— 与正文字体同样的整条链路。
   *
   * 特别注意「两个范围必须各自独立」：界面字号 80%–150%、正文字号 85%–150%，
   * 若有人图省事让两者共用常量或共用 localStorage 键，
   * 会出现"改界面字号把正文字号也改了"这种极难排查的串味。
   */
  it("正文字号接成完整一条链路，且与界面字号各自独立", () => {
    // 1) 控件在**共享组件**里，且绑定到草稿字段
    //
    // 为什么必须看共享组件：设置页与写作现场用的是同一个组件。
    // 只看设置页会漏掉"控件搬走了但接线没跟上"这种情况。
    expect(bodyTypographySource).toContain("BODY_FONT_OPTIONS")
    expect(bodyTypographySource).toContain('aria-label="正文字体"')
    expect(bodyTypographySource).toContain('aria-label="正文字号预设"')
    expect(bodyTypographySource).toContain('aria-label="正文字号"')
    // 这 4 个滑块用**动态**属性 aria-label={label}，字面量只以 label="行间距" 这个
    // prop 的形式出现 —— 所以这里断言 prop，不能断言 aria-label="行间距"
    // （那样写永远不成立：源码里根本没有那个字符串）。
    // 两条一起断言：prop 传的标签对，且 aria-label 确实接到了它。
    expect(bodyTypographySource).toContain("aria-label={label}")
    for (const label of ["行间距", "字间距", "左右边距", "底部安全距离"]) {
      expect(bodyTypographySource).toContain(`label="${label}"`)
    }
    // 2) 设置页通过共享组件接线，而不是自己再写一套控件
    expect(interfaceSectionSource).toContain("BodyTypographyFields")
    expect(interfaceSectionSource).toContain('setDraft("uiBodyFontPx"')
    expect(interfaceSectionSource).toContain('setDraft("uiBodyLineHeight"')
    expect(interfaceSectionSource).toContain('setDraft("uiBodyLetterSpacing"')
    expect(interfaceSectionSource).toContain('setDraft("uiBodyMarginX"')
    expect(interfaceSectionSource).toContain('setDraft("uiBodySafeBottom"')
    // 3) 草稿类型里有这 6 个字段
    for (const field of ["uiBodyFontFamily", "uiBodyFontPx", "uiBodyLineHeight", "uiBodyLetterSpacing", "uiBodyMarginX", "uiBodySafeBottom"]) {
      expect(settingsTypesSource).toContain(field)
    }
    // 3) store：5 个新状态 + 5 个 setter + 5 个**互不相同**的 localStorage 键
    //
    // 键必须各不相同：共用一个键会让「改行距把字号也改了」这种串味缺陷
    // 出现，而且极难排查 —— 这是本仓库已经吃过一次的亏。
    const storeKeys = [
      ["uiBodyFontPx", "qmai-body-font-px"],
      ["uiBodyLineHeight", "qmai-body-line-height"],
      ["uiBodyLetterSpacing", "qmai-body-letter-spacing"],
      ["uiBodyMarginX", "qmai-body-margin-x"],
      ["uiBodySafeBottom", "qmai-body-safe-bottom"],
    ] as const
    const seenKeys = new Set<string>()
    for (const [field, key] of storeKeys) {
      expect(wikiStoreSource).toContain(`${field}: readStored`)
      expect(wikiStoreSource).toContain(`set${field[0].toUpperCase()}${field.slice(1)}:`)
      expect(wikiStoreSource).toContain(`"${key}"`)
      expect(seenKeys.has(key), `键 ${key} 被两个参数共用`).toBe(false)
      seenKeys.add(key)
    }
    // 正文字体仍有自己的键
    expect(wikiStoreSource).toContain('"qmai-body-font-family"')
    // 迁移必须走单一来源的纯函数，并且把**界面字号**传进去 ——
    // 自己写 bodyScale × 18 会让界面字号非 100% 的用户一升级正文就变小
    /*
     * ⚠ 必须断言**参数形态**，不能拆成两个独立的 toContain。
     *
     * 拆开的写法没有鉴别力：把
     *     resolveMigratedBodyFontPx(legacy, readStoredUiFontSizeScale())
     * 改成
     *     resolveMigratedBodyFontPx(legacy, 1)
     * 之后，"readStoredUiFontSizeScale()" 这个字符串仍然出现在
     * uiFontSizeScale: readStoredUiFontSizeScale() 那一行里，
     * 于是第二条断言照样通过 —— 而"迁移时忘了乘界面字号"正是
     * 界面 150% 的用户升级后正文变小的那个真实缺陷。
     *
     * 用正则而不是字面量，是为了容忍换行与空格：这行有 81 字符，
     * 折成三行是完全合理的写法，字面量 toContain 会因此假红。
     */
    expect(wikiStoreSource).toMatch(
      /resolveMigratedBodyFontPx\(\s*legacy\s*,\s*readStoredUiFontSizeScale\(\)\s*\)/,
    )
    // 旧倍数键必须保留只读（迁移要用），但不得再被写入
    expect(wikiStoreSource).toContain('const BODY_FONT_SIZE_SCALE_KEY = "qmai-ui-body-font-scale"')
    expect(wikiStoreSource).not.toContain("localStorage.setItem(BODY_FONT_SIZE_SCALE_KEY")
    // 4) 保存时既写 store 也持久化
    expect(settingsViewSource).toContain("setUiBodyFontSizeScale(draft.uiBodyFontSizeScale)")
    expect(settingsViewSource).toContain("saveUiBodyFontSizeScale(draft.uiBodyFontSizeScale")
    // 5) 界面字号照旧保存，不能被挤掉
    expect(settingsViewSource).toContain("saveUiFontSizeScale(draft.uiFontSizeScale")
  })

  /**
   * App.tsx 必须把 5 个排版参数**写在 documentElement 的行内样式上**，
   * 由 CSS 的间接层读取。
   *
   * ── 为什么把旧的一条整条替换掉，而不是删掉 ──
   * 旧断言钉的是「正文字号写成倍数变量，与界面字号相乘」。
   * 用户已确认把正文字号改成绝对 px，两者不再相乘 ——
   * 那条断言的**前提**消失了，不能留着（会永远红），
   * 但也不能只是删掉：它当时防的是"算好一个 px 写进 fontSize、
   * 两个设置互相覆盖"，那个风险依然存在，只是形态变了。
   * 现在防的是：值必须经由 applyBodyTypography 写变量，
   * 而不是被塞进 documentElement.style.fontSize。
   */
  it("App 通过 applyBodyTypography 应用 5 个排版变量，且与界面字号机制不同", () => {
    const appSource = readFileSync(resolve(__dirname, "../../App.tsx"), "utf8")
    expect(appSource).toContain("applyBodyTypography({")

    /*
     * 5 个参数的**配对**必须逐字对上。
     *
     * 为什么不能只断言「字段名 + 某个 uiBody* 名字」：
     * 那样写的话，把 lineHeight: uiBodyLineHeight 串成 lineHeight: uiBodySafeBottom
     * 仍然绿 —— tsc 也拦不住（五个值都是 number）。
     * 而"串味"正是这种一次写 5 个变量的写法最容易犯的错。
     */
    const APPLIED = [
      ["fontPx", "uiBodyFontPx"],
      ["lineHeight", "uiBodyLineHeight"],
      ["letterSpacing", "uiBodyLetterSpacing"],
      ["marginX", "uiBodyMarginX"],
      ["safeBottom", "uiBodySafeBottom"],
    ]
    for (const [field, storeField] of APPLIED) {
      expect(appSource).toContain(`${field}: ${storeField}`)
    }

    /*
     * 启动读回：**每一条读回都必须真的写进 store**。
     *
     * 这是本任务最容易漏、也最难发现的一步 —— 读回来了却忘了写回，
     * 编译过、界面不报错、本次会话也不报错，只有"重开软件设置回退"
     * 这一个症状，而它恰恰是启动读回存在的全部理由。
     * 所以这里断言的是"读回 + 判空 + 写回"三件事连成的整句原文：
     * 删掉写回那一行、把 setter 换错、把判空条件改坏，都会立刻变红。
     *
     * 注意 marginX 用的是 !== null（null 是合法值，表示"跟随窗口"，
     * 此时保留 store 默认值即可，不能写成 ?? 或把 null 也写进去）。
     */
    const ROUND_TRIP = [
      ["savedBodyFontPx", "UiBodyFontPx"],
      ["savedBodyLineHeight", "UiBodyLineHeight"],
      ["savedBodyLetterSpacing", "UiBodyLetterSpacing"],
      ["savedBodyMarginX", "UiBodyMarginX"],
      ["savedBodySafeBottom", "UiBodySafeBottom"],
    ]
    for (const [saved, suffix] of ROUND_TRIP) {
      expect(appSource).toContain(`await load${suffix}(`)
      expect(appSource).toContain(
        `if (${saved} !== null) useWikiStore.getState().set${suffix}(${saved})`,
      )
    }

    /*
     * 整个计划里最该被钉住的一行。
     *
     * 老用户只有旧键"正文倍数"，新字号 = 旧倍数 × 界面字号。
     * 迁移时若忘了把界面字号传进去，界面字号 150% 的用户升级后
     * 会发现正文**变小**了 —— 不报错、不崩溃，只是悄悄变了。
     * 这个缺陷在计划评审阶段真的出现过一次，所以宁可单独钉一行。
     */
    expect(appSource).toContain("await loadUiBodyFontPx(uiFontSizeScale)")

    /*
     * 依赖数组必须逐个列出那 5 个字段。
     *
     * 为什么这条不能省（Task 5 实现者实测发现，我复现确认）：
     * 把依赖数组改成 `[]` 时，上面**所有**断言照样全绿 ——
     * 源码文本一个字都没变，只有运行时行为变了。
     * 而 `[]` 让 applyBodyTypography 只在挂载时跑一次：
     * 挂载时 store 初值来自 localStorage（wiki-store 模块加载期的 readStored*），
     * 而启动读回读的是 app-state（project-store 的 getStore），
     * 读回值写进 store 后**不会**再落到 CSS 变量 ——
     * 于是本次会话"设置页显示 A、正文实际 B"，要下次启动才自愈。
     * 这正是本计划要根除的"设了没反应"同型缺陷，
     * 而升级迁移（老用户只有旧键）走的恰好是这条读回路径。
     *
     * ⚠ 必须**定位到这一个 effect 的依赖数组**，不能直接
     * `expect(appSource).toContain("[]")` 之类：App.tsx 里本来就有 3 个
     * 空依赖数组，那样写是恒真的（这正是本仓库反复踩的坑）。
     * 所以从 applyBodyTypography 调用处往后截取到它自己的 `])` 为止。
     * （截取的起点是**第一处**调用 —— 下面的"只有一个调用点"断言负责
     *  保证第一处就是唯一那处，否则这段会检查错对象。）
     */
    const callAt = appSource.indexOf("applyBodyTypography({")
    const afterCall = appSource.slice(callAt)
    const depsAt = afterCall.indexOf("}, [")
    const depsEnd = afterCall.indexOf("])", depsAt)
    const deps = depsAt >= 0 && depsEnd > depsAt ? afterCall.slice(depsAt, depsEnd) : ""
    for (const [, storeField] of APPLIED) {
      expect(deps).toContain(storeField)
    }

    /*
     * 界面字号机制不许被顺手删掉：它仍是根字号百分比（rem 基准），
     * 与正文的绝对 px 是两套机制。
     *
     * ⚠ 只断言上面这一行 token 是不够的 —— Task 5 的质量评审实测出两个漏网的变异：
     *     · 把值改成字面量 "100%"（界面字号从此永久失效）→ 绿
     *     · 把 deps 改成 []（改界面字号要重启才生效）→ 绿
     *   因为 `toContain` 只证明"这行还在"，对"值算什么"和"何时重跑"都不敏感。
     *   而同一个文件里紧邻的 applyBodyTypography 那条已经补了依赖数组断言，
     *   兄弟 effect 不能只靠一个 token 兜着 —— 那两个变异的用户可见后果
     *   与正文字号失效是同一类（"设了没反应"）。
     * 所以这里复刻同一种形状：定位到它自己的作用域，断言完整表达式 + 依赖数组。
     */
    const sizeAt = appSource.indexOf("document.documentElement.style.fontSize")
    expect(sizeAt).toBeGreaterThan(-1)
    // 到此 effect 结束为止的一小段（`}, [...])` 是它的收尾）
    const sizeTail = appSource.slice(sizeAt, appSource.indexOf("}, [", sizeAt) + 120)
    // 值必须是"界面字号 × 100 取整"这个表达式，不能是写死的百分比
    expect(sizeTail).toMatch(/Math\.round\(\s*uiFontSizeScale\s*\*\s*100\s*\)/)
    // 依赖数组必须跟着界面字号，否则改了要重启才生效
    expect(sizeTail).toMatch(/\},\s*\[\s*uiFontSizeScale\s*\]/)

    /*
     * 正文排版 effect 在全文件里**只能有一个调用点**。
     *
     * 为什么这条不是洁癖：上面那段依赖数组断言用 `indexOf("applyBodyTypography({")`
     * 取**第一处**。Task 5 的质量评审构造了一个诱饵 —— 在真实 effect 之前
     * 插一个文本完整的第二处调用，再把**真实** effect 的依赖数组改成 `[]`
     * （就是我们要防的那个 bug），依赖数组断言照样全绿，因为它检查的是诱饵。
     * 真实来源并不牵强：写作现场若也要应用一次排版、或旧写法被注释掉却留了
     * 完整文本，都会产生第二个调用点。
     * 钉住"只有一个"就把这种漂移变成红。
     */
    expect(
      appSource.split("applyBodyTypography({").length - 1,
      "applyBodyTypography 应只有一个调用点（多处会让依赖数组断言检查错对象）",
    ).toBe(1)

    /*
     * ── 控制流层：上面**全部**文本断言都原理上看不见的那一半 ──
     *
     * Task 5 的质量评审实测出两个漏网变异，它们比"改坏一个字面量"隐蔽得多：
     *   · `if (false) applyBodyTypography({…})` —— 5 个配对、5 条读回、
     *     正确的依赖数组**文本一个都没变**，功能却 100% 死掉；
     *   · 把 5 条「判空 + 写回」整块包进 `if (false) { … }` —— 同理。
     * 两者都全绿。这不是"变异无害"，是**源码文本断言对控制流不敏感**：
     * 它只能证明"这些字还在文件里"，证明不了"这行会被执行"。
     *
     * 而它们的用户可见后果正是本计划存在的理由：启动读回不执行
     * ⇒「重开软件设置就回退」。这个症状不会报错、不会崩，
     * 只有用户自己会发现 —— 与当初 F1 那个"界面 150% 的老用户正文变小"同类。
     *
     * 所以这一层改用 TypeScript AST：不看文本，看**语法结构**。
     * 两个判据：
     *   1. 那次调用/那 5 条写回必须是所在函数体里的**直接语句**，
     *      向上到函数体之间不能夹着 if / 三元；
     *   2. 依赖数组**逐项等于**那 5 个标识符（按 AST 取，不靠 indexOf 猜位置）。
     * 判据 2 顺带替掉"唯一调用点"那条的脆弱性来源：这里按 effect 找，
     * 不按"文件里第一次出现"找，诱饵骗不到它。
     */
    const sf = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    /*
     * `parseDiagnostics` 存在于运行时，但**不在** SourceFile 的公开类型上
     * （TypeScript 把它标成内部字段）。所以这里显式取交集类型，而不是
     * `as any` —— 保留"它是个诊断数组"这个信息，也避免把整行类型关掉。
     * 断言它的意义：这个 AST 守卫的一切结论都建立在"文件能解析"之上；
     * 若解析失败（例如有人把 App.tsx 改成语法错误），AST 会静默退化成一堆
     * 残缺节点，后面的"找不到 if 包裹"就会**假绿**。所以先钉住解析是否成功。
     */
    const parseDiagnostics = (sf as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] })
      .parseDiagnostics
    expect(parseDiagnostics, "App.tsx 应能被解析（否则这个 AST 守卫会假绿）").toHaveLength(0)

    const isFunctionLike = (n: ts.Node): boolean =>
      ts.isArrowFunction(n) ||
      ts.isFunctionExpression(n) ||
      ts.isFunctionDeclaration(n) ||
      ts.isMethodDeclaration(n)

    /** 从 node 向上走到最近的函数体；途中遇到 if / 三元即视为"可能不执行"。 */
    const conditionallyGuarded = (node: ts.Node): boolean => {
      let cur: ts.Node | undefined = node.parent
      while (cur && !isFunctionLike(cur)) {
        if (ts.isIfStatement(cur) || ts.isConditionalExpression(cur)) return true
        cur = cur.parent
      }
      return false
    }

    const effectNodes: ts.CallExpression[] = []
    const collectEffects = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "useEffect"
      ) {
        effectNodes.push(node)
      }
      ts.forEachChild(node, collectEffects)
    }
    collectEffects(sf)
    expect(effectNodes.length, "App.tsx 里应能找到多个 useEffect").toBeGreaterThan(1)

    // (1) 排版 effect：依赖数组按 AST 逐项核对
    const applyEffect = effectNodes.find((e) => e.getText().includes("applyBodyTypography"))
    expect(applyEffect, "应有一个 useEffect 调用 applyBodyTypography").toBeDefined()
    if (applyEffect) {
      const depsArg = applyEffect.arguments[1]
      expect(
        ts.isArrayLiteralExpression(depsArg),
        "排版 effect 必须有显式依赖数组（省略它会让它每次渲染都跑）",
      ).toBe(true)
      if (ts.isArrayLiteralExpression(depsArg)) {
        expect(depsArg.elements.map((e) => e.getText())).toEqual([
          "uiBodyFontPx",
          "uiBodyLineHeight",
          "uiBodyLetterSpacing",
          "uiBodyMarginX",
          "uiBodySafeBottom",
        ])
      }

      let callNode: ts.CallExpression | null = null
      const findApplyCall = (n: ts.Node): void => {
        if (
          !callNode &&
          ts.isCallExpression(n) &&
          ts.isIdentifier(n.expression) &&
          n.expression.text === "applyBodyTypography"
        ) {
          callNode = n
        }
        ts.forEachChild(n, findApplyCall)
      }
      findApplyCall(applyEffect)
      expect(callNode, "应在该 effect 里找到 applyBodyTypography 调用").not.toBeNull()
      if (callNode) {
        expect(
          conditionallyGuarded(callNode),
          "applyBodyTypography 不能被 if / 三元包着 —— 文本断言看不见这种死代码",
        ).toBe(false)
      }
    }

    // (2) 5 条启动读回写回同样不许被包在条件里
    /*
     * 判据必须**窄**：第一版写成「thenStatement 里出现 useWikiStore.getState().set」
     * 就收录，结果匹配到 **22** 条 —— App.tsx 里还有别的"判空后写 store"。
     * 那样断言"恰好 5 条"会直接红，而放宽成"至少 5 条"又会让真正那 5 条
     * 被别的语句稀释掉（用户可见后果完全不同：读回缺失才是"重开设置回退"）。
     * 所以这里要求 thenStatement 是**单条表达式**、且整条文本就是
     * `useWikiStore.getState().setXxx(yyy)` 这一种形状。
     */
    const WRITE_BACK = /^useWikiStore\.getState\(\)\.set[A-Za-z]+\([A-Za-z]+\)$/
    const writeBacks: ts.IfStatement[] = []
    const collectWriteBacks = (node: ts.Node): void => {
      if (
        ts.isIfStatement(node) &&
        ts.isExpressionStatement(node.thenStatement) &&
        WRITE_BACK.test(node.thenStatement.getText())
      ) {
        writeBacks.push(node)
      }
      ts.forEachChild(node, collectWriteBacks)
    }
    collectWriteBacks(sf)
    expect(writeBacks.length, "应恰好有 5 条「判空 + 写回 store」").toBe(5)
    for (const wb of writeBacks) {
      expect(
        conditionallyGuarded(wb),
        `读回写回不能被 if / 三元包裹（否则重开软件设置就回退）：${wb.getText().slice(0, 70)}`,
      ).toBe(false)
    }
  })
})
