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
  "characterSoulLibrary",
  /*
   * ⚠️ `personaSkillLibrary`（「人物 Skill」）是**补进来的**，不是一开始就有。
   *
   * 它就是用户报的那个缺陷：技能库六个 tab 里，另外五个都在本清单中，
   * 只有「人物 Skill」漏了 —— 于是 `hasDirectory` 判真，切到该 tab 时
   * 左侧会冒出一条**章节列表**，而其余 tab 都是整窗、没有目录栏。
   * 用户要求「点击『人物 Skill』时没有任何作用」，即与其余 tab 一致。
   *
   * 为什么容易漏：它是**唯一**会改写 `activeView` 的技能库 tab（见
   * `unified-skill-library-view.tsx` 的 `skillLibraryTabs` 与
   * `unified-skill-library-view.spec.tsx`「切到『人物 Skill』tab：写 activeView」）；
   * 其余 tab 只是组件内部 `activeTab` 状态，`activeView` 不变，
   * 所以它们只在**新 view 名**这一条路径上暴露 —— 而同一张清单里
   * 已经漏过它一次（`content-area.tsx` 曾为它多贴一整份不可达代码，
   * 详见 `content-area.routing.spec.tsx` 的说明）。
   *
   * 因此 `full-window-views.spec.ts` 里有一条**专门的**用例钉它，
   * 且该用例的候选清单必须包含它 —— 否则「漏项检查」那条自己也会漏。
   */
  "personaSkillLibrary",
  "skillFavorites",
  "soul",
  "bookAnalysis",
] as const

export type FullWindowView = (typeof FULL_WINDOW_VIEWS)[number]

export function isFullWindowView(view: string): view is FullWindowView {
  return FULL_WINDOW_VIEWS.some((candidate) => candidate === view)
}
