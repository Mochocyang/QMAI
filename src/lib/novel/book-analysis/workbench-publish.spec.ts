import { beforeEach, describe, expect, it, vi } from "vitest"
import { sha256Text } from "@/lib/context-hub/fingerprint"
import { inspectWorkbenchPublication, confirmWorkbenchRevision } from "./workbench-publish"
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
  loadCharacterAuraStore: async () => ({ customAuras: io.auras, bindings: [] }),
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
})
