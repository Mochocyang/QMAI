/**
 * 「下拉框换成结构化名单」之后，旧接口仍要能用。
 *
 * 背景：灵魂页现在改用 listBindableNovelCharactersStructured（只读活跃角色与候选角色）。
 * 但旧接口 listBindableNovelCharacters / listBindableNovelCharactersLocal 仍被其他调用方引用，
 * 不能因为这次改造把它们的契约弄坏 —— 它们各自仍按老规则工作，只是不再喂给灵魂页。
 *
 * 这里只锁「旧接口还在、还能返回、出错不抛」这三件事；
 * 新的名单规则由 character-aura-name-extraction.spec.ts 负责。
 */
import { describe, expect, it, vi } from "vitest"

type DirNode = { name: string; path: string; is_dir: boolean; children: DirNode[] }

const files = new Map<string, string>()

function buildDirTree(root: string): DirNode[] {
  const prefix = root.endsWith("/") ? root : `${root}/`
  const roots: DirNode[] = []
  for (const key of [...files.keys()].sort()) {
    if (!key.startsWith(prefix)) continue
    const parts = key.slice(prefix.length).split("/")
    let bucket = roots
    let accumulated = prefix
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]
      const isLeaf = i === parts.length - 1
      accumulated = `${accumulated}${part}`
      let node = bucket.find((item) => item.name === part)
      if (!node) {
        node = { name: part, path: accumulated, is_dir: !isLeaf, children: [] }
        bucket.push(node)
      }
      bucket = node.children
      accumulated = `${accumulated}/`
    }
  }
  return roots
}

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(async () => undefined),
  fileExists: vi.fn(async (path: string) => files.has(path)),
  listDirectory: vi.fn(async (path: string) => buildDirTree(path)),
  readFile: vi.fn(async (path: string) => {
    const value = files.get(path)
    if (value === undefined) throw new Error(`ENOENT: ${path}`)
    return value
  }),
  writeFileAtomic: vi.fn(async (path: string, content: string) => {
    files.set(path, content)
  }),
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

vi.mock("@/lib/novel/bindable-characters-filter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/novel/bindable-characters-filter")>(
    "@/lib/novel/bindable-characters-filter",
  )
  return { ...actual, readBindableIgnoreList: vi.fn(async () => []) }
})

const { listBindableNovelCharacters, listBindableNovelCharactersLocal, listBindableNovelCharactersStructured } =
  await import("./character-aura")

const PROJECT = "/proj"

describe("旧版可绑定人物接口仍然可用", () => {
  it("三个接口都存在且返回数组", async () => {
    files.clear()

    await expect(listBindableNovelCharactersLocal(PROJECT)).resolves.toEqual([])
    await expect(listBindableNovelCharacters(PROJECT)).resolves.toEqual([])
    await expect(listBindableNovelCharactersStructured(PROJECT)).resolves.toEqual([])
  })

  it("项目里没有任何人物数据时不抛错", async () => {
    files.clear()
    await expect(listBindableNovelCharactersStructured("/empty-project")).resolves.toEqual([])
  })

  it("结构化接口读的是人物档案，不是大纲 md", async () => {
    files.clear()
    files.set(
      `${PROJECT}/.qmai/persona-skills/index.json`,
      JSON.stringify({
        version: 1,
        skills: [
          {
            id: "杨寒",
            characterName: "杨寒",
            aliases: [],
            roleType: "主角",
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
            updatedAt: "2026-11-01T00:00:00.000Z",
            origin: "auto",
            outlineRefs: [],
            asOfChapter: 1,
          },
        ],
      }),
    )
    // 同时放一份只有栏目名的大纲页：它不该进入结构化名单。
    files.set(
      `${PROJECT}/wiki/outlines/人物小传/人物小传.md`,
      ["# 人物小传", "", "## 内在分析", "内容。", "## 能力设计", "内容。"].join("\n"),
    )

    const characters = await listBindableNovelCharactersStructured(PROJECT)
    expect(characters.map((item) => item.name)).toEqual(["杨寒"])
  })
})
