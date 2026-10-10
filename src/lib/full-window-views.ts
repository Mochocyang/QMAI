/**
 * 「整窗视图」清单：这些视图自己占满内容区，**不再需要左侧目录栏**。
 *
 * 抽成一个不依赖 React 的纯模块，是为了让这条判定**可被行为测试**。
 * 原先是 `ui-test-shell.tsx` 里一行内联的 `||` 链，唯一的「测试」是
 * `memory-center-dismantling.spec.ts` 把那一行从源码里找出来、再 `toContain`
 * 两个子串——行为完全等价的换行/重排就会让它红，而它到底守住了什么
 * （`fullWindowViews` 本身）**全仓库零行为覆盖**。
 *
 * ⚠️ 与 `memoryCenterFullWindow`（`activeView === "lint" && novelMode`）是两件事：
 * `lint` 由记忆中心与 LintView 两个页面共用，必须额外带 `novelMode`
 * 才不会把 LintView 的章节树一起藏掉，所以它**不**在这个清单里。
 */
export const FULL_WINDOW_VIEWS = [
  "skillLibrary",
  "writingSkillLibrary",
  "writingStyleLibrary",
  "skillFavorites",
  "soul",
  "bookAnalysis",
] as const

export type FullWindowView = (typeof FULL_WINDOW_VIEWS)[number]

export function isFullWindowView(view: string): view is FullWindowView {
  return FULL_WINDOW_VIEWS.some((candidate) => candidate === view)
}
