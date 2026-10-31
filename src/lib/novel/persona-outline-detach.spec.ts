import { beforeEach, describe, expect, it, vi } from "vitest"

const io = vi.hoisted(() => ({ files: new Map<string, string>() }))

vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!io.files.has(path)) throw new Error(`文件缺失：${path}`)
    return io.files.get(path)!
  },
  writeFileAtomic: async (path: string, contents: string) => {
    io.files.set(path, contents)
  },
  createDirectory: async () => {},
  listDirectory: async () => [],
  fileExists: async (path: string) => io.files.has(path),
}))

import {
  applyPersonaKeep,
  detachOutlineRef,
  detachOutlineRefFromSkills,
  planPersonaDetach,
  planPersonaKeep,
  removePersonaFromIndex,
} from "./persona-outline-detach"
import { loadPersonaSkillIndex } from "./persona-skill-store"
import type { PersonaSkillMeta } from "./persona-skill-types"

const project = "C:/project"
const indexFile = `${project}/.qmai/persona-skills/index.json`
const OUTLINE = "卷纲-第一卷.md"

function meta(overrides: Partial<PersonaSkillMeta> & { characterName: string }): PersonaSkillMeta {
  return {
    id: overrides.characterName, aliases: [], roleType: "", tier: "minor", pinned: false,
    status: "active", firstChapter: 1, lastChapter: 4, appearanceCount: 1, createdChapter: 1,
    lastLearnedChapter: 4, skillRevision: 1, editedByUser: false, hasResearch: false,
    updatedAt: "2026-10-10T00:00:00.000Z", origin: "auto", outlineRefs: [OUTLINE], asOfChapter: 4,
    ...overrides,
  }
}

describe("planPersonaDetach", () => {
  it("手工建档的角色永不连带移除", () => {
    const plan = planPersonaDetach({ outlineFileName: OUTLINE, skills: [meta({ characterName: "A", origin: "manual" })] })
    expect(plan.removals).toEqual([])
    expect(plan.kept).toEqual([{ characterName: "A", reason: "manual" }])
  })

  it("绿勾角色永不连带移除", () => {
    const plan = planPersonaDetach({ outlineFileName: OUTLINE, skills: [meta({ characterName: "B", pinned: true })] })
    expect(plan.removals).toEqual([])
    expect(plan.kept).toEqual([{ characterName: "B", reason: "pinned" }])
  })

  it("仍被其他大纲引用时保留，并给出其他引用", () => {
    const plan = planPersonaDetach({
      outlineFileName: OUTLINE,
      skills: [meta({ characterName: "C", outlineRefs: [OUTLINE, "章纲-第3章.md"] })],
    })
    expect(plan.removals).toEqual([])
    expect(plan.kept).toEqual([{ characterName: "C", reason: "referenced", otherRefs: ["章纲-第3章.md"] }])
  })

  it("auto + 未绿勾 + 仅被这一份引用 → 可移除", () => {
    const plan = planPersonaDetach({ outlineFileName: OUTLINE, skills: [meta({ characterName: "D" })] })
    expect(plan.removals).toEqual(["D"])
    expect(plan.kept).toEqual([])
  })

  it("未引用这份大纲的角色既不移除也不列为保留", () => {
    const plan = planPersonaDetach({ outlineFileName: OUTLINE, skills: [meta({ characterName: "E", outlineRefs: [] })] })
    expect(plan.removals).toEqual([])
    expect(plan.kept).toEqual([])
  })

  it("混合场景：一次分拣清楚谁删谁留", () => {
    const plan = planPersonaDetach({
      outlineFileName: OUTLINE,
      skills: [
        meta({ characterName: "手建", origin: "manual" }),
        meta({ characterName: "重点", pinned: true }),
        meta({ characterName: "共用", outlineRefs: [OUTLINE, "章纲-第5章.md"] }),
        meta({ characterName: "可删" }),
      ],
    })
    expect(plan.removals).toEqual(["可删"])
    expect(plan.kept.map((item) => item.reason)).toEqual(["manual", "pinned", "referenced"])
  })
})

describe("planPersonaKeep", () => {
  it("解引用 + 冻结 asOfChapter + 转 dormant", () => {
    const patches = planPersonaKeep({
      outlineFileName: OUTLINE,
      skills: [meta({ characterName: "F", id: "F", lastChapter: 7 })],
    })
    expect(patches).toEqual([{ id: "F", outlineRefs: [], status: "dormant", asOfChapter: 7 }])
  })

  it("从没学过的角色保留原有 asOfChapter（不硬造 0）", () => {
    const patches = planPersonaKeep({
      outlineFileName: OUTLINE,
      skills: [meta({ characterName: "G", id: "G", lastChapter: 0, asOfChapter: null })],
    })
    expect(patches[0].asOfChapter).toBeNull()
  })

  it("未引用该大纲的角色不产生补丁", () => {
    expect(planPersonaKeep({ outlineFileName: OUTLINE, skills: [meta({ characterName: "H", outlineRefs: [] })] })).toEqual([])
  })
})

describe("removePersonaFromIndex", () => {
  it("只移除点名的角色，其余按原顺序保留", () => {
    const skills = [meta({ characterName: "A" }), meta({ characterName: "B" }), meta({ characterName: "C" })]
    const result = removePersonaFromIndex(skills, ["B"])
    expect(result.removed).toEqual(["B"])
    expect(result.next.map((item) => item.characterName)).toEqual(["A", "C"])
  })

  it("名字不存在时什么都不移除", () => {
    const result = removePersonaFromIndex([meta({ characterName: "A" })], ["不存在"])
    expect(result.removed).toEqual([])
    expect(result.next).toHaveLength(1)
  })
})

describe("applyPersonaKeep", () => {
  it("只改补丁命中的角色", () => {
    const skills = [meta({ characterName: "A", id: "A" }), meta({ characterName: "B", id: "B" })]
    const next = applyPersonaKeep(skills, [{ id: "A", outlineRefs: [], status: "dormant", asOfChapter: 4 }])
    expect(next[0].status).toBe("dormant")
    expect(next[0].outlineRefs).toEqual([])
    expect(next[1].status).toBe("active")
    expect(next[1].outlineRefs).toEqual([OUTLINE])
  })
})

describe("detachOutlineRef", () => {
  beforeEach(() => io.files.clear())

  it("落盘：被删大纲的引用从 index 里消失", async () => {
    io.files.set(indexFile, JSON.stringify({
      version: 1,
      skills: [meta({ characterName: "林清越", outlineRefs: [OUTLINE, "章纲-第3章.md"] })],
    }))
    expect(await detachOutlineRef(project, OUTLINE)).toEqual(["林清越"])
    const skills = (await loadPersonaSkillIndex(project)).skills
    expect(skills[0].outlineRefs).toEqual(["章纲-第3章.md"])
  })

  it("只解引用，不动角色状态与来源", async () => {
    io.files.set(indexFile, JSON.stringify({ version: 1, skills: [meta({ characterName: "林清越" })] }))
    await detachOutlineRef(project, OUTLINE)
    const skill = (await loadPersonaSkillIndex(project)).skills[0]
    expect(skill.status).toBe("active")
    expect(skill.origin).toBe("auto")
  })

  it("没有引用时返回空，且不写盘", async () => {
    io.files.set(indexFile, JSON.stringify({ version: 1, skills: [meta({ characterName: "A", outlineRefs: [] })] }))
    const before = io.files.get(indexFile)
    expect(await detachOutlineRef(project, OUTLINE)).toEqual([])
    expect(io.files.get(indexFile)).toBe(before)
  })

  it("空文件名直接返回", async () => {
    expect(await detachOutlineRef(project, "   ")).toEqual([])
  })
})

describe("detachOutlineRefFromSkills", () => {
  it("只摘掉被删大纲的引用，别的引用原样保留", () => {
    const plan = detachOutlineRefFromSkills(
      [meta({ characterName: "林清越", outlineRefs: [OUTLINE, "章纲-第3章.md"] })],
      OUTLINE,
    )
    expect(plan.changed).toEqual(["林清越"])
    expect(plan.next.get("林清越")).toEqual(["章纲-第3章.md"])
  })
})
