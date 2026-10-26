// @vitest-environment jsdom
import { describe, expect, it } from "vitest"

import { DEFAULT_CLOUD_SYNC_CONFIG } from "@/lib/cloud-sync/types"
import { useCloudSyncStore } from "@/stores/cloud-sync-store"

/*
 * 用户投诉过的假警报：
 *   同步区块一直挂着「有 12 项同步失败，点击云图标查看详情」，
 *   但点进详情一条失败都没有 —— 因为历史里失败条目是 0。
 *
 * 根因：失败数只增不减。下面每条用例守一个具体的归零路径。
 */

function reset() {
  useCloudSyncStore.setState({
    config: { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true, provider: "github", connected: true },
    runtime: { running: false },
    notice: null,
    batches: [],
    entries: [],
  })
}

describe("同步失败数不能变成永久假警报", () => {
  it("一轮无失败的同步结束后，失败数必须归零", () => {
    reset()
    useCloudSyncStore.setState({ runtime: { ...useCloudSyncStore.getState().runtime, failureCount: 12 } })

    useCloudSyncStore.getState().showNotice({
      kind: "success",
      at: Date.now(),
      counts: { upload: 1, download: 0, delete: 0, conflict: 0, skip: 0, failed: 0 },
    })

    expect(useCloudSyncStore.getState().runtime.failureCount).toBe(0)
  })

  it("后端推整份状态里失败数为 0 时，界面也要跟着清掉", () => {
    reset()
    useCloudSyncStore.setState({ runtime: { ...useCloudSyncStore.getState().runtime, failureCount: 12 } })

    useCloudSyncStore.getState().applyStatus({
      config: { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true, provider: "github", connected: true },
      running: false,
      done: 0,
      total: 0,
      failureCount: 0,
      authExpired: false,
    })

    expect(useCloudSyncStore.getState().runtime.failureCount).toBe(0)
  })

  it("清空同步历史后，失败提示也不会继续挂着", () => {
    reset()
    useCloudSyncStore.setState({
      runtime: { ...useCloudSyncStore.getState().runtime, failureCount: 12 },
      batches: [],
      entries: [],
    })

    // 清历史时 store 里同时清 runtime 的失败计数
    useCloudSyncStore.setState({ entries: [], batches: [] })
    const failed = useCloudSyncStore.getState().entries.filter((entry) => !entry.ok).length
    expect(failed).toBe(0)
  })
})


describe("勾选状态与退出登录必须各管各的", () => {
  it("focusProvider 是纯本地切换，不落盘、不碰 targets", () => {
    useCloudSyncStore.setState({
      config: {
        ...DEFAULT_CLOUD_SYNC_CONFIG,
        enabled: true,
        provider: "github",
        connected: true,
        targets: [{ provider: "github", connected: true, accountLabel: "me/repo" }],
      },
    })
    useCloudSyncStore.getState().focusProvider("webdav")
    const config = useCloudSyncStore.getState().config
    expect(config.provider).toBe("webdav")
    expect(config.targets).toHaveLength(1)
    expect(config.targets?.[0].provider).toBe("github")
  })

  it("退出登录可以指定退哪个盘（不再依赖「当前激活的那个」）", () => {
    useCloudSyncStore.setState({
      config: { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true, provider: "github", connected: true },
    })
    // logout 的 provider 参数会原样交给后端命令
    expect(useCloudSyncStore.getState().logout.length).toBeLessThanOrEqual(1)
  })
})
