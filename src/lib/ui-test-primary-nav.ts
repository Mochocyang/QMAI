import type { WikiState } from "@/stores/wiki-store"

export type PrimaryNavView = WikiState["activeView"]
export interface PrimaryNavItem { view: PrimaryNavView; label: string }

export const PRIMARY_NAV_OPTIONS: PrimaryNavItem[] = [
  { view: "sources", label: "大纲" },
  { view: "wiki", label: "章节" },
  { view: "soul", label: "灵魂" },
  { view: "skillLibrary", label: "技能库" },
  // 「插件」跟在技能库之后：两者都是「扩展能力」类入口，顺序与顶栏「创作工具」
  // 下拉里的分组保持一致（见 ui-test-shell.tsx 的 TOOL_GROUPS）。
  { view: "plugins", label: "插件" },
  { view: "graph", label: "小说图谱" },
  { view: "bookAnalysis", label: "拆书库" },
  { view: "reviewCenter", label: "审查中心" },
  { view: "search", label: "剧情搜索" },
  { view: "storySimulation", label: "剧情推演" },
  { view: "lint", label: "记忆中心" },
]

export const PRIMARY_NAV_LONG_PRESS_MS = 500
/** 一级导航最多 5 项。 */
const PRIMARY_NAV_LIMIT = 5
/**
 * 老数据向前补全的目标项（「插件」成为一级功能时新增）。
 *
 * 为什么需要补：新默认值只对**没有存过** `qm-uitest-primary-nav-v1` 的用户生效；
 * 老用户的 localStorage 里已经存着 `["sources","wiki","soul"]`，读出来永远不会
 * 含 `plugins`，于是他们看不到新入口。
 */
const BACKFILL_VIEW: PrimaryNavView = "plugins"
const DEFAULT_PRIMARY_NAV: PrimaryNavView[] = ["sources", "wiki", "soul", "plugins"]
const STORAGE_KEY = "qm-uitest-primary-nav-v1"

function optionFor(view: PrimaryNavView) {
  return PRIMARY_NAV_OPTIONS.find((item) => item.view === view)
}

export function normalizePrimaryNav(value: unknown): PrimaryNavItem[] {
  const views = Array.isArray(value) ? value : DEFAULT_PRIMARY_NAV
  const unique = views.filter((view, index): view is PrimaryNavView =>
    typeof view === "string" && Boolean(optionFor(view as PrimaryNavView)) && views.indexOf(view) === index,
  )
  const selected = (unique.length > 0 ? unique : DEFAULT_PRIMARY_NAV).slice(0, PRIMARY_NAV_LIMIT)
  /*
   * 老数据向前补全「插件」：只在**没满 5 项**时追加到末尾。
   *
   * 为什么是「追加到末尾 + 只在没满时」而不是无条件插到固定位置：
   * 顺序是用户自己在长按菜单里排的（移动/替换/删除），我们无权插队改写他们的
   * 排列；没满 5 项说明还有空位，往后补一个不影响既有顺序。已经满 5 项时
   * 完全不追加 —— 用户用满了自己的名额，是否要拿别的项换成「插件」由他们
   * 通过「替换为」决定。
   *
   * 幂等性：追加的前提是「当前不含 plugins」，所以第二次 normalize 时
   * 数组已经含 plugins，不会再追加一次。
   */
  if (!selected.includes(BACKFILL_VIEW) && selected.length < PRIMARY_NAV_LIMIT) selected.push(BACKFILL_VIEW)
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
