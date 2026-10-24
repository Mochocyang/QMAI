/**
 * 云同步的前端状态（zustand）。
 *
 * 分工：
 * - 这里只保存「后端告诉我什么」+「界面开关」；不做同步逻辑。
 * - 真正的同步在 Rust；本 store 通过 client.ts 调用命令、订阅事件。
 */

import { create } from "zustand"

import {
  beginCloudSyncLogin,
  cancelCloudSyncLogin,
  clearCloudSyncHistory,
  connectCloudSyncFolder,
  connectCloudSyncWebdav,
  getCloudSyncConfig,
  getCloudSyncStatus,
  logoutCloudSync,
  readCloudSyncHistory,
  resolveCloudSyncConflict,
  type ResolveConflictResult,
  runCloudSyncNow,
  setCloudSyncConfig,
  stopCloudSync,
  subscribeCloudSync,
  type CloudSyncProjectRef,
  type CloudSyncStatus,
  type ConnectResult,
} from "@/lib/cloud-sync/client"
import type { CloudSyncRuntime } from "@/lib/cloud-sync/status"
import { isProviderAvailable } from "@/lib/cloud-sync/providers"
import {
  DEFAULT_CLOUD_SYNC_CONFIG,
  enabledTargets,
  emptyCounts,
  normalizeCloudSyncConfig,
  type CloudProviderId,
  type CloudSyncConfig,
  type CloudSyncNotice,
  type SyncBatch,
  type SyncEntry,
  type SyncTrigger,
} from "@/lib/cloud-sync/types"

export interface CloudSyncLoginState {
  status: "pending" | "error"
  errorCode?: string
}

interface CloudSyncStoreState {
  config: CloudSyncConfig
  runtime: CloudSyncRuntime
  loaded: boolean
  saving: boolean
  login: CloudSyncLoginState | null
  notice: CloudSyncNotice | null
  batches: SyncBatch[]
  entries: SyncEntry[]
  detailOpen: boolean

  /** 启动时拉一次配置 + 状态 + 历史，并订阅事件。 */
  hydrate: () => Promise<void>
  /** 卸载时调用，清掉事件订阅。 */
  teardown: () => void

  /** 开关：打开/关闭；关闭时同时停掉引擎与排队任务。 */
  setEnabled: (enabled: boolean) => Promise<void>
  patchConfig: (patch: Partial<CloudSyncConfig>) => Promise<CloudSyncConfig>
  setProvider: (provider: CloudSyncConfig["provider"]) => Promise<void>
  /** 勾选/取消一个网盘：取消后它不再参与同步，但已保存的凭据不删。 */
  toggleTarget: (provider: CloudProviderId) => Promise<void>
  setScope: (scope: CloudSyncConfig["scope"]) => Promise<void>
  setIncludeSnapshots: (include: boolean) => Promise<void>

  beginLogin: () => Promise<void>
  cancelLogin: () => Promise<void>
  connectWebdav: (input: { url: string; user: string; password: string }) => Promise<ConnectResult>
  connectFolder: (path: string) => Promise<ConnectResult>
  logout: () => Promise<void>

  runNow: (projects: CloudSyncProjectRef[], trigger?: SyncTrigger) => Promise<void>
  /** 从项目登记表取书单后同步（「仅当前书籍」在这里筛）。 */
  runNowFromRegistry: (trigger?: SyncTrigger) => Promise<void>
  retry: (entryIds: string[]) => Promise<void>
  /** 逐项定夺冲突：`local` 保留本地这份，`cloud` 改用云端那份。 */
  resolveConflict: (input: {
    projectId: string
    projectPath: string
    bookName?: string
    rel: string
    choice: "local" | "cloud"
    provider?: CloudProviderId | null
  }) => Promise<ResolveConflictResult>
  /** 重新读一次同步历史（同步结束、打开详情面板时用）。 */
  refreshHistory: () => Promise<void>
  clearHistory: () => Promise<void>

  applyStatus: (status: CloudSyncStatus) => void
  applyProgress: (progress: { done: number; total: number }) => void
  appendEntries: (entries: SyncEntry[]) => void
  showNotice: (notice: CloudSyncNotice) => void
  dismissNotice: () => void
  openDetail: () => void
  closeDetail: () => void
}

let unlisten: (() => void) | null = null
let subscribing: Promise<void> | null = null

/** 事件订阅只建一次（StrictMode 双挂载/重复 hydrate 都不会重复弹泡）。 */
function subscribeOnce(get: () => CloudSyncStoreState): void {
  if (subscribing) return
  subscribing = subscribeCloudSync({
    onStatus: (next) => get().applyStatus(next),
    onProgress: (payload) => get().applyProgress(payload),
    onEntries: (payload) => get().appendEntries(payload.entries),
    onNotice: (payload) => {
      get().showNotice({
        kind: payload.kind,
        at: Date.now(),
        batchId: payload.batchId,
        counts: payload.counts,
        errorCode: payload.errorCode,
      })
      // 一轮同步刚结束：立刻重读历史，否则详情面板要等下次打开才更新。
      void get().refreshHistory()
    },
  }).then((off) => {
    unlisten = off
  })
}


export const useCloudSyncStore = create<CloudSyncStoreState>((set, get) => ({
  config: { ...DEFAULT_CLOUD_SYNC_CONFIG },
  runtime: { running: false },
  loaded: false,
  saving: false,
  login: null,
  notice: null,
  batches: [],
  entries: [],
  detailOpen: false,

  hydrate: async () => {
    // 先只读一次配置：云同步关着的时候不该再为它多发两次 IPC。
    const config = await getCloudSyncConfig()
    if (!config.enabled) {
      set({ config, loaded: true, runtime: { running: false } })
      subscribeOnce(get)
      return
    }

    const [status, history] = await Promise.all([getCloudSyncStatus(), readCloudSyncHistory()])
    set({
      config,
      loaded: true,
      runtime: {
        running: status.running,
        done: status.done,
        total: status.total,
        failureCount: status.failureCount,
        authExpired: status.authExpired,
      },
      batches: history.batches,
      entries: history.entries,
    })
    subscribeOnce(get)
  },

  teardown: () => {
    unlisten?.()
    unlisten = null
    subscribing = null
  },

  setEnabled: async (enabled) => {
    await get().patchConfig({ enabled })
    if (!enabled) await stopCloudSync()
  },

  patchConfig: async (patch) => {
    set({ saving: true })
    try {
      const config = await setCloudSyncConfig(patch)
      set({ config, saving: false })
      return config
    } catch (error) {
      set({ saving: false })
      throw error
    }
  },

  setProvider: async (provider) => {
    if (provider && !isProviderAvailable(provider)) return
    // 只切 provider，不在这里手工清 connected：后端 `set_config` 会按**已保存的凭据**
    // 重算连接态。手工清空的后果是「切到百度再切回 WebDAV 就得重新输密码」，
    // 而凭据其实一直躺在磁盘上。
    await get().patchConfig({ provider })
  },

  toggleTarget: async (provider) => {
    // 不可用的网盘（这一版是百度）连勾选都不允许，别让别的入口绕过去。
    if (!isProviderAvailable(provider)) return
    const current = enabledTargets(get().config)
    const exists = current.some((target) => target.provider === provider)
    const next = exists
      ? current.filter((target) => target.provider !== provider)
      : [...current, { provider, connected: false }]
    await get().patchConfig({ targets: next })
  },

  setScope: async (scope) => {
    await get().patchConfig({ scope })
  },

  setIncludeSnapshots: async (includeSnapshots) => {
    await get().patchConfig({ includeSnapshots })
  },

  beginLogin: async () => {
    set({ login: { status: "pending" } })
    try {
      const { authUrl, errorCode } = await beginCloudSyncLogin(get().config.provider ?? "baidu")
      if (errorCode) {
        // 后端明确说「还没接入」时不要留一个永远转圈的弹窗，直接收起并给气泡。
        set({ login: null })
        get().showNotice({ kind: "failure", at: Date.now(), errorCode })
        return
      }
      if (authUrl) {
        const { openExternalUrl } = await import("@/lib/open-external-url")
        await openExternalUrl(authUrl)
      }
      // 真正的成功要等后端 cloud-sync://state 事件，这里只结束「等待打开浏览器」。
      set({ login: null })
    } catch (error) {
      set({ login: { status: "error", errorCode: error instanceof Error ? error.message : "unknown" } })
    }
  },

  cancelLogin: async () => {
    set({ login: null })
    await cancelCloudSyncLogin()
  },

  connectWebdav: async (input) => {
    const result = await connectCloudSyncWebdav(input)
    if (result.ok) {
      set((state) => ({
        config: { ...state.config, provider: "webdav", connected: true, accountLabel: input.user },
      }))
    }
    return result
  },

  connectFolder: async (path) => {
    const result = await connectCloudSyncFolder(path)
    if (result.ok) {
      // 后端把账号名、开关状态一起算好了，用它的；拿不到才退化成路径。
      set((state) => ({
        config: result.config
          ? normalizeCloudSyncConfig(result.config)
          : {
              ...state.config,
              provider: "folder",
              connected: true,
              folderPath: path,
              accountLabel: path.split(/[\\/]/).filter(Boolean).pop() ?? path,
            },
      }))
    }
    return result
  },

  logout: async () => {
    // 带 provider：多选时只断开当前这个盘，其他目标保持连接。
    const config = await logoutCloudSync(get().config.provider)
    set({ config, login: null })
  },

  runNow: async (projects, trigger = "manual") => {
    await runCloudSyncNow(projects, trigger)
  },

  /**
   * 从项目登记表取书单再触发同步。
   * 引擎不自己猜书籍清单：「仅当前书籍」时必须由前端筛。
   */
  runNowFromRegistry: async (trigger = "manual") => {
    const [{ loadRegisteredProjects }, { useWikiStore }] = await Promise.all([
      import("@/lib/project-store"),
      import("@/stores/wiki-store"),
    ])
    const all = await loadRegisteredProjects()
    const current = useWikiStore.getState().project
    const chosen =
      get().config.scope === "current" && current ? all.filter((project) => project.id === current.id) : all
    if (chosen.length === 0) return
    // 记账要在发起之前：否则「刚发起就被聚焦再触发」会连发两轮。
    set((state) => ({ runtime: { ...state.runtime, lastAttemptAt: Date.now() } }))
    const result = await runCloudSyncNow(
      chosen.map((project) => ({ id: project.id, name: project.name, path: project.path })),
      trigger,
    )
    // `result` 理论上一定有；但被测试替身/旧版本命令返回空值时不该炸，
    // 这里同步是副路径，崩掉会变成未捕获的 Promise 拒绝。
    const errorCode = result?.errorCode
    if (errorCode) {
      set((state) => ({
        runtime: {
          ...state.runtime,
          consecutiveFailures: (state.runtime.consecutiveFailures ?? 0) + 1,
          lastErrorCode: errorCode,
        },
      }))
    }
  },

  retry: async (entryIds) => {
    if (entryIds.length === 0) return
    // 引擎是幂等的（已同步的文件会判成 NoChange），所以「重试失败项」= 再跑一轮，
    // 不必为每个失败条目单独排队。
    await get().runNowFromRegistry("retry")
  },

  resolveConflict: async (input) => {
    const result = await resolveCloudSyncConflict(input)
    if (result.ok) {
      // 冲突已收敛：重读历史，让「冲突」那条立刻变成已处理，不再要求用户点第二次。
      const history = await readCloudSyncHistory()
      set({ batches: history.batches, entries: history.entries })
    }
    return result
  },

  refreshHistory: async () => {
    try {
      const history = await readCloudSyncHistory()
      set({ batches: history.batches, entries: history.entries })
    } catch {
      // 读历史失败不该影响同步本身：面板显示上一次的内容即可。
    }
  },

  clearHistory: async () => {
    await clearCloudSyncHistory()
    set({ batches: [], entries: [] })
  },

  applyStatus: (status) => {
    const config = normalizeCloudSyncConfig(status.config)
    set((state) => ({
      config,
      // 登录成功的唯一信号是后端把 connected 置真：这一步必须收起等待弹窗，
      // 否则用户授权完了回来还看着「等待浏览器」。
      login: config.connected ? null : state.login,
      // 合并而不是重建：后端每次推整份状态，重建会抹掉 lastAttemptAt / consecutiveFailures，
      // 那样「焦点节流 120s」和「失败退避」都会失效，切一次窗口就同步一轮。
      runtime: {
        ...state.runtime,
        running: status.running,
        done: status.done,
        total: status.total,
        failureCount: status.failureCount,
        authExpired: status.authExpired,
      },
    }))
  },

  applyProgress: ({ done, total }) => {
    // 「本轮同步成功」后需要 2 秒对勾：用 applyProgress 的结束信号当锚点太脆，
    // 因此这里只更新进度；成功态统一由 showNotice("success") 置位。
    set((state) => ({
      runtime: { ...state.runtime, running: true, done, total },
    }))
  },

  appendEntries: (entries) => {
    if (entries.length === 0) return
    set((state) => {
      const merged = [...state.entries, ...entries]
      // 只累计**本轮**的失败数：拿整段历史去数会让红点永远擦不掉。
      const failedNow = entries.filter((entry) => !entry.ok).length
      const runtime: CloudSyncRuntime = {
        ...state.runtime,
        failureCount: (state.runtime.failureCount ?? 0) + failedNow,
      }
      return { entries: merged, runtime }
    })
  },

  showNotice: (notice) => {
    set((state) => {
      const runtime: CloudSyncRuntime =
        notice.kind === "success"
          ? {
              ...state.runtime,
              running: false,
              done: 0,
              total: 0,
              failureCount: 0,
              consecutiveFailures: 0,
              lastErrorCode: undefined,
              recentSuccessAt: notice.at,
              authExpired: false,
            }
          : {
              ...state.runtime,
              running: false,
              authExpired:
                notice.errorCode === "auth.expired" ||
                notice.errorCode === "auth.revoked" ||
                notice.errorCode === "auth.required"
                  ? true
                  : state.runtime.authExpired,
            }
      const config: CloudSyncConfig =
        notice.kind === "success" ? { ...state.config, lastSyncAt: notice.at } : state.config
      return { notice, runtime, config }
    })
  },

  dismissNotice: () => set({ notice: null }),
  openDetail: () => {
    set({ detailOpen: true, notice: null })
    // 面板里的数据是缓存：不刷新的话，用户刚同步完点开还是上一轮（甚至上一天）的记录，
    // 看起来就像「没同步」。
    void get().refreshHistory()
  },
  closeDetail: () => set({ detailOpen: false }),
}))

/** 供批次列表使用：新建一个空批次壳（P0 只有 stub 会用）。 */
export function makeEmptyBatch(batchId: string, trigger: SyncTrigger, startedAt = Date.now()): SyncBatch {
  return { batchId, startedAt, trigger, state: "running", counts: emptyCounts() }
}
