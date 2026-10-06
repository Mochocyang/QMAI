import { beforeEach, describe, expect, it, vi } from "vitest"
import { sha256Text } from "@/lib/context-hub/fingerprint"
import { inspectWorkbenchPublication, confirmWorkbenchRevision, publishWorkbenchCharacter } from "./workbench-publish"
import { saveWorkbenchRevision, workbenchRevisionPath } from "./workbench-storage"
import { buildEvidenceCandidates, type WorkbenchRevision } from "./workbench-core"
import { upsertWritingStylePreset } from "../writing-style-store"

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
    await confirmWorkbenchRevision("/project", bookPath, legacy.id, preview.fingerprint)
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
