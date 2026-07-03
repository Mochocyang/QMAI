export const DEFAULT_SIDEBAR_NAV_ORDER = [
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
] as const

export type SidebarNavItemId = (typeof DEFAULT_SIDEBAR_NAV_ORDER)[number]

export interface SidebarNavConfig {
  order: SidebarNavItemId[]
  hidden: SidebarNavItemId[]
}

export const DEFAULT_SIDEBAR_NAV_CONFIG: SidebarNavConfig = {
  order: [...DEFAULT_SIDEBAR_NAV_ORDER],
  hidden: [],
}

const SIDEBAR_NAV_ITEM_IDS = new Set<string>(DEFAULT_SIDEBAR_NAV_ORDER)

export function isSidebarNavItemId(value: string): value is SidebarNavItemId {
  return SIDEBAR_NAV_ITEM_IDS.has(value)
}

function normalizeIdList(values: unknown): SidebarNavItemId[] {
  if (!Array.isArray(values)) return []
  const result: SidebarNavItemId[] = []
  for (const value of values) {
    if (typeof value !== "string" || !isSidebarNavItemId(value)) continue
    if (!result.includes(value)) {
      result.push(value)
    }
  }
  return result
}

export function normalizeSidebarNavConfig(config?: Partial<SidebarNavConfig> | null): SidebarNavConfig {
  const order = normalizeIdList(config?.order)
  for (const id of DEFAULT_SIDEBAR_NAV_ORDER) {
    if (!order.includes(id)) {
      order.push(id)
    }
  }
  const wikiIndex = order.indexOf("wiki")
  if (wikiIndex > 0) {
    order.splice(wikiIndex, 1)
    order.unshift("wiki")
  }
  return {
    order,
    hidden: normalizeIdList(config?.hidden),
  }
}

export function reorderSidebarNavOrder(
  order: readonly SidebarNavItemId[],
  activeId: SidebarNavItemId,
  overId: SidebarNavItemId,
): SidebarNavItemId[] {
  const normalized = normalizeSidebarNavConfig({ order: [...order] }).order
  const activeIndex = normalized.indexOf(activeId)
  const overIndex = normalized.indexOf(overId)
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
    return normalized
  }
  const next = [...normalized]
  const [moved] = next.splice(activeIndex, 1)
  next.splice(overIndex, 0, moved)
  return next
}
