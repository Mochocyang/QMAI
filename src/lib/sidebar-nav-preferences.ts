import type { WikiState } from "@/stores/wiki-store"

export const DEFAULT_SIDEBAR_NAV_ORDER = [
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

type NavView = WikiState["activeView"]

/**
 * 由「技能库」一个侧边栏图标承载的**其余**内部视图 —— 即技能库 tab 的 view 里
 * 除 `skillLibrary` 自身以外的那些（`skillLibrary` 靠精确相等就已经高亮）。
 *
 * ⚠️ 名字里的 FOLDED 是**故意的**：这不是「技能库 tab 视图的完整清单」，而是
 * 「需要折算到技能库图标上的那些」。`skillFavorites` **不在**这里 ——
 * 「收藏」tab 因此不会点亮技能库图标。那是**既有行为**，本批不改，
 * 也不在这个名字里假装它不存在。
 *
 * ⚠️「它们不是独立的侧边栏导航入口」由测试守、**不是**编译守：
 * `DEFAULT_SIDEBAR_NAV_ORDER` 是 `as const` 元组，往里加一个新 view 只要一行、
 * 而且编译通过。守着它的断言在
 * `sidebar-nav-preferences.spec.ts`（默认顺序与归一化结果都不含这两个 view）
 * 与 `icon-sidebar.test.tsx`（`id` / `labelKey` 都不出现）。
 *
 * ⚠️ 合并说明：`personaSkillLibrary`（`main` 的「人物 Skill」）是**原样保留的既有
 * 行为** —— 它以前写在 `icon-sidebar.tsx` 的内联条件里，本分支把判定抽成
 * `isNavItemActive` 后必须一并搬进来，否则点开人物 Skill 页时侧边栏没有图标高亮。
 */
export const FOLDED_SKILL_LIBRARY_VIEWS: readonly NavView[] = [
  "writingSkillLibrary",
  "writingStyleLibrary",
  "personaSkillLibrary",
]

/**
 * 侧边栏条目是否处于选中态。
 *
 * 抽成纯函数是为了让它**可被行为测试**：`icon-sidebar.test.tsx` 只读源码文本，
 * 原先那条「把文风视图折算到技能库图标上」的用例其实只断言了源码里那行常量
 * 字面量还在 —— 把字面量原样留着、只改这个使用点，用例照样全绿。
 */
export function isNavItemActive(itemView: NavView, activeView: NavView): boolean {
  return itemView === activeView
    || (itemView === "skillLibrary" && FOLDED_SKILL_LIBRARY_VIEWS.includes(activeView))
}
