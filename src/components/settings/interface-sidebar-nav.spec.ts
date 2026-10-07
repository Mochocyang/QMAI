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
})
