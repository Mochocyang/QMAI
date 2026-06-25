import { beforeEach, describe, expect, it, vi } from "vitest"

const mockFs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  directories: new Map<string, Array<{ name: string; path: string; is_dir: boolean }>>(),
}))

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(async (path: string) => mockFs.directories.get(path.replace(/\\/g, "/")) ?? []),
  readFile: vi.fn(async (path: string) => {
    const key = path.replace(/\\/g, "/")
    if (!mockFs.files.has(key)) throw new Error(`missing ${key}`)
    return mockFs.files.get(key)!
  }),
}))

vi.mock("@/lib/novel/writing-style-store", () => ({
  loadWritingStyleStore: vi.fn(async () => ({ version: 1, enabledStyleId: null, styles: [] })),
}))

vi.mock("@/lib/novel/character-aura", () => ({
  loadCharacterAuraStore: vi.fn(async () => ({ customAuras: [], bindings: [] })),
}))

import { loadBookAnalysisLibraryState } from "./library-state"

beforeEach(() => {
  mockFs.files.clear()
  mockFs.directories.clear()
})

function addBook(projectPath: string) {
  const bookPath = `${projectPath}/book-analysis/book-1`
  mockFs.directories.set(`${projectPath}/book-analysis`, [
    { name: "book-1", path: bookPath, is_dir: true },
  ])
  mockFs.files.set(`${bookPath}/metadata.json`, JSON.stringify({
    title: "长夜书",
    totalChapters: 2,
    totalWords: 2200,
    sourceType: "file",
    createdAt: 1,
    updatedAt: 2,
  }))
  mockFs.directories.set(`${bookPath}/characters`, [
    { name: "linjing.json", path: `${bookPath}/characters/linjing.json`, is_dir: false },
  ])
  mockFs.files.set(`${bookPath}/characters/linjing.json`, JSON.stringify({
    id: "char-linjing",
    name: "林烬",
    aliases: [],
    importance: 9,
    category: "protagonist",
    firstAppearance: 1,
    lastAppearance: 2,
    appearanceCount: 2,
    description: "",
    personality: "",
    speechStyle: "",
    relationships: [],
    keyEvents: [],
    corpus: "",
  }))
  mockFs.directories.set(`${bookPath}/skills`, [])
  mockFs.files.set(`${bookPath}/recognized-characters.json`, JSON.stringify([
    {
      id: "char-linjing",
      name: "林烬",
      aliases: [],
      appearances: 2,
      chapterIndices: [0, 1],
      importanceScore: 95,
      category: "主角",
      sourceBook: bookPath,
    },
    {
      id: "char-wuya",
      name: "乌鸦",
      aliases: [],
      appearances: 1,
      chapterIndices: [1],
      importanceScore: 50,
      category: "次要",
      sourceBook: bookPath,
    },
  ]))
}

describe("loadBookAnalysisLibraryState recognized characters", () => {
  it("读取首次识别出的全量角色，而不是只读取已生成 Skill 的角色", async () => {
    addBook("E:/Novel")

    const state = await loadBookAnalysisLibraryState("E:/Novel")

    expect(state.books[0].characters).toHaveLength(1)
    expect(state.books[0].recognizedCharacters.map((item) => item.name)).toEqual(["林烬", "乌鸦"])
  })
})
