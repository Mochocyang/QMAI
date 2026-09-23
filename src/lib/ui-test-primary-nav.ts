import type { WikiState } from "@/stores/wiki-store"

export type PrimaryNavView = WikiState["activeView"]
export interface PrimaryNavItem { view: PrimaryNavView; label: string }

export const PRIMARY_NAV_OPTIONS: PrimaryNavItem[] = [
  { view: "sources", label: "大纲" },
  { view: "wiki", label: "章节" },
  { view: "soul", label: "灵魂" },
  { view: "skillLibrary", label: "技能库" },
  { view: "graph", label: "小说图谱" },
  { view: "bookAnalysis", label: "拆书库" },
  { view: "reviewCenter", label: "审查中心" },
  { view: "search", label: "剧情搜索" },
  { view: "storySimulation", label: "剧情推演" },
  { view: "lint", label: "记忆中心" },
]

export const PRIMARY_NAV_LONG_PRESS_MS = 500
const DEFAULT_PRIMARY_NAV: PrimaryNavView[] = ["sources", "wiki", "soul"]
const STORAGE_KEY = "qm-uitest-primary-nav-v1"

function optionFor(view: PrimaryNavView) {
  return PRIMARY_NAV_OPTIONS.find((item) => item.view === view)
}

export function normalizePrimaryNav(value: unknown): PrimaryNavItem[] {
  const views = Array.isArray(value) ? value : DEFAULT_PRIMARY_NAV
  const unique = views.filter((view, index): view is PrimaryNavView =>
    typeof view === "string" && Boolean(optionFor(view as PrimaryNavView)) && views.indexOf(view) === index,
  )
  const selected = (unique.length > 0 ? unique : DEFAULT_PRIMARY_NAV).slice(0, 5)
  return selected.map((view) => optionFor(view)!)
}

export function readPrimaryNav(): PrimaryNavItem[] {
  try { return normalizePrimaryNav(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")) }
  catch { return normalizePrimaryNav(DEFAULT_PRIMARY_NAV) }
}

export function writePrimaryNav(items: PrimaryNavItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.map((item) => item.view)))
}

export function availablePrimaryNav(items: PrimaryNavItem[]) {
  return PRIMARY_NAV_OPTIONS.filter((option) => !items.some((item) => item.view === option.view))
}

export function movePrimaryNav(items: PrimaryNavItem[], view: PrimaryNavView, direction: -1 | 1) {
  const index = items.findIndex((item) => item.view === view)
  const next = index + direction
  if (index < 0 || next < 0 || next >= items.length) return items
  const copy = [...items]
  const [item] = copy.splice(index, 1)
  copy.splice(next, 0, item)
  return copy
}
