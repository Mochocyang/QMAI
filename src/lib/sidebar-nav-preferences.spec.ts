import { describe, expect, it } from "vitest"
import {
  DEFAULT_SIDEBAR_NAV_ORDER,
  FOLDED_SKILL_LIBRARY_VIEWS,
  isNavItemActive,
  normalizeSidebarNavConfig,
  reorderSidebarNavOrder,
  type SidebarNavConfig,
} from "./sidebar-nav-preferences"

describe("sidebar nav preferences", () => {
  it("keeps the supported feature entries in the default order", () => {
    expect(DEFAULT_SIDEBAR_NAV_ORDER).toEqual([
      "wiki",
      "sources",
      "graph",
      "lint",
      "soul",
      "skillLibrary",
      "bookAnalysis",
      "reviewCenter",
      "storySimulation",
      "search",
      "trash",
    ])
  })

  it("normalizes persisted order by removing unknown ids, deduping, and appending missing ids", () => {
    const config = normalizeSidebarNavConfig({
      order: ["search", "wiki", "unknown", "search", "trash"],
      hidden: [],
    } as unknown as SidebarNavConfig)

    expect(config.order).toEqual([
      "wiki",
      "search",
      "trash",
      "sources",
      "graph",
      "lint",
      "soul",
      "skillLibrary",
      "bookAnalysis",
      "reviewCenter",
      "storySimulation",
    ])
  })

  it("normalizes hidden entries to known feature ids only", () => {
    const config = normalizeSidebarNavConfig({
      order: [...DEFAULT_SIDEBAR_NAV_ORDER],
      hidden: ["graph", "settings", "trash", "theme"],
    } as unknown as SidebarNavConfig)

    expect(config.hidden).toEqual(["graph", "trash"])
  })

  it("moves a feature id relative to another feature id while keeping wiki first", () => {
    const order = reorderSidebarNavOrder(DEFAULT_SIDEBAR_NAV_ORDER, "trash", "sources")
    expect(order.slice(0, 3)).toEqual(["wiki", "trash", "sources"])
  })

  it("always keeps wiki in first position after normalization", () => {
    const config = normalizeSidebarNavConfig({ order: ["trash", "sources", "wiki", "graph"] })
    expect(config.order[0]).toBe("wiki")
  })

  it("keeps writing skills merged into the single skill library entry", () => {
    expect(DEFAULT_SIDEBAR_NAV_ORDER).toContain("skillLibrary")
    expect(DEFAULT_SIDEBAR_NAV_ORDER).not.toContain("writingSkillLibrary")
    expect(normalizeSidebarNavConfig({ order: ["wiki"] }).order).toContain("skillLibrary")
    expect(normalizeSidebarNavConfig({ order: ["wiki"] }).order).not.toContain("writingSkillLibrary")
  })

  /*
   * 文风库同样是技能库**内部**的 tab：它必须在侧边栏里**没有**自己的入口。
   * ⚠️ `DEFAULT_SIDEBAR_NAV_ORDER` 是 `as const` 元组，往里加一个新 view 只要一行、
   * 而且编译通过；所以这件事只能靠断言守。上面那条用例只覆盖了
   * `writingSkillLibrary`（grep 命中 0 次 `writingStyleLibrary`），
   * 于是 `icon-sidebar.tsx` 里「两个 spec 都断言了」的说法当时是**假的**。
   * 这两条把话说圆：默认顺序与归一化结果里都不能出现它。
   */
  it("keeps the 文风 view out of the sidebar entirely", () => {
    expect(DEFAULT_SIDEBAR_NAV_ORDER).not.toContain("writingStyleLibrary")
    expect(normalizeSidebarNavConfig({ order: ["wiki"] }).order).not.toContain("writingStyleLibrary")
    // 反向对照：不能因为「什么都没断言」而意外变绿
    expect(DEFAULT_SIDEBAR_NAV_ORDER).toContain("skillLibrary")
  })

  /*
   * 折算高亮的**行为**（不是源码文本）：技能库 tab 的两个内部视图要把技能库
   * 图标点亮。`icon-sidebar.test.tsx` 只读源码、跑不了组件，所以判定被抽成
   * 纯函数 `isNavItemActive` 放在本模块里，由这里做行为断言。
   */
  it("技能库图标的选中态折算覆盖技能库 tab 的两个内部视图", () => {
    expect(isNavItemActive("skillLibrary", "skillLibrary")).toBe(true)
    expect(isNavItemActive("skillLibrary", "writingSkillLibrary")).toBe(true)
    expect(isNavItemActive("skillLibrary", "writingStyleLibrary")).toBe(true)
    // 精确相等那条通路对别的条目仍然成立
    expect(isNavItemActive("soul", "soul")).toBe(true)
    expect(isNavItemActive("trash", "trash")).toBe(true)
  })

  it("折算只对技能库图标生效，且不越过既有例外", () => {
    // 别的条目不得被误折算
    expect(isNavItemActive("soul", "writingStyleLibrary")).toBe(false)
    expect(isNavItemActive("wiki", "writingStyleLibrary")).toBe(false)
    expect(isNavItemActive("trash", "skillLibrary")).toBe(false)
    // 收藏 tab 是**既有例外**：它不点亮技能库图标（本批不改，如实钉住，避免
    // 以后有人「顺手统一」而静默改掉 收藏 tab 的既有观感）
    expect(FOLDED_SKILL_LIBRARY_VIEWS).not.toContain("skillFavorites")
    expect(isNavItemActive("skillLibrary", "skillFavorites")).toBe(false)
    // 也不得把技能库看成别的视图的别名
    expect(isNavItemActive("skillLibrary", "soul")).toBe(false)
    expect(isNavItemActive("skillLibrary", "wiki")).toBe(false)
  })
})
