import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  BUILT_IN_DE_AI_SKILLS,
  DEFAULT_DE_AI_SKILL_ID,
  createBlankProjectDeAiSkill,
  deleteProjectDeAiSkill,
  getAllDeAiSkills,
  isDeAiSkillModified,
  loadDeAiSkillConfig,
  loadEffectiveDeAiSkillSafely,
  normalizeDeAiSkillConfig,
  recreateDeAiSkillConfig,
  resetBuiltInDeAiSkill,
  restoreDeAiSkillConfigFromBackup,
  resolveAvailableDeAiSkills,
  resolveEffectiveDeAiSkill,
  saveDeAiSkillConfig,
  setLastChapterDeAiSkill,
  setDeAiSkillEnabled,
  setDefaultDeAiSkill,
  updateDeAiSkill,
  updateProjectDeAiSkill,
} from "./de-ai-skill-library"

const readFileMock = vi.hoisted(() => vi.fn())
const writeFileMock = vi.hoisted(() => vi.fn())
const writeFileAtomicMock = vi.hoisted(() => vi.fn())
const joinMock = vi.hoisted(() => vi.fn(async (...parts: string[]) => parts.join("/")))

vi.mock("@/commands/fs", () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
  writeFileAtomic: writeFileAtomicMock,
}))

vi.mock("@tauri-apps/api/path", () => ({
  join: joinMock,
}))

describe("de-ai skill library", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    writeFileAtomicMock.mockResolvedValue(undefined)
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

  it("gives each built-in skill a dedicated rule section instead of the same base prompt", () => {
    expect(BUILT_IN_DE_AI_SKILLS.find((skill) => skill.id === "built-in:comprehensive")?.content).toContain(
      "## 综合去AI味规则",
    )
    expect(BUILT_IN_DE_AI_SKILLS.find((skill) => skill.id === "built-in:reduce-explanation")?.content).toContain(
      "## 减少解释腔规则",
    )
    expect(BUILT_IN_DE_AI_SKILLS.find((skill) => skill.id === "built-in:dialogue-natural")?.content).toContain(
      "## 对话口语化规则",
    )
    expect(BUILT_IN_DE_AI_SKILLS.find((skill) => skill.id === "built-in:break-regularity")?.content).toContain(
      "## 打破工整句式规则",
    )
    expect(BUILT_IN_DE_AI_SKILLS.find((skill) => skill.id === "built-in:literary-retain")?.content).toContain(
      "## 保留文艺感规则",
    )
  })

  it("folds information-density subtraction into comprehensive and keeps literary metaphor uncapped", () => {
    const comprehensive = BUILT_IN_DE_AI_SKILLS.find((skill) => skill.id === "built-in:comprehensive")?.content ?? ""
    const literary = BUILT_IN_DE_AI_SKILLS.find((skill) => skill.id === "built-in:literary-retain")?.content ?? ""
    const explanation = BUILT_IN_DE_AI_SKILLS.find((skill) => skill.id === "built-in:reduce-explanation")?.content ?? ""
    const regularity = BUILT_IN_DE_AI_SKILLS.find((skill) => skill.id === "built-in:break-regularity")?.content ?? ""
    const dialogue = BUILT_IN_DE_AI_SKILLS.find((skill) => skill.id === "built-in:dialogue-natural")?.content ?? ""

    expect(comprehensive).toContain("信息密度")
    expect(comprehensive).toContain("无效热闹")
    expect(comprehensive).toContain("三问")
    expect(comprehensive).toContain("不编进展")
    expect(explanation).toContain("三问")
    expect(regularity).toContain("单手法循环")
    expect(dialogue).toContain("对线循环")
    expect(literary).toContain("不要用单章比喻数量硬顶")
    expect(literary).not.toContain("比喻单章不超过2")
  })

  it("keeps built-in skill prompts materially different from each other", () => {
    const contents = BUILT_IN_DE_AI_SKILLS.map((skill) => skill.content)

    for (let i = 0; i < contents.length; i += 1) {
      for (let j = i + 1; j < contents.length; j += 1) {
        const shorter = Math.min(contents[i].length, contents[j].length)
        let samePrefix = 0
        while (samePrefix < shorter && contents[i][samePrefix] === contents[j][samePrefix]) {
          samePrefix += 1
        }
        expect(samePrefix / shorter).toBeLessThan(0.65)
      }
    }
  })

  it("ships professional editing workflows for every built-in skill", () => {
    for (const skill of BUILT_IN_DE_AI_SKILLS) {
      expect(skill.content).toContain("## 适用场景")
      expect(skill.content).toContain("## 诊断步骤")
      expect(skill.content).toContain("## 改写优先级")
      expect(skill.content).toContain("## 禁止改法")
      expect(skill.content.length).toBeGreaterThan(900)
    }
  })

  it("keeps every built-in prompt centered on de-AI work instead of generic polishing", () => {
    for (const skill of BUILT_IN_DE_AI_SKILLS) {
      expect(skill.content).toContain("## 去AI味核心目标")
      expect(skill.content).toContain("## AI味识别清单")
      expect(skill.content).toContain("## 去AI味处理流程")
      expect(skill.content).toContain("## 反润色约束")
      expect(skill.content).toContain("## 去AI味输出契约")
      expect(skill.content.length).toBeGreaterThan(1500)
      expect((skill.content.match(/去AI味/g) ?? []).length).toBeGreaterThanOrEqual(8)
      expect((skill.content.match(/AI味/g) ?? []).length).toBeGreaterThanOrEqual(8)
    }
  })

  it("normalizes an empty config to the built-in comprehensive skill", () => {
    expect(normalizeDeAiSkillConfig(null)).toEqual({
      version: 1,
      defaultSkillId: DEFAULT_DE_AI_SKILL_ID,
      disabledSkillIds: [],
      projectSkills: [],
      builtInSkillOverrides: [],
      lastChapterDeAiSkillId: null,
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

  it("creates a blank project skill without copying a built-in prompt", () => {
    const config = normalizeDeAiSkillConfig(null)

    const next = createBlankProjectDeAiSkill(config, 1000)

    expect(next.projectSkills).toHaveLength(1)
    expect(next.projectSkills[0]).toMatchObject({
      id: "project:1000",
      name: "新建去AI味 Skill",
      description: "",
      templateId: "custom",
      source: "project",
      createdAt: 1000,
      updatedAt: 1000,
    })
    expect(next.projectSkills[0].content).toContain("在这里填写这个 Skill")
    expect(next.projectSkills[0].content).not.toContain("综合去AI味规则")
    expect(next.defaultSkillId).toBe("project:1000")
  })

  it("updates and deletes project skills without deleting built-ins", () => {
    const created = createBlankProjectDeAiSkill(normalizeDeAiSkillConfig(null), 1000)
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
    const projectCreated = createBlankProjectDeAiSkill(builtInUpdated, 3000)
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

  it("throws when the json skill config is corrupt instead of falling back and risking overwrite", async () => {
    readFileMock.mockResolvedValueOnce("{bad json")

    await expect(loadDeAiSkillConfig("C:/project")).rejects.toThrow("技能库配置文件损坏")
  })

  it("loads the effective skill safely and returns a warning when the config is corrupt", async () => {
    readFileMock.mockResolvedValueOnce("{bad json")

    const result = await loadEffectiveDeAiSkillSafely("C:/project", "built-in:comprehensive")

    expect(result.skill).toBeNull()
    expect(result.warning).toBe("去AI味配置损坏，本次未应用去AI味 Skill，请到技能库恢复配置")
  })

  it("does not set a disabled or unknown skill as default", () => {
    const config = normalizeDeAiSkillConfig({
      defaultSkillId: "built-in:comprehensive",
      disabledSkillIds: ["built-in:dialogue-natural"],
    })

    expect(setDefaultDeAiSkill(config, "built-in:dialogue-natural").defaultSkillId).toBe("built-in:comprehensive")
    expect(setDefaultDeAiSkill(config, "missing").defaultSkillId).toBe("built-in:comprehensive")
    expect(setDefaultDeAiSkill(config, "built-in:reduce-explanation").defaultSkillId).toBe(
      "built-in:reduce-explanation",
    )
  })

  it("persists the last chapter de-AI skill only when it is available", () => {
    const config = normalizeDeAiSkillConfig({
      disabledSkillIds: ["built-in:dialogue-natural"],
    })

    expect(setLastChapterDeAiSkill(config, "built-in:reduce-explanation").lastChapterDeAiSkillId).toBe(
      "built-in:reduce-explanation",
    )
    expect(setLastChapterDeAiSkill(config, "built-in:dialogue-natural").lastChapterDeAiSkillId).toBeNull()
    expect(setLastChapterDeAiSkill(config, "missing").lastChapterDeAiSkillId).toBeNull()
  })

  it("backs up the existing json config before saving a new config", async () => {
    const existing = JSON.stringify(normalizeDeAiSkillConfig({
      defaultSkillId: "built-in:dialogue-natural",
    }))
    const next = normalizeDeAiSkillConfig({
      defaultSkillId: "built-in:reduce-explanation",
    })
    readFileMock.mockResolvedValueOnce(existing)

    await saveDeAiSkillConfig("C:/project", next)

    expect(writeFileMock).toHaveBeenNthCalledWith(1, "C:/project/de-ai-skills.backup.json", existing)
    expect(writeFileAtomicMock).toHaveBeenCalledWith(
      "C:/project/de-ai-skills.json",
      JSON.stringify(next, null, 2),
    )
  })

  it("does not use a non-atomic main config write when saving", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing json"))
    const next = normalizeDeAiSkillConfig({
      defaultSkillId: "built-in:reduce-explanation",
    })

    await saveDeAiSkillConfig("C:/project", next)

    expect(writeFileMock).not.toHaveBeenCalledWith(
      "C:/project/de-ai-skills.json",
      expect.any(String),
    )
    expect(writeFileAtomicMock).toHaveBeenCalledWith(
      "C:/project/de-ai-skills.json",
      JSON.stringify(next, null, 2),
    )
  })

  it("queues concurrent saves for the same project path", async () => {
    let firstAtomicWriteDone = false
    let releaseFirstWrite!: () => void
    readFileMock.mockRejectedValue(new Error("missing json"))
    writeFileAtomicMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstWrite = resolve
      })
      firstAtomicWriteDone = true
    })
    writeFileAtomicMock.mockImplementationOnce(async () => {
      expect(firstAtomicWriteDone).toBe(true)
    })

    const first = saveDeAiSkillConfig("C:/project", normalizeDeAiSkillConfig({
      defaultSkillId: "built-in:reduce-explanation",
    }))
    const second = saveDeAiSkillConfig("C:/project", normalizeDeAiSkillConfig({
      defaultSkillId: "built-in:dialogue-natural",
    }))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(writeFileAtomicMock).toHaveBeenCalledTimes(1)
    releaseFirstWrite()
    await Promise.all([first, second])

    expect(writeFileAtomicMock).toHaveBeenCalledTimes(2)
  })

  it("restores the main config file from a valid backup config", async () => {
    const backup = normalizeDeAiSkillConfig({
      defaultSkillId: "built-in:dialogue-natural",
    })
    readFileMock.mockResolvedValueOnce(JSON.stringify(backup))

    const restored = await restoreDeAiSkillConfigFromBackup("C:/project")

    expect(restored.defaultSkillId).toBe("built-in:dialogue-natural")
    expect(writeFileAtomicMock).toHaveBeenCalledWith(
      "C:/project/de-ai-skills.json",
      JSON.stringify(backup, null, 2),
    )
  })

  it("recreates the config file with defaults without reading the corrupt file", async () => {
    const recreated = await recreateDeAiSkillConfig("C:/project")

    expect(recreated.defaultSkillId).toBe(DEFAULT_DE_AI_SKILL_ID)
    expect(readFileMock).not.toHaveBeenCalled()
    expect(writeFileAtomicMock).toHaveBeenCalledWith(
      "C:/project/de-ai-skills.json",
      JSON.stringify(normalizeDeAiSkillConfig(null), null, 2),
    )
  })
})
