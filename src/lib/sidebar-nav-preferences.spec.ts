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
      "search",
      "wiki",
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

  it("moves a feature id relative to another feature id", () => {
    const order = reorderSidebarNavOrder(DEFAULT_SIDEBAR_NAV_ORDER, "trash", "wiki")

    expect(order.slice(0, 3)).toEqual(["trash", "wiki", "sources"])
  })

  it("includes skill library in the configurable sidebar order", () => {
    expect(DEFAULT_SIDEBAR_NAV_ORDER).toContain("skillLibrary")
    expect(normalizeSidebarNavConfig({ order: ["wiki"] }).order).toContain("skillLibrary")
  })
})
