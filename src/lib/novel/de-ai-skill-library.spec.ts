import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  BUILT_IN_DE_AI_SKILLS,
  DEFAULT_DE_AI_SKILL_ID,
  createProjectDeAiSkillFromTemplate,
  deleteProjectDeAiSkill,
  getAllDeAiSkills,
  isDeAiSkillModified,
  loadDeAiSkillConfig,
  normalizeDeAiSkillConfig,
  resetBuiltInDeAiSkill,
  resolveAvailableDeAiSkills,
  resolveEffectiveDeAiSkill,
  setDeAiSkillEnabled,
  setDefaultDeAiSkill,
  updateDeAiSkill,
  updateProjectDeAiSkill,
} from "./de-ai-skill-library"

const readFileMock = vi.hoisted(() => vi.fn())
const writeFileMock = vi.hoisted(() => vi.fn())
const joinMock = vi.hoisted(() => vi.fn(async (...parts: string[]) => parts.join("/")))

vi.mock("@/commands/fs", () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
}))

vi.mock("@tauri-apps/api/path", () => ({
  join: joinMock,
}))

describe("de-ai skill library", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("ships five built-in de-AI skills", () => {
    expect(BUILT_IN_DE_AI_SKILLS.map((skill) => skill.id)).toEqual([
      "built-in:comprehensive",
      "built-in:reduce-explanation",
      "built-in:dialogue-natural",
      "built-in:break-regularity",
      "built-in:literary-retain",
    ])
  })

  it("normalizes an empty config to the built-in comprehensive skill", () => {
    expect(normalizeDeAiSkillConfig(null)).toEqual({
      version: 1,
      defaultSkillId: DEFAULT_DE_AI_SKILL_ID,
      disabledSkillIds: [],
      projectSkills: [],
      builtInSkillOverrides: [],
    })
  })

  it("filters disabled skills from available skills", () => {
    const config = normalizeDeAiSkillConfig({
      disabledSkillIds: ["built-in:comprehensive", "built-in:dialogue-natural"],
    })

    const available = resolveAvailableDeAiSkills(config)

    expect(available.some((skill) => skill.id === "built-in:comprehensive")).toBe(false)
    expect(available.some((skill) => skill.id === "built-in:reduce-explanation")).toBe(true)
  })

  it("falls back when selected skill is disabled", () => {
    const config = normalizeDeAiSkillConfig({
      defaultSkillId: "built-in:comprehensive",
      disabledSkillIds: ["built-in:comprehensive"],
    })

    const skill = resolveEffectiveDeAiSkill(config, "built-in:comprehensive")

    expect(skill?.id).toBe("built-in:reduce-explanation")
  })

  it("creates a project skill from a built-in template", () => {
    const config = normalizeDeAiSkillConfig(null)

    const next = createProjectDeAiSkillFromTemplate(config, "built-in:reduce-explanation", 1000)

    expect(next.projectSkills).toHaveLength(1)
    expect(next.projectSkills[0].source).toBe("project")
    expect(next.projectSkills[0].name).toContain("减少解释腔")
    expect(next.defaultSkillId).toBe(next.projectSkills[0].id)
  })

  it("updates and deletes project skills without deleting built-ins", () => {
    const created = createProjectDeAiSkillFromTemplate(
      normalizeDeAiSkillConfig(null),
      "built-in:dialogue-natural",
      1000,
    )
    const id = created.projectSkills[0].id

    const updated = updateProjectDeAiSkill(created, id, { name: "对话规则", content: "只输出正文" }, 2000)
    const deleted = deleteProjectDeAiSkill(updated, id)

    expect(updated.projectSkills[0].name).toBe("对话规则")
    expect(updated.projectSkills[0].updatedAt).toBe(2000)
    expect(deleted.projectSkills).toHaveLength(0)
    expect(deleteProjectDeAiSkill(deleted, "built-in:comprehensive")).toEqual(deleted)
  })

  it("stores edited built-in skills as project overrides and can restore defaults", () => {
    const config = normalizeDeAiSkillConfig(null)

    const updated = updateDeAiSkill(config, "built-in:comprehensive", {
      name: "综合去AI味-项目版",
      description: "当前项目专用规则",
      content: "当前项目覆盖后的内置规则",
    }, 2000)
    const allUpdatedSkills = getAllDeAiSkills(updated)

    expect(updated.builtInSkillOverrides).toHaveLength(1)
    expect(updated.builtInSkillOverrides[0]).toMatchObject({
      id: "built-in:comprehensive",
      name: "综合去AI味-项目版",
      description: "当前项目专用规则",
      content: "当前项目覆盖后的内置规则",
      source: "built-in",
      updatedAt: 2000,
    })
    expect(allUpdatedSkills.filter((skill) => skill.id === "built-in:comprehensive")).toHaveLength(1)
    expect(resolveEffectiveDeAiSkill(updated, "built-in:comprehensive")?.content).toBe("当前项目覆盖后的内置规则")

    const restored = resetBuiltInDeAiSkill(updated, "built-in:comprehensive")

    expect(restored.builtInSkillOverrides).toEqual([])
    expect(resolveEffectiveDeAiSkill(restored, "built-in:comprehensive")?.content).toBe(
      BUILT_IN_DE_AI_SKILLS[0].content,
    )
  })

  it("detects modified built-in and project skills", () => {
    const builtInUpdated = updateDeAiSkill(normalizeDeAiSkillConfig(null), "built-in:comprehensive", {
      name: "综合去AI味-项目版",
      content: "项目覆盖规则",
    }, 2000)
    const projectCreated = createProjectDeAiSkillFromTemplate(builtInUpdated, "built-in:dialogue-natural", 3000)
    const projectId = projectCreated.projectSkills[0].id
    const projectUpdated = updateDeAiSkill(projectCreated, projectId, {
      name: "对话规则",
      content: "新的对话规则",
    }, 4000)

    expect(isDeAiSkillModified(projectUpdated, "built-in:comprehensive")).toBe(true)
    expect(isDeAiSkillModified(projectUpdated, projectId)).toBe(true)
    expect(isDeAiSkillModified(projectUpdated, "built-in:reduce-explanation")).toBe(false)
  })

  it("disables a default skill and moves default to an available skill", () => {
    const config = normalizeDeAiSkillConfig({ defaultSkillId: "built-in:comprehensive" })

    const next = setDeAiSkillEnabled(config, "built-in:comprehensive", false)

    expect(next.disabledSkillIds).toContain("built-in:comprehensive")
    expect(next.defaultSkillId).toBe("built-in:reduce-explanation")
    expect(setDefaultDeAiSkill(next, "built-in:dialogue-natural").defaultSkillId).toBe("built-in:dialogue-natural")
  })

  it("loads legacy de-ai-skill.txt as the default project skill when json config is absent", async () => {
    readFileMock
      .mockRejectedValueOnce(new Error("missing json"))
      .mockResolvedValueOnce("legacy rules")

    const config = await loadDeAiSkillConfig("C:/project")

    expect(config.defaultSkillId).toBe("project:legacy-de-ai-skill")
    expect(config.projectSkills[0]).toMatchObject({
      id: "project:legacy-de-ai-skill",
      name: "旧版自定义去AI味 Skill",
      content: "legacy rules",
    })
  })
})
