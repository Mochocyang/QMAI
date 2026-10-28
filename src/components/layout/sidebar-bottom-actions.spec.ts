import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(
  resolve(__dirname, "sidebar-bottom-actions.tsx"),
  "utf8",
)

describe("sidebar-bottom-actions", () => {
  it("左下角账号入口同时显示头像与用户名，整块可点", () => {
    expect(source).toContain('data-ui="sidebar-bottom-actions"')
    expect(source).toContain('data-ui="sidebar-account-avatar"')
    expect(source).toContain("ui-test-account-name")
    expect(source).toContain("{accountDisplayNameText}")
    // 头像不再紧贴侧栏边线：底栏给了左内边距
    expect(source).toContain("pl-3")
  })

  it("公告铃铛靠最右", () => {
    expect(source).toContain("<AnnouncementBell />")
    expect(source).toContain('className="flex shrink-0 items-center"')
  })

  it("外观不在菜单里全部展开，只留一个入口跳到设置", () => {
    // 皮肤列表已从菜单移除
    expect(source).not.toContain("UI_TEST_SKINS")
    expect(source).not.toContain("useAppearanceSkin")
    // 改为「外观」入口 → 设置 › 界面
    expect(source).toContain('data-ui="sidebar-appearance-entry"')
    expect(source).toContain('openAppearanceSettings')
    expect(source).toContain('"interface"')
  })

  it("头像菜单里有账号、设置、维护工具三个入口", () => {
    expect(source).toContain('data-ui="sidebar-avatar-account-entry"')
    expect(source).toContain('data-ui="sidebar-settings-entry"')
    expect(source).toContain('data-ui="sidebar-maintenance-entry"')
    expect(source).toContain('setActiveView("maintenance")')
  })

  it("跳设置时同时下发分区与视图，并防止分区被旧值吃掉", () => {
    expect(source).toContain('setActiveSettingsCategory(category)')
    expect(source).toContain('setActiveView("settings")')
    // 同一分区重复点击时用微任务补一次，避免「点了没反应」
    expect(source).toContain("queueMicrotask")
  })

  it("no longer owns a light/dark theme dropdown", () => {
    expect(source).not.toContain("applyTheme")
    expect(source).not.toContain("saveTheme")
    expect(source).not.toContain("THEME_OPTIONS")
  })

  it("opens the menu in a portal, anchored by its bottom above the trigger", () => {
    expect(source).toContain("createPortal")
    expect(source).toContain("document.body")
    expect(source).toContain('position: "fixed"')
    expect(source).toContain('top: "auto"')
    expect(source).toContain('right: "auto"')
    expect(source).toContain("bottom: menuStyle.bottom")
    expect(source).toContain("maxHeight")
    expect(source).not.toContain("rect.top - menuHeight")
  })
})
