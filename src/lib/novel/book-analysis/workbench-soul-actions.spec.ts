import { beforeEach, describe, expect, it, vi } from "vitest"

const io = vi.hoisted(() => ({
  auras: [] as any[], bindings: [] as any[],
  imported: vi.fn(), published: vi.fn(), bind: vi.fn(),
}))
vi.mock("./aura-adapter", () => ({ importBookAnalysisSkillsAsAuras: (...a: any[]) => io.imported(...a) }))
vi.mock("./workbench-publish", () => ({ publishWorkbenchCharacter: (...a: any[]) => io.published(...a) }))
vi.mock("../character-aura", () => ({
  loadCharacterAuraStore: async () => ({ customAuras: io.auras, bindings: io.bindings }),
  bindCharacterAura: (...a: any[]) => io.bind(...a),
}))
vi.mock("./aura-match", () => ({
  isSameBookAnalysisCharacterAura: (aura: any, bookTitle: string, subject: string) =>
    aura.name === subject && aura.sourceBook === bookTitle,
}))

import { addCharacterToSoulLibrary, bindCharacterToNovelCharacters, loadCharacterSoulStatus } from "./workbench-soul-actions"
import type { BookAnalysisLibraryBook } from "./library-state"
import type { WorkbenchRevision } from "./workbench-core"

const book = {
  id: "book-1", path: "/project/book-analysis/book-1",
  metadata: { title: "测试作品", totalChapters: 3, totalWords: 3000, sourceType: "file", createdAt: 1, updatedAt: 2 },
  recognizedCharacters: [], styleStatus: "disabled", boundAurasCount: 0, addedAuraCharacterIds: [], evidence: [],
  characters: [{ id: "char-1", name: "林烬", aliases: [], importance: 9, category: "protagonist",
    firstAppearance: 1, lastAppearance: 3, appearanceCount: 3, description: "", personality: "沉默。",
    speechStyle: "", relationships: [], keyEvents: [], corpus: "" }],
  skills: [{ id: "skill-char-1", characterId: "char-1", characterName: "林烬",
    skillContent: "---\nportablePersonality: {}\n---\n", sourceBook: "测试作品", chapterRange: ["1", "3"], createdAt: 1 }],
} as unknown as BookAnalysisLibraryBook

const legacyBase = {
  id: "legacy-chars-x", origin: "legacy" as const, skill: "characters" as const, bookTitle: "测试作品",
  items: [{ subject: "林烬", summary: "s", limitations: "", rules: [] }], evidence: [], coverage: [],
  selectedChapterIds: [], workbenchVersion: 2 as const, taskId: "t", bookId: "book-1", requirements: "", createdAt: 1,
}
const legacy = legacyBase as WorkbenchRevision
const modern = { ...legacyBase, id: "r2", origin: undefined } as unknown as WorkbenchRevision

beforeEach(() => { io.auras = []; io.bindings = []; vi.resetAllMocks() })

describe("loadCharacterSoulStatus", () => {
  it("没有 aura 时是 none", async () => {
    expect(await loadCharacterSoulStatus("/project", "测试作品", "林烬")).toBe("none")
  })
  it("有 aura 未绑定时是 added", async () => {
    io.auras = [{ id: "aura-1", name: "林烬", sourceBook: "测试作品" }]
    expect(await loadCharacterSoulStatus("/project", "测试作品", "林烬")).toBe("added")
  })
  it("有绑定时返回被绑定的人物名", async () => {
    io.auras = [{ id: "aura-1", name: "林烬", sourceBook: "测试作品" }]
    io.bindings = [{ auraId: "aura-1", characterName: "沈微" }]
    expect(await loadCharacterSoulStatus("/project", "测试作品", "林烬")).toEqual({ bound: ["沈微"] })
  })
})

describe("addCharacterToSoulLibrary", () => {
  it("旧版条目走 importBookAnalysisSkillsAsAuras，且不绑定任何人", async () => {
    io.imported.mockResolvedValue([{ auraId: "aura-1", auraName: "林烬" }])
    const r = await addCharacterToSoulLibrary("/project", book, legacy, "林烬")
    expect(io.imported).toHaveBeenCalled()
    expect(io.published).not.toHaveBeenCalled()
    expect(io.bind).not.toHaveBeenCalled()
    expect(r.auraId).toBe("aura-1")
  })
  it("新版条目走 publishWorkbenchCharacter", async () => {
    io.published.mockResolvedValue({ id: "aura-2", name: "林烬", sourceBook: "测试作品" })
    const r = await addCharacterToSoulLibrary("/project", book, modern, "林烬")
    expect(io.published).toHaveBeenCalled()
    expect(io.imported).not.toHaveBeenCalled()
    expect(r.auraId).toBe("aura-2")
  })
  it("旧版角色已在灵魂库时不重复创建，改用状态查询取回 auraId", async () => {
    // importBookAnalysisSkillsAsAuras 对已存在的 aura 会跳过并返回空数组
    io.imported.mockResolvedValue([])
    io.auras = [{ id: "aura-1", name: "林烬", sourceBook: "测试作品" }]
    const r = await addCharacterToSoulLibrary("/project", book, legacy, "林烬")
    expect(r.auraId).toBe("aura-1")
  })
})

describe("bindCharacterToNovelCharacters", () => {
  it("先入库再绑定（顺序即需求 2c）", async () => {
    io.imported.mockResolvedValue([{ auraId: "aura-1", auraName: "林烬" }])
    io.bind.mockResolvedValue(undefined)
    await bindCharacterToNovelCharacters("/project", book, legacy, "林烬", ["沈微", "裴探"])
    expect(io.imported.mock.invocationCallOrder[0]).toBeLessThan(io.bind.mock.invocationCallOrder[0])
    expect(io.bind).toHaveBeenCalledWith("/project", { characterName: "沈微", auraId: "aura-1" })
    expect(io.bind).toHaveBeenCalledWith("/project", { characterName: "裴探", auraId: "aura-1" })
  })
  it("没有目标人物时不写任何数据", async () => {
    await bindCharacterToNovelCharacters("/project", book, legacy, "林烬", [])
    expect(io.imported).not.toHaveBeenCalled()
    expect(io.published).not.toHaveBeenCalled()
    expect(io.bind).not.toHaveBeenCalled()
  })
  it("个别绑定失败不中断其余，并如实报数", async () => {
    io.imported.mockResolvedValue([{ auraId: "aura-1", auraName: "林烬" }])
    io.bind.mockImplementation(async (_p: string, b: any) => { if (b.characterName === "裴探") throw new Error("失败") })
    const r = await bindCharacterToNovelCharacters("/project", book, legacy, "林烬", ["沈微", "裴探"])
    expect(r).toEqual({ succeeded: 1, alreadyBound: [], failed: ["裴探"] })
  })
  it("已绑过同一人物时视为幂等，不重复写入且计入 alreadyBound", async () => {
    // 已绑定同一人物再绑 视为幂等，不重复写入；汇总里计为已有
    io.imported.mockResolvedValue([{ auraId: "aura-1", auraName: "林烬" }])
    io.bindings = [{ auraId: "aura-1", characterName: "沈微" }]
    const r = await bindCharacterToNovelCharacters("/project", book, legacy, "林烬", ["沈微", "裴探"])
    expect(io.bind).toHaveBeenCalledTimes(1)
    expect(io.bind).toHaveBeenCalledWith("/project", { characterName: "裴探", auraId: "aura-1" })
    expect(r).toEqual({ succeeded: 1, alreadyBound: ["沈微"], failed: [] })
  })
})
