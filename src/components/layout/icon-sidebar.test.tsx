import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const iconSidebarSource = readFileSync(resolve(__dirname, "icon-sidebar.tsx"), "utf8")
const contentAreaSource = readFileSync(resolve(__dirname, "content-area.tsx"), "utf8")

describe("icon-sidebar", () => {
  it("does not restore the old absolute title layout", () => {
    expect(iconSidebarSource).not.toContain("absolute left-9")
    expect(iconSidebarSource).not.toContain("getIconSidebarAppTitle")
  })

  it("keeps the soul entry wired into the content area route", () => {
    expect(iconSidebarSource).toContain('view: "soul"')
    expect(iconSidebarSource).toContain('labelKey: "novel.nav.soul"')
    expect(contentAreaSource).toContain('case "soul"')
    expect(contentAreaSource).toContain("<SoulView />")
  })

  it("clears the selected file when switching to outline sources", () => {
    expect(iconSidebarSource).toContain('view === "sources"')
    expect(iconSidebarSource).toContain('includes("/wiki/outlines/")')
    expect(iconSidebarSource).toContain("setSelectedFile(null)")
  })

  it("keeps the search entry above trash and outside the main nav list", () => {
    expect(iconSidebarSource).toContain('id: "search"')
    expect(iconSidebarSource).toContain('id: "trash"')
    expect(iconSidebarSource.indexOf('id: "search"')).toBeLessThan(iconSidebarSource.indexOf('id: "trash"'))
  })

  it("opens search inside the main window instead of creating a separate window", () => {
    expect(iconSidebarSource).toContain('view: "search"')
    expect(iconSidebarSource).toContain("handleNavClick(item.view)")
    expect(iconSidebarSource).not.toContain("openSearchWindow")
  })

  it("keeps the novel memory-center entry on the brain icon", () => {
    expect(iconSidebarSource).toContain("Brain")
    expect(iconSidebarSource).toContain('view: "lint", icon: Brain')
  })

  it("keeps the review-center nav entry", () => {
    expect(iconSidebarSource).toContain('labelKey: "novel.nav.reviewCenter"')
    expect(iconSidebarSource).toContain('view: "reviewCenter"')
  })

  it("merges writing skill library into the single skill library navigation entry", () => {
    expect(iconSidebarSource).toContain('id: "skillLibrary"')
    expect(iconSidebarSource).not.toContain('id: "writingSkillLibrary"')
    expect(iconSidebarSource).not.toContain('labelKey: "novel.nav.writingSkillLibrary"')
    expect(contentAreaSource).toContain('case "writingSkillLibrary"')
    expect(contentAreaSource).toContain("<UnifiedSkillLibraryView")
  })

  /*
   * 文风库是技能库内部 tab 的视图：它必须在侧边栏里**没有**自己的入口。
   *
   * ⚠️ 这条原名「folds the 文风 view into the skill-library nav icon…」，
   * 但它当时只断言源码里那行常量字面量还在 —— 把字面量原样保留、只把**使用点**
   * 改掉（`FOLDED_SKILL_LIBRARY_VIEWS.includes(activeView)` 换成别的），
   * 用例照样全绿。它守的是一个字面量，不是它名字说的那个行为。
   * 现在：折算的**行为**由 `sidebar-nav-preferences.spec.ts` 里针对纯函数
   * `isNavItemActive` 的一组断言负责（本文件只读源码文本，跑不了组件）；
   * 这里只留「不得新增入口」——那是源码文本能诚实证明的部分。
   */
  it("文风视图与写作 Skill 视图都不新增侧边栏条目（id / labelKey 都不出现）", () => {
    expect(iconSidebarSource).not.toContain('id: "writingStyleLibrary"')
    expect(iconSidebarSource).not.toContain('labelKey: "novel.nav.writingStyleLibrary"')
    expect(iconSidebarSource).not.toContain('id: "writingSkillLibrary"')
    expect(iconSidebarSource).not.toContain('labelKey: "novel.nav.writingSkillLibrary"')
  })

  /*
   * 合并说明：本条原为「makes feature entries configurable without moving fixed
   * bottom controls」。`feature/scene-dialogue-simulation` 把「外观 / 设置 / 切换小说
   * 不出现在可配置特性条目里」这层语义提成了独立的名字，git 因此把**用例名那一行**
   * 判成冲突，而两侧的断言体本就相同 —— 采用分支的重命名，语义不变。
   * 它与上面那条文风用例是同文件的不同用例，都保留。
   */
  it("keeps theme / settings / switch-project out of the configurable feature entries", () => {
    expect(iconSidebarSource).toContain("sidebarNavConfig")
    expect(iconSidebarSource).toContain("setSidebarNavConfig")
    expect(iconSidebarSource).toContain("CONFIGURABLE_NAV_ITEMS")
    expect(iconSidebarSource).toContain('id: "search"')
    expect(iconSidebarSource).toContain('id: "trash"')
    expect(iconSidebarSource).not.toContain('id: "theme"')
    expect(iconSidebarSource).not.toContain('id: "settings"')
    expect(iconSidebarSource).not.toContain('id: "switchProject"')
  })

  it("moves 外观 / 设置 out of the icon rail into the sidebar panels", () => {
    // 图标栏不再承载外观与设置，只保留「切换小说」
    expect(iconSidebarSource).not.toContain("THEME_OPTIONS")
    expect(iconSidebarSource).not.toContain('t("novel.nav.settings")')
    expect(iconSidebarSource).toContain("nav.switchProject")

    // 各侧栏面板统一在底部渲染 SidebarBottomActions
    const panels = [
      "sidebar-panel.tsx",
      "graph-sidebar-panel.tsx",
      "review-center-sidebar-panel.tsx",
      "book-analysis-sidebar-panel.tsx",
      "trash-panel.tsx",
    ]
    for (const panel of panels) {
      const src = readFileSync(resolve(__dirname, panel), "utf8")
      expect(src, panel).toContain("SidebarBottomActions")
    }
  })

  it("uses long-press sortable behavior for sidebar feature entries", () => {
    expect(iconSidebarSource).toContain("DndContext")
    expect(iconSidebarSource).toContain("SortableContext")
    expect(iconSidebarSource).toContain("useSortable")
    expect(iconSidebarSource).toContain("PointerSensor")
    expect(iconSidebarSource).toContain("activationConstraint: { distance: 5 }")
    expect(iconSidebarSource).not.toContain("delay: 350")
    expect(iconSidebarSource).toContain("reorderSidebarNavOrder")
  })
})
