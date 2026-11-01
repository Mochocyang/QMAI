import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(
  resolve(__dirname, "sidebar-bottom-actions.tsx"),
  "utf8",
)

describe("sidebar-bottom-actions", () => {
  it("底栏左侧是头像+用户名（名字在头像右侧），右侧是公告铃铛", () => {
    expect(source).toContain('data-ui="sidebar-bottom-actions"')
    expect(source).toContain('data-ui="sidebar-account-avatar"')
    expect(source).toContain("ui-test-account-name")
    expect(source).toContain("{accountDisplayNameText}")
    /*
     * 顺序（用户 2026-10-28 最终确认）：**头像在最左，用户名在头像右侧**。
     * 在账号块 800 字符窗口内，`sidebar-account-avatar` 必须早于 `ui-test-account-name`。
     */
    const blockStart = source.indexOf('data-ui="sidebar-account-avatar"')
    const blockWindow = source.slice(blockStart, blockStart + 1400)
    const avatarAt = blockWindow.indexOf("sidebar-account-avatar", 10)
    const nameAt = blockWindow.indexOf("ui-test-account-name")
    expect(avatarAt).toBeGreaterThan(-1)
    expect(nameAt).toBeGreaterThan(avatarAt)
    /*
     * 用户名必须真的占住「头像右侧」那块宽度（用户 2026-10-28 复报「头像右侧没有名字」）：
     * 账号块 `w-fit` 在 WebView2 里会按 max-content 收回，`truncate` 的名字只剩零宽。
     * 所以账号块要 `flex-1 min-w-0`，名字要 `min-w-0 flex-1`。
     */
    expect(source).not.toContain("min-w-0 shrink items-center")
    expect(source).toContain("flex min-w-0 flex-1 items-center gap-1.5")
    expect(source).toContain("ui-test-account-name min-w-0 flex-1 truncate")
    /*
     * 左内边距 10px（用户 2026-10-28 定：头像原来贴侧栏边界太靠左），
     * 叠上按钮自身的 2px 内衬后头像左边缘在 12px，与面板标题文字左边对齐。
     */
    expect(source).toContain("pr-1.5 pl-2.5")
    // 设置入口只在账号菜单里，不再有独立齿轮
    expect(source).not.toContain('data-ui="sidebar-settings-gear"')
  })

  it("公告铃铛用 ml-auto 靠最右", () => {
    expect(source).toContain("<AnnouncementBell />")
    expect(source).toContain('className="ml-auto flex shrink-0 items-center"')
  })

  it("外观默认折叠，点击或悬停都能展开三个主题且不带副标题", () => {
    expect(source).toContain('data-ui="sidebar-appearance-entry"')
    expect(source).toContain("ui-avatar-appearance-group")
    expect(source).toContain("ui-avatar-appearance-sub")
    expect(source).toContain("UI_TEST_SKINS.map")
    // 折叠：受控状态 + data-open
    expect(source).toContain("appearanceVisible")
    expect(source).toContain("data-open={appearanceVisible")
    // 用户 2026-10-28：三个皮肤要弹在「外观」右侧，鼠标移上去就展开（点击也仍可用）
    expect(source).toContain("onMouseEnter={() => setAppearanceHovered(true)}")
    expect(source).toContain("onMouseLeave")
    expect(source).toContain("setAppearancePinned((open) => !open)")
    // 子项只有主题名，不带 hint 副标题
    expect(source).not.toContain("{item.hint}")
  })

  it("菜单里的入口都绑了点击处理", () => {
    expect(source).toContain("onClick={openAccount}")
    expect(source).toContain("onClick={openGeneralSettings}")
    expect(source).toContain("onClick={openMaintenance}")
    expect(source).toContain("onClick={() => selectSkin(item.id)}")
    expect(source).toContain("onClick={() => setAppearancePinned((open) => !open)}")
  })

  it("已登录时菜单里有「退出账号」，点它会调 logout", () => {
    expect(source).toContain('data-ui="sidebar-logout-entry"')
    expect(source).toContain("void handleLogout()")
    // 只在已登录时出现：未登录时没有可退的会话
    const idx = source.indexOf('data-ui="sidebar-logout-entry"')
    const window = source.slice(Math.max(0, idx - 400), idx)
    expect(window).toContain("{accountUser ? (")
    // 位置在「维护工具」之后
    expect(source.indexOf('data-ui="sidebar-maintenance-entry"')).toBeLessThan(idx)
  })

  it("退出后底栏显示「未登录」", () => {
    // accountUser 为空时用「未登录」
    expect(source).toContain('? accountDisplayName(accountUser.displayName, accountUser.email)')
    expect(source).toContain(': "未登录"')
    // 未登录时账号条目提示「点击登录账号」
    expect(source).toContain("点击登录账号")
  })

  it("未登录时点账号条目直接弹登录窗，不跳设置页", () => {
    // 未登录分支走 openDialog("login")
    expect(source).toContain('useAccountStore.getState().openDialog("login")')
    const idx = source.indexOf('const openAccount = () => {')
    const block = source.slice(idx, idx + 600)
    expect(block).toContain('if (accountUser)')
    expect(block).toContain('goToSettings("account")')
    // 登录分支必须在「未登录 → 弹窗」之前 return，否则会先跳设置
    expect(block.indexOf('return')).toBeGreaterThan(block.indexOf('goToSettings("account")'))
  })

  it("外观子菜单弹在右侧，而不是列在「外观」下面", () => {
    const css = readFileSync(
      resolve(__dirname, "../uitest/ui-test.css"),
      "utf8",
    )
    /*
     * 用户 2026-10-28：三个皮肤必须在「外观」右侧弹出。
     * 之前是 `margin-left: 12px` + `border-left` 的缩进列表，会长在下方。
     */
    expect(css).not.toContain("border-left: 1px solid var(--ui-line);\n  padding-left: 4px;")
    /*
     * left 要跨过「菜单内边距 14px + 间隙 6px」：group 的右边界是菜单**内容区**的
     * 右边界，不是菜单卡片的右边界（+6px 会让子菜单压进菜单卡片里）。
     */
    expect(css).toContain("left: calc(100% + 20px)")
    expect(css).toContain('.ui-avatar-appearance-sub[data-open="true"]')
    /*
     * 悬停通道：从「外观」一行横移进子菜单要跨过 20px 空档，
     * 少了这块透明的桥，mouseleave 会先把子菜单收掉。
     */
    expect(css).toContain(".ui-avatar-appearance-sub::before")
    /*
     * 账号菜单是 createPortal 挂到 document.body 的，不在 .ui-test-root 里面：
     * 这两条规则一旦带上 `.ui-test-root` 前缀就永远匹配不上 —— 表现是三个皮肤
     * 一直平铺在外观下面、收起和右侧定位全部失效（2026-10-28 用户实测截图）。
     * 必须是全局选择器。
     */
    expect(css).not.toContain(".ui-test-root .ui-avatar-appearance-group")
    expect(css).not.toContain(".ui-test-root .ui-avatar-appearance-sub")
    expect(css).toMatch(/(^|\n)\.ui-avatar-appearance-group \{/)
    expect(css).toMatch(/(^|\n)\.ui-avatar-appearance-sub \{/)
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
    expect(source).not.toContain("rect.top - menuHeight")
  })

  it("弹层不能是滚动容器（否则子菜单被裁 + 长出滚动条）", () => {
    /*
     * 用户 2026-10-28 截图：账号菜单里出现左右/上下两个灰色滚动条，
     * 「外观」右侧的皮肤子菜单完全看不见。
     * 根因是弹层 `overflow-y: auto` + max-height：绝对定位的子菜单属于弹层的
     * 可滚动溢出区，既被裁掉又把 scrollWidth 撑到 450px（实测）。
     * 菜单本身只有四项、约 200px 高，永远不需要滚。
     */
    expect(source).toContain('overflow: "visible"')
    expect(source).not.toContain('overflowY: "auto"')
    expect(source).not.toContain("maxHeight")
  })

  it("头像容器不能按百分比撑满账号块（否则用户名被挤成 0 宽）", () => {
    const css = readFileSync(resolve(__dirname, "../uitest/ui-test.css"), "utf8")
    /*
     * `.sidebar-account-avatar` 自己就是 28px 的圆形容器（class 里有 size-7）。
     * 旧规则给它 `width/height: 100%`，实测被撑到 216px：头像居中在一片空白里，
     * 用户名 `flex-1 min-w-0 truncate` 只好收缩到 0 宽 —— 用户两次报的
     * 「头像右边没有用户名」就是这个，光改 flex 布局没用。
     */
    const rule = css.match(/\.ui-test-root \.sidebar-account-avatar \{[^}]*\}/)
    expect(rule).toBeTruthy()
    expect(rule![0]).not.toContain("width: 100%")
    expect(rule![0]).not.toContain("height: 100%")
  })
})
