import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 「选择小说人物」下拉框只读左栏「人物小传」下的活跃角色与候选角色。
 *
 * 回归背景（用户两次截图）：
 *   1. 下拉里出现「基本信息」「角色定位」「核心标签」「金手指」「旧案定位」；
 *   2. 修完又出现「内在分析」「能力设计」「写作边界」「剧情作用」「死亡逻辑」。
 * 两次都是同一个病根：**去解析大纲 md 的标题**。人物小传页里除了人名，
 * 还有大量栏目小节与人名同处一个标题层级，靠标题解析永远挡不干净。
 *
 * 现在改为只读结构化存储：
 *   · 活跃角色 = `.qmai/persona-skills/index.json`
 *   · 候选角色 = `.qmai/persona-skills/sightings.json`
 * 这两份文件本来就只装名字，不含任何栏目 —— 与左栏那份目录完全一致。
 */

const files = new Map<string, string>()

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(async (path: string) => {
    const value = files.get(path)
    if (value === undefined) throw new Error(`ENOENT: ${path}`)
    return value
  }),
  writeFileAtomic: vi.fn(async (path: string, content: string) => {
    files.set(path, content)
  }),
  createDirectory: vi.fn(async () => undefined),
  listDirectory: vi.fn(async () => []),
  exists: vi.fn(async (path: string) => files.has(path)),
  removeFile: vi.fn(async () => undefined),
}))

vi.mock("@/lib/has-usable-llm", () => ({ hasUsableLlm: vi.fn(() => false) }))
vi.mock("@/lib/llm-client", () => ({ streamChat: vi.fn() }))
vi.mock("@/lib/search", () => ({ searchWiki: vi.fn() }))
vi.mock("@/lib/tauri-fetch", () => ({ getHttpFetch: vi.fn() }))
vi.mock("@/lib/web-search", () => ({ webSearch: vi.fn() }))
vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: {
    getState: () => ({
      llmConfig: { provider: "openai", apiKey: "", model: "", ollamaUrl: "", customEndpoint: "", maxContextSize: 128000 },
      providerConfigs: {},
      aiChatModel: "",
      defaultLlmModel: "",
      novelConfig: { defaultLlmModel: "" },
    }),
  },
}))

const { listBindableNovelCharactersStructured } = await import("./character-aura")

const PROJECT = "/proj"

/** 造一条 personaskill 索引记录。 */
function skillMeta(name: string, overrides: Record<string, unknown> = {}) {
  return {
    id: name,
    characterName: name,
    aliases: [],
    roleType: "主角",
    tier: "major",
    pinned: false,
    status: "active",
    firstChapter: 1,
    lastChapter: 3,
    appearanceCount: 3,
    createdChapter: 1,
    lastLearnedChapter: 3,
    skillRevision: 1,
    editedByUser: false,
    hasResearch: false,
    updatedAt: "2026-11-01T00:00:00.000Z",
    origin: "auto",
    outlineRefs: [],
    asOfChapter: 3,
    ...overrides,
  }
}

/** 造一条候选池记录。 */
function sighting(name: string, overrides: Record<string, unknown> = {}) {
  return {
    characterName: name,
    aliases: [],
    roleType: "配角",
    appearanceCount: 2,
    firstChapter: 2,
    lastChapter: 3,
    chapters: [2, 3],
    ...overrides,
  }
}

function setup(options: { skills?: unknown[]; sightings?: unknown[]; ignored?: string[] } = {}) {
  files.clear()
  files.set(
    `${PROJECT}/.qmai/persona-skills/index.json`,
    JSON.stringify({ version: 1, skills: options.skills ?? [] }),
  )
  files.set(
    `${PROJECT}/.qmai/persona-skills/sightings.json`,
    JSON.stringify({ version: 1, sightings: options.sightings ?? [], ignored: options.ignored ?? [] }),
  )
}

async function names(): Promise<string[]> {
  return (await listBindableNovelCharactersStructured(PROJECT)).map((item) => item.name)
}

beforeEach(() => {
  files.clear()
})

describe("选择小说人物：只读活跃角色与候选角色", () => {
  it("活跃角色来自人物档案，带角色定位并标为 archive", async () => {
    setup({ skills: [skillMeta("杨寒", { roleType: "主角" })], sightings: [] })

    const characters = await listBindableNovelCharactersStructured(PROJECT)
    expect(characters.map((item) => item.name)).toEqual(["杨寒"])
    expect(characters[0].source).toBe("archive")
    expect(characters[0].roleType).toBe("主角")
  })

  it("候选角色来自候选池，标为 sighting", async () => {
    setup({ skills: [], sightings: [sighting("地下铁门守卫")] })

    const characters = await listBindableNovelCharactersStructured(PROJECT)
    expect(characters.map((item) => item.name)).toEqual(["地下铁门守卫"])
    expect(characters[0].source).toBe("sighting")
  })

  it("活跃角色排在候选角色之前，同名只出现一次", async () => {
    setup({
      skills: [skillMeta("杨妙萍")],
      sightings: [sighting("杨妙萍", { roleType: "配角" }), sighting("抱保温杯守卫")],
    })

    const characters = await listBindableNovelCharactersStructured(PROJECT)
    expect(characters.filter((item) => item.name === "杨妙萍")).toHaveLength(1)
    // 同名时保留活跃角色那条（信息更全）。
    expect(characters.find((item) => item.name === "杨妙萍")?.source).toBe("archive")
  })

  it("已归档的档案不出现在名单里", async () => {
    setup({ skills: [skillMeta("杨寒"), skillMeta("旧角色", { status: "archived" })] })

    const all = await names()
    expect(all).toContain("杨寒")
    expect(all).not.toContain("旧角色")
  })

  it("休眠的档案会标出 dormant，但仍然可选", async () => {
    setup({ skills: [skillMeta("杨津艺", { status: "dormant" })] })

    const characters = await listBindableNovelCharactersStructured(PROJECT)
    expect(characters.find((item) => item.name === "杨津艺")?.dormant).toBe(true)
  })

  it("用户手动删掉的候选不再出现", async () => {
    setup({ sightings: [sighting("守卫甲"), sighting("守卫乙")], ignored: ["守卫甲"] })

    const all = await names()
    expect(all).toContain("守卫乙")
    expect(all).not.toContain("守卫甲")
  })

  it("完全不读大纲 md：只有 md 里写着人名、结构里没有时，名单为空", async () => {
    // 这正是用户第二次截图的前提：人名只存在于大纲正文的标题里。
    // 新实现不再解析它，所以这里必须为空 —— 宁可少显示，也不能混进栏目名。
    files.clear()
    files.set(
      `${PROJECT}/wiki/outlines/人物小传/人物小传.md`,
      ["# 人物小传", "", "## 内在分析", "内容。", "## 能力设计", "内容。", "## 写作边界", "内容。"].join("\n"),
    )

    await expect(names()).resolves.toEqual([])
  })

  it("没有人物档案与候选池时返回空名单，不抛错", async () => {
    files.clear()
    await expect(names()).resolves.toEqual([])
  })
})
