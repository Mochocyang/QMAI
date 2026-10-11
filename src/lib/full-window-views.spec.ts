import { describe, expect, it } from "vitest"
import { FULL_WINDOW_VIEWS, isFullWindowView } from "./full-window-views"

/*
 * 「整窗视图」清单的行为测试。
 *
 * 在此之前的唯一覆盖是 `memory-center-dismantling.spec.ts` 把
 * `ui-test-shell.tsx` 里的 `const fullWindowViews = …` 那一行找出来、
 * 再 `toContain` 两个子串——`fullWindowViews` 的**行为**全仓库零覆盖：
 * 把清单里任意一项删掉，两个子串断言照样绿。
 * 这里逐项钉住清单的成员，并钉住不该进来的视图。
 */
describe("fullWindowViews（整窗视图清单）", () => {
  it("技能库的五个视图都是整窗视图", () => {
    expect(isFullWindowView("skillLibrary")).toBe(true)
    expect(isFullWindowView("writingSkillLibrary")).toBe(true)
    expect(isFullWindowView("writingStyleLibrary")).toBe(true)
    expect(isFullWindowView("characterSoulLibrary")).toBe(true)
    expect(isFullWindowView("skillFavorites")).toBe(true)
  })

  it("灵魂与拆书库也是整窗视图", () => {
    expect(isFullWindowView("soul")).toBe(true)
    expect(isFullWindowView("bookAnalysis")).toBe(true)
  })

  it("lint 不在清单里：它还要按 novelMode 分流，不能无条件整窗", () => {
    // 记忆中心由 `activeView === "lint" && novelMode` 另行判定；
    // 若把 lint 混进这张无条件清单，LintView 的章节树会被一起藏掉。
    expect(isFullWindowView("lint")).toBe(false)
    expect(FULL_WINDOW_VIEWS).not.toContain("lint")
  })

  it("双栏视图与设置页都不是整窗视图", () => {
    for (const view of ["wiki", "sources", "graph", "search", "reviewCenter", "storySimulation", "settings", "trash", "maintenance"]) {
      expect(isFullWindowView(view)).toBe(false)
    }
  })

  it("清单本身没有重复项（重复会让上面每一条断言都仍然通过）", () => {
    expect(new Set(FULL_WINDOW_VIEWS).size).toBe(FULL_WINDOW_VIEWS.length)
  })

  it("清单与判定一致：清单里每一项都判 true，且没有漏项", () => {
    for (const view of FULL_WINDOW_VIEWS) {
      expect(isFullWindowView(view)).toBe(true)
    }
    const admitted = [
      "skillLibrary", "writingSkillLibrary", "writingStyleLibrary", "characterSoulLibrary", "skillFavorites",
      "soul", "bookAnalysis", "lint", "wiki", "sources", "graph", "search",
      "reviewCenter", "storySimulation", "settings", "trash", "maintenance",
    ].filter(isFullWindowView)
    expect([...admitted].sort()).toEqual([...FULL_WINDOW_VIEWS].sort())
  })
})
