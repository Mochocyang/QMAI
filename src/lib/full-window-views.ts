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
  /*
   * 「剧情推演室」是**补进来的**：它原本是「左侧故事框架栏 + 右侧内容区」的
   * 双栏视图（`SidebarPanel` 里的 `StorySimulationSidebarPanel`）。
   * 改造后入口页把「剧情推演式」与「舞台情景」并列成两个同级卡片、整窗单栏，
   * 左侧那一栏随之删除 —— 用户明确要求去掉双栏结构。
   * 漏掉它的后果与技能库那次一样：左栏会重新冒出来。
   */
  "storySimulation",
  /*
   * 「插件」是**补进来的**：它是顶层独立页面（市场 / 已安装两个 tab），
   * 自己占满内容区，左侧那条目录栏（章节树）对它没有任何意义 ——
   * 它既不属于某一章，页面上也没有"在插件页里选章"这种动作。
   *
   * 漏项的症状与技能库那次一模一样：进插件页时左侧多冒出一条章节列表，
   * 而其余顶层页（灵魂 / 拆书库 / 剧情推演室…）都是整窗、没有目录栏。
   *
   * ⚠️ 这一条**只影响 UI 测试壳**（`ui-test-shell.tsx` 的 `hasDirectory`，
   * 它是本清单唯一的消费方）：生产界面的目录栏由 `SidebarPanel` 自己的判断决定，
   * 不受本清单约束，所以这是"测试壳与真机表现不一致"，不是线上缺陷。
   * 仍然要修：壳子拿来讲的正是"这一页长什么样"，它多一条栏，截图与走查就会
   * 把一条**不存在的**侧栏当成设计的一部分；下一个照壳子改界面的人会把它留在那儿。
   */
  "plugins",
] as const

export type FullWindowView = (typeof FULL_WINDOW_VIEWS)[number]

export function isFullWindowView(view: string): view is FullWindowView {
  return FULL_WINDOW_VIEWS.some((candidate) => candidate === view)
}
