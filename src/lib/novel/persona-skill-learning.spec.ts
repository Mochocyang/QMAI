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

// 学习失败必须能被界面看见（App.tsx 订阅这个字段弹 toast），
// 所以这里用 spy 而不是空对象：空对象会让「静默失败」重新长回来。
const storeMock = vi.hoisted(() => ({
  providerConfigs: [] as unknown[],
  setPersonaSkillLearningError: vi.fn(),
  setPersonaSkillCompletion: vi.fn(),
}))

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: { getState: () => storeMock },
}))

import {
  collectChapterAppearances,
  learnPersonaSkillsFromChapter,
  loadCharacterRoleTypes,
  lookupRoleType,
  parsePersonaSkillDrafts,
  regeneratePersonaSkillResearch,
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
    fields: { 怎么说话: "句子短。", 怎么判断: "先看对方的手。", 知道局限: "不知道沈砚的真实身份。" },
    editedByUser: false,
  }

  it("主要人物写出全部提供的字段与 frontmatter", () => {
    const doc = renderPersonaSkillDocument(base)
    expect(doc).toContain("## 怎么说话")
    expect(doc).toContain("## 知道局限")
    expect(doc).toContain("tier: major")
    expect(doc).toContain("appearances: 2")
    expect(doc).toContain("aliases: 清越")
  })

  it("次要人物同样落全部 5 个字段：档位只管注入，不管学习", () => {
    // 用户明确要「第一章角色一出现，skill 基本就成型」。提示词只问 2 个字段的
    // 话，另外 3 格永远空着。学习成本与字段数无关（整章合并成一次请求），
    // 真正稀缺的注入预算由 renderPersonaSkillBlock 按档位裁剪。
    const doc = renderPersonaSkillDocument({ ...base, tier: "minor" })
    expect(doc).toContain("## 怎么说话")
    expect(doc).toContain("## 知道局限")
    expect(doc).toContain("tier: minor")
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

describe("regeneratePersonaSkillResearch", () => {
  beforeEach(() => {
    io.files.clear()
    streamChatMock.mockReset()
    __resetPersonaSkillRoundsForTesting()
  })

  it("从既有档案重新整理研究文件，并回写 hasResearch", async () => {
    seedIndex([{ characterName: "沈砚", id: "沈砚", roleType: "配角", pinned: true, hasResearch: false }])
    io.files.set(
      `${project}/.qmai/persona-skills/沈砚/SKILL.md`,
      "# 沈砚 · 人物 Skill\n\n## 怎么说话\n\n句尾常带「吧」。\n",
    )
    streamChatMock.mockImplementation(
      async (_c: unknown, _m: unknown, callbacks: { onToken: (t: string) => void; onDone: () => void }) => {
        callbacks.onToken(JSON.stringify({ research: { 人物小传: "他是账房出身。", 语言习惯: "自问自答。" } }))
        callbacks.onDone()
      },
    )

    const ok = await regeneratePersonaSkillResearch({
      projectPath: project,
      characterName: "沈砚",
      llmConfig,
    })

    expect(ok).toBe(true)
    expect(io.files.get(`${project}/.qmai/persona-skills/沈砚/references/research/人物小传.md`)).toContain(
      "他是账房出身。",
    )
    expect(readIndex()!.skills[0].hasResearch).toBe(true)
  })

  it("查无此人时返回 false，且不调模型", async () => {
    const ok = await regeneratePersonaSkillResearch({
      projectPath: project,
      characterName: "查无此人",
      llmConfig,
    })
    expect(ok).toBe(false)
    expect(streamChatMock).not.toHaveBeenCalled()
  })

  it("模型返回坏 JSON 时返回 false，不写文件，也不抛", async () => {
    seedIndex([{ characterName: "沈砚", id: "沈砚", roleType: "配角", pinned: true }])
    io.files.set(`${project}/.qmai/persona-skills/沈砚/SKILL.md`, "# 沈砚 · 人物 Skill\n\n## 怎么说话\n\n句尾带吧。\n")
    streamChatMock.mockImplementation(
      async (_c: unknown, _m: unknown, callbacks: { onToken: (t: string) => void; onDone: () => void }) => {
        callbacks.onToken("抱歉，我忘了 JSON")
        callbacks.onDone()
      },
    )

    await expect(
      regeneratePersonaSkillResearch({ projectPath: project, characterName: "沈砚", llmConfig }),
    ).resolves.toBe(false)
    expect(readIndex()!.skills[0].hasResearch).toBe(false)
  })

  it("非绿勾人物：即使盘上还留着研究文件，也不重新整理（D6）", async () => {
    // 被取消绿勾的人，研究文件不会从盘上删掉 —— 视图据此以为「他有研究文件」。
    seedIndex([{ characterName: "沈砚", id: "沈砚", roleType: "配角", pinned: false, hasResearch: true }])
    io.files.set(`${project}/.qmai/persona-skills/沈砚/SKILL.md`, "# 沈砚 · 人物 Skill\n\n## 怎么说话\n\n句尾带吧。\n")
    io.files.set(`${project}/.qmai/persona-skills/沈砚/references/research/人物小传.md`, "旧的小传。")
    streamChatMock.mockImplementation(
      async (_c: unknown, _m: unknown, callbacks: { onToken: (t: string) => void; onDone: () => void }) => {
        callbacks.onToken(JSON.stringify({ research: { 人物小传: "新的小传。" } }))
        callbacks.onDone()
      },
    )

    await expect(
      regeneratePersonaSkillResearch({ projectPath: project, characterName: "沈砚", llmConfig }),
    ).resolves.toBe(false)
    expect(streamChatMock).not.toHaveBeenCalled()
    // 旧文件一字未动
    expect(io.files.get(`${project}/.qmai/persona-skills/沈砚/references/research/人物小传.md`)).toBe("旧的小传。")
  })
})

describe("人物 Skill 审查修复：并发保存、确定性记账、回填旧章", () => {
  beforeEach(() => {
    io.files.clear()
    streamChatMock.mockReset()
    __resetPersonaSkillRoundsForTesting()
  })

  it("模型调用期间用户保存了手改正文：正文保留、editedByUser 不回退", async () => {
    seedIndex([
      { characterName: "林清越", id: "林清越", roleType: "男主", pinned: false, appearanceCount: 1, lastChapter: 0, editedByUser: false, createdChapter: 1, skillRevision: 1 },
    ])
    io.files.set(
      `${project}/.qmai/persona-skills/林清越/SKILL.md`,
      "# 林清越 · 人物 Skill\n\n## 怎么说话\n\n旧的内容。\n",
    )
    streamChatMock.mockImplementation(
      async (_c: unknown, _m: unknown, callbacks: { onToken: (t: string) => void; onDone: () => void }) => {
        // 模拟「整轮模型调用期间，用户在人物 Skill 页点了保存」
        io.files.set(
          `${project}/.qmai/persona-skills/林清越/SKILL.md`,
          "# 林清越 · 人物 Skill\n\n## 怎么说话\n\n用户亲手改的句子。\n",
        )
        const saved = JSON.parse(io.files.get(indexFile)!) as { skills: Array<Record<string, unknown>> }
        saved.skills[0].editedByUser = true
        io.files.set(indexFile, JSON.stringify(saved))
        callbacks.onToken(JSON.stringify({ skills: [{ name: "林清越", fields: { 怎么说话: "本章新观察。" } }] }))
        callbacks.onDone()
      },
    )

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 2, chapterBody: "第二章正文", characters: ["林清越"] },
      llmConfig,
    })

    const document = io.files.get(`${project}/.qmai/persona-skills/林清越/SKILL.md`)!
    // 用户那句话必须还在（原实现会整份丢掉，只剩「本章新观察。」）
    expect(document).toContain("用户亲手改的句子。")
    expect(document).toContain("## 补充（第 2 章）")
    // 护栏不能一起丢，否则下一次还会覆盖
    expect(readIndex()!.skills[0].editedByUser).toBe(true)
  })

  it("模型漏了已建档的人：他的 lastChapter 与状态仍然前进", async () => {
    seedIndex([
      { characterName: "沈砚", id: "沈砚", roleType: "配角", pinned: false, appearanceCount: 3, lastChapter: 5, createdChapter: 3, skillRevision: 1 },
      { characterName: "林清越", id: "林清越", roleType: "男主", pinned: false, appearanceCount: 2, lastChapter: 5, createdChapter: 1, skillRevision: 1 },
    ])
    // 模型只回了林清越，一个字都没提沈砚
    streamChatMock.mockImplementation(
      async (_c: unknown, _m: unknown, callbacks: { onToken: (t: string) => void; onDone: () => void }) => {
        callbacks.onToken(JSON.stringify({ skills: [{ name: "林清越", fields: { 怎么说话: "照旧。" } }] }))
        callbacks.onDone()
      },
    )

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 45, chapterBody: "第四十五章正文", characters: ["沈砚", "林清越"] },
      llmConfig,
    })

    const shen = readIndex()!.skills.find((item) => item.characterName === "沈砚")!
    // 原实现里他停在 lastChapter=5 → gap=40 → archived（正在场上的人被移出注入）
    expect(shen.lastChapter).toBe(45)
    expect(shen.status).toBe("active")
    expect(shen.appearanceCount).toBe(4)
  })

  it("回填旧章：已归档的人不会因为旧章号被复活", async () => {
    seedIndex([
      { characterName: "沈砚", id: "沈砚", roleType: "配角", pinned: false, appearanceCount: 9, lastChapter: 40, createdChapter: 3, skillRevision: 4, status: "archived" },
    ])
    streamChatMock.mockImplementation(
      async (_c: unknown, _m: unknown, callbacks: { onToken: (t: string) => void; onDone: () => void }) => {
        callbacks.onToken(JSON.stringify({ skills: [] }))
        callbacks.onDone()
      },
    )

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 5, chapterBody: "第五章正文", characters: ["沈砚"] },
      llmConfig,
    })

    // 原实现：currentChapter(5) - lastChapter(40) = -35 → 负数 gap 落进 return "active"
    expect(readIndex()!.skills[0].status).toBe("archived")
  })
})

describe("真实项目回归：定位查不到时靠实体页兜底", () => {
  /**
   * 这一组钉的是线上实测到的静默失效：
   *
   * 定位只写在 `wiki/characters/角色-<定位>-<名>.md` 的文件名里，而那个目录
   * 只有跑过「人物」多智能体生成才会存在。实测项目 `C:\QM-BOOK\黑雨之下`
   * 根本没有 `wiki/characters`，于是所有人 roleType 为空 → 一律按「未标注」
   * 要 3 次出场才建档。那个项目摄取到第 4 章，候选池里最高出场数才 2，
   * 结果一个人都没建档，技能库空空如也，且**全程没有任何报错或日志**。
   *
   * 兜底判据用仓库既有的那条：`wiki/entities/` 下 `tags` 含 `character`
   * 的实体页（`character-aura.ts` 的 isCharacterEntityContent 同款）。
   * 它的价值在于天然斩断路人 —— 正文里一笔带过的「老太太/老头/小男孩」
   * 压根不会建实体页。
   */
  function entityPage(name: string, tags = "[character]") {
    io.files.set(
      `${project}/wiki/entities/${name}.md`,
      `---\ntype: entity\ntitle: "${name}"\ntags: ${tags}\n---\n\n# ${name}\n`,
    )
  }

  /** 一个人物五个字段都给全，确保 renderFieldSections 不会把整条草稿丢成空。 */
  function fullFields() {
    return {
      怎么说话: "话少，句子短。",
      怎么想: "先算代价。",
      怎么判断: "看人先看底线。",
      什么不做: "不拿无辜者交换。",
      知道局限: "救不了所有人。",
    }
  }

  beforeEach(() => {
    io.files.clear()
    streamChatMock.mockReset()
    __resetPersonaSkillRoundsForTesting()
  })

  it("无 wiki/characters、只有实体页：真实人物第一次出场就建档", async () => {
    entityPage("杨寒")
    reply([{ name: "杨寒", fields: fullFields() }])

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: ["杨寒"] },
      llmConfig,
    })

    // 修复前：roleType 为空 → 门槛 3 → 0 次模型调用、不建 index。
    expect(streamChatMock).toHaveBeenCalledTimes(1)
    const index = readIndex()
    expect(index).not.toBeNull()
    expect(index!.skills.map((item) => item.characterName)).toEqual(["杨寒"])
    // 档位仍是 minor：认出来只影响「什么时候建档」，不影响注入预算档位。
    expect(index!.skills[0].tier).toBe("minor")
    // 建档后从候选池移走
    expect(readSightings()!.sightings).toEqual([])
  })

  it("路人不建实体页，仍按未标注处理：出场两次也不建档", async () => {
    // 「老太太」在正文里出现过，但没有任何实体页 —— 不该为临时角色建档。
    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: ["老太太"] },
      llmConfig,
    })
    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 2, chapterBody: "第二章正文", characters: ["老太太"] },
      llmConfig,
    })

    expect(streamChatMock).not.toHaveBeenCalled()
    expect(readIndex()).toBeNull()
    expect(readSightings()!.sightings).toHaveLength(1)
  })

  it("实体页 type 不是 entity（设定页重名）不算数", async () => {
    io.files.set(
      `${project}/wiki/entities/归元箓.md`,
      `---\ntype: concept\ntitle: "归元箓"\ntags: [character]\n---\n\n# 归元箓\n`,
    )

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: ["归元箓"] },
      llmConfig,
    })

    expect(streamChatMock).not.toHaveBeenCalled()
    expect(readIndex()).toBeNull()
  })

  it("实体页没有 character 标签（地点/物品）不算数", async () => {
    entityPage("千碑城", "[location, city]")

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: ["千碑城"] },
      llmConfig,
    })

    expect(streamChatMock).not.toHaveBeenCalled()
    expect(readIndex()).toBeNull()
  })

  it("声明了定位的主角仍然走主角档：实体页不改变已有定位的优先级", async () => {
    roleFile("主角", "杨寒")
    entityPage("杨寒")
    reply([{ name: "杨寒", fields: fullFields() }])

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: ["杨寒"] },
      llmConfig,
    })

    expect(readIndex()!.skills[0].tier).toBe("major")
  })

  it("实体页标签写法兼容块列表（tags: 换行 + - character）", async () => {
    io.files.set(
      `${project}/wiki/entities/杨寒.md`,
      `---\ntype: entity\ntitle: "杨寒"\ntags:\n  - character\n  - 主角\n---\n\n# 杨寒\n`,
    )
    reply([{ name: "杨寒", fields: fullFields() }])

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: ["杨寒"] },
      llmConfig,
    })

    expect(readIndex()!.skills.map((item) => item.characterName)).toEqual(["杨寒"])
  })
})

/**
 * 真实项目报障回归（2026-10-11）：「提取完了，技能库里人物 Skill 还是空的」。
 *
 * 实盘取证：那个项目 `.qmai/persona-skills/` 下**只有 sightings.json**，
 * 从来没有 index.json；章节提取日志里连着两章都是「模型没有返回可解析的 JSON」。
 * 把真实编排跑起来喂各种「模型真会吐出来」的形状后发现：**规范形状是好的**，
 * 但模型一偏离提示词的严格契约，整轮就静默什么都不写 —— 一个字的日志都没有。
 * 这一组用例把那些静默路径逐条钉住。
 */
describe("模型输出形状容错：模型不会逐字照抄提示词", () => {
  const logFile = `${project}/.qmai/chapter-ingest.log`
  const doc = (name: string) => io.files.get(`${project}/.qmai/persona-skills/${name}/SKILL.md`) ?? ""
  const readLog = () => io.files.get(logFile) ?? ""

  function replyRaw(raw: string) {
    streamChatMock.mockImplementation(
      async (_c: unknown, _m: unknown, cb: { onToken: (t: string) => void; onDone: () => void }) => {
        cb.onToken(raw)
        cb.onDone()
      },
    )
  }

  beforeEach(() => {
    io.files.clear()
    streamChatMock.mockReset()
    __resetPersonaSkillRoundsForTesting()
    storeMock.setPersonaSkillLearningError.mockClear()
  })

  it("对照组：完全照抄提示词的规范形状照常建档", async () => {
    roleFile("男主", "林清越")
    reply([{ name: "林清越", fields: { 怎么说话: "句子短，先问后答。", 怎么想: "先算代价。" } }])

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: ["林清越"] },
      llmConfig,
    })

    expect(readIndex()!.skills).toHaveLength(1)
  })

  it("字段平铺在条目顶层（没有 fields 子对象）也建档", async () => {
    // 之前这条整轮静默：fields 取不到 → 空对象 → 全部 skip → upserts 0 → 一个日志都没有
    roleFile("男主", "林清越")
    replyRaw(
      JSON.stringify({
        skills: [{ name: "林清越", 怎么说话: "句子短，先问后答。", 怎么判断: "先看对方的手。" }],
      }),
    )

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: ["林清越"] },
      llmConfig,
    })

    expect(readIndex()!.skills.map((item) => item.characterName)).toEqual(["林清越"])
    expect(doc("林清越")).toContain("## 怎么说话")
    expect(doc("林清越")).toContain("句子短，先问后答。")
  })

  it("字段名被改写成近义词：落进规范段，而不是写出一页只有 frontmatter 的空档案", async () => {
    // 之前这条会建出 index 与 SKILL.md，但文档里 0 个 `## ` 段：
    // 库里有卡片、点开什么都没有 —— 用户看到的正是「显示还是为空」。
    roleFile("男主", "林清越")
    replyRaw(
      JSON.stringify({
        skills: [
          {
            name: "林清越",
            fields: { 说话方式: "句子短，句尾带「嗯」。", 思维方式: "先算代价再动。", 判断方式: "看对方手腕。" },
          },
        ],
      }),
    )

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: ["林清越"] },
      llmConfig,
    })

    const text = doc("林清越")
    expect(text).toContain("## 怎么说话")
    expect(text).toContain("句子短，句尾带「嗯」。")
    expect(text).toContain("## 怎么想")
    expect(text).toContain("## 怎么判断")
  })

  it("名字带装饰（林清越（男主））也能匹配到本轮计划", async () => {
    // 严格按名字查表时这条整轮静默，且模型的「name」字段是最容易跑偏的一项
    roleFile("男主", "林清越")
    replyRaw(JSON.stringify({ skills: [{ name: "林清越（男主）", fields: { 怎么说话: "句子短。" } }] }))

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: ["林清越"] },
      llmConfig,
    })

    expect(readIndex()!.skills.map((item) => item.characterName)).toEqual(["林清越"])
  })

  it("模型用别名称呼人物：认回同一个人，并统一成规范名建档", async () => {
    roleFile("男主", "林清越")
    replyRaw(JSON.stringify({ skills: [{ name: "清越", fields: { 怎么说话: "句子短。" } }] }))

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: {
        chapterNumber: 1,
        chapterBody: "第一章正文",
        characters: ["林清越"],
        characterAliases: { 林清越: ["清越"] },
      },
      llmConfig,
    })

    expect(readIndex()!.skills.map((item) => item.characterName)).toEqual(["林清越"])
  })

  it("字段值是数组时拼接进正文，而不是整格丢掉", async () => {
    roleFile("男主", "林清越")
    replyRaw(
      JSON.stringify({
        skills: [{ name: "林清越", fields: { 怎么说话: ["句子短。", "句尾常带「嗯」。"] } }],
      }),
    )

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: ["林清越"] },
      llmConfig,
    })

    expect(doc("林清越")).toContain("句子短。")
    expect(doc("林清越")).toContain("句尾常带「嗯」。")
  })

  it("模型直接返回裸数组（没有 skills 外壳）也能解析", async () => {
    roleFile("男主", "林清越")
    replyRaw(JSON.stringify([{ name: "林清越", fields: { 怎么说话: "句子短。" } }]))

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: ["林清越"] },
      llmConfig,
    })

    expect(readIndex()!.skills.map((item) => item.characterName)).toEqual(["林清越"])
  })

  it("一条草稿都认不出来时：不写空档案，并把原始输出留在 .qmai/chapter-ingest.log", async () => {
    // 这一条是「下次再出事必须能查」的保险：以前这条路径连一个字的日志都没有。
    roleFile("男主", "林清越")
    replyRaw("我忘了要输出 JSON，这里是林清越的性格：话少。")

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: ["林清越"] },
      llmConfig,
    })

    expect(io.files.has(indexFile)).toBe(false)
    expect(readLog()).toContain("persona")
    expect(readLog()).toContain("我忘了要输出 JSON")
    // 候选池计数不能丢，下一轮还要能补上
    expect(readSightings()!.sightings).toHaveLength(1)
  })

  it("字段名全都认不出来：不建空档案，写日志并让界面能看见", async () => {
    roleFile("男主", "林清越")
    replyRaw(JSON.stringify({ skills: [{ name: "林清越", fields: { 他喜欢吃辣: "很能吃辣。" } }] }))

    await learnPersonaSkillsFromChapter({
      projectPath: project,
      chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: ["林清越"] },
      llmConfig,
    })

    expect(io.files.has(indexFile)).toBe(false)
    expect(readLog()).toContain("persona")
    expect(storeMock.setPersonaSkillLearningError).toHaveBeenCalled()
  })

  it("模型调用本身抛错（鉴权/网络/参数被拒）也要留痕并让界面看见", async () => {
    // 这条路径走不到上面任何一条 if：以前只有一句 console.warn，
    // 用户看到的仍然是「技能库空的」，而开发者手上什么都没有。
    roleFile("男主", "林清越")
    streamChatMock.mockImplementation(async () => {
      throw new Error("401 invalid api key")
    })

    await expect(
      learnPersonaSkillsFromChapter({
        projectPath: project,
        chapter: { chapterNumber: 1, chapterBody: "第一章正文", characters: ["林清越"] },
        llmConfig,
      }),
    ).resolves.toBeUndefined()

    expect(io.files.has(indexFile)).toBe(false)
    expect(readLog()).toContain("persona_round_error")
    expect(readLog()).toContain("401 invalid api key")
    expect(storeMock.setPersonaSkillLearningError).toHaveBeenCalled()
  })
})

