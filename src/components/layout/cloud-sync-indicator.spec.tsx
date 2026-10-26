// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CloudSyncIndicator } from "./cloud-sync-indicator"
import { DEFAULT_CLOUD_SYNC_CONFIG, emptyCounts } from "@/lib/cloud-sync/types"
import { useCloudSyncStore } from "@/stores/cloud-sync-store"

// React 19 需要这个标记，act(...) 才不报警告（跟仓库里其它组件 spec 一致）。
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/lib/platform", () => ({ isTauri: () => false, isMacOS: () => false }))

let host: HTMLDivElement
let root: Root

function render() {
  act(() => {
    root.render(<CloudSyncIndicator />)
  })
}

function entryButton(): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(".ui-test-cloud-entry")
}

const connectedConfig = {
  ...DEFAULT_CLOUD_SYNC_CONFIG,
  enabled: true,
  provider: "folder" as const,
  connected: true,
}

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  useCloudSyncStore.setState({
    config: { ...DEFAULT_CLOUD_SYNC_CONFIG },
    runtime: { running: false },
    notice: null,
    detailOpen: false,
    login: null,
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

describe("CloudSyncIndicator", () => {
  it("开关关闭时完全不渲染（右上角保持原样）", () => {
    render()
    expect(entryButton()).toBeNull()
  })

  it("未登录是稳定态：灰度图标 + 「未登录」文案，不显示错误点", () => {
    useCloudSyncStore.setState({ config: { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true, connected: false } })
    render()
    const button = entryButton()
    expect(button?.dataset.cloudSyncState).toBe("login-required")
    expect(button?.getAttribute("aria-label")).toContain("未登录")
    expect(host.querySelector(".ui-test-cloud-badge")).toBeNull()
  })

  it("就绪态点击图标打开同步详情", () => {
    useCloudSyncStore.setState({ config: connectedConfig, runtime: { running: false } })
    render()
    expect(entryButton()?.dataset.cloudSyncState).toBe("ready")
    act(() => entryButton()!.click())
    expect(useCloudSyncStore.getState().detailOpen).toBe(true)
  })

  it("同步中把进度写进 aria-label", () => {
    useCloudSyncStore.setState({ config: connectedConfig, runtime: { running: true, done: 7, total: 19 } })
    render()
    const button = entryButton()
    expect(button?.dataset.cloudSyncState).toBe("syncing")
    expect(button?.getAttribute("aria-label")).toContain("7/19")
  })

  it("有失败项显示红点", () => {
    useCloudSyncStore.setState({ config: connectedConfig, runtime: { running: false, failureCount: 2 } })
    render()
    expect(entryButton()?.dataset.cloudSyncState).toBe("attention")
    expect(host.querySelector(".ui-test-cloud-badge.is-error")).toBeTruthy()
  })

  it("授权过期显示黄点，且指向重新登录", () => {
    useCloudSyncStore.setState({ config: connectedConfig, runtime: { running: false, authExpired: true } })
    render()
    expect(entryButton()?.dataset.cloudSyncState).toBe("auth-expired")
    expect(host.querySelector(".ui-test-cloud-badge.is-warn")).toBeTruthy()
    expect(entryButton()?.getAttribute("aria-label")).toContain("重新登录")
  })

  it("同步成功不再弹气泡（只有图标态，不打搅用户）", () => {
    useCloudSyncStore.setState({ config: connectedConfig, runtime: { running: false } })
    render()
    act(() => {
      useCloudSyncStore.getState().showNotice({
        kind: "success",
        at: Date.now(),
        counts: { ...emptyCounts(), upload: 5, download: 2 },
      })
    })
    expect(host.querySelector("[data-cloud-sync-notice]")).toBeNull()
    expect(host.querySelector(".ui-test-cloud-bubble")).toBeNull()
    // 图标回到「已就绪」，不因为一次成功就长期停在别的状态。
    expect(entryButton()?.dataset.cloudSyncState).toBe("ready")
  })

  it("整轮失败（没有逐项记录）也让图标变红，点击打开详情", () => {
    useCloudSyncStore.setState({ config: connectedConfig, runtime: { running: false, failureCount: 0 } })
    render()
    act(() => {
      useCloudSyncStore.getState().showNotice({
        kind: "failure",
        at: Date.now(),
        errorCode: "net.offline",
        counts: emptyCounts(),
      })
    })
    // 没有气泡，但状态必须是 attention（CSS 会把它染红）
    expect(host.querySelector("[data-cloud-sync-notice]")).toBeNull()
    expect(entryButton()?.dataset.cloudSyncState).toBe("attention")
    expect(entryButton()?.getAttribute("aria-label")).toContain("检查网络")

    act(() => entryButton()!.click())
    expect(useCloudSyncStore.getState().detailOpen).toBe(true)
  })

  it("成功之后失败态不会残留（新 notice 覆盖旧 notice）", () => {
    useCloudSyncStore.setState({ config: connectedConfig, runtime: { running: false } })
    render()
    act(() => {
      useCloudSyncStore.getState().showNotice({ kind: "failure", at: Date.now(), errorCode: "net.offline" })
    })
    expect(entryButton()?.dataset.cloudSyncState).toBe("attention")
    act(() => {
      useCloudSyncStore.getState().showNotice({ kind: "success", at: Date.now(), counts: emptyCounts() })
    })
    expect(entryButton()?.dataset.cloudSyncState).toBe("ready")
  })
})
