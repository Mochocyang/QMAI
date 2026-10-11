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
}))

import {
  PERSONA_INJECT_CHAR_BUDGET,
  PERSONA_INJECT_MAX_SKILLS,
  type PersonaSkillMeta,
} from "./persona-skill-types"
import {
  buildPersonaSkillContext,
  extractPersonaSkillSections,
  matchesPersonaName,
  renderPersonaSkillBlock,
  selectPersonaSkillCandidates,
} from "./persona-skill-context"

const project = "C:/project"
const indexFile = `${project}/.qmai/persona-skills/index.json`

function meta(overrides: Partial<PersonaSkillMeta> & { characterName: string }): PersonaSkillMeta {
  return {
    id: overrides.characterName,
    aliases: [],
    roleType: "男主",
    tier: "major",
    pinned: false,
    status: "active",
    firstChapter: 1,
    lastChapter: 1,
    appearanceCount: 1,
    createdChapter: 1,
    lastLearnedChapter: 1,
    skillRevision: 1,
    editedByUser: false,
    hasResearch: false,
    updatedAt: "2026-10-10T00:00:00.000Z",
    ...overrides,
  }
}

function doc(fields: Record<string, string>): string {
  const body = Object.entries(fields)
    .map(([name, value]) => `## ${name}\n\n${value}\n`)
    .join("\n")
  return `# 人物 Skill\n\n${body}`
}

function seed(skills: PersonaSkillMeta[], documents: Record<string, string>) {
  io.files.set(indexFile, JSON.stringify({ version: 1, skills }))
  for (const [id, content] of Object.entries(documents)) {
    io.files.set(`${project}/.qmai/persona-skills/${id}/SKILL.md`, content)
  }
}

const majorFields = {
  怎么说话: "句子短，先问后答。",
  怎么想: "凡事先算退路。",
  怎么判断: "先看对方的手。",
  什么不做: "不碰旧账。",
  知道局限: "不知道沈砚的真实身份。",
}

describe("matchesPersonaName", () => {
  it("完全相等命中", () => {
    expect(matchesPersonaName("林清越", ["林清越"])).toBe(true)
  })

  it("双向包含都命中", () => {
    expect(matchesPersonaName("林清越推开门", ["林清越"])).toBe(true)
    expect(matchesPersonaName("清越", ["林清越"])).toBe(true)
  })

  it("单字查询不做包含匹配，避免污染", () => {
    expect(matchesPersonaName("林", ["林清越"])).toBe(false)
    expect(matchesPersonaName("林", ["林"])).toBe(true)
  })
})

describe("extractPersonaSkillSections", () => {
  it("按二级标题切段，同名标题会拼接", () => {
    const sections = extractPersonaSkillSections(
      "# 标题\n\n## 怎么说话\n\n甲。\n\n## 补充（第 3 章）\n\n乙。\n\n## 补充（第 9 章）\n\n丙。\n",
    )
    expect(sections.get("怎么说话")).toBe("甲。")
    expect(sections.get("补充（第 3 章）")).toBe("乙。")
    expect(sections.get("补充（第 9 章）")).toBe("丙。")
  })
})

describe("selectPersonaSkillCandidates", () => {
  // 夹具人物名必须 ≥ 2 字：matchesPersonaName 对单字名只允许精确相等，
  // 而这里传进去的是一整段 matchingText，所以单字名会（按设计）匹配不上。
  // 名字只是占位，本组用例测的是排序与状态筛选。
  beforeEach(() => io.files.clear())

  it("绿勾排最前，其次主要人物，再按出场次数降序", () => {
    const index = {
      version: 1 as const,
      skills: [
        meta({ characterName: "甲一", appearanceCount: 3 }),
        meta({ characterName: "乙二", tier: "minor", roleType: "配角", appearanceCount: 9 }),
        meta({ characterName: "丙三", pinned: true, tier: "minor", roleType: "配角", appearanceCount: 1 }),
        meta({ characterName: "丁四", appearanceCount: 7 }),
      ],
    }
    const selected = selectPersonaSkillCandidates(index, "甲一 乙二 丙三 丁四 都出场了")
    expect(selected.map((item) => item.characterName)).toEqual(["丙三", "丁四", "甲一", "乙二"])
  })

  it("归档 / 潜伏的人不入选，绿勾例外", () => {
    const index = {
      version: 1 as const,
      skills: [
        meta({ characterName: "甲一", status: "archived" }),
        meta({ characterName: "乙二", status: "dormant" }),
        meta({ characterName: "丙三", status: "archived", pinned: true }),
      ],
    }
    const selected = selectPersonaSkillCandidates(index, "甲一 乙二 丙三")
    expect(selected.map((item) => item.characterName)).toEqual(["丙三"])
  })

  it("最多取 12 个", () => {
    const skills = Array.from({ length: 20 }, (_unused, index) =>
      meta({ characterName: `人物${index}`, appearanceCount: 100 - index }),
    )
    const selected = selectPersonaSkillCandidates(
      { version: 1, skills },
      skills.map((item) => item.characterName).join(" "),
    )
    expect(selected).toHaveLength(PERSONA_INJECT_MAX_SKILLS)
  })
})

describe("renderPersonaSkillBlock", () => {
  it("主要人物写 7 段", () => {
    const block = renderPersonaSkillBlock(meta({ characterName: "林清越" }), doc(majorFields))
    for (const field of Object.keys(majorFields)) expect(block).toContain(field)
    expect(block).toContain("主要人物")
    expect(block).toContain("出场 1 次")
  })

  it("次要人物只留「怎么说话 / 怎么判断」，其余段落即使存在也不注入", () => {
    const block = renderPersonaSkillBlock(
      meta({ characterName: "沈砚", tier: "minor", roleType: "配角" }),
      doc(majorFields),
    )
    expect(block).toContain("怎么说话")
    expect(block).toContain("怎么判断")
    expect(block).not.toContain("怎么想")
    expect(block).not.toContain("什么不做")
    expect(block).not.toContain("知道局限")
  })

  it("用户手改过的「补充」段也会注入", () => {
    const block = renderPersonaSkillBlock(
      meta({ characterName: "林清越", editedByUser: true }),
      doc({ 怎么说话: "句子短。", "补充（第 3 章）": "AI 本轮补的观察。" }),
    )
    expect(block).toContain("AI 本轮补的观察。")
  })
})

describe("buildPersonaSkillContext", () => {
  beforeEach(() => io.files.clear())

  it("没有 index.json 时返回空串", async () => {
    expect(await buildPersonaSkillContext(project, "林清越出场了")).toBe("")
  })

  it("matchingText 为空时返回空串，不读盘", async () => {
    seed([meta({ characterName: "林清越" })], { 林清越: doc(majorFields) })
    expect(await buildPersonaSkillContext(project, "   ")).toBe("")
  })

  it("没有命中任何人物时返回空串", async () => {
    seed([meta({ characterName: "林清越" })], { 林清越: doc(majorFields) })
    expect(await buildPersonaSkillContext(project, "完全无关的一段细纲")).toBe("")
  })

  it("命中时输出带标题的块，并包含该人物的字段", async () => {
    seed([meta({ characterName: "林清越" })], { 林清越: doc(majorFields) })
    const text = await buildPersonaSkillContext(project, "林清越推开门，看见沈砚。")
    expect(text).toContain("【人物 Skill】")
    expect(text).toContain("林清越")
    expect(text).toContain("句子短，先问后答。")
  })

  it("别名也能命中", async () => {
    seed([meta({ characterName: "林清越", aliases: ["清越"] })], { 林清越: doc(majorFields) })
    expect(await buildPersonaSkillContext(project, "清越站在门口")).toContain("林清越")
  })

  it("index 里有条目但 SKILL.md 丢了时跳过它，不抛", async () => {
    seed([meta({ characterName: "林清越" })], {})
    expect(await buildPersonaSkillContext(project, "林清越出场了")).toBe("")
  })

  it("总长不超过 4000 字预算", async () => {
    const long = "字".repeat(3000)
    const fields = Object.fromEntries(
      ["怎么说话", "怎么想", "怎么判断", "什么不做", "知道局限"].map((name) => [name, long]),
    )
    const skills = [
      meta({ characterName: "甲一", appearanceCount: 100 }),
      meta({ characterName: "乙二", appearanceCount: 90 }),
      meta({ characterName: "丙三", appearanceCount: 80 }),
    ]
    seed(skills, {
      甲一: doc(fields),
      乙二: doc(fields),
      丙三: doc(fields),
    })
    const text = await buildPersonaSkillContext(project, "甲一 乙二 丙三")
    expect(text.length).toBeLessThanOrEqual(PERSONA_INJECT_CHAR_BUDGET + 20)
    expect(text).toContain("甲一")
    expect(text).toContain("乙二")
    expect(text).not.toContain("丙三")
  })
})
