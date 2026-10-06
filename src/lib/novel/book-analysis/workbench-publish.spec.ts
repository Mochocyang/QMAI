import { beforeEach, describe, expect, it, vi } from "vitest"
import { sha256Text } from "@/lib/context-hub/fingerprint"
import { inspectWorkbenchPublication, confirmWorkbenchRevision, publishWorkbenchCharacter, ensureLegacyCharacterAura } from "./workbench-publish"
import { saveWorkbenchRevision, workbenchRevisionPath } from "./workbench-storage"
import { buildEvidenceCandidates, type WorkbenchRevision } from "./workbench-core"
import { upsertWritingStylePreset } from "../writing-style-store"
import { renderPersonalitySkill } from "../portable-personality"
import type { BookAnalysisLibraryBook } from "./library-state"
import type { CharacterSkill, ExtractedCharacter, PersonalityProfile } from "./types"

const io = vi.hoisted(() => ({
  files: new Map<string, string>(), auras: [] as any[], writes: vi.fn(), createAura: vi.fn(), updateAura: vi.fn(),
}))
vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => { if (!io.files.has(path)) throw new Error("文件缺失"); return io.files.get(path)! },
  writeFileAtomic: async (path: string, text: string) => { io.writes(path); io.files.set(path, text) },
  createDirectory: async () => {},
  fileExists: async (path: string) => io.files.has(path),
  listDirectory: async () => [],
}))
vi.mock("./analysis-engine", () => ({ loadChapterList: async () => [{ chapterId: "c1", title: "第一章", order: 1 }] }))
vi.mock("../character-aura", () => ({
  // 返回副本而不是 io.auras 本体：生产代码里的去重是「先读库、再在内存里替换条目」，
  // 若共享同一个数组引用，即使删掉 store.customAuras = [...] 这行去重也照样通过，
  // 测试就钉不住去重逻辑。
  loadCharacterAuraStore: async () => ({ customAuras: [...io.auras], bindings: [] }),
  createCustomCharacterAuraFromGeneratedSkill: async (_path: string, input: any) => {
    io.createAura(input); const aura = { ...input, id: "aura-1" }; io.auras.push(aura); return aura
  },
  updateCustomCharacterAura: async (_path: string, id: string, input: any) => { io.updateAura(id, input); return { ...input, id } },
}))
vi.mock("../writing-style-store", () => ({ loadWritingStyleStore: async () => ({ styles: [], enabledStyleId: null }), upsertWritingStylePreset: vi.fn() }))
vi.mock("../plot-framework-library", () => ({ loadPlotFrameworkLibrary: async () => ({ frameworks: [] }), upsertPlotFramework: vi.fn() }))

const bookPath = "/project/book-analysis/book-1"
let revision: WorkbenchRevision
beforeEach(async () => {
  io.files.clear(); io.auras = []; vi.clearAllMocks()
  const body = "他没有立刻下结论，而是先核对账簿。"
  io.files.set(`${bookPath}/chapters/c1.md`, body)
  const sourceHash = await sha256Text(body)
  const evidence = await buildEvidenceCandidates([{ chapterId: "c1", order: 1, start: 0, text: body, sourceHash }])
  revision = {
    workbenchVersion: 2, id: "r1", taskId: "task1", bookId: "book-1", bookTitle: "测试作品", skill: "characters",
    requirements: "", selectedChapterIds: ["c1"], createdAt: 1, evidence,
    coverage: [{ chapterId: "c1", order: 1, start: 0, end: body.length, sourceHash }],
    items: [{ subject: "甲", summary: "先核对", limitations: "只覆盖本章", rules: [{
      id: "R1", dimension: "mentalModel", observation: "核对账簿", condition: "信息不足", action: "先核对再判断", boundary: "例外未知", evidenceIds: [evidence[0].id],
    }] }],
  }
  await saveWorkbenchRevision(bookPath, revision)
})
describe("版本确认入库", () => {
  it("文风确认保留结构画像、代表片段与作品来源，不自动启用", async () => {
    revision.skill = "style"
    revision.items[0].subject = "文风"
    revision.items[0].styleFingerprint = { version: 1, positioning: "白话", coverage: [], lexicon: [], scenes: [] }
    vi.mocked(upsertWritingStylePreset).mockResolvedValueOnce({ id: "style-1" } as never)
    await saveWorkbenchRevision(bookPath, revision)
    const preview = await inspectWorkbenchPublication("/project", revision)
    await confirmWorkbenchRevision("/project", bookPath, revision.id, preview.fingerprint)
    expect(upsertWritingStylePreset).toHaveBeenCalledWith("/project", expect.objectContaining({
      sourceBookId: "book-1", profile: expect.objectContaining({ workbenchStyle: revision.items[0], samples: [revision.evidence[0].text] }),
    }))
  })
  it("未采纳建议保留在来源版本，但不传入文风使用库", async () => {
    revision.skill = "style"
    revision.items[0].subject = "文风"
    revision.items[0].styleFingerprint = { version: 1, positioning: "白话", coverage: [], lexicon: [], scenes: [], omitted: [{ kind: "lexicon", label: "不可靠词项", reason: "不能支持用法" }] }
    vi.mocked(upsertWritingStylePreset).mockResolvedValueOnce({ id: "style-1" } as never)
    await saveWorkbenchRevision(bookPath, revision)
    const preview = await inspectWorkbenchPublication("/project", revision)
    await confirmWorkbenchRevision("/project", bookPath, revision.id, preview.fingerprint)
    const published = vi.mocked(upsertWritingStylePreset).mock.calls[0][1]
    expect(published.profile?.workbenchStyle?.styleFingerprint?.omitted).toBeUndefined()
    expect(JSON.parse(io.files.get(workbenchRevisionPath(bookPath, revision.id))!).items[0].styleFingerprint.omitted).toHaveLength(1)
  })
  it("草稿保存不入库，重复确认只创建一次且保留版本", async () => {
    expect(io.createAura).not.toHaveBeenCalled()
    const preview = await inspectWorkbenchPublication("/project", revision)
    await confirmWorkbenchRevision("/project", bookPath, "r1", preview.fingerprint)
    await confirmWorkbenchRevision("/project", bookPath, "r1", preview.fingerprint)
    expect(io.createAura).toHaveBeenCalledTimes(1)
    expect(JSON.parse(io.files.get(workbenchRevisionPath(bookPath, "r1"))!).confirmedAt).toBeGreaterThan(0)
  })
  it("原文被修改时阻止入库，草稿与原版本仍保留", async () => {
    const preview = await inspectWorkbenchPublication("/project", revision)
    io.files.set(`${bookPath}/chapters/c1.md`, "不同的原文")
    await expect(confirmWorkbenchRevision("/project", bookPath, "r1", preview.fingerprint)).rejects.toThrow("证据")
    expect(io.createAura).not.toHaveBeenCalled()
    expect(io.files.has(workbenchRevisionPath(bookPath, "r1"))).toBe(true)
  })
  it("角色条目发布时把条目内容送进 aura", async () => {
    const preview = await inspectWorkbenchPublication("/project", revision)
    await confirmWorkbenchRevision("/project", bookPath, revision.id, preview.fingerprint)
    // 只断言「创建了一次」不足以守住重构：item → aura 的映射才是要钉住的东西。
    expect(io.createAura).toHaveBeenCalledTimes(1)
    expect(io.createAura).toHaveBeenCalledWith(expect.objectContaining({
      name: "甲", category: "拆书角色", sourceBook: "测试作品",
    }))
    const input = io.createAura.mock.calls[0][0] as { portablePersonality?: { rules?: Array<Record<string, string>> } }
    expect(input.portablePersonality?.rules?.[0]).toMatchObject({
      condition: "信息不足", tendency: "先核对再判断", boundary: "例外未知",
    })
  })
  it("库中已有同源角色时走更新分支，不重复创建", async () => {
    io.auras.push({
      id: "aura-existing", name: "甲", category: "拆书角色", builtIn: false,
      sourceNote: "来自拆书作品《测试作品》的可迁移人格。",
    })
    const preview = await inspectWorkbenchPublication("/project", revision)
    await confirmWorkbenchRevision("/project", bookPath, revision.id, preview.fingerprint)
    expect(io.createAura).not.toHaveBeenCalled()
    expect(io.updateAura).toHaveBeenCalledTimes(1)
    // 现有 mock 只把 (id, input) 记进 io.updateAura，projectPath 由被调用的实现消费。
    expect(io.updateAura).toHaveBeenCalledWith("aura-existing", expect.objectContaining({ name: "甲" }))
  })
  it("不传使用库时也能直接发布单个条目", async () => {
    const aura = await publishWorkbenchCharacter("/project", revision, revision.items[0])
    expect(aura.name).toBe("甲")
    expect(io.createAura).toHaveBeenCalledTimes(1)
    expect(io.createAura).toHaveBeenCalledWith(expect.objectContaining({ name: "甲", category: "拆书角色", sourceBook: "测试作品" }))
  })
  it("同一批次里同源角色只创建一次，后续条目走更新", async () => {
    const rule = (id: string) => ({
      id, dimension: "mentalModel", observation: "核对账簿", condition: "信息不足",
      action: "先核对再判断", boundary: "例外未知", evidenceIds: [revision.evidence[0].id],
    })
    revision.items = [
      { subject: "甲", summary: "先核对", limitations: "只覆盖本章", rules: [rule("R1")] },
      { subject: "甲", summary: "先核对", limitations: "只覆盖本章", rules: [rule("R2")] },
    ]
    await saveWorkbenchRevision(bookPath, revision)
    const preview = await inspectWorkbenchPublication("/project", revision)
    await confirmWorkbenchRevision("/project", bookPath, revision.id, preview.fingerprint)
    expect(io.createAura).toHaveBeenCalledTimes(1)
    expect(io.updateAura).toHaveBeenCalledTimes(1)
    expect(io.updateAura).toHaveBeenCalledWith("aura-1", expect.objectContaining({ name: "甲" }))
  })
})

/** 旧版迁移版本：evidence／coverage／selectedChapterIds 全空，规则要么没有、要么证据引用被清空。 */
function legacyRevision(overrides: Partial<WorkbenchRevision> = {}): WorkbenchRevision {
  return {
    workbenchVersion: 2, id: "legacy-chars-1", taskId: "legacy-chars-1", bookId: "book-1", bookTitle: "测试作品",
    skill: "characters", requirements: "旧版角色导入", origin: "legacy", selectedChapterIds: [], createdAt: 1,
    evidence: [], coverage: [],
    items: [{ subject: "甲", summary: "先核对再判断", limitations: "旧版摘要，本就没有正文偏移", rules: [] }],
    ...overrides,
  }
}
describe("旧版迁移版本发布", () => {
  it("旧版迁移版本没有结构化规则也能确认入库", async () => {
    const legacy = legacyRevision()
    await saveWorkbenchRevision(bookPath, legacy)
    const preview = await inspectWorkbenchPublication("/project", legacy)
    await confirmWorkbenchRevision("/project", bookPath, legacy.id, preview.fingerprint, legacyBook())
    expect(io.createAura).toHaveBeenCalledTimes(1)
    expect(io.createAura).toHaveBeenCalledWith(expect.objectContaining({ name: "甲", category: "拆书角色" }))
  })
  it("新版条目没有有依据的规则仍拒绝确认", async () => {
    revision.items = [{ subject: "甲", summary: "没有依据", limitations: "", rules: [] }]
    await saveWorkbenchRevision(bookPath, revision)
    const preview = await inspectWorkbenchPublication("/project", revision)
    await expect(confirmWorkbenchRevision("/project", bookPath, revision.id, preview.fingerprint))
      .rejects.toThrow("没有有依据的规则可加入")
    expect(io.createAura).not.toHaveBeenCalled()
  })
  it("迁移条目证据引用被清空时靠散文字段兜底，不因缺少证据抛错", async () => {
    const legacy = legacyRevision({
      items: [{
        subject: "甲", summary: "先核对再判断", limitations: "旧版摘要，本就没有正文偏移",
        rules: [{
          id: "R1", dimension: "mentalModel", observation: "", condition: "信息不足",
          action: "先核对再判断", boundary: "例外未知", evidenceIds: [],
        }],
      }],
    })
    const aura = await publishWorkbenchCharacter("/project", legacy, legacy.items[0])
    expect(aura.name).toBe("甲")
    const input = io.createAura.mock.calls[0][0] as { skillContent?: string; notes?: string }
    expect(input.skillContent).toBe("")
    expect(input.notes).toContain("第 1 章")
  })
  it("迁移条目发布时不写入 Infinity 章节号", async () => {
    const legacy = legacyRevision()
    const aura = await publishWorkbenchCharacter("/project", legacy, legacy.items[0])
    expect(aura.name).toBe("甲")
    expect(JSON.stringify(io.createAura.mock.calls[0][0])).not.toContain("Infinity")
  })
})

const legacyProfile: PersonalityProfile = {
  personality: "沉得住气，先核实再下结论。", motivation: "查清账目。", speechStyle: "短句，少形容词。",
  behaviorPatterns: "信息不足时先核对。", quotes: ["账目不会说谎。"],
}
const legacyPersona = { version: 1 as const, summary: "先核对再判断", scope: "只覆盖前两章", rules: [{
  id: "P1", field: "mentalModel" as const, condition: "信息不足", tendency: "先核对再判断", boundary: "例外未知",
  evidenceIds: ["E1"],
}], evidence: [{ id: "E1", chapterId: "1", quote: "他没有立刻下结论，而是先核对账簿。" }] }

function legacyCharacter(over: Partial<ExtractedCharacter> = {}): ExtractedCharacter {
  return {
    id: "char-1", name: "甲", aliases: [], importance: 9, category: "protagonist",
    firstAppearance: 1, lastAppearance: 3, appearanceCount: 3, description: "旧城巡夜人。",
    personality: "散文字段：克制。", speechStyle: "散文字段：短句。", relationships: [], keyEvents: [],
    corpus: "旧城巡夜，夜里巡街。", ...over,
  }
}
function legacySkill(over: Partial<CharacterSkill> = {}): CharacterSkill {
  return {
    id: "skill-char-1", characterId: "char-1", characterName: "甲",
    skillContent: renderPersonalitySkill("甲", "测试作品", legacyPersona),
    sourceBook: "测试作品", chapterRange: ["1", "3"], createdAt: 1, ...over,
  }
}
/**
 * 旧版（迁移）作品的库对象。默认给「甲」一个 personalityProfile（情况 Y）：
 * 旧版六维路径的角色没有便携人格块，但人格资料在 personalityProfile 里，
 * 只有 aura-adapter 会读它——这正是缺陷 1 的关键。
 */
function legacyBook(over: Partial<BookAnalysisLibraryBook> = {}): BookAnalysisLibraryBook {
  return {
    id: "book-1", path: bookPath,
    metadata: { title: "测试作品", totalChapters: 3, totalWords: 3000, sourceType: "file", createdAt: 1, updatedAt: 2 },
    recognizedCharacters: [], characters: [legacyCharacter({ personalityProfile: legacyProfile })], skills: [],
    styleStatus: "disabled", boundAurasCount: 0, addedAuraCharacterIds: [], evidence: [], ...over,
  }
}

/**
 * 缺陷 1 的回归网：旧版条目必须复用 importBookAnalysisSkillsAsAuras（设计 §5.2），
 * 因为它拿的是真实 ExtractedCharacter，personalityProfile／散文字段的小兜底链才会生效。
 * 若走 publishWorkbenchCharacter 的合成角色路径，skillContent 恒为 ""，
 * 「确认并加入」得到的灵魂没有 SKILL.md 正文（而「加入自定义灵魂库」有）——同一个人两个结果。
 */
describe("旧版角色发布走 aura-adapter 路径（设计 §5.2／§8.1）", () => {
  it("设计 §8.1 情况 Y：只有 personalityProfile、没有 Skill 时 SKILL.md 非空且内容来自人格资料", async () => {
    const book = legacyBook()
    const r = await ensureLegacyCharacterAura("/project", book, "甲")
    expect(r).toEqual({ auraId: "aura-1", auraName: "甲" })
    expect(io.createAura).toHaveBeenCalledTimes(1)
    const input = io.createAura.mock.calls[0][0] as { skillContent: string; name: string; category: string }
    expect(input.name).toBe("甲")
    expect(input.category).toBe("拆书角色")
    // 核心断言：对照「加入自定义灵魂库」，SKILL.md 不能是空串。
    expect(input.skillContent).not.toBe("")
    expect(input.skillContent).toContain("# 角色 Skill - 甲")
    expect(input.skillContent).toContain("沉得住气，先核实再下结论。")
    expect(input.skillContent).toContain("账目不会说谎。")
  })

  it("设计 §8.1 情况 Z：只有散文字段时仍能入库，SKILL.md 为空但字段由散文字段兜底", async () => {
    const book = legacyBook({ characters: [legacyCharacter()] })
    const r = await ensureLegacyCharacterAura("/project", book, "甲")
    expect(r.auraName).toBe("甲")
    expect(io.createAura).toHaveBeenCalledTimes(1)
    const input = io.createAura.mock.calls[0][0] as { skillContent: string; styleDescription: string; corpus: string }
    expect(input.skillContent).toBe("")
    expect(input.styleDescription).toContain("旧城巡夜人。")
    expect(input.corpus).toContain("旧城巡夜，夜里巡街。")
  })

  it("设计 §8.1 情况 X：带便携人格 Skill 时人格内容进入 aura", async () => {
    const book = legacyBook({ skills: [legacySkill()] })
    await ensureLegacyCharacterAura("/project", book, "甲")
    expect(io.createAura).toHaveBeenCalledTimes(1)
    const input = io.createAura.mock.calls[0][0] as {
      portablePersonality?: { summary: string; rules: Array<{ tendency: string }> }
      corpus: string; mentalModel: string
    }
    expect(input.portablePersonality?.summary).toBe("先核对再判断")
    expect(input.portablePersonality?.rules[0].tendency).toBe("先核对再判断")
    expect(input.mentalModel).toContain("先核对再判断")
    expect(input.corpus).toContain("他没有立刻下结论，而是先核对账簿。")
  })

  it("批量「确认并加入」旧版迁移版本时也走 aura-adapter，SKILL.md 非空（情况 Y）", async () => {
    const legacy = legacyRevision()
    const book = legacyBook()
    await saveWorkbenchRevision(bookPath, legacy)
    const preview = await inspectWorkbenchPublication("/project", legacy)
    const confirmed = await confirmWorkbenchRevision("/project", bookPath, legacy.id, preview.fingerprint, book)
    expect(io.createAura).toHaveBeenCalledTimes(1)
    expect(confirmed.publishedIds).toEqual(["aura-1"])
    // 旧版条目没有结构化规则，若复用 publishWorkbenchCharacter 的合成角色，
    // 这里的 skillContent 会是 ""——「确认并加入」也就得到一个没有正文的灵魂。
    const input = io.createAura.mock.calls[0][0] as { skillContent: string; name: string }
    expect(input.name).toBe("甲")
    expect(input.skillContent).not.toBe("")
    expect(input.skillContent).toContain("沉得住气，先核实再下结论。")
  })

  it("批量确认旧版迁移版本时缺少作品资料就拒绝，不创建 aura", async () => {
    const legacy = legacyRevision()
    await saveWorkbenchRevision(bookPath, legacy)
    const preview = await inspectWorkbenchPublication("/project", legacy)
    await expect(confirmWorkbenchRevision("/project", bookPath, legacy.id, preview.fingerprint))
      .rejects.toThrow("旧版迁移版本发布需要作品资料")
    expect(io.createAura).not.toHaveBeenCalled()
  })

  it("旧版角色已在灵魂库时返回既有 auraId，不重复创建", async () => {
    const book = legacyBook()
    const first = await ensureLegacyCharacterAura("/project", book, "甲")
    const second = await ensureLegacyCharacterAura("/project", book, "甲")
    // adapter 对已存在的 aura 会跳过并返回空数组，此时必须查回既有 aura，
    // 否则「已入库但未绑定」的角色永远绑不上（设计 §5.1）。
    expect(second).toEqual(first)
    expect(io.createAura).toHaveBeenCalledTimes(1)
  })

  it("同一批次里同一旧版角色只创建一次 aura", async () => {
    const legacy = legacyRevision({
      items: [
        { subject: "甲", summary: "先核对再判断", limitations: "", rules: [] },
        { subject: "甲", summary: "先核对再判断", limitations: "", rules: [] },
      ],
    })
    const book = legacyBook()
    await saveWorkbenchRevision(bookPath, legacy)
    const preview = await inspectWorkbenchPublication("/project", legacy)
    const confirmed = await confirmWorkbenchRevision("/project", bookPath, legacy.id, preview.fingerprint, book)
    expect(io.createAura).toHaveBeenCalledTimes(1)
    expect(confirmed.publishedIds).toEqual(["aura-1"])
  })

  it("旧版角色不在作品资料里时明确报错", async () => {
    const book = legacyBook({ characters: [legacyCharacter({ name: "乙" })] })
    await expect(ensureLegacyCharacterAura("/project", book, "甲")).rejects.toThrow("找不到旧版角色「甲」")
  })
})
