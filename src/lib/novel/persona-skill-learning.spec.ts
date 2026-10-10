import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import type { PersonaSkillIndex, PersonaSkillMeta } from "./persona-skill-types"

const io = vi.hoisted(() => {
  const files = new Map<string, string>()
  return { files }
})

vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!io.files.has(path)) throw new Error(`文件缺失：${path}`)
    return io.files.get(path)!
  },
  writeFileAtomic: async (path: string, contents: string) => {
    io.files.set(path, contents)
  },
  // 加固后的 store 靠 fileExists 区分「索引不存在」（可安全当空索引）与
  // 「存在但读不出来」（拒绝写，绝不覆盖）。不 mock 它会掉进真实 Tauri invoke。
  fileExists: async (path: string) => io.files.has(path),
  createDirectory: async () => {},
  listDirectory: async (dir: string) => {
    const prefix = dir.endsWith("/") ? dir : `${dir}/`
    const nodes = new Map<string, { name: string; path: string; is_dir: boolean }>()
    for (const path of io.files.keys()) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      const head = rest.split("/")[0]
      const childPath = `${prefix}${head}`
      nodes.set(childPath, { name: head, path: childPath, is_dir: rest.includes("/") })
    }
    return [...nodes.values()]
  },
}))

const streamChatMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/llm-client", () => ({
  streamChat: streamChatMock,
  DEFAULT_LLM_REQUEST_TIMEOUT_MS: 1000,
}))

vi.mock("@/lib/has-usable-llm", () => ({ hasUsableLlm: () => true }))

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: { getState: () => ({ providerConfigs: [] }) },
}))

import {
  collectChapterAppearances,
  learnPersonaSkillsFromChapter,
  loadCharacterRoleTypes,
  lookupRoleType,
  parsePersonaSkillDrafts,
  renderPersonaSkillDocument,
  __resetPersonaSkillRoundsForTesting,
} from "./persona-skill-learning"

const project = "C:/project"
const indexFile = `${project}/.qmai/persona-skills/index.json`
const sightingsFile = `${project}/.qmai/persona-skills/sightings.json`
const llmConfig = {} as LlmConfig

function roleFile(roleType: string, name: string) {
  io.files.set(`${project}/wiki/characters/角色-${roleType}-${name}.md`, `# ${name}`)
}

function reply(skills: unknown) {
  streamChatMock.mockImplementation(
    async (_config: unknown, _messages: unknown, callbacks: { onToken: (t: string) => void; onDone: () => void }) => {
      callbacks.onToken(JSON.stringify({ skills }))
      callbacks.onDone()
    },
  )
}

// 返回类型要写成 PersonaSkillIndex | null，不能只写 { skills: ... }：
// 下面有用例把 readIndex() 的结果直接喂给 collectChapterAppearances，
// 而它要求 PersonaSkillIndex（含 version），少一个字段就是 TS2345 卡门禁。
function readIndex() {
  return JSON.parse(io.files.get(indexFile) ?? "null") as PersonaSkillIndex | null
}

function readSightings() {
  return JSON.parse(io.files.get(sightingsFile) ?? "null") as { sightings: unknown[] } | null
}

function baseMeta(overrides: Partial<PersonaSkillMeta> = {}): PersonaSkillMeta {
  return {
    id: "林清越",
    characterName: "林清越",
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

function seedIndex(skills: Partial<PersonaSkillMeta>[]) {
  io.files.set(indexFile, JSON.stringify({ version: 1, skills: skills.map(baseMeta) }))
}

describe("loadCharacterRoleTypes", () => {
  it("从文件名读定位，不用读正文", async () => {
    roleFile("男主", "林清越")
    roleFile("男配", "沈砚")
    io.files.set(`${project}/wiki/characters/角色-男主-林-九.md`, "# 名字里带连字符")
    io.files.set(`${project}/wiki/characters/随便.md`, "# 不是角色页")
    const roleTypes = await loadCharacterRoleTypes(project)
    // 键是**归一化**过的（NFKC + 去空白与标点 + 小写）：文件名里的名字被
    // buildCharacterFileName 净化过，与快照里 LLM 抽出的原始名不是同一种写法。
    // 「林-九」的连字符也是净化产物，归一化后与快照里的「林九」才对得上。
    expect(roleTypes).toEqual({ 林清越: "男主", 沈砚: "男配", 林九: "男主" })
  })

  it("文件名被净化过（去空白）也能对上快照里的原始名", async () => {
    // 盘上是「角色-男主-LinChen.md」（sanitize 去掉了空格），
    // 而快照里的人物名是「Lin Chen」。不归一化就会查不到定位 → 静默降成次要档。
    roleFile("男主", "LinChen")
    const roleTypes = await loadCharacterRoleTypes(project)
    expect(lookupRoleType(roleTypes, "Lin Chen")).toBe("男主")
  })

  it("目录不存在时返回空对象，不抛", async () => {
    expect(await loadCharacterRoleTypes("C:/empty")).toEqual({})
  })
})

describe("collectChapterAppearances", () => {
  it("同一章里同一个人只计一次", () => {
    const { appearances } = collectChapterAppearances(
      { version: 1, skills: [] },
      { version: 1, sightings: [] },
      { chapterNumber: 2, chapterBody: "", characters: ["甲", "甲"] },
      {},
    )
    expect(appearances).toHaveLength(1)
    expect(appearances[0].appearanceCount).toBe(1)
  })

  it("别名能认回同一个人物", () => {
    const first = collectChapterAppearances(
      { version: 1, skills: [] },
      { version: 1, sightings: [] },
      { chapterNumber: 1, chapterBody: "", characters: ["林清越"] },
      {},
    )
    const second = collectChapterAppearances(
      { version: 1, skills: [] },
      first.sightings,
      { chapterNumber: 2, chapterBody: "", characters: ["清越"], characterAliases: { 清越: ["林清越"] } },
      {},
    )
    expect(second.sightings.sightings).toHaveLength(1)
    expect(second.appearances[0].appearanceCount).toBe(2)
  })

  it("同一章重复摄取不重复计数", () => {
    seedIndex([{ characterName: "林清越", lastChapter: 3 }])
    io.files.set(`${project}/.qmai/persona-skills/林清越/SKILL.md`, "# 林清越")
    const { appearances } = collectChapterAppearances(
      readIndex()!,
      { version: 1, sightings: [] },
      { chapterNumber: 3, chapterBody: "", characters: ["林清越"] },
      {},
    )
    expect(appearances[0].appearanceCount).toBe(1)
  })
})

describe("parsePersonaSkillDrafts", () => {
  const plans = [{
    characterName: "林清越",
    aliases: ["清越"],
    roleType: "男主",
    tier: "major" as const,
    pinned: false,
    appearanceCount: 1,
    mode: "create" as const,
    withResearch: false,
  }]

  it("坏 JSON 返回 null（整轮跳过）", () => {
    expect(parsePersonaSkillDrafts("这不是 JSON", plans)).toBeNull()
  })

  it("根对象缺 skills 数组返回 null", () => {
    expect(parsePersonaSkillDrafts('{"foo":1}', plans)).toBeNull()
  })

  it("用别名也能认回计划里的人物，名字统一成规范名", () => {
    const drafts = parsePersonaSkillDrafts(
      JSON.stringify({ skills: [{ name: "清越", fields: { 怎么说话: "句子短" } }] }),
      plans,
    )
    expect(drafts).toHaveLength(1)
    expect(drafts![0].characterName).toBe("林清越")
    expect(drafts![0].fields["怎么说话"]).toBe("句子短")
  })

  it("计划外的人物被丢掉", () => {
    const drafts = parsePersonaSkillDrafts(
      JSON.stringify({ skills: [{ name: "路人", fields: { 怎么说话: "x" } }] }),
      plans,
    )
    expect(drafts).toEqual([])
  })
})

describe("renderPersonaSkillDocument", () => {
  const base = {
    characterName: "林清越",
    aliases: ["清越"],
    roleType: "男主",
    tier: "major" as const,
    pinned: false,
    appearanceCount: 2,
    firstChapter: 1,
    lastChapter: 2,
    chapterNumber: 2,
    fields: { 怎么说话: "句子短。", 怎么判断: "先看对方的手。", 成长轨迹: "从回避到直视。" },
    editedByUser: false,
  }

  it("主要人物写出全部提供的字段与 frontmatter", () => {
    const doc = renderPersonaSkillDocument(base)
    expect(doc).toContain("## 怎么说话")
    expect(doc).toContain("## 成长轨迹")
    expect(doc).toContain("tier: major")
    expect(doc).toContain("appearances: 2")
    expect(doc).toContain("aliases: 清越")
  })

  it("次要人物只落 2 个字段，其余字段被丢掉", () => {
    const doc = renderPersonaSkillDocument({ ...base, tier: "minor" })
    expect(doc).toContain("## 怎么说话")
    expect(doc).not.toContain("## 成长轨迹")
  })

  it("用户手改过：既有正文逐字保留，新内容进「补充」段", () => {
    const existing = [
      "---",
      "character: 林清越",
      "---",
      "",
      "# 林清越 · 人物 Skill",
      "",
      "## 怎么说话",
      "",
      "这是用户亲手写的一句。",
      "",
    ].join("\n")
    const doc = renderPersonaSkillDocument({
      ...base,
      fields: { 怎么说话: "AI 的新观察。" },
      existing,
      editedByUser: true,
      chapterNumber: 7,
    })
    expect(doc).toContain("这是用户亲手写的一句。")
    expect(doc).toContain("## 补充（第 7 章）")
    expect(doc).toContain("AI 的新观察。")
    expect(doc.indexOf("这是用户亲手写的一句。")).toBeLessThan(doc.indexOf("## 补充（第 7 章）"))
    expect(doc.match(/# 林清越 · 人物 Skill/g)).toHaveLength(1)
  })
})

describe("learnPersonaSkillsFromChapter", () => {
  beforeEach(() => {
    io.files.clear()
    streamChatMock.mockReset()
    __resetPersonaSkillRoundsForTesting()
  })

  it("主要人物第一次出场就建档，并从候选池移走", async () => {
    roleFile("男主", "林清越")
    reply([{ name: "林清越", fields: { 怎么说话: "句子短，先问后答。", 怎么判断: "先看对方的手。" } }])

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: ["林清越"] },
      llmConfig,
    })

    const index = readIndex()!
    expect(index.skills).toHaveLength(1)
    expect(index.skills[0]).toMatchObject({
      characterName: "林清越",
      roleType: "男主",
      tier: "major",
      appearanceCount: 1,
      lastLearnedChapter: 1,
    })
    expect(io.files.get(`${project}/.qmai/persona-skills/林清越/SKILL.md`)).toContain("句子短，先问后答。")
    expect(readSightings()!.sightings).toHaveLength(0)
  })

  it("同一章 5 个人物只调用模型 1 次", async () => {
    const roles: [string, string][] = [
      ["男主", "甲"], ["女主", "乙"], ["反派", "丙"], ["导师", "丁"], ["主角", "戊"],
    ]
    for (const [role, name] of roles) roleFile(role, name)
    reply(roles.map(([, name]) => ({ name, fields: { 怎么说话: `${name}的语气。` } })))

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: roles.map(([, name]) => name) },
      llmConfig,
    })

    expect(streamChatMock).toHaveBeenCalledTimes(1)
    expect(readIndex()!.skills).toHaveLength(5)
  })

  it("次要人物第一次出场不建档，第二次才建档", async () => {
    roleFile("配角", "沈砚")
    reply([{ name: "沈砚", fields: { 怎么说话: "句尾常带「吧」。" } }])

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: ["沈砚"] },
      llmConfig,
    })
    expect(io.files.has(indexFile)).toBe(false)
    expect(streamChatMock).not.toHaveBeenCalled()
    expect(readSightings()!.sightings).toHaveLength(1)

    __resetPersonaSkillRoundsForTesting()
    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 2, chapterBody: "第二章正文", characters: ["沈砚"] },
      llmConfig,
    })
    expect(streamChatMock).toHaveBeenCalledTimes(1)
    expect(readIndex()!.skills[0]).toMatchObject({ characterName: "沈砚", tier: "minor", appearanceCount: 2 })
  })

  // 「未标注定位」走的是 PERSONA_UNKNOWN_FIRST_APPEARANCE = 3，与「龙套」不是同一件事：
  // 设计规格第 4 节的表述是「出场 ≥3 次才按 minor 处理（自动滤掉一笔带过的路人）」——
  // 也就是说「一笔带过」是被这个门槛滤掉的，而不是靠某个叫「龙套」的定位标签。
  // 所以无定位的人物出场到第 3 次时**应当**建档，不能写成「永远不建档」。
  it("未标注定位：出场两次仍不建档，也不烧模型", async () => {
    // 故意给一份「会被用上」的回复：万一代码错误地调了模型，它就会拿到有效草稿并建档，
    // 从而把后面两条断言一起打红——比 reply([]) 更能证明「真的没烧模型」。
    reply([{ name: "小二", fields: { 怎么说话: "爱搭话。" } }])
    for (const chapterNumber of [1, 2]) {
      __resetPersonaSkillRoundsForTesting()
      await learnPersonaSkillsFromChapter({
        projectPath: project,
        chapter: { chapterNumber, chapterBody: "正文", characters: ["小二"] },
        llmConfig,
      })
    }
    expect(streamChatMock).not.toHaveBeenCalled()
    expect(io.files.has(indexFile)).toBe(false)
    expect(readSightings()!.sightings).toHaveLength(1)
  })

  it("未标注定位：第 3 次出场才建档，按 minor 处理", async () => {
    reply([{ name: "小二", fields: { 怎么说话: "爱搭话。" } }])
    for (const chapterNumber of [1, 2, 3]) {
      __resetPersonaSkillRoundsForTesting()
      await learnPersonaSkillsFromChapter({
        projectPath: project,
        chapter: { chapterNumber, chapterBody: "正文", characters: ["小二"] },
        llmConfig,
      })
    }
    expect(streamChatMock).toHaveBeenCalledTimes(1)
    expect(readIndex()!.skills[0]).toMatchObject({
      characterName: "小二",
      tier: "minor",
      appearanceCount: 3,
    })
  })

  it("同一章重复摄取不二次烧模型，也不重复计数", async () => {
    roleFile("男主", "林清越")
    reply([{ name: "林清越", fields: { 怎么说话: "句子短。" } }])
    const chapter = { chapterNumber: 1, chapterBody: "第一章正文", characters: ["林清越"] }

    await learnPersonaSkillsFromChapter({ projectPath: project, chapter, llmConfig })
    __resetPersonaSkillRoundsForTesting()
    await learnPersonaSkillsFromChapter({ projectPath: project, chapter, llmConfig })

    expect(streamChatMock).toHaveBeenCalledTimes(1)
    expect(readIndex()!.skills[0].appearanceCount).toBe(1)
    expect(readIndex()!.skills[0].lastLearnedChapter).toBe(1)
  })

  it("模型返回坏 JSON：整轮跳过、不建 index，但不抛也不丢候选池计数", async () => {
    roleFile("男主", "林清越")
    streamChatMock.mockImplementation(
      async (_c: unknown, _m: unknown, callbacks: { onToken: (t: string) => void; onDone: () => void }) => {
        callbacks.onToken("我把 JSON 忘了")
        callbacks.onDone()
      },
    )

    await expect(
      learnPersonaSkillsFromChapter({
        projectPath: project,
        chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: ["林清越"] },
        llmConfig,
      }),
    ).resolves.toBeUndefined()

    expect(io.files.has(indexFile)).toBe(false)
    expect(readSightings()!.sightings).toHaveLength(1)

    // 下一轮换成好 JSON，必须还能补上（证明 lastLearnedChapter 没被推进）
    reply([{ name: "林清越", fields: { 怎么说话: "句子短。" } }])
    __resetPersonaSkillRoundsForTesting()
    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 2, chapterBody: "第二章正文", characters: ["林清越"] },
      llmConfig,
    })
    expect(readIndex()!.skills).toHaveLength(1)
  })

  it("绿勾人物在完善时同时产出研究文件", async () => {
    roleFile("配角", "沈砚")
    seedIndex([{ characterName: "沈砚", id: "沈砚", roleType: "配角", tier: "minor", pinned: true, lastChapter: 2, appearanceCount: 2, lastLearnedChapter: 2 }])
    io.files.set(`${project}/.qmai/persona-skills/沈砚/SKILL.md`, "# 沈砚 · 人物 Skill\n\n## 怎么说话\n\n句尾常带「吧」。\n")
    reply([{
      name: "沈砚",
      fields: { 怎么说话: "句尾常带「吧」。", 怎么判断: "先算代价再开口。" },
      research: { 人物小传: "他是账房出身。", 语言习惯: "自问自答。" },
    }])

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 3, chapterBody: "第三章正文", characters: ["沈砚"] },
      llmConfig,
    })

    const research = io.files.get(`${project}/.qmai/persona-skills/沈砚/references/research/人物小传.md`)
    expect(research).toContain("他是账房出身。")
    expect(readIndex()!.skills[0].hasResearch).toBe(true)
    // 绿勾人物即使在 minor 定位下也按 major 注入
    expect(readIndex()!.skills[0].tier).toBe("major")
  })

  it("已有研究文件的绿勾人物再次完善时不重写研究文件（防用本章素材覆盖累积内容）", async () => {
    roleFile("配角", "沈砚")
    seedIndex([
      {
        characterName: "沈砚",
        id: "沈砚",
        roleType: "配角",
        tier: "minor",
        pinned: true,
        hasResearch: true,
        lastChapter: 2,
        appearanceCount: 2,
        lastLearnedChapter: 2,
      },
    ])
    io.files.set(`${project}/.qmai/persona-skills/沈砚/SKILL.md`, "# 沈砚 · 人物 Skill\n\n## 怎么说话\n\n句尾带吧。\n")
    io.files.set(
      `${project}/.qmai/persona-skills/沈砚/references/research/人物小传.md`,
      "旧的研究内容，不许被覆盖。",
    )
    reply([{
      name: "沈砚",
      fields: { 怎么说话: "句尾带吧。" },
      research: { 人物小传: "本章新素材写的东西。" },
    }])

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 3, chapterBody: "第三章正文", characters: ["沈砚"] },
      llmConfig,
    })

    expect(io.files.get(`${project}/.qmai/persona-skills/沈砚/references/research/人物小传.md`)).toContain(
      "旧的研究内容，不许被覆盖。",
    )
  })

  it("用户手改过的档案只追加「补充」，既有正文逐字保留", async () => {
    roleFile("男主", "林清越")
    seedIndex([{ characterName: "林清越", lastChapter: 2, appearanceCount: 2, lastLearnedChapter: 2, editedByUser: true }])
    io.files.set(
      `${project}/.qmai/persona-skills/林清越/SKILL.md`,
      "# 林清越 · 人物 Skill\n\n## 怎么说话\n\n用户亲手写的句子。\n",
    )
    reply([{ name: "林清越", fields: { 怎么说话: "AI 本次的新观察。" } }])

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 3, chapterBody: "第三章正文", characters: ["林清越"] },
      llmConfig,
    })

    const doc = io.files.get(`${project}/.qmai/persona-skills/林清越/SKILL.md`)!
    expect(doc).toContain("用户亲手写的句子。")
    expect(doc).toContain("AI 本次的新观察。")
    expect(doc).toContain("## 补充（第 3 章）")
    expect(readIndex()!.skills[0].editedByUser).toBe(true)
  })

  it("连续 30 章未出场转归档，但文件不删", async () => {
    seedIndex([{ characterName: "林清越", lastChapter: 1, appearanceCount: 1, status: "active" }])
    io.files.set(`${project}/.qmai/persona-skills/林清越/SKILL.md`, "# 林清越 · 人物 Skill\n")

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 31, chapterBody: "第三十一章正文", characters: ["路人"] },
      llmConfig,
    })

    expect(readIndex()!.skills[0].status).toBe("archived")
    expect(io.files.has(`${project}/.qmai/persona-skills/林清越/SKILL.md`)).toBe(true)
    expect(streamChatMock).not.toHaveBeenCalled()
  })

  it("绿勾人物不会因为长期未出场被归档", async () => {
    seedIndex([{ characterName: "林清越", lastChapter: 1, appearanceCount: 1, status: "active", pinned: true }])
    io.files.set(`${project}/.qmai/persona-skills/林清越/SKILL.md`, "# 林清越 · 人物 Skill\n")

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 99, chapterBody: "第九十九章正文", characters: ["路人"] },
      llmConfig,
    })

    expect(readIndex()!.skills[0].status).toBe("active")
  })
})
