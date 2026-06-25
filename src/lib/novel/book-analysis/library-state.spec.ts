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
  loadWritingStyleStore: vi.fn(async () => ({
    version: 1,
    enabledStyleId: "style-1",
    styles: [
      {
        id: "style-1",
        name: "凡人修仙传 · 文风",
        sourceBook: "凡人修仙传",
        profile: {
          schemaVersion: 1,
          generatedAt: 1,
          sampledChapterIds: ["ch-1"],
          narrativeDensity: "叙事密度中高",
          descriptionWeight: "",
          emotionRendering: "",
          sentenceStyle: "",
          rhetoricDensity: "",
          transitionStyle: "",
          narrativeVoice: "",
          dialogueStyle: "",
          thematicHabits: "",
          constitution: "1. 动作推进优先",
          samples: [],
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  })),
}))

vi.mock("@/lib/novel/character-aura", () => ({
  loadCharacterAuraStore: vi.fn(async () => ({
    customAuras: [
      {
        id: "aura-hanli",
        builtIn: false,
        name: "韩立",
        category: "拆书角色",
        sourceNote: "来自拆书作品《凡人修仙传》的角色分析。",
        corpus: "",
        styleDescription: "",
        behaviorRules: "",
        boundaries: "",
        notes: "",
      },
    ],
    bindings: [{ characterName: "主角", auraId: "aura-hanli" }],
  })),
}))

import { loadBookAnalysisLibraryState } from "./library-state"

beforeEach(() => {
  mockFs.files.clear()
  mockFs.directories.clear()
})

function addBook(projectPath: string, bookId: string, title: string, withStyle: boolean) {
  const bookPath = `${projectPath}/book-analysis/${bookId}`
  mockFs.directories.set(`${projectPath}/book-analysis`, [
    ...(mockFs.directories.get(`${projectPath}/book-analysis`) ?? []),
    { name: bookId, path: bookPath, is_dir: true },
  ])
  mockFs.files.set(`${bookPath}/metadata.json`, JSON.stringify({
    title,
    author: "作者",
    totalChapters: 10,
    totalWords: 100000,
    sourceType: "file",
    createdAt: 1,
    updatedAt: 2,
  }))
  mockFs.directories.set(`${bookPath}/characters`, [
    { name: "hanli.json", path: `${bookPath}/characters/hanli.json`, is_dir: false },
  ])
  mockFs.files.set(`${bookPath}/characters/hanli.json`, JSON.stringify({
    id: "char-hanli",
    name: "韩立",
    aliases: [],
    importance: 9,
    category: "protagonist",
    firstAppearance: 1,
    lastAppearance: 10,
    appearanceCount: 10,
    description: "谨慎",
    personality: "隐忍",
    speechStyle: "少承诺",
    relationships: [],
    keyEvents: [],
    corpus: "",
  }))
  mockFs.directories.set(`${bookPath}/skills`, [
    { name: "韩立-skill.md", path: `${bookPath}/skills/韩立-skill.md`, is_dir: false },
  ])
  mockFs.files.set(`${bookPath}/skills/韩立-skill.md`, "# 韩立")
  if (withStyle) {
    mockFs.files.set(`${bookPath}/style-profile.json`, JSON.stringify({
      schemaVersion: 1,
      generatedAt: 1,
      sampledChapterIds: ["ch-1"],
      narrativeDensity: "叙事密度中高",
      descriptionWeight: "",
      emotionRendering: "",
      sentenceStyle: "",
      rhetoricDensity: "",
      transitionStyle: "",
      narrativeVoice: "",
      dialogueStyle: "",
      thematicHabits: "",
      constitution: "1. 动作推进优先",
      samples: [],
    }))
  }
}

describe("loadBookAnalysisLibraryState", () => {
  it("loads books with active style and binding summary", async () => {
    addBook("E:/Novel", "book-1", "凡人修仙传", true)
    addBook("E:/Novel", "book-2", "诡秘之主", false)

    const state = await loadBookAnalysisLibraryState("E:/Novel")

    expect(state.books).toHaveLength(2)
    expect(state.enabledStyle?.sourceBook).toBe("凡人修仙传")
    expect(state.books[0].styleStatus).toBe("enabled")
    expect(state.books[1].styleStatus).toBe("missing")
    expect(state.bindings).toEqual([{ characterName: "主角", auraId: "aura-hanli", auraName: "韩立" }])
    expect(state.books[0].boundAurasCount).toBe(1)
  })
})
