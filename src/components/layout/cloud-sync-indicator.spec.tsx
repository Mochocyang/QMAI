// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CloudSyncIndicator, SYNC_SUCCESS_BUBBLE_MS } from "./cloud-sync-indicator"
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

  it("成功气泡在图标下方出现，4 秒后自动消失", () => {
    vi.useFakeTimers()
    useCloudSyncStore.setState({ config: connectedConfig, runtime: { running: false } })
    render()
    act(() => {
      useCloudSyncStore.getState().showNotice({
        kind: "success",
        at: Date.now(),
        counts: { ...emptyCounts(), upload: 5, download: 2 },
      })
    })
    const bubble = host.querySelector('[data-cloud-sync-notice="success"]')
    expect(bubble?.textContent).toContain("已同步 7 项")

    act(() => {
      vi.advanceTimersByTime(SYNC_SUCCESS_BUBBLE_MS + 10)
    })
    expect(useCloudSyncStore.getState().notice).toBeNull()
  })

  it("失败气泡不会自动消失，并且带「查看详情」", () => {
    vi.useFakeTimers()
    useCloudSyncStore.setState({ config: connectedConfig, runtime: { running: false } })
    render()
    act(() => {
      useCloudSyncStore.getState().showNotice({
        kind: "failure",
        at: Date.now(),
        errorCode: "net.offline",
        counts: emptyCounts(),
      })
    })
    const bubble = host.querySelector('[data-cloud-sync-notice="failure"]')
    expect(bubble?.textContent).toContain("检查网络")

    act(() => {
      vi.advanceTimersByTime(SYNC_SUCCESS_BUBBLE_MS * 3)
    })
    expect(useCloudSyncStore.getState().notice).not.toBeNull()
    expect(bubble?.textContent).toContain("查看详情")
  })

  it("鼠标悬停时暂停成功气泡的计时", () => {
    vi.useFakeTimers()
    useCloudSyncStore.setState({ config: connectedConfig, runtime: { running: false } })
    render()
    act(() => {
      useCloudSyncStore.getState().showNotice({ kind: "success", at: Date.now(), counts: emptyCounts() })
    })
    const bubble = host.querySelector('[data-cloud-sync-notice="success"]')!
    act(() => {
      // React 用 mouseover 委托 onMouseEnter，直接派发 mouseenter 不会命中。
      bubble.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    })
    act(() => {
      vi.advanceTimersByTime(SYNC_SUCCESS_BUBBLE_MS * 2)
    })
    expect(useCloudSyncStore.getState().notice).not.toBeNull()
  })

  it("点失败气泡的「重新登录」会把授权过期态复位成未连接", () => {
    useCloudSyncStore.setState({ config: connectedConfig, runtime: { running: false, authExpired: true } })
    render()
    act(() => {
      useCloudSyncStore.getState().showNotice({ kind: "failure", at: Date.now(), errorCode: "auth.expired" })
    })
    const bubble = host.querySelector('[data-cloud-sync-notice="failure"]')!
    const relogin = [...bubble.querySelectorAll("button")].find((item) => item.textContent === "重新登录")!
    act(() => relogin.click())
    expect(useCloudSyncStore.getState().notice).toBeNull()
  })
})
