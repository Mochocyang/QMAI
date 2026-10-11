import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { isNavItemActive } from "@/lib/sidebar-nav-preferences"

const root = resolve(__dirname, "../../..")

/**
 * 去掉注释后的源码副本（同仓内其余 `stripComments` 的写法）。
 *
 * ⚠️ 本文件原先的第三条用例直接对**整份源码文本**查字面量，合并
 * `work/scratch-20261010` 之后它被**注释**满足（实测见下），所以凡是
 * 「文件里有没有这个标识符」这类断言，都必须先去掉注释再查。
 *
 * ⚠️ 已知局限（此处够用即可）：不做词法分析，因此字符串字面量里的
 * `//` 或 `/*` 也会被当成注释起点。本文件的匹配目标
 * （`personaSkillLibrary` / `isNavItemActive` 调用）都不含这类字面量。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
}

describe("人物 Skill 路由连线", () => {
  it("activeView 联合类型认得 personaSkillLibrary", () => {
    const store = readFileSync(resolve(root, "src/stores/wiki-store.ts"), "utf8")
    expect(store).toContain('"personaSkillLibrary"')
    expect(store).toContain("personaSkillLibraryDraftDirty")
  })

  it("内容区把 personaSkillLibrary 路由到统一技能库", () => {
    const content = readFileSync(resolve(root, "src/components/layout/content-area.tsx"), "utf8")
    expect(content).toContain('case "personaSkillLibrary":')
    expect(content).toContain("UnifiedSkillLibraryView")
  })

  it("侧栏图标在人物 Skill 页保持高亮", () => {
    /*
     * ⚠️ 这条用例曾经是**假绿**，不要再改回源码文本查字面量。
     *
     * 原写法：读 `icon-sidebar.tsx`，断言它 `toContain("personaSkillLibrary")`。
     * 在合并 `work/scratch-20261010` 之后，那条折算判定从 `icon-sidebar.tsx`
     * 的**内联条件**搬进了 `@/lib/sidebar-nav-preferences` 的
     * `FOLDED_SKILL_LIBRARY_VIEWS`，于是该文件里这个字面量**只剩注释里有**
     * （一句说明「已把它并入 FOLDED_SKILL_LIBRARY_VIEWS」的注释）。
     *
     * 两次实测（都做过，不是推断）：
     *   1. 只把注释里的字面量改写掉 → 本用例立刻变红 ⇒ 它此前是被**注释**满足的；
     *   2. 把 `personaSkillLibrary` 从 `FOLDED_SKILL_LIBRARY_VIEWS` **删掉**
     *      （真实行为回归）、注释原样留着 → 本文件连同
     *      `sidebar-nav-preferences.spec.ts` 共 **12 条全绿** ⇒ 它**抓不到**
     *      自己声称要守的那个回归。
     *
     * 现在拆成两半，各自都杀得动：
     *   (a) **行为**：`isNavItemActive` 必须把人物 Skill 视图折算到技能库图标
     *       —— 注释满足不了它，实现再搬家也不会失效；
     *   (b) **连线**：`icon-sidebar.tsx` 必须真的**调用**那个纯函数
     *       —— 纯函数对而组件不调，行为断言照样绿（这正是原写法的盲区）。
     *       (b) 先 `stripComments` 再查，注释满足不了它。
     */
    expect(isNavItemActive("skillLibrary", "personaSkillLibrary")).toBe(true)
    // 反向对照：折算只对技能库图标生效，别的条目不得被误折算
    expect(isNavItemActive("soul", "personaSkillLibrary")).toBe(false)
    // 反向对照：「收藏」是既有例外，不得被顺手统一进来
    expect(isNavItemActive("skillLibrary", "skillFavorites")).toBe(false)

    const iconSidebar = stripComments(
      readFileSync(resolve(root, "src/components/layout/icon-sidebar.tsx"), "utf8"),
    )
    expect(iconSidebar).toContain("isNavItemActive(item.view, activeView)")
  })
})
