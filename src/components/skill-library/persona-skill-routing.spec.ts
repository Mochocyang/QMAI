import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(__dirname, "../../..")

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
    const sidebar = readFileSync(resolve(root, "src/components/layout/icon-sidebar.tsx"), "utf8")
    expect(sidebar).toContain("personaSkillLibrary")
  })
})
