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
  loadCharacterAuraStore: vi.fn(async () => ({
    customAuras: [{
      id: "aura-linjing",
      builtIn: false,
      name: "林烬",
      category: "拆书角色",
      sourceNote: "来自拆书作品《长夜书》的角色分析。",
      corpus: "",
      styleDescription: "",
      behaviorRules: "",
      boundaries: "",
      notes: "",
    }],
    bindings: [],
  })),
}))

import { loadBookAnalysisLibraryState } from "./library-state"

function addBook(projectPath: string) {
  const bookPath = `${projectPath}/book-analysis/book-1`
  mockFs.directories.set(`${projectPath}/book-analysis`, [
    { name: "book-1", path: bookPath, is_dir: true },
  ])
  mockFs.files.set(`${bookPath}/metadata.json`, JSON.stringify({
    title: "长夜书",
    totalChapters: 3,
    totalWords: 12000,
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
    lastAppearance: 3,
    appearanceCount: 3,
    description: "",
    personality: "",
    speechStyle: "",
    relationships: [],
    keyEvents: [],
    corpus: "",
  }))
  mockFs.directories.set(`${bookPath}/skills`, [])
}

describe("loadBookAnalysisLibraryState added aura markers", () => {
  beforeEach(() => {
    mockFs.files.clear()
    mockFs.directories.clear()
  })

  it("标记已加入自定义灵魂库的拆书角色", async () => {
    addBook("E:/Novel")

    const state = await loadBookAnalysisLibraryState("E:/Novel")

    expect(state.books[0].addedAuraCharacterIds).toEqual(["char-linjing"])
  })
})
