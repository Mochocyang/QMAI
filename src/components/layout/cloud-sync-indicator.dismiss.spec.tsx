// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_CLOUD_SYNC_CONFIG, type SyncBatch, type SyncEntry } from "@/lib/cloud-sync/types"
import { useCloudSyncStore } from "@/stores/cloud-sync-store"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }))
vi.mock("@/lib/platform", () => ({ isTauri: () => true }))

import { CloudSyncIndicator } from "./cloud-sync-indicator"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function failedBatch(provider: string): SyncBatch {
  return {
    batchId: `b-${provider}`,
    startedAt: Date.now(),
    trigger: "manual",
    state: "failed",
    counts: { upload: 0, download: 0, delete: 0, conflict: 0, skip: 0, failed: 1 },
    provider: provider as never,
  }
}

function failedEntry(batchId: string): SyncEntry {
  return {
    id: `${batchId}-e`,
    batchId,
    at: Date.now(),
    direction: "upload",
    path: "长夜/QM/chapters/001.md",
    ok: false,
    errorCode: "github.network",
  }
}

describe("同步失败下拉的关闭行为", () => {
  let host: HTMLDivElement
  let root: Root

  function mount() {
    act(() => {
      root.render(<CloudSyncIndicator />)
    })
  }

  function openDropdown() {
    const button = host.querySelector<HTMLButtonElement>(".ui-test-cloud-entry")!
    act(() => button.click())
    return host.querySelector('[data-ui="cloud-sync-failure-list"]')
  }

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    useCloudSyncStore.setState({
      config: { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true, provider: "github", connected: true },
      runtime: { running: false, failureCount: 1 },
      batches: [failedBatch("github")],
      entries: [failedEntry("b-github")],
      notice: null,
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.clearAllMocks()
  })

  it("有失败时点图标会打开下拉", () => {
    mount()
    expect(openDropdown()).toBeTruthy()
  })

  it("再点一次图标就关掉（同一个按钮要能开关）", () => {
    mount()
    openDropdown()
    const button = host.querySelector<HTMLButtonElement>(".ui-test-cloud-entry")!
    act(() => button.click())
    expect(host.querySelector('[data-ui="cloud-sync-failure-list"]')).toBeNull()
  })

  it("点页面别处会关掉", () => {
    mount()
    openDropdown()
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    })
    expect(host.querySelector('[data-ui="cloud-sync-failure-list"]')).toBeNull()
  })

  it("按 Esc 会关掉", () => {
    mount()
    openDropdown()
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    expect(host.querySelector('[data-ui="cloud-sync-failure-list"]')).toBeNull()
  })

  it("点下拉内部不会误关（否则点不到里面的按钮）", () => {
    mount()
    const list = openDropdown()!
    act(() => {
      list.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    })
    expect(host.querySelector('[data-ui="cloud-sync-failure-list"]')).toBeTruthy()
  })

  it("「知道了」和「查看全部」仍然能关掉", () => {
    mount()
    openDropdown()
    const dismiss = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "知道了",
    )!
    act(() => dismiss.click())
    expect(host.querySelector('[data-ui="cloud-sync-failure-list"]')).toBeNull()
  })
})
