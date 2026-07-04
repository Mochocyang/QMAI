import { describe, expect, it } from "vitest"
import type { DeAiSkillConfig } from "@/lib/novel/de-ai-skill-library"
import type { UserSkillConfig } from "@/lib/novel/user-skill-store"
import {
  buildUnifiedSkillEntries,
  filterUnifiedSkillEntries,
  getUnifiedSkillCategory,
  getUnifiedSkillStatus,
} from "./unified-skill-model"

const deAiConfig: DeAiSkillConfig = {
  version: 1,
  defaultSkillId: "built-in:comprehensive",
  disabledSkillIds: ["project:quiet"],
  lastChapterDeAiSkillId: null,
  projectSkills: [
    {
      id: "project:quiet",
      name: "沉浸式去AI味",
      description: "减少解释腔和总结腔",
      templateId: "custom",
      content: "删除协作口吻，保留角色语气。",
      source: "project",
      createdAt: 100,
      updatedAt: 200,
    },
  ],
  builtInSkillOverrides: [
    {
      id: "built-in:comprehensive",
      name: "综合去AI味-项目版",
      description: "项目覆盖版本",
      templateId: "comprehensive",
      content: "去掉模板句和机械总结。",
      source: "built-in",
      updatedAt: 300,
    },
  ],
}

const writingConfig: UserSkillConfig = {
  version: 1,
  selectedSkillId: "skill:rhythm",
  disabledSkillIds: [],
  categories: [],
  skills: [
    {
      id: "skill:rhythm",
      name: "节奏压迫",
      description: "用于严格模式下审稿和改写章节节奏",
      kind: ["review", "structure"],
      stages: ["review", "rewrite"],
      modes: ["strict"],
      content: "检查中段塌陷、重复场景和结尾钩子。",
      source: "uploaded",
      priority: 0,
      tags: [],
      categoryId: "",
      createdAt: 100,
      updatedAt: 200,
    },
  ],
}

describe("unified skill model", () => {
  it("builds unified entries from writing and de-AI skill configs", () => {
    const entries = buildUnifiedSkillEntries(deAiConfig, writingConfig)

    expect(entries.map((entry) => entry.id)).toContain("de-ai:project:quiet")
    expect(entries.map((entry) => entry.id)).toContain("writing:skill:rhythm")

    const deAi = entries.find((entry) => entry.id === "de-ai:project:quiet")
    expect(deAi).toMatchObject({
      library: "de-ai",
      source: "project",
      enabled: false,
      defaultSkill: false,
      category: "去AI味",
      kind: ["style", "rewrite"],
      stages: ["rewrite", "output"],
      modes: ["fast", "standard", "strict"],
    })

    const writing = entries.find((entry) => entry.id === "writing:skill:rhythm")
    expect(writing).toMatchObject({
      library: "writing",
      source: "uploaded",
      enabled: true,
      defaultSkill: true,
      category: "审稿",
      kind: ["review", "structure"],
      stages: ["review", "rewrite"],
      modes: ["strict"],
    })
  })

  it("marks overridden built-in de-AI skill as modified", () => {
    const entries = buildUnifiedSkillEntries(deAiConfig, writingConfig)
    const overridden = entries.find((entry) => entry.id === "de-ai:built-in:comprehensive")

    expect(overridden).toMatchObject({
      name: "综合去AI味-项目版",
      modified: true,
      defaultSkill: true,
      status: "启用",
    })
  })

  it("filters entries by query, category, status, mode, stage and kind", () => {
    const entries = buildUnifiedSkillEntries(deAiConfig, writingConfig)

    expect(filterUnifiedSkillEntries(entries, { query: "压迫" }).map((entry) => entry.id))
      .toEqual(["writing:skill:rhythm"])
    expect(filterUnifiedSkillEntries(entries, { category: "去AI味" }).every((entry) => entry.library === "de-ai"))
      .toBe(true)
    expect(filterUnifiedSkillEntries(entries, { status: "disabled" }).map((entry) => entry.id))
      .toEqual(["de-ai:project:quiet"])
    expect(filterUnifiedSkillEntries(entries, { mode: "strict", stage: "review", kind: "review" }).map((entry) => entry.id))
      .toEqual(["writing:skill:rhythm"])
  })

  it("returns user-facing category and status labels", () => {
    const entries = buildUnifiedSkillEntries(deAiConfig, writingConfig)
    const deAi = entries.find((entry) => entry.id === "de-ai:project:quiet")
    const writing = entries.find((entry) => entry.id === "writing:skill:rhythm")

    expect(deAi && getUnifiedSkillCategory(deAi)).toBe("去AI味")
    expect(writing && getUnifiedSkillCategory(writing)).toBe("审稿")
    expect(deAi && getUnifiedSkillStatus(deAi)).toBe("停用")
    expect(writing && getUnifiedSkillStatus(writing)).toBe("启用")
  })
})
