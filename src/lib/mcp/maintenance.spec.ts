import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { registerOpenDocument } from "./open-document"

vi.mock("@/commands/fs", () => ({ fileExists: vi.fn(async () => false), readFile: vi.fn(), createDirectory: vi.fn(), writeFileAtomic: vi.fn() }))
vi.mock("@/lib/project-refresh", () => ({ refreshProjectState: vi.fn() }))
vi.mock("@/lib/novel/memory-cleanup-runner", () => ({
  loadMemoryCleanupScan: vi.fn(), runMemoryCleanupScan: vi.fn(), applyMemoryCleanup: vi.fn(), keepMemoryCleanupIssue: vi.fn(), undoLastMemoryCleanup: vi.fn(),
}))
vi.mock("@/lib/novel/memory-maintenance", async (original) => {
  const actual = await original<typeof import("@/lib/novel/memory-maintenance")>()
  return { ...actual, loadMemoryMaintenanceOverview: vi.fn(), loadMemoryMaintenanceSettings: vi.fn(), updateMemoryMaintenanceSettings: vi.fn() }
})
vi.mock("./maintenance-progress", () => ({
  lastMemoryCleanupId: vi.fn(async () => "cleanup-1"), maintenanceProgressStore: { active: vi.fn(() => null), start: vi.fn(), get: vi.fn(), stop: vi.fn() },
}))
import { dispatchMaintenanceTool } from "./maintenance"
import { loadMemoryCleanupScan, keepMemoryCleanupIssue } from "@/lib/novel/memory-cleanup-runner"
import { DEFAULT_MEMORY_MAINTENANCE, loadMemoryMaintenanceOverview, loadMemoryMaintenanceSettings, updateMemoryMaintenanceSettings } from "@/lib/novel/memory-maintenance"
import { maintenanceProgressStore } from "./maintenance-progress"

const scan = { version: 1 as const, scanId: "scan-1", scannedAt: 1, records: [
  { id: "r1", chapterNumber: 1, field: "knowledgeChanges" as const, text: "重复事实", revision: 1 },
  { id: "r2", chapterNumber: 2, field: "knowledgeChanges" as const, text: "保留事实", revision: 1 },
], issues: [{ id: "issue-1", kind: "duplicate" as const, removeIds: ["r1"], keepId: "r2", reason: "同一事实", confidence: "high" as const }] }
beforeEach(() => {
  vi.clearAllMocks()
  useWikiStore.setState({ project: { path: "/book", name: "测试书" } as never, selectedFile: null,
    llmConfig: { provider: "custom", model: "other", apiKey: "private-secret", customEndpoint: "https://example.test/v1", ollamaUrl: "", maxContextSize: 8192 },
    providerConfigs: { custom: { enabled: true, apiKey: "private-secret", savedModels: [{ id: "luna", model: "luna", name: "Luna", createdAt: 1 }] } },
  })
  vi.mocked(loadMemoryCleanupScan).mockResolvedValue(scan)
  vi.mocked(loadMemoryMaintenanceSettings).mockResolvedValue(structuredClone(DEFAULT_MEMORY_MAINTENANCE))
  vi.mocked(loadMemoryMaintenanceOverview).mockResolvedValue({ counts: { cognition: 301, characters: 1, foreshadowing: 1, timeline: 1 }, cognitionChars: 50, totalForeshadowing: 1 })
})
afterEach(() => { registerOpenDocument(null); useWikiStore.setState({ project: null, selectedFile: null, providerConfigs: {} }) })

describe("MCP maintenance boundary", () => {
  it("exposes status and model IDs without leaking provider credentials", async () => {
    const text = await dispatchMaintenanceTool("get_maintenance_status", {})
    expect(text).not.toContain("private-secret")
    expect(JSON.parse(text)).toMatchObject({ projectPath: "/book", warnings: ["认知条目 301 条（阈值 300）"], availableModels: [{ id: "custom/luna", name: "Luna", provider: "custom" }] })
  })
  it("requires the opened project and valid models before scheduling a scan", async () => {
    await expect(dispatchMaintenanceTool("scan_memory_cleanup", { projectPath: "/other" })).rejects.toThrow("当前打开")
    await expect(dispatchMaintenanceTool("scan_memory_cleanup", { model: "missing/model" })).rejects.toThrow("找不到可用")
    await expect(dispatchMaintenanceTool("scan_memory_cleanup", { fromChapter: 10, toChapter: 1 })).rejects.toThrow("不能大于")
    await expect(dispatchMaintenanceTool("scan_memory_cleanup", { fields: [] })).rejects.toThrow("非空")
    expect(maintenanceProgressStore.start).not.toHaveBeenCalled()
    await dispatchMaintenanceTool("scan_memory_cleanup", { model: "custom/luna", fromChapter: 1, toChapter: 2 })
    expect(maintenanceProgressStore.start).toHaveBeenCalledWith({ projectPath: "/book", operation: "scan", model: "custom/luna" }, expect.any(Function), expect.any(Function))
    expect(useWikiStore.getState().llmConfig.model).toBe("other")
  })
  it("pages reviewable source records and rejects stale scans or unknown issue IDs", async () => {
    const result = JSON.parse(await dispatchMaintenanceTool("get_memory_cleanup_result", { scanId: "scan-1", limit: 1 }))
    expect(result.issues[0]).toMatchObject({ remove: [{ id: "r1", category: "人物认知" }], keep: { id: "r2" } })
    expect(result.hasMore).toBe(false)
    await expect(dispatchMaintenanceTool("apply_memory_cleanup", { scanId: "old", issueIds: ["issue-1"] })).rejects.toThrow("已过期")
    await expect(dispatchMaintenanceTool("apply_memory_cleanup", { scanId: "scan-1", issueIds: ["unknown"] })).rejects.toThrow("不存在")
    await expect(dispatchMaintenanceTool("apply_memory_cleanup", { scanId: "scan-1", issueIds: [] })).rejects.toThrow("1–100")
    expect(maintenanceProgressStore.start).not.toHaveBeenCalled()
  })
  it("refuses to overwrite dirty memory editors and requires the matching undo ID", async () => {
    const path = "/book/wiki/memory/character-cognition.md"
    useWikiStore.setState({ selectedFile: path })
    registerOpenDocument({ path, isDirty: () => true, applyMarkdown: vi.fn() })
    await expect(dispatchMaintenanceTool("apply_memory_cleanup", { scanId: "scan-1", issueIds: ["issue-1"] })).rejects.toThrow("未保存")
    registerOpenDocument(null)
    await expect(dispatchMaintenanceTool("undo_memory_cleanup", { cleanupId: "other" })).rejects.toThrow("已变化")
    expect(maintenanceProgressStore.start).not.toHaveBeenCalled()
  })
  it("keeps reviewed issues only and merges threshold updates without changing reminder time", async () => {
    await dispatchMaintenanceTool("keep_memory_cleanup_issues", { scanId: "scan-1", issueIds: ["issue-1"] })
    expect(keepMemoryCleanupIssue).toHaveBeenCalledWith("/book", scan.issues[0])
    await dispatchMaintenanceTool("update_maintenance_settings", { limits: { cognition: 400 } })
    expect(updateMemoryMaintenanceSettings).toHaveBeenCalledWith("/book", { limits: { ...DEFAULT_MEMORY_MAINTENANCE.limits, cognition: 400 } })
    await expect(dispatchMaintenanceTool("update_maintenance_settings", { limits: { arbitrary: 4 } })).rejects.toThrow("未知")
  })
  it("can query an original project run after switching books", async () => {
    await dispatchMaintenanceTool("get_maintenance_progress", { projectPath: "/other", runId: "run-1", afterRevision: 3, waitMs: 30000 })
    expect(maintenanceProgressStore.get).toHaveBeenCalledWith({ projectPath: "/other", runId: "run-1", afterRevision: 3, waitMs: 30000 })
    await expect(dispatchMaintenanceTool("get_maintenance_progress", { runId: "x", waitMs: 30001 })).rejects.toThrow("waitMs")
  })
})
