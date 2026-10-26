// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { DEFAULT_MEMORY_MAINTENANCE, loadMemoryMaintenanceSettings } from "@/lib/novel/memory-maintenance"

const io = vi.hoisted(() => ({
  scan: vi.fn(), apply: vi.fn(async () => 1), undo: vi.fn(async () => {}), keep: vi.fn(async () => {}),
  save: vi.fn(async (_path: string, patch: object) => ({ version: 1, lastRemindedAt: 0, ...patch })),
}))
vi.mock("@/lib/novel/memory-cleanup-runner", () => ({
  runMemoryCleanupScan: io.scan, applyMemoryCleanup: io.apply, undoLastMemoryCleanup: io.undo, keepMemoryCleanupIssue: io.keep, loadMemoryCleanupScan: vi.fn(async () => null),
}))
vi.mock("@/lib/novel/memory-maintenance", async (original) => ({
  ...await original<typeof import("@/lib/novel/memory-maintenance")>(),
  loadMemoryMaintenanceSettings: vi.fn(async () => ({ ...DEFAULT_MEMORY_MAINTENANCE, limits: { ...DEFAULT_MEMORY_MAINTENANCE.limits } })),
  loadMemoryMaintenanceOverview: vi.fn(async () => ({ counts: { cognition: 301, characters: 1, foreshadowing: 1, timeline: 1 }, cognitionChars: 100, totalForeshadowing: 1 })),
  updateMemoryMaintenanceSettings: io.save,
}))
vi.mock("@/components/chat/chat-model-selector", () => ({ ChatModelSelector: () => <button>模型</button> }))
vi.mock("@/lib/novel/model-resolver", () => ({ resolveDefaultModel: vi.fn(() => ({})), resolveModelConfig: vi.fn(() => ({})) }))
vi.mock("@/lib/has-usable-llm", () => ({ hasUsableLlm: () => true }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), info: vi.fn() } }))
import { MemoryCleanupTool } from "./memory-cleanup-tool"

let root: Root, container: HTMLDivElement
const click = async (label: string) => {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label))
  expect(button, label).toBeDefined()
  await act(async () => button!.click())
}
beforeEach(async () => {
  vi.clearAllMocks()
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useWikiStore.setState({ project: { id: "a", name: "甲", path: "/a" }, dataVersion: 0 })
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  vi.spyOn(window, "confirm").mockReturnValue(true)
  io.scan.mockResolvedValue({ version: 1, scannedAt: 1, records: [{ id: "r", field: "knowledgeChanges", chapterNumber: 1, revision: 1, text: "林默知道空泛信息" }], issues: [{ id: "issue", kind: "noise", removeIds: ["r"], reason: "没有具体事实", confidence: "high" }] })
  await act(async () => root.render(<MemoryCleanupTool />))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })
it("展示超量提示、六类扫描选项和可调整提醒阈值", () => {
  expect(container.textContent).toContain("认知条目 301 条")
  expect(container.textContent).toContain("自动提醒与阈值")
  expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(7)
  expect(container.querySelectorAll('input[type="number"]')).toHaveLength(5)
})
it("扫描只展示候选，用户选择并执行后才删除；成功后旧扫描失效", async () => {
  await click("扫描记忆")
  expect(container.textContent).toContain("林默知道空泛信息")
  expect(io.apply).not.toHaveBeenCalled()
  await click("选择高置信度候选")
  await click("清理选中项")
  expect(window.confirm).toHaveBeenCalledOnce()
  expect(io.apply).toHaveBeenCalledWith("/a", expect.any(Object), [expect.objectContaining({ id: "issue" })], expect.any(Function))
  expect(container.textContent).not.toContain("没有具体事实")
})
it("切换项目会取消旧扫描，迟到的结果不显示到新项目", async () => {
  let finish!: (value: unknown) => void
  io.scan.mockImplementation((_path, _config, options) => {
    expect(options.signal.aborted).toBe(false)
    return new Promise((resolve) => { finish = resolve })
  })
  await click("扫描记忆")
  const options = io.scan.mock.calls[0][2]
  await act(async () => useWikiStore.setState({ project: { id: "b", name: "乙", path: "/b" } }))
  expect(options.signal.aborted).toBe(true)
  await act(async () => finish({ version: 1, scannedAt: 1, records: [], issues: [{ id: "late", kind: "noise", removeIds: [], reason: "旧项目的迟到结果", confidence: "high" }] }))
  expect(container.textContent).not.toContain("旧项目的迟到结果")
})
it("MCP 修改设置后刷新面板，但保留用户尚未保存的表单修改", async () => {
  const remote = { ...DEFAULT_MEMORY_MAINTENANCE, limits: { ...DEFAULT_MEMORY_MAINTENANCE.limits, cognition: 500 } }
  vi.mocked(loadMemoryMaintenanceSettings).mockResolvedValueOnce(remote)
  await act(async () => useWikiStore.getState().bumpDataVersion())
  expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe("500")
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
  vi.mocked(loadMemoryMaintenanceSettings).mockResolvedValueOnce({ ...remote, limits: { ...remote.limits, cognition: 650 } })
  await act(async () => useWikiStore.getState().bumpDataVersion())
  expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false)
  expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe("500")
})
