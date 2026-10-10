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
   * 文风库是技能库内部 tab 的视图：它必须折算到技能库图标上保持高亮，
   * 但**不得**同时新增侧边栏条目（`id` / `labelKey` 都不能出现）。
   */
  it("folds the 文风 view into the skill-library nav icon without adding a sidebar entry", () => {
    expect(iconSidebarSource).toContain(
      'const SKILL_LIBRARY_TAB_VIEWS: readonly NavView[] = ["writingSkillLibrary", "writingStyleLibrary"]',
    )
    expect(iconSidebarSource).not.toContain('id: "writingStyleLibrary"')
    expect(iconSidebarSource).not.toContain('labelKey: "novel.nav.writingStyleLibrary"')
  })

  it("makes feature entries configurable without moving fixed bottom controls", () => {
    expect(iconSidebarSource).toContain("sidebarNavConfig")
    expect(iconSidebarSource).toContain("setSidebarNavConfig")
    expect(iconSidebarSource).toContain("CONFIGURABLE_NAV_ITEMS")
    expect(iconSidebarSource).toContain('id: "search"')
    expect(iconSidebarSource).toContain('id: "trash"')
    expect(iconSidebarSource).not.toContain('id: "theme"')
    expect(iconSidebarSource).not.toContain('id: "settings"')
    expect(iconSidebarSource).not.toContain('id: "switchProject"')
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
