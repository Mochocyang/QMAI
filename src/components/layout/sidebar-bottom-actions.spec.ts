import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(
  resolve(__dirname, "sidebar-bottom-actions.tsx"),
  "utf8",
)

describe("sidebar-bottom-actions", () => {
  it("renders 设置 first (left) and 外观 second (right)", () => {
    expect(source).toContain('t("sidebarActions.settings")')
    expect(source).toContain('t("sidebarActions.appearance")')
    expect(source).toContain('data-ui="sidebar-bottom-actions"')

    const settingsIndex = source.indexOf('t("sidebarActions.settings")')
    const appearanceIndex = source.indexOf('t("sidebarActions.appearance")')
    expect(settingsIndex).toBeGreaterThan(-1)
    expect(appearanceIndex).toBeGreaterThan(-1)
    expect(settingsIndex).toBeLessThan(appearanceIndex)
  })

  it("wires 外观 to the skin switcher (静水 / 纸间 / 星夜) from the shell context", () => {
    expect(source).toContain("useAppearanceSkin")
    expect(source).toContain("UI_TEST_SKINS")
    expect(source).toContain("selectSkin")
    expect(source).toContain("ui-test-skin-menu")
    expect(source).toContain("menuitemradio")
  })

  it("no longer owns a light/dark theme dropdown", () => {
    expect(source).not.toContain("applyTheme")
    expect(source).not.toContain("saveTheme")
    expect(source).not.toContain("THEME_OPTIONS")
  })

  it("opens the skin menu in a portal above the trigger", () => {
    expect(source).toContain("createPortal")
    expect(source).toContain("document.body")
    expect(source).toContain("rect.top - menuHeight - 6")
  })

  it("皮肤菜单不拖动窗口（沿用顶栏那条约束）", () => {
    expect(source).toContain('data-tauri-drag-region="false"')
  })

  it("switches to the settings view with search panel closed", () => {
    expect(source).toContain('setActiveView("settings")')
    expect(source).toContain("setSearchPanelOpen(false)")
  })
})
