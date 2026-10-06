/**
 * Task 2 回归：可绑定人物名单拆成「本地即时解析」+「后台 LLM 精修」两段，
 * 并接入 .qmai/bindable-characters.json 持久缓存。
 *
 * 关键不变量：
 * - listBindableNovelCharactersLocal 是纯本地解析，绝不发起 LLM 请求。
 * - listBindableNovelCharacters 永不等待 LLM（旧实现串行等待 6 个 30s 超时）。
 * - refineBindableCharactersWithLlm 只在指纹变化时并发精修一次，失败静默降级。
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(),
  fileExists: vi.fn(),
  listDirectory: vi.fn(),
  readFile: vi.fn(),
  writeFileAtomic: vi.fn(),
}))

vi.mock("@/lib/has-usable-llm", () => ({
  hasUsableLlm: vi.fn(() => false),
}))

vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(),
}))

vi.mock("@/lib/search", () => ({
  searchWiki: vi.fn(),
}))

vi.mock("@/lib/tauri-fetch", () => ({
  getHttpFetch: vi.fn(),
}))

vi.mock("@/lib/web-search", () => ({
  webSearch: vi.fn(),
}))

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: {
    getState: () => ({
      llmConfig: {
        provider: "openai",
        apiKey: "",
        model: "",
        ollamaUrl: "",
        customEndpoint: "",
        maxContextSize: 128000,
      },
      providerConfigs: {},
      aiChatModel: "",
      defaultLlmModel: "",
      novelConfig: { defaultLlmModel: "" },
    }),
  },
}))

import { listDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { streamChat } from "@/lib/llm-client"
import type { FileNode } from "@/types/wiki"
import {
  bindableCharactersCachePath,
  computeBindableFingerprint,
  readBindableCharactersCache,
  type BindableCharactersCache,
} from "./bindable-characters-cache"
import {
  BINDABLE_CHARACTERS_LLM_TIMEOUT_MS,
  listBindableNovelCharacters,
  listBindableNovelCharactersLocal,
  refineBindableCharactersWithLlm,
} from "./character-aura"

const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)
const mockWriteFileAtomic = vi.mocked(writeFileAtomic)
const mockStreamChat = vi.mocked(streamChat)
const mockHasUsableLlm = vi.mocked(hasUsableLlm)

const PROJECT_PATH = "E:/Novel"
const CACHE_PATH = bindableCharactersCachePath(PROJECT_PATH)
const ENTITIES_DIR = `${PROJECT_PATH}/wiki/entities`
const OUTLINES_DIR = `${PROJECT_PATH}/wiki/outlines`

type FixtureFile = {
  name: string
  path: string
  content: string
  mtimeMs: number
  size: number
}

let entityFiles: FixtureFile[] = []
let outlineFiles: FixtureFile[] = []
let cacheDisk = new Map<string, string>()

function fixtureFile(path: string, content: string, mtimeMs: number): FixtureFile {
  return { name: path.split("/").pop() ?? path, path, content, mtimeMs, size: content.length }
}

/** 人物实体页：type=entity + tags 含 character，标题取自 frontmatter title。 */
function entityPage(name: string, mtimeMs = 1000): FixtureFile {
  const content = [
    "---",
    "type: entity",
    "tags: [character]",
    `title: "${name}"`,
    "---",
    "",
    `# ${name}`,
    "",
  ].join("\n")
  return fixtureFile(`${ENTITIES_DIR}/${name}.md`, content, mtimeMs)
}

/** 人物小传大纲页：本地解析能拿到 `## 段名` 作为人物名。 */
function characterOutline(fileName: string, sectionName: string, mtimeMs = 2000): FixtureFile {
  const content = [
    "---",
    "type: outline",
    `title: "${fileName}"`,
    "outline_category: characters",
    "---",
    "",
    `# ${fileName}`,
    "",
    `## ${sectionName}`,
    "### 背景",
    "- 出身背景：某地少年",
    "",
  ].join("\n")
  return fixtureFile(`${OUTLINES_DIR}/人物小传/${fileName}.md`, content, mtimeMs)
}

function toNode(file: FixtureFile): FileNode {
  return { name: file.name, path: file.path, is_dir: false, mtimeMs: file.mtimeMs, size: file.size }
}

function entityTree(): FileNode[] {
  return entityFiles.map(toNode)
}

function outlineTree(): FileNode[] {
  return [
    {
      name: "人物小传",
      path: `${OUTLINES_DIR}/人物小传`,
      is_dir: true,
      children: outlineFiles.map(toNode),
    },
  ]
}

function setupProject(options?: { entities?: FixtureFile[]; outlines?: FixtureFile[] }): void {
  entityFiles = options?.entities ?? []
  outlineFiles = options?.outlines ?? []
  cacheDisk = new Map()

  mockListDirectory.mockReset()
  mockReadFile.mockReset()
  mockWriteFileAtomic.mockReset()
  mockStreamChat.mockReset()
  mockHasUsableLlm.mockReset()
  mockHasUsableLlm.mockReturnValue(false)

  // 两个 wiki 目录的清单稳定不变（fingerprint 可复现），其它路径一律视为不存在。
  mockListDirectory.mockImplementation(async (path: string) => {
    if (path === ENTITIES_DIR) return entityTree()
    if (path === OUTLINES_DIR) return outlineTree()
    throw new Error(`unexpected path: ${path}`)
  })

  mockReadFile.mockImplementation(async (path: string) => {
    const cached = cacheDisk.get(path)
    if (cached !== undefined) return cached
    const file = [...entityFiles, ...outlineFiles].find((item) => item.path === path)
    if (file) return file.content
    throw new Error(`unexpected read: ${path}`)
  })

  mockWriteFileAtomic.mockImplementation(async (path: string, contents: string) => {
    cacheDisk.set(path, contents)
  })
}

function seedCache(entry: Partial<BindableCharactersCache> & { fingerprint: string; names: string[] }): void {
  cacheDisk.set(CACHE_PATH, JSON.stringify({ updatedAt: Date.now(), ...entry }))
}

function readPaths(): string[] {
  return mockReadFile.mock.calls.map((call) => call[0])
}

function cacheEntryOnDisk(): BindableCharactersCache | null {
  const raw = cacheDisk.get(CACHE_PATH)
  return raw ? (JSON.parse(raw) as BindableCharactersCache) : null
}

/** 让 LLM 每次流式返回给定的名字，每行一个。 */
function mockLlmReturning(...names: string[]): void {
  mockStreamChat.mockImplementation(async (_config, _messages, callbacks) => {
    callbacks.onToken(names.map((name) => `\n${name}`).join(""))
    callbacks.onDone()
  })
}

describe("character-aura 可绑定人物名单（本地/缓存/精修拆分）", () => {
  it("listBindableNovelCharactersLocal 只做本地解析，绝不调用 LLM", async () => {
    setupProject({ entities: [entityPage("甲")], outlines: [characterOutline("甲篇", "甲")] })
    mockHasUsableLlm.mockReturnValue(true)

    const names = await listBindableNovelCharactersLocal(PROJECT_PATH)

    expect(names).toEqual(["甲"])
    expect(mockStreamChat).not.toHaveBeenCalled()
    expect(cacheDisk.has(CACHE_PATH)).toBe(false)
  })

  it("listBindableNovelCharacters 在 LLM 永不返回时也必须立即返回本地名单", async () => {
    setupProject({ entities: [entityPage("甲")], outlines: [characterOutline("甲篇", "甲")] })
    mockHasUsableLlm.mockReturnValue(true)
    // 旧实现在这里会串行 await 一个永不 resolve 的请求，导致界面卡住约 3 分钟。
    mockStreamChat.mockImplementation(() => new Promise<void>(() => {}))

    const names = await listBindableNovelCharacters(PROJECT_PATH)

    expect(names).toEqual(["甲"])
    expect(mockStreamChat).not.toHaveBeenCalled()
  })

  it("listBindableNovelCharacters 第二次调用命中缓存，不再重新扫描", async () => {
    setupProject({ entities: [entityPage("甲")], outlines: [characterOutline("甲篇", "甲")] })

    const first = await listBindableNovelCharacters(PROJECT_PATH)
    expect(first).toEqual(["甲"])
    const firstScanCalls = mockListDirectory.mock.calls.length
    expect(firstScanCalls).toBeGreaterThan(0)

    mockListDirectory.mockClear()
    mockReadFile.mockClear()

    const second = await listBindableNovelCharacters(PROJECT_PATH)

    expect(second).toEqual(["甲"])
    // 命中缓存时只剩指纹计算需要列目录，绝不再跑一遍实体页/大纲扫描。
    expect(mockListDirectory.mock.calls.length).toBeGreaterThan(0)
    expect(mockListDirectory.mock.calls.length).toBeLessThan(firstScanCalls)
    expect(readPaths()).toEqual([CACHE_PATH])
  })

  it("refineBindableCharactersWithLlm 把 LLM 精修结果并入本地名单并写回缓存", async () => {
    setupProject({ entities: [entityPage("甲")], outlines: [characterOutline("甲篇", "甲")] })
    mockHasUsableLlm.mockReturnValue(true)
    mockLlmReturning("乙")

    const names = await refineBindableCharactersWithLlm(PROJECT_PATH)

    expect(names).toEqual(["甲", "乙"])
    expect(mockStreamChat).toHaveBeenCalledTimes(1)

    const fingerprint = await computeBindableFingerprint(PROJECT_PATH)
    const cached = cacheEntryOnDisk()
    expect(cached?.fingerprint).toBe(fingerprint)
    expect(cached?.llmRefinedFingerprint).toBe(fingerprint)
    expect(cached?.names).toEqual(["甲", "乙"])
  })

  it("同一指纹下 refineBindableCharactersWithLlm 不会重复精修", async () => {
    setupProject({ entities: [entityPage("甲")], outlines: [characterOutline("甲篇", "甲")] })
    mockHasUsableLlm.mockReturnValue(true)
    mockLlmReturning("乙")

    const first = await refineBindableCharactersWithLlm(PROJECT_PATH)
    expect(mockStreamChat).toHaveBeenCalledTimes(1)

    mockStreamChat.mockClear()
    const second = await refineBindableCharactersWithLlm(PROJECT_PATH)

    expect(second).toEqual(first)
    expect(mockStreamChat).not.toHaveBeenCalled()
  })

  it("指纹变化后 refineBindableCharactersWithLlm 会重新精修", async () => {
    setupProject({ entities: [entityPage("甲")], outlines: [characterOutline("甲篇", "甲")] })
    mockHasUsableLlm.mockReturnValue(true)
    mockLlmReturning("乙")

    await refineBindableCharactersWithLlm(PROJECT_PATH)
    expect(mockStreamChat).toHaveBeenCalledTimes(1)

    mockStreamChat.mockClear()
    outlineFiles[0].mtimeMs = 999_999

    const names = await refineBindableCharactersWithLlm(PROJECT_PATH)

    expect(mockStreamChat).toHaveBeenCalledTimes(1)
    expect(names).toEqual(["甲", "乙"])
  })

  it("LLM 抛错时 refineBindableCharactersWithLlm 静默降级且不标记为已精修", async () => {
    setupProject({ entities: [entityPage("甲")], outlines: [characterOutline("甲篇", "甲")] })
    mockHasUsableLlm.mockReturnValue(true)
    mockStreamChat.mockRejectedValue(new Error("llm down"))

    const names = await refineBindableCharactersWithLlm(PROJECT_PATH)

    expect(names).toEqual(["甲"])
    expect(cacheEntryOnDisk()?.llmRefinedFingerprint).toBeUndefined()
  })

  it("模型不可用时 refineBindableCharactersWithLlm 不调用 LLM，也不算已精修", async () => {
    setupProject({ entities: [entityPage("甲")], outlines: [characterOutline("甲篇", "甲")] })
    mockHasUsableLlm.mockReturnValue(false)

    const names = await refineBindableCharactersWithLlm(PROJECT_PATH)

    expect(names).toEqual(["甲"])
    expect(mockStreamChat).not.toHaveBeenCalled()
    expect(cacheEntryOnDisk()?.llmRefinedFingerprint).toBeUndefined()
  })

  it("多个大纲页时 refineBindableCharactersWithLlm 并发请求而不是串行等待", async () => {
    setupProject({
      outlines: [characterOutline("甲篇", "甲"), characterOutline("丙篇", "丙")],
    })
    mockHasUsableLlm.mockReturnValue(true)

    let started = 0
    let finished = 0
    let maxInFlight = 0
    let releaseGate: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    mockStreamChat.mockImplementation(async (_config, _messages, callbacks) => {
      started += 1
      maxInFlight = Math.max(maxInFlight, started - finished)
      await gate
      finished += 1
      callbacks.onToken("\n乙")
      callbacks.onDone()
    })

    const pending = refineBindableCharactersWithLlm(PROJECT_PATH)
    try {
      // 串行实现此刻只会有 1 个请求在飞；并发实现必须 2 个都已在飞。
      await vi.waitFor(() => {
        expect(started).toBe(2)
      }, { timeout: 2000, interval: 10 })
    } finally {
      releaseGate?.()
    }

    const names = await pending

    expect(mockStreamChat).toHaveBeenCalledTimes(2)
    expect(maxInFlight).toBe(2)
    expect(names).toHaveLength(3)
    expect(names.slice(0, 2)).toEqual(expect.arrayContaining(["甲", "丙"]))
    expect(names[2]).toBe("乙")
  })

  it("缓存命中时 listBindableNovelCharacters 直接返回精修后的名字，不重新扫描", async () => {
    setupProject({ entities: [entityPage("甲")], outlines: [characterOutline("甲篇", "甲")] })
    const fingerprint = await computeBindableFingerprint(PROJECT_PATH)
    seedCache({ fingerprint, names: ["甲", "乙"], llmRefinedFingerprint: fingerprint })

    mockListDirectory.mockClear()
    mockReadFile.mockClear()
    mockWriteFileAtomic.mockClear()

    const names = await listBindableNovelCharacters(PROJECT_PATH)

    expect(names).toEqual(["甲", "乙"])
    expect(readPaths()).toEqual([CACHE_PATH])
    expect(mockWriteFileAtomic).not.toHaveBeenCalled()
    expect(mockStreamChat).not.toHaveBeenCalled()
  })

  it("listBindableNovelCharactersLocal 不读缓存，始终重新做本地解析", async () => {
    setupProject({ entities: [entityPage("甲")], outlines: [characterOutline("甲篇", "甲")] })
    const fingerprint = await computeBindableFingerprint(PROJECT_PATH)
    seedCache({ fingerprint, names: ["甲", "乙"], llmRefinedFingerprint: fingerprint })
    mockReadFile.mockClear()

    const names = await listBindableNovelCharactersLocal(PROJECT_PATH)

    expect(names).toEqual(["甲"])
    expect(readPaths()).not.toContain(CACHE_PATH)
  })

  it("listBindableNovelCharactersLocal 合并实体页与大纲人物，去重并按 zh-CN 排序", async () => {
    setupProject({
      entities: [entityPage("乙")],
      outlines: [characterOutline("甲篇", "甲"), characterOutline("甲外传", "甲"), characterOutline("丙篇", "丙")],
    })

    const names = await listBindableNovelCharactersLocal(PROJECT_PATH)

    expect([...names].sort((left, right) => left.localeCompare(right, "zh-CN"))).toEqual(names)
    expect(names).toEqual(["甲", "乙", "丙"].sort((left, right) => left.localeCompare(right, "zh-CN")))
    expect(names).toEqual(expect.arrayContaining(["甲", "乙", "丙"]))
  })

  it("listBindableNovelCharactersLocal 过滤忽略名单与超长名称", async () => {
    setupProject({
      entities: [entityPage("配角"), entityPage("超".repeat(41))],
      outlines: [characterOutline("甲篇", "甲")],
    })

    const names = await listBindableNovelCharactersLocal(PROJECT_PATH)

    expect(names).toEqual(["甲"])
  })

  it("精修请求使用远短于旧实现的超时，并通过 AbortSignal 传入", async () => {
    setupProject({ entities: [entityPage("甲")], outlines: [characterOutline("甲篇", "甲")] })
    mockHasUsableLlm.mockReturnValue(true)
    mockLlmReturning("乙")

    await refineBindableCharactersWithLlm(PROJECT_PATH)

    expect(BINDABLE_CHARACTERS_LLM_TIMEOUT_MS).toBeGreaterThan(0)
    expect(BINDABLE_CHARACTERS_LLM_TIMEOUT_MS).toBeLessThanOrEqual(10_000)
    const signal = mockStreamChat.mock.calls[0]?.[3]
    expect(signal).toBeInstanceOf(AbortSignal)
  })

  it("refineBindableCharactersWithLlm 返回的名字会写进 listBindableNovelCharacters 的缓存", async () => {
    setupProject({ entities: [entityPage("甲")], outlines: [characterOutline("甲篇", "甲")] })
    mockHasUsableLlm.mockReturnValue(true)
    mockLlmReturning("乙")

    await refineBindableCharactersWithLlm(PROJECT_PATH)
    const names = await listBindableNovelCharacters(PROJECT_PATH)

    expect(names).toEqual(["甲", "乙"])
    const cached = await readBindableCharactersCache(PROJECT_PATH)
    expect(cached?.names).toEqual(["甲", "乙"])
  })
})
