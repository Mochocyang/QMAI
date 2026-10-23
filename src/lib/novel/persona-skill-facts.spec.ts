import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildPersonaChapterFacts,
  mergeLiveLines,
  syncPersonaSkillChapterFacts,
  type PersonaChapterFactSource,
} from "./persona-skill-facts"

/*
 * sync 要真实落盘（它的价值就在「不调模型也能写进 SKILL.md」），
 * 所以整个文件挂一层内存磁盘。纯函数用例不受影响。
 */
const io = vi.hoisted(() => ({ files: new Map<string, string>() }))

vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!io.files.has(path)) throw new Error(`文件缺失：${path}`)
    return io.files.get(path)!
  },
  writeFileAtomic: async (path: string, contents: string) => {
    io.files.set(path, contents)
  },
  fileExists: async (path: string) => io.files.has(path),
  createDirectory: async () => {},
  deleteFile: async (path: string) => {
    io.files.delete(path)
  },
  listDirectory: async () => [],
}))

function source(overrides: Partial<PersonaChapterFactSource> = {}): PersonaChapterFactSource {
  return {
    chapterNumber: 7,
    characters: ["林清越", "沈砚"],
    organizations: ["青云会", "漕帮"],
    characterStateChanges: [],
    relationshipChanges: [],
    knowledgeChanges: [],
    graphEdges: [],
    ...overrides,
  }
}

describe("buildPersonaChapterFacts — 当前状态", () => {
  it("本章状态变化 + 身份/阵营/目标/弧光合成一段", () => {
    const facts = buildPersonaChapterFacts(
      source({
        characterStateChanges: ["林清越:右肩受伤，被困在码头"],
        characterDetails: {
          林清越: { identity: "外门执事", faction: "青云会", goals: "查清母亲被逐的真相", arcChange: "开始怀疑师父" },
        },
      }),
      "林清越",
    )
    expect(facts.currentState).toContain("第 7 章")
    expect(facts.currentState).toContain("右肩受伤")
    expect(facts.currentState).toContain("身份：外门执事")
    expect(facts.currentState).toContain("弧光：开始怀疑师父")
  })

  it("本章没提到状态时返回空串（由调用方保留上一章）", () => {
    expect(buildPersonaChapterFacts(source(), "林清越").currentState).toBe("")
  })

  it("按别名匹配：快照里写的是别名也算", () => {
    const facts = buildPersonaChapterFacts(
      source({ characterStateChanges: ["清越：剑断了"] }),
      "林清越",
      ["清越"],
    )
    expect(facts.currentState).toContain("剑断了")
  })
})

describe("buildPersonaChapterFacts — 出场组织", () => {
  it("成员表点名才算他出场", () => {
    const facts = buildPersonaChapterFacts(
      source({
        organizationDetails: {
          青云会: { leader: "掌门", members: "林清越、苏晚", goals: "", resources: "" },
          漕帮: { leader: "帮主", members: "老周", goals: "", resources: "" },
        },
      }),
      "林清越",
    )
    expect(facts.organizations).toEqual(["青云会：成员（第 7 章）"])
  })

  it("BELONGS_TO 边也算，且方向反过来同样认", () => {
    const facts = buildPersonaChapterFacts(
      source({ graphEdges: ["青云会->BELONGS_TO->林清越"] }),
      "林清越",
    )
    expect(facts.organizations).toEqual(["青云会：属于（第 7 章）"])
  })

  it("其它关系边给出关系名", () => {
    const facts = buildPersonaChapterFacts(
      source({ graphEdges: ["漕帮->ENEMY_OF->林清越"] }),
      "林清越",
    )
    expect(facts.organizations).toEqual(["漕帮：敌对（第 7 章）"])
  })

  it("没有任何证据的组织不硬塞给他", () => {
    expect(buildPersonaChapterFacts(source(), "林清越").organizations).toEqual([])
  })
})

describe("buildPersonaChapterFacts — 认知与关系", () => {
  it("认知只收点了名的行，并带上章号", () => {
    const facts = buildPersonaChapterFacts(
      source({
        knowledgeChanges: ["林清越知道账本是假的", "沈砚不知道林清越见过账本"],
      }),
      "林清越",
    )
    // 「沈砚不知道林清越见过账本」虽然出现了名字，但主体是沈砚 —— 不能记到林清越头上
    expect(facts.cognition).toEqual(["第 7 章：林清越知道账本是假的"])
  })

  it("关系边：命中 source 或 target 都收，另一端写入关系网", () => {
    const facts = buildPersonaChapterFacts(
      source({ relationshipChanges: ["沈砚->SUSPECTS->林清越", "苏晚->ALLY_OF->沈砚"] }),
      "林清越",
    )
    expect(facts.relations).toEqual(["第 7 章：与 沈砚 关系 → 怀疑"])
    expect(facts.relationNetwork).toEqual(["沈砚：怀疑"])
  })

  it("非边格式但点了名也保留（信息比格式重要）", () => {
    const facts = buildPersonaChapterFacts(
      source({ relationshipChanges: ["林清越与沈砚彻底决裂"] }),
      "林清越",
    )
    expect(facts.relations).toEqual(["第 7 章：林清越与沈砚彻底决裂"])
  })
})

describe("mergeLiveLines", () => {
  it("同一条事实换了章号只保留最新一条", () => {
    const merged = mergeLiveLines("第 3 章：与 沈砚 关系 → 敌对", ["第 7 章：与 沈砚 关系 → 敌对"], 12)
    expect(merged).toBe("第 7 章：与 沈砚 关系 → 敌对")
  })

  it("超出上限丢最旧，保留最近若干条", () => {
    const merged = mergeLiveLines("第 1 章：甲\n第 2 章：乙", ["第 3 章：丙", "第 4 章：丁"], 2)
    expect(merged.split("\n")).toEqual(["第 3 章：丙", "第 4 章：丁"])
  })

  it("空行与空白不写入", () => {
    expect(mergeLiveLines("", ["", "  "], 6)).toBe("")
  })
})

describe("syncPersonaSkillChapterFacts — 真实落盘", () => {
  const project = "C:/project"
  const indexFile = `${project}/.qmai/persona-skills/index.json`
  const docFile = `${project}/.qmai/persona-skills/林清越/SKILL.md`

  function meta(overrides: Record<string, unknown> = {}) {
    return {
      id: "林清越",
      characterName: "林清越",
      aliases: ["清越"],
      roleType: "男主",
      tier: "major",
      pinned: false,
      status: "active",
      firstChapter: 1,
      lastChapter: 6,
      appearanceCount: 4,
      createdChapter: 1,
      lastLearnedChapter: 6,
      skillRevision: 2,
      editedByUser: false,
      hasResearch: false,
      updatedAt: "2026-10-10T00:00:00.000Z",
      ...overrides,
    }
  }

  beforeEach(() => {
    io.files.clear()
  })

  it("把四段写进 SKILL.md，且不动 updatedAt（避免把档案推回自进化队列）", async () => {
    io.files.set(indexFile, JSON.stringify({ version: 1, skills: [meta()] }))
    io.files.set(
      docFile,
      "# 林清越 · 人物 Skill\n\n## 性别\n\n男\n\n## 怎么说话\n\n句子短。\n",
    )

    const updated = await syncPersonaSkillChapterFacts(
      project,
      source({
        characterStateChanges: ["林清越:右肩受伤"],
        knowledgeChanges: ["林清越知道账本是假的"],
        relationshipChanges: ["沈砚->SUSPECTS->林清越"],
        organizationDetails: {
          青云会: { leader: "掌门", members: "林清越、苏晚", goals: "", resources: "" },
        },
      }),
    )

    expect(updated).toEqual(["林清越"])
    const doc = io.files.get(docFile)!
    expect(doc).toContain("## 当前状态")
    expect(doc).toContain("右肩受伤")
    expect(doc).toContain("## 出场组织")
    expect(doc).toContain("青云会：成员（第 7 章）")
    expect(doc).toContain("## 认知变化")
    expect(doc).toContain("知道账本是假的")
    expect(doc).toContain("## 关系变化")
    expect(doc).toContain("与 沈砚 关系 → 怀疑")
    // 「关系网」也吃到本章关系，界面上不用等模型下一轮 refine
    expect(doc).toContain("## 关系网")
    expect(doc).toContain("沈砚：怀疑")
    // 既有内容不能丢
    expect(doc).toContain("## 怎么说话")

    const stored = JSON.parse(io.files.get(indexFile)!).skills[0]
    expect(stored.updatedAt).toBe("2026-10-10T00:00:00.000Z")
    expect(stored.skillRevision).toBe(3)
  })

  it("本章没出场的人一个字节都不动", async () => {
    io.files.set(
      indexFile,
      JSON.stringify({
        version: 1,
        skills: [meta(), meta({ id: "沈砚", characterName: "沈砚", aliases: [] })],
      }),
    )
    const 沈砚Doc = `${project}/.qmai/persona-skills/沈砚/SKILL.md`
    io.files.set(`${project}/.qmai/persona-skills/沈砚/SKILL.md`, "# 沈砚\n\n## 怎么说话\n\n句尾带吧。\n")

    await syncPersonaSkillChapterFacts(
      project,
      source({ characters: ["林清越"], characterStateChanges: ["林清越:受伤"] }),
    )

    expect(io.files.get(沈砚Doc)).toBe("# 沈砚\n\n## 怎么说话\n\n句尾带吧。\n")
  })

  it("重复同步同一章不会堆重复行", async () => {
    io.files.set(indexFile, JSON.stringify({ version: 1, skills: [meta()] }))
    io.files.set(docFile, "# 林清越 · 人物 Skill\n\n## 怎么说话\n\n句子短。\n")
    const facts = source({ relationshipChanges: ["沈砚->SUSPECTS->林清越"] })

    await syncPersonaSkillChapterFacts(project, facts)
    await syncPersonaSkillChapterFacts(project, facts)

    const doc = io.files.get(docFile)!
    expect(doc.match(/与 沈砚 关系 → 怀疑/g)).toHaveLength(1)
  })
})
