import { describe, expect, it } from "vitest"
import {
  DEFAULT_SIDEBAR_NAV_ORDER,
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
      "writingSkillLibrary",
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
      "writingSkillLibrary",
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

  it("includes skill library in the configurable sidebar order", () => {
    expect(DEFAULT_SIDEBAR_NAV_ORDER).toContain("skillLibrary")
    expect(DEFAULT_SIDEBAR_NAV_ORDER).toContain("writingSkillLibrary")
    expect(normalizeSidebarNavConfig({ order: ["wiki"] }).order).toContain("skillLibrary")
    expect(normalizeSidebarNavConfig({ order: ["wiki"] }).order).toContain("writingSkillLibrary")
  })
})
