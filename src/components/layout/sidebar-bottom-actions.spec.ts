import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(
  resolve(__dirname, "sidebar-bottom-actions.tsx"),
  "utf8",
)

describe("sidebar-bottom-actions", () => {
  it("底栏左侧是用户名+头像（名字在头像左侧），右侧是公告铃铛", () => {
    expect(source).toContain('data-ui="sidebar-bottom-actions"')
    expect(source).toContain('data-ui="sidebar-account-avatar"')
    expect(source).toContain("ui-test-account-name")
    expect(source).toContain("{accountDisplayNameText}")
    /*
     * 用户名必须在头像之前（用户要求「头像左边显示用户名，已经说了好几次」）。
     * 用 JSX 渲染顺序判定：从账号块开始的 800 字符窗口里，
     * `ui-test-account-name` 必须早于 `sidebar-account-avatar`。
     */
    const blockStart = source.indexOf('data-ui="sidebar-account-avatar"')
    const window800 = source.slice(blockStart, blockStart + 800)
    const nameAt = window800.indexOf("ui-test-account-name")
    const avatarAt = window800.indexOf("sidebar-account-avatar", 10)
    expect(nameAt).toBeGreaterThan(-1)
    expect(avatarAt).toBeGreaterThan(nameAt)
    // 不能再用 flex-1（会把头像推到整条底栏的中间）
    expect(source).not.toContain("min-w-0 flex-1 items-center")
    expect(source).toContain("w-fit")
    // 底栏不再加左内边距（用户要求头像继续往左）
    expect(source).toContain("pl-0")
    // 设置入口只在账号菜单里，不再有独立齿轮
    expect(source).not.toContain('data-ui="sidebar-settings-gear"')
  })

  it("公告铃铛用 ml-auto 靠最右", () => {
    expect(source).toContain("<AnnouncementBell />")
    expect(source).toContain('className="ml-auto flex shrink-0 items-center"')
  })

  it("外观默认折叠，点击展开三个主题且不带副标题", () => {
    expect(source).toContain('data-ui="sidebar-appearance-entry"')
    expect(source).toContain("ui-avatar-appearance-group")
    expect(source).toContain("ui-avatar-appearance-sub")
    expect(source).toContain("UI_TEST_SKINS.map")
    // 折叠：受控状态 + data-open，不再是 hover
    expect(source).toContain("appearanceOpen")
    expect(source).toContain("data-open={appearanceOpen")
    // 子项只有主题名，不带 hint 副标题
    expect(source).not.toContain("{item.hint}")
  })

  it("菜单里的入口都绑了点击处理", () => {
    expect(source).toContain("onClick={openAccountSettings}")
    expect(source).toContain("onClick={openGeneralSettings}")
    expect(source).toContain("onClick={openMaintenance}")
    expect(source).toContain("onClick={() => selectSkin(item.id)}")
    expect(source).toContain("onClick={() => setAppearanceOpen((open) => !open)}")
  })

  it("外部点击放行整个账号菜单（否则菜单里点任何一项都会被先关掉）", () => {
    expect(source).toContain('closest?.(".ui-test-avatar-menu")')
    expect(source).not.toContain('closest?.(".ui-test-skin-menu")')
  })

  it("跳设置时同时下发分区与视图，并防止分区被旧值吃掉", () => {
    expect(source).toContain("setActiveSettingsCategory(category)")
    expect(source).toContain('setActiveView("settings")')
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
