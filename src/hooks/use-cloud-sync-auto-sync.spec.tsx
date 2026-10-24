// @vitest-environment jsdom
/**
 * 自动同步接线：真正把「落盘 / 聚焦 / 刚连上」变成一次同步调用的地方。
 *
 * 纯判定逻辑在 scheduler.spec.ts 里测过了，这里只守接线：
 * 去抖是否真的合并了、聚焦是否真的触发、清理是否干净。
 * 接线断了的表现很隐蔽——界面一切正常，只是永远不会自动同步。
 */

import * as ReactDOM from "react-dom/client"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useCloudSyncAutoSync } from "./use-cloud-sync-auto-sync"
import { notifyProjectSaved, resetProjectSavedListenersForTest } from "@/lib/cloud-sync/save-signal"
import { SAVE_DEBOUNCE_MS } from "@/lib/cloud-sync/scheduler"
import { DEFAULT_CLOUD_SYNC_CONFIG } from "@/lib/cloud-sync/types"
import { useCloudSyncStore } from "@/stores/cloud-sync-store"

vi.mock("@/lib/platform", () => ({ isTauri: () => true }))

function Harness() {
  useCloudSyncAutoSync()
  return null
}

let container: HTMLDivElement
let root: ReactDOM.Root | null = null
let runNow: ReturnType<typeof vi.fn>

async function mount(): Promise<void> {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = ReactDOM.createRoot(container)
  await act(async () => {
    root?.render(<Harness />)
  })
}

async function unmount(): Promise<void> {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container.remove()
}

function connectedState(): void {
  useCloudSyncStore.setState({
    config: { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true, connected: true, provider: "folder" },
    runtime: { running: false },
    // 接线只关心「被调用」，这里替换掉真实实现（它会去读项目登记表）。
    runNowFromRegistry: runNow as never,
  })
}

describe("useCloudSyncAutoSync", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetProjectSavedListenersForTest()
    runNow = vi.fn(async () => {})
    connectedState()
    // 让 `act` 认得这是 React 环境。
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    if (root) await unmount()
    vi.useRealTimers()
    resetProjectSavedListenersForTest()
  })

  it("落盘后等去抖时间再同步一次", async () => {
    await mount()
    act(() => notifyProjectSaved())
    expect(runNow).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS)
    })
    expect(runNow).toHaveBeenCalledTimes(1)
    expect(runNow).toHaveBeenCalledWith("editor-save")
  })

  it("连续落盘只合并成一次同步", async () => {
    await mount()
    act(() => {
      notifyProjectSaved()
      vi.advanceTimersByTime(2_000)
      notifyProjectSaved()
      vi.advanceTimersByTime(2_000)
      notifyProjectSaved()
    })
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS)
    })
    expect(runNow).toHaveBeenCalledTimes(1)
  })

  it("窗口重新聚焦触发一次同步", async () => {
    await mount()
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(runNow).toHaveBeenCalledWith("window-focus")
  })

  it("后端推一份状态不会抹掉上次尝试时间：聚焦节流仍然生效", async () => {
    await mount()
    // 上一轮同步真发生在 1 秒前，还远没到 120s 的聚焦节流。
    useCloudSyncStore.setState({
      runtime: { ...useCloudSyncStore.getState().runtime, lastAttemptAt: Date.now() - 1_000 },
    })
    // 每轮同步开始/结束、每次改配置，后端都会把整份状态推过来。
    act(() => {
      useCloudSyncStore.getState().applyStatus({
        config: { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true, connected: true, provider: "folder" },
        running: false,
        done: 0,
        total: 0,
        failureCount: 0,
        authExpired: false,
      })
    })
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    // 曾经这里会重新同步一轮：状态推送把 lastAttemptAt 重建掉了，
    // 于是「切窗口 → 同步 → 推送状态 → 再切窗口 → 再同步」无限循环。
    expect(runNow).not.toHaveBeenCalled()
  })

  it("正在同步时聚焦不重复触发", async () => {
    useCloudSyncStore.setState({ runtime: { running: true } })
    await mount()
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(runNow).not.toHaveBeenCalled()
  })

  it("刚连上网盘（connected 由假变真）立刻同步一轮", async () => {
    useCloudSyncStore.setState({
      config: { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true, connected: false },
      runtime: { running: false },
      runNowFromRegistry: runNow as never,
    })
    await mount()
    await act(async () => {
      useCloudSyncStore.setState({
        config: { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true, connected: true, provider: "folder" },
      })
    })
    expect(runNow).toHaveBeenCalledWith("first-connect")
  })

  it("卸载后不再有任何调用与定时器", async () => {
    await mount()
    act(() => notifyProjectSaved())
    await unmount()

    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 3)
      window.dispatchEvent(new Event("focus"))
      notifyProjectSaved()
    })
    expect(runNow).not.toHaveBeenCalled()
  })
})
