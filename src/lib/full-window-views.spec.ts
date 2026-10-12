import { readFileSync } from "node:fs"
import { resolve } from "node:path"
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
  it("技能库的六个视图都是整窗视图", () => {
    expect(isFullWindowView("skillLibrary")).toBe(true)
    expect(isFullWindowView("writingSkillLibrary")).toBe(true)
    expect(isFullWindowView("writingStyleLibrary")).toBe(true)
    expect(isFullWindowView("characterSoulLibrary")).toBe(true)
    expect(isFullWindowView("skillFavorites")).toBe(true)
    /*
     * ⚠️ 「人物 Skill」是**补进来的**。它漏掉时，切到该 tab 会冒出一条
     * 左侧章节列表（其余五个 tab 都是整窗、没有目录栏），这正是用户报的缺陷。
     * 它是唯一会改写 `activeView` 的技能库 tab，所以只在「新 view 名」
     * 这条路径上暴露 —— 同一张清单里它已经漏过一次。
     * 判别力：从 `FULL_WINDOW_VIEWS` 删掉它 ⇒ 本条红。
     */
    expect(isFullWindowView("personaSkillLibrary")).toBe(true)
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
      "skillLibrary", "writingSkillLibrary", "writingStyleLibrary", "characterSoulLibrary", "personaSkillLibrary", "skillFavorites",
      "soul", "bookAnalysis", "lint", "wiki", "sources", "graph", "search",
      "reviewCenter", "storySimulation", "settings", "trash", "maintenance",
    ].filter(isFullWindowView)
    expect([...admitted].sort()).toEqual([...FULL_WINDOW_VIEWS].sort())
  })

  /*
   * ⚠️ 这条是**结构性**守卫，专门防「以后又加了一个技能库 tab、忘了加进清单」——
   * 也就是「人物 Skill」这次漏项事故的**同类**，而不是它本身（那条在上面）。
   *
   * 为什么值得单独加：技能库的 tab 清单（`unified-skill-library-view.tsx` 的
   * `skillLibraryTabs`）与 `FULL_WINDOW_VIEWS` 是**两个各写一份的清单**，
   * 中间没有编译期约束 —— 加一个 tab 只要一行、`tsc` 全绿，
   * 但那个新 tab 会像「人物 Skill」一样在左侧冒出一条章节列表。
   *
   * 这里直接读源码把 tab 的 view 名抽出来，逐个要求它们在整窗清单里。
   * 判别力：往 `skillLibraryTabs` 加一个新 view 而不动 `FULL_WINDOW_VIEWS` ⇒ 红。
   */
  it("技能库 tab 清单里每个 view 都在整窗清单里（防下一个 tab 漏项）", () => {
    const source = readFileSync(
      resolve(__dirname, "../components/skill-library/unified-skill-library-view.tsx"),
      "utf8",
    )
    // 只扫 `skillLibraryTabs` 那张数组，别把同文件里 ACTIVE_TAB_BY_VIEW 之类的
    // `view: "…"` 形状也扫进来（多扫不会出错，但会让这条断言的含义变糊）。
    const tabsBlock = source.slice(
      source.indexOf("const skillLibraryTabs = ["),
      source.indexOf("type SkillLibraryTab"),
    )
    expect(tabsBlock.length).toBeGreaterThan(0)

    const views = [...tabsBlock.matchAll(/view:\s*"([A-Za-z]+)"/g)].map((m) => m[1])
    // tab 数量变了要有人过一眼：这里至少保证抽到的不是一个空数组。
    expect(views.length).toBeGreaterThanOrEqual(6)
    expect(views).toContain("personaSkillLibrary")

    const missing = views.filter((view) => !isFullWindowView(view))
    expect(missing, `这些技能库 tab 没进整窗清单，切过去会冒出左侧目录栏：${missing.join(", ")}`).toEqual([])
  })
})
