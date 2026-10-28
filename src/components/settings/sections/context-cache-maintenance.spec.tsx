// @vitest-environment jsdom
/**
 * 维护工具里的「缓存与孤儿资料」面板：
 * - 没打开项目时提示先打开项目；
 * - 有项目时显示缓存占用、清空缓存、记忆体检三块入口；
 * - 扫描到孤儿后能勾选并清理。
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  measureContextCache: vi.fn(),
  clearContextCache: vi.fn(),
  scanMemoryHealth: vi.fn(),
  deleteOrphanMemorySnapshots: vi.fn(),
  project: { path: "E:/Novel", name: "长夜" } as { path: string; name: string } | null,
}))

vi.mock("@/lib/context-hub/cache-maintenance", () => ({
  measureContextCache: mocks.measureContextCache,
  clearContextCache: mocks.clearContextCache,
}))
vi.mock("@/lib/novel/memory-health", () => ({ scanMemoryHealth: mocks.scanMemoryHealth }))
vi.mock("@/lib/novel/delete-source-memory", () => ({
  deleteOrphanMemorySnapshots: mocks.deleteOrphanMemorySnapshots,
}))
vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: (selector: (state: { project: typeof mocks.project }) => unknown) =>
    selector({ project: mocks.project }),
}))

import { ContextCacheMaintenance } from "./context-cache-maintenance"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function render() {
  await act(async () => {
    root.render(<ContextCacheMaintenance />)
  })
}

function button(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
    item.textContent?.includes(text),
  )
}

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  mocks.project = { path: "E:/Novel", name: "长夜" }
  mocks.measureContextCache.mockReset().mockResolvedValue({ exists: true, fileCount: 12, totalBytes: 2048 })
  mocks.clearContextCache.mockReset().mockResolvedValue({ existed: true, removedFiles: 12 })
  mocks.scanMemoryHealth.mockReset().mockResolvedValue({
    scannedAt: 1,
    snapshotCount: 3,
    chapterCount: 2,
    outlineCount: 1,
    orphans: [
      { snapshotNumber: 3, kind: "chapter", label: "第 3 章" },
      { snapshotNumber: -57, kind: "outline", label: "大纲快照 #-57" },
    ],
  })
  mocks.deleteOrphanMemorySnapshots.mockReset().mockResolvedValue(2)
  vi.spyOn(window, "confirm").mockReturnValue(true)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

describe("缓存与孤儿资料面板", () => {
  it("没打开项目时提示先打开项目", async () => {
    mocks.project = null
    await render()
    expect(host.textContent).toContain("请先打开项目")
  })

  it("显示缓存占用与两块入口", async () => {
    await render()
    expect(host.textContent).toContain("上下文缓存")
    expect(host.textContent).toContain("2.0 KB")
    expect(host.textContent).toContain("12 个文件")
    expect(host.textContent).toContain("记忆体检")
    expect(button("清空缓存")).toBeTruthy()
    expect(button("开始体检")).toBeTruthy()
  })

  it("点清空缓存会删目录并提示结果", async () => {
    await render()
    await act(async () => {
      button("清空缓存")!.click()
    })
    expect(mocks.clearContextCache).toHaveBeenCalledWith("E:/Novel")
    expect(host.textContent).toContain("已清空上下文缓存")
  })

  it("体检后列出孤儿，默认全选，清理按钮可用", async () => {
    await render()
    await act(async () => {
      button("开始体检")!.click()
    })
    expect(host.textContent).toContain("第 3 章")
    expect(host.textContent).toContain("大纲快照 #-57")
    expect(button("清理选中（2）")).toBeTruthy()

    await act(async () => {
      button("清理选中")!.click()
    })
    expect(mocks.deleteOrphanMemorySnapshots).toHaveBeenCalledWith("E:/Novel", [3, -57])
    expect(host.textContent).toContain("已清理 2 条孤儿记忆来源")
  })

  it("没有孤儿时给出「一致」的结论", async () => {
    mocks.scanMemoryHealth.mockResolvedValue({
      scannedAt: 1,
      snapshotCount: 2,
      chapterCount: 2,
      outlineCount: 1,
      orphans: [],
    })
    await render()
    await act(async () => {
      button("开始体检")!.click()
    })
    expect(host.textContent).toContain("没有发现孤儿记忆")
  })
})
