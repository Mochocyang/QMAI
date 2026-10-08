import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const interfaceSectionSource = readFileSync(resolve(__dirname, "sections/interface-section.tsx"), "utf8")
const settingsTypesSource = readFileSync(resolve(__dirname, "settings-types.ts"), "utf8")
const settingsViewSource = readFileSync(resolve(__dirname, "settings-view.tsx"), "utf8")
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
    // 1) 设置页有控件，且绑定到草稿的新字段
    expect(interfaceSectionSource).toContain("BODY_FONT_OPTIONS")
    expect(interfaceSectionSource).toContain('aria-label="正文字体"')
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
    // 1) 设置页有两行控件（预设下拉 + 滑块），分别绑定各自字段
    expect(interfaceSectionSource).toContain('aria-label="正文字号预设"')
    expect(interfaceSectionSource).toContain('aria-label="正文字号"')
    expect(interfaceSectionSource).toContain('setDraft("uiBodyFontSizeScale"')
    expect(interfaceSectionSource).toContain("BODY_FONT_SIZE_PRESETS")
    expect(interfaceSectionSource).toContain("BODY_FONT_SIZE_MIN")
    expect(interfaceSectionSource).toContain("BODY_FONT_SIZE_MAX")
    // 2) 草稿类型里有该字段
    expect(settingsTypesSource).toContain("uiBodyFontSizeScale")
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
     * 界面字号机制不许被顺手删掉：它仍是根字号百分比（rem 基准），
     * 与正文的绝对 px 是两套机制。
     * （这条只防"删掉"，不证明"互不覆盖" —— 后者由上面两条配对/写回断言保证。）
     */
    expect(appSource).toContain("document.documentElement.style.fontSize")
  })
})
