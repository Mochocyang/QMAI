// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"

const mock = vi.hoisted(() => ({
  overview: vi.fn(async () => ({ counts: { cognition: 301, characters: 1, foreshadowing: 1, timeline: 1 }, cognitionChars: 100, totalForeshadowing: 1 })),
  claim: vi.fn(async () => ["认知条目 301 条"]),
  toast: vi.fn(), subscribe: vi.fn(() => () => {}),
}))
vi.mock("@/commands/fs", async (original) => ({ ...await original<typeof import("@/commands/fs")>(), subscribeProjectFileMutations: mock.subscribe }))
vi.mock("@/lib/toast", () => ({ toast: { info: mock.toast } }))
vi.mock("@/lib/novel/memory-maintenance", () => ({ loadMemoryMaintenanceOverview: mock.overview, claimMemoryMaintenanceReminder: mock.claim }))
import { MemoryMaintenanceReminder } from "./memory-maintenance-reminder"

let root: Root
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers()
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useWikiStore.setState({ project: { id: "a", name: "甲", path: "/a" }, novelMode: true, dataVersion: 0, activeView: "wiki" })
  root = createRoot(document.createElement("div"))
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers() })
it("打开项目后自动检查，提醒按钮直接进入维护工具", async () => {
  await act(async () => root.render(<MemoryMaintenanceReminder />))
  await act(async () => vi.advanceTimersByTimeAsync(1500))
  expect(mock.toast).toHaveBeenCalledOnce()
  const options = mock.toast.mock.calls[0][1] as { action: { onClick: () => void } }
  act(() => options.action.onClick())
  expect(useWikiStore.getState().activeView).toBe("maintenance")
})
it("切换项目后旧提醒不能将新项目带入旧任务", async () => {
  await act(async () => root.render(<MemoryMaintenanceReminder />))
  await act(async () => vi.advanceTimersByTimeAsync(1500))
  const options = mock.toast.mock.calls[0][1] as { action: { onClick: () => void } }
  act(() => useWikiStore.setState({ project: { id: "b", name: "乙", path: "/b" }, activeView: "wiki" }))
  act(() => options.action.onClick())
  expect(useWikiStore.getState().activeView).toBe("wiki")
})
it("记忆更新触发重新检查；冷却期内不发提醒，关闭小说模式后停止", async () => {
  mock.claim.mockResolvedValueOnce([])
  await act(async () => root.render(<MemoryMaintenanceReminder />))
  await act(async () => vi.advanceTimersByTimeAsync(1500))
  expect(mock.toast).not.toHaveBeenCalled()
  act(() => useWikiStore.getState().bumpDataVersion())
  await act(async () => vi.advanceTimersByTimeAsync(1500))
  expect(mock.toast).toHaveBeenCalledOnce()
  act(() => useWikiStore.setState({ novelMode: false }))
  act(() => useWikiStore.getState().bumpDataVersion())
  await act(async () => vi.advanceTimersByTimeAsync(1500))
  expect(mock.toast).toHaveBeenCalledOnce()
})
