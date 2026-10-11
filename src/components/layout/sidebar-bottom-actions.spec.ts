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

  it("设置靠左、外观靠右对齐", () => {
    expect(source).toContain("items-center justify-start")
    expect(source).toContain("items-center justify-end")
  })

  it("opens the skin menu in a portal, anchored by its bottom above the trigger", () => {
    expect(source).toContain("createPortal")
    expect(source).toContain("document.body")
    // 以底边锚定 + 覆盖 .ui-test-menu-pop 的 absolute/top/right，避免菜单被窗口底边裁掉
    expect(source).toContain('position: "fixed"')
    expect(source).toContain('top: "auto"')
    expect(source).toContain('right: "auto"')
    expect(source).toContain("bottom: menuStyle.bottom")
    expect(source).toContain("maxHeight")
    expect(source).not.toContain("rect.top - menuHeight")
  })

  it("皮肤菜单不拖动窗口（沿用顶栏那条约束）", () => {
    expect(source).toContain('data-tauri-drag-region="false"')
  })

  it("switches to the settings view with search panel closed", () => {
    expect(source).toContain('setActiveView("settings")')
    expect(source).toContain("setSearchPanelOpen(false)")
  })
})
