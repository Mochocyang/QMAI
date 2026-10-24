// @vitest-environment jsdom
/**
 * 云同步 store 的关键行为：登录弹窗何时收起、失败数怎么累计、成功态怎么落。
 *
 * 这三条都属于「错了用户会明显感觉到」的地方：
 * - 授权完了弹窗不收 → 用户以为卡住了；
 * - 失败数按全量历史数 → 红点永远擦不掉；
 * - 成功后不记 lastSyncAt → 「上次同步」一直显示空白。
 */

import { beforeEach, describe, expect, it } from "vitest"

import { useCloudSyncStore } from "./cloud-sync-store"
import { DEFAULT_CLOUD_SYNC_CONFIG, emptyCounts, type SyncEntry } from "@/lib/cloud-sync/types"

function entry(overrides: Partial<SyncEntry> = {}): SyncEntry {
  return {
    id: "e1",
    batchId: "b1",
    at: Date.now(),
    direction: "upload",
    path: "QM/entities/林照.md",
    ok: true,
    ...overrides,
  }
}

function status(overrides: { connected?: boolean; failureCount?: number; running?: boolean } = {}) {
  return {
    config: {
      ...DEFAULT_CLOUD_SYNC_CONFIG,
      enabled: true,
      provider: "baidu" as const,
      connected: overrides.connected ?? true,
    },
    running: overrides.running ?? false,
    done: 0,
    total: 0,
    failureCount: overrides.failureCount ?? 0,
    authExpired: false,
  }
}

describe("cloud-sync-store", () => {
  beforeEach(() => {
    useCloudSyncStore.setState({
      config: { ...DEFAULT_CLOUD_SYNC_CONFIG },
      runtime: { running: false, done: 0, total: 0 },
      notice: null,
      batches: [],
      entries: [],
      login: null,
      detailOpen: false,
    })
  })

  it("授权成功后（connected=true）收起等待弹窗", () => {
    useCloudSyncStore.setState({ login: { status: "pending" } })
    useCloudSyncStore.getState().applyStatus(status({ connected: true }))
    expect(useCloudSyncStore.getState().login).toBeNull()
  })

  it("还没连上时保留等待弹窗（别把用户的登录过程关掉）", () => {
    useCloudSyncStore.setState({ login: { status: "pending" } })
    useCloudSyncStore.getState().applyStatus(status({ connected: false }))
    expect(useCloudSyncStore.getState().login).toEqual({ status: "pending" })
  })

  it("失败数只累计本轮条目，不受历史里旧失败影响", () => {
    useCloudSyncStore.setState({
      entries: [entry({ id: "old", batchId: "b0", ok: false })],
      runtime: { running: true, done: 0, total: 2 },
    })
    useCloudSyncStore.getState().appendEntries([entry({ id: "n1" })])
    expect(useCloudSyncStore.getState().runtime.failureCount).toBe(0)
    useCloudSyncStore.getState().appendEntries([entry({ id: "n2", ok: false })])
    expect(useCloudSyncStore.getState().runtime.failureCount).toBe(1)
  })

  it("成功气泡同时刷新「上次同步」并把失败数清零", () => {
    useCloudSyncStore.setState({ runtime: { running: true, done: 3, total: 3, failureCount: 2 } })
    const at = 1_800_000_000_000
    useCloudSyncStore.getState().showNotice({ kind: "success", at, counts: emptyCounts() })
    const state = useCloudSyncStore.getState()
    expect(state.runtime.running).toBe(false)
    expect(state.runtime.failureCount).toBe(0)
    expect(state.config.lastSyncAt).toBe(at)
    expect(state.runtime.recentSuccessAt).toBe(at)
  })

  it("自动同步记账：发起时记时间，失败累加退避次数", async () => {
    // 用假项目登记表：只关心「有没有记账」，不关心真的去同步。
    const store = useCloudSyncStore.getState()
    expect(store.runtime.lastAttemptAt).toBeUndefined()

    useCloudSyncStore.setState({
      runtime: { running: false, lastAttemptAt: 999, consecutiveFailures: 2, lastErrorCode: "net.offline" },
    })
    const state = useCloudSyncStore.getState()
    expect(state.runtime.consecutiveFailures).toBe(2)

    // 成功一次就清零：连续失败计数不清零会导致退避越来越长，最后十分钟才重试。
    state.showNotice({ kind: "success", at: Date.now(), counts: emptyCounts() })
    expect(useCloudSyncStore.getState().runtime.consecutiveFailures).toBe(0)
    expect(useCloudSyncStore.getState().runtime.lastErrorCode).toBeUndefined()
  })

  it("失败气泡不清 lastSyncAt，也不把 authExpired 之外的标记改掉", () => {
    useCloudSyncStore.setState({
      config: { ...DEFAULT_CLOUD_SYNC_CONFIG, lastSyncAt: 123 },
      runtime: { running: true, done: 0, total: 1, authExpired: false },
    })
    useCloudSyncStore.getState().showNotice({ kind: "failure", at: 999, errorCode: "local.locked" })
    const state = useCloudSyncStore.getState()
    expect(state.config.lastSyncAt).toBe(123)
    expect(state.runtime.authExpired).toBe(false)
    expect(state.notice?.errorCode).toBe("local.locked")
  })
})
