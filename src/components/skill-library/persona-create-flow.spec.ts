// @vitest-environment jsdom
//
// 「新建人物角色」与「人物管理入口」的链路约束。
//
// 需求（2026-10-30 修订，用户三次反馈后定稿）：
//   ① 点「新建人物角色」要打开**一整块界面**（像技能库人物 skill 那样），
//      不是在大纲列表里填个名字。
//   ② 人物 Skill 从技能库移出后，必须在大纲侧**找得到**入口。
//   ③ 建档必须真的写出 wiki/outlines/人物小传/<名>.md，否则大纲列表里看不到角色。
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const sidebar = readFileSync(resolve(__dirname, "../layout/sidebar-panel.tsx"), "utf8")
const uitestDir = readFileSync(resolve(__dirname, "../uitest/ui-test-directory.tsx"), "utf8")
const unified = readFileSync(resolve(__dirname, "unified-skill-library-view.tsx"), "utf8")
const view = readFileSync(resolve(__dirname, "persona-skill-view.tsx"), "utf8")
const learning = readFileSync(resolve(__dirname, "../../lib/novel/persona-skill-learning.ts"), "utf8")

describe("新建人物角色：打开完整界面", () => {
  it("大纲菜单有「新建人物角色」入口", () => {
    expect(uitestDir).toContain("新建人物角色")
    expect(uitestDir).toContain("onCreatePersona")
  })

  it("点它切到人物 Skill 整窗视图并请求新建模式", () => {
    expect(sidebar).toContain('setActiveView("personaSkillLibrary")')
    expect(sidebar).toContain("setPersonaSkillCreateRequested(true)")
  })

  it("不再走大纲的内联取名流程（那是只填名字的输入框）", () => {
    const at = sidebar.indexOf("function beginCreate")
    const beginCreate = sidebar.slice(at, at + 900)
    const personaAt = beginCreate.indexOf('request.kind === "persona"')
    const pendingAt = beginCreate.indexOf("setPendingCreate(request)")
    expect(personaAt).toBeGreaterThan(-1)
    // persona 必须在 setPendingCreate 之前 return，否则会落进内联输入框
    expect(pendingAt).toBeGreaterThan(personaAt)
  })

  it("人物页有新建表单，并消费一次性意图", () => {
    expect(view).toContain("PersonaPersonalityCreateForm")
    expect(view).toContain("personaSkillCreateRequested")
    expect(view).toContain("setPersonaSkillCreateRequested(false)")
  })
})

describe("人物入口：移出技能库后在大纲侧找得到", () => {
  it("顶部那枚「人物」图标已删除：入口只剩「新建」菜单与左栏区段", () => {
    // 反向守卫：图标与它接的旧视图跳转都不该再出现。
    // 它和左栏「活跃角色 / 候选角色」功能重叠，用户实测认为两个入口互相干扰。
    expect(uitestDir).not.toContain('aria-label="人物"')
    expect(uitestDir).not.toContain("onOpenPersona")
    expect(sidebar).not.toContain("onOpenPersona")
    // 「新建人物角色」仍在新建菜单里
    expect(uitestDir).toContain("新建人物角色")
  })

  it("技能库标签数组里已没有「人物 Skill」", () => {
    const tabsBlock = unified.slice(
      unified.indexOf("const skillLibraryTabs = ["),
      unified.indexOf("type SkillLibraryTab"),
    )
    expect(tabsBlock).not.toContain("personaSkillLibrary")
    expect(tabsBlock).not.toContain("人物 Skill")
    expect(tabsBlock).toContain("去AI味技能")
    expect(tabsBlock).toContain("收藏")
  })
})

describe("建档产出投影文件", () => {
  it("createPersonaSkillByUser 会调用 projectPersonaToOutline", () => {
    const fnStart = learning.indexOf("export async function createPersonaSkillByUser")
    const fnBody = learning.slice(fnStart, fnStart + 2600)
    expect(fnBody).toContain("projectPersonaToOutline(pp, id)")
  })
})
