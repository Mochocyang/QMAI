/**
 * 模型配置云同步的客户端状态与动作。
 *
 * 分工：
 * - 真正的「拉取 → 合并 → 推送」逻辑在 `lib/model-sync/service.ts`（纯编排、可单测）；
 * - 这里负责：从账号 store 取 token、读写本地配置与同步状态、把同步密码交给
 *   系统加密的本地仓库（`secret_set/get`），并维护界面需要的状态位。
 */

import { create } from "zustand"

import { isTauri } from "@/lib/platform"
import { getStore } from "@/lib/web-store"
import { deleteModelConfig, fetchModelConfig, putModelConfig } from "@/lib/account/api"
import { isAccessTokenFresh } from "@/lib/account/session"
import {
  loadEmbeddingConfig,
  loadProviderConfigs,
  loadRerankConfig,
  saveEmbeddingConfig,
  saveProviderConfigs,
  saveRerankConfig,
} from "@/lib/project-store"
import type { ProviderConfigs } from "@/stores/wiki-store"
import { useWikiStore } from "@/stores/wiki-store"
import { useAccountStore } from "@/stores/account-store"

import {
  emptySyncState,
  hasPendingDeletion,
  pullAndMerge,
  pushLocal,
  restoreFromCloud as restoreFromCloudPayload,
  type ModelSyncIo,
  type ModelSyncState,
} from "@/lib/model-sync/service"
import { shouldPull } from "@/lib/model-sync/scheduler"
import { isFingerprint } from "@/lib/model-sync/canonical"
import type { MergeConflictDetail } from "@/lib/model-sync/merge"
import { SyncPasswordError } from "@/lib/model-sync/crypto"

/** 同步密码最短长度：8 位是「够用又不折腾」的下限（再短挡不住暴力破解）。 */
export const MIN_SYNC_PASSWORD_LENGTH = 8

/** 同步密码在本地仓库里的键名（Windows 走 DPAPI）。 */
const PASSWORD_SECRET = "model-sync-password"
/** 同步状态（版本号 / 时间戳 / 快照）落在 Tauri store 的键名。 */
const STATE_STORE_KEY = "model-sync-state"
/**
 * 「同步开关」自己的持久化键。
 *
 * 为什么不能只靠「有没有密码」推导：开关关闭时**不再清掉密码**（用户要求
 * 「关掉后再点一下就重新打开，不用再做别的操作」），所以必须单独记住开关状态，
 * 否则重启后会把「关掉的」误判成「开着的」。
 */
const ENABLED_STORE_KEY = "model-sync-enabled"

export type ModelSyncStatus = "idle" | "pulling" | "pushing" | "error"

interface ModelSyncStore {
  /** 用户是否开启「同步到我的账号」。 */
  enabled: boolean
  /** 本机是否已存同步密码（有密码才能自动同步；没密码时每次都要手输）。 */
  passwordReady: boolean
  busy: boolean
  status: ModelSyncStatus
  message: string
  /** 最近一次合并里「两边都改过」的 provider 名单。 */
  conflicts: string[]
  /** 冲突明细（只在内存里：含 API Key，绝不落盘）。 */
  pendingConflicts: MergeConflictDetail[]
  version: number
  lastSyncAt: number | null

  init: () => Promise<void>
  /** 开启同步：保存密码、先合并云端、再上传。 */
  enable: (password: string) => Promise<void>
  /**
   * 开关本身：开 = 继续用已存的同步密码同步一次；关 = 停止同步但保留密码与云端配置。
   * 与 `disable({ clearCloud: true })`（销毁式关闭）区别就在这里。
   */
  setEnabled: (next: boolean) => Promise<void>
  /** 关闭同步；`clearCloud` 为真时同时删除云端配置。 */
  disable: (options?: { clearCloud?: boolean }) => Promise<void>
  /** 手动同步：先拉取合并，再推送本地改动。 */
  syncNow: () => Promise<void>
  /** 从云端下载：把云端配置填回本机（覆盖同名项，本地独有的保留）。 */
  restoreFromCloud: () => Promise<void>
  /** 自动同步的一次心跳（App 级每 60 秒调一次；内部按节流规则决定是否联网）。 */
  autoSyncTick: () => Promise<void>
  /** 修改同步密码：用旧密码解锁后，用新密码重加密并覆盖上传。 */
  changePassword: (currentPassword: string, nextPassword: string) => Promise<void>
  /** 冲突时由用户决定保留哪一份（合并阶段先按更新时间选了一份）。 */
  resolveConflict: (key: string, side: "local" | "cloud") => Promise<void>
  clearMessage: () => void
}

async function readSecret(name: string): Promise<string | null> {
  if (!isTauri()) return null
  const { invoke } = await import("@tauri-apps/api/core")
  const value = await invoke<string | null>("secret_get", { name })
  return value && value.length > 0 ? value : null
}

async function writeSecret(name: string, value: string): Promise<void> {
  if (!isTauri()) throw new Error("当前环境不支持安全存储同步密码。")
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("secret_set", { name, value })
}

async function clearSecret(name: string): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("secret_clear", { name })
}

async function loadSyncState(): Promise<ModelSyncState> {
  try {
    const store = await getStore()
    const raw = await store.get<unknown>(STATE_STORE_KEY)
    if (!raw || typeof raw !== "object") return emptySyncState()
    const record = raw as Partial<ModelSyncState>
    return {
      version: typeof record.version === "number" ? record.version : 0,
      lastPullAt: typeof record.lastPullAt === "number" ? record.lastPullAt : null,
      lastPushAt: typeof record.lastPushAt === "number" ? record.lastPushAt : null,
      updatedAt: (record.updatedAt as Record<string, number>) ?? {},
      snapshot: (record.snapshot as Record<string, string>) ?? {},
    }
  } catch {
    return emptySyncState()
  }
}

async function saveSyncState(state: ModelSyncState): Promise<void> {
  const store = await getStore()
  await store.set(STATE_STORE_KEY, state)
  await store.save()
}

/**
 * 读「同步开关」。缺省视为开启：老版本没有这个开关，那时「有密码 = 在同步」，
 * 不能因为升级而把正在同步的用户悄悄关掉。
 */
async function loadEnabledFlag(): Promise<boolean> {
  try {
    const store = await getStore()
    const raw = await store.get<unknown>(ENABLED_STORE_KEY)
    return raw !== false
  } catch {
    return true
  }
}

async function saveEnabledFlag(value: boolean): Promise<void> {
  try {
    const store = await getStore()
    await store.set(ENABLED_STORE_KEY, value)
    await store.save()
  } catch {
    // 记不住开关不影响本次操作，下次 init 会按「有密码即开启」兜底。
  }
}

/** 取当前账号的可用 token；过期就先续期，未登录则报错。 */
async function requireSession(): Promise<{ baseUrl: string; accessToken: string }> {
  const account = useAccountStore.getState()
  let session = account.session
  if (!session) throw new Error("请先在「账号」里登录，再开启模型同步。")
  if (!isAccessTokenFresh(session)) {
    session = (await account.refreshSession()) ?? session
  }
  return { baseUrl: session.baseUrl, accessToken: session.accessToken }
}

function createIo(session: { baseUrl: string; accessToken: string }): ModelSyncIo {
  return {
    now: () => Date.now(),
    loadConfigs: async () => ((await loadProviderConfigs()) ?? {}) as Record<string, unknown>,
    saveConfigs: async (configs) => {
      const typed = configs as ProviderConfigs
      await saveProviderConfigs(typed)
      useWikiStore.getState().setProviderConfigs(typed)
    },
    /*
     * 重排 / 向量模型不属于 provider 列表，各自是「整份配置」，
     * 所以单独一组 IO：读进来按 rerank / embedding 放进 settings，
     * 写回时同时更新 wiki-store，设置页不用重进就能看到。
     */
    loadSettings: async () => {
      const [rerank, embedding] = await Promise.all([
        loadRerankConfig().catch(() => null),
        loadEmbeddingConfig().catch(() => null),
      ])
      const settings: Record<string, unknown> = {}
      if (rerank) settings.rerank = rerank
      if (embedding) settings.embedding = embedding
      return settings
    },
    saveSettings: async (settings) => {
      const rerank = settings.rerank
      if (rerank && typeof rerank === "object") {
        await saveRerankConfig(rerank as never)
        useWikiStore.getState().setRerankConfig(rerank as never)
      }
      const embedding = settings.embedding
      if (embedding && typeof embedding === "object") {
        await saveEmbeddingConfig(embedding as never)
        useWikiStore.getState().setEmbeddingConfig(embedding as never)
      }
    },
    loadState: loadSyncState,
    saveState: saveSyncState,
    fetchCloud: (ifNoneMatch) =>
      fetchModelConfig(session.baseUrl, session.accessToken, { ifNoneMatch }).catch(describeSyncEndpointError),
    putCloud: (input) => putModelConfig(session.baseUrl, session.accessToken, input).catch(describeSyncEndpointError),
  }
}

/**
 * 把「服务端没这个接口」翻译成用户能照做的提示。
 *
 * 线上真实出现过：客户端已经带上了模型同步，但 account.qmai.pro 部署的 Worker
 * 还是旧版本（没有 /v1/model-config 路由），点「立即同步」只看到一句「接口不存在。」，
 * 用户无从判断是自己的网络问题还是服务端没更新。
 *
 * 只在 NOT_FOUND 时换文案；其它错误原样抛出。错误码保留，调用方仍可按 code 判断。
 */
function describeSyncEndpointError(error: unknown): never {
  if ((error as { code?: string } | null)?.code === "NOT_FOUND") {
    const friendly = new Error(
      "账号服务还没有「模型同步」接口 —— 服务端（account.qmai.pro）仍在跑旧版本。" +
        "在 account-worker 目录执行 wrangler deploy，并应用最新 D1 迁移后再试。",
    ) as Error & { code?: string }
    friendly.code = "NOT_FOUND"
    throw friendly
  }
  throw error
}

/** 账号接口的传输层失败（连不上/超时），值得重试。 */
function isNetworkError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "NETWORK"
}

/**
 * 网络抖动重试：只对 NETWORK 重试（鉴权失败、版本冲突重试没有意义），最多 3 次。
 * 实测这台机器上「几秒前能通、几秒后超时」都会出现，一次抖动就报失败体验太差。
 */
async function withNetworkRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      lastError = error
      if (!isNetworkError(error) || attempt === attempts - 1) break
      await new Promise((resolve) => setTimeout(resolve, 1_500 * (attempt + 1)))
    }
  }
  throw lastError
}

/** 把失败原因写进应用日志（window-debug.log），否则只剩一句「网络不可用」没法查。 */
async function logDiagnostic(message: string): Promise<void> {
  if (!isTauri()) return
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("log_diagnostic", { message })
  } catch {
    // 记日志失败不影响业务流程。
  }
}

function describeError(error: unknown): string {
  if (error instanceof SyncPasswordError) return error.message
  if (isNetworkError(error)) {
    return "连不上账号服务（网络问题）。请检查网络或代理后重试；如果本机通过代理软件上网，建议在「设置 → 网络」里填上代理地址，应用会显式走它。"
  }
  const message = error instanceof Error ? error.message : String(error)
  return message || "同步失败，请稍后重试。"
}

export const useModelSyncStore = create<ModelSyncStore>((set, get) => ({
  enabled: false,
  passwordReady: false,
  busy: false,
  status: "idle",
  message: "",
  conflicts: [],
  pendingConflicts: [],
  version: 0,
  lastSyncAt: null,

  init: async () => {
    const password = await readSecret(PASSWORD_SECRET).catch(() => null)
    const enabledFlag = await loadEnabledFlag()
    const state = await loadSyncState()
    // 早期版本把整份配置 JSON 存进了快照（等于把 API Key 明文写回磁盘），
    // 这里清洗成指纹；结构不符就整体重算，最多让下一次同步多重推一遍。
    const dirtySnapshot = Object.values(state.snapshot).some((value) => !isFingerprint(value))
    if (dirtySnapshot) {
      await saveSyncState({ ...state, snapshot: {} }).catch(() => undefined)
      state.snapshot = {}
    }
    set({
      enabled: password !== null && enabledFlag,
      passwordReady: password !== null,
      version: state.version,
      lastSyncAt: state.lastPushAt ?? state.lastPullAt ?? null,
    })
  },

  enable: async (password) => {
    if (password.trim().length < MIN_SYNC_PASSWORD_LENGTH) {
      throw new Error(`同步密码至少 ${MIN_SYNC_PASSWORD_LENGTH} 位。`)
    }
    set({ busy: true, status: "pushing", message: "" })
    try {
      const session = await requireSession()
      await writeSecret(PASSWORD_SECRET, password)
      const io = createIo(session)
      // 云端可能已经被别的设备写过（baseVersion 为空会撞 409）：先合并再推，别直接覆盖。
      const pulled = await withNetworkRetry(() => pullAndMerge(io, password))
      const result = await withNetworkRetry(() => pushLocal(io, password))
      await saveEnabledFlag(true)
      set({
        enabled: true,
        passwordReady: true,
        busy: false,
        status: "idle",
        version: Math.max(pulled.version, result.version),
        lastSyncAt: Date.now(),
        pendingConflicts: pulled.outcome?.conflictDetails ?? [],
        conflicts: pulled.outcome?.conflicts ?? [],
        message:
          (pulled.outcome?.conflicts.length ?? 0) > 0
            ? "已开启同步。云端有与你不同的版本，已先保留较新的一份，可在下方改成另一份。"
            : "已开启同步，模型配置已加密上传。",
      })
    } catch (error) {
      await clearSecret(PASSWORD_SECRET).catch(() => undefined)
      void logDiagnostic(`[model-sync] enable failed: ${String(error)}`)
      set({ busy: false, status: "error", message: describeError(error) })
      throw error
    }
  },

  setEnabled: async (next) => {
    if (next) {
      /*
       * 打开：密码早就存在（关闭时没清），直接恢复同步即可，不需要用户再输入一遍。
       * 只有「本机没存过密码」（首次开启 / 清空过云端配置）才让调用方去弹设置表单。
       */
      const password = await readSecret(PASSWORD_SECRET).catch(() => null)
      if (!password) {
        set({ status: "error", message: "本机没有保存同步密码，请先设置同步密码再开启同步。" })
        return
      }
      await saveEnabledFlag(true)
      set({ enabled: true, passwordReady: true, status: "idle", message: "正在同步…" })
      await get().syncNow()
      return
    }
    await saveEnabledFlag(false)
    set({
      enabled: false,
      status: "idle",
      message: "已关闭同步（云端配置和同步密码都保留，再打开即可继续同步）。",
    })
  },

  disable: async (options = {}) => {
    set({ busy: true, status: "idle", message: "" })
    try {
      if (options.clearCloud) {
        const session = await requireSession()
        await withNetworkRetry(() =>
          deleteModelConfig(session.baseUrl, session.accessToken),
        )
      }
      await clearSecret(PASSWORD_SECRET)
      await saveEnabledFlag(false)
      await saveSyncState(emptySyncState())
      set({
        enabled: false,
        passwordReady: false,
        busy: false,
        version: 0,
        lastSyncAt: null,
        conflicts: [],
        pendingConflicts: [],
        message: options.clearCloud ? "已关闭同步并清空云端配置。" : "已关闭同步，云端配置保留。",
      })
    } catch (error) {
      void logDiagnostic(`[model-sync] disable failed: ${String(error)}`)
      set({ busy: false, status: "error", message: describeError(error) })
      throw error
    }
  },

  syncNow: async () => {
    const password = await readSecret(PASSWORD_SECRET).catch(() => null)
    if (!password) {
      set({ status: "error", message: "本机没有保存同步密码，请重新开启同步。" })
      return
    }
    set({ busy: true, status: "pulling", message: "" })
    try {
      const session = await requireSession()
      const io = createIo(session)
      const pulled = await withNetworkRetry(() => pullAndMerge(io, password))
      set({ status: "pushing" })
      let pushed = await withNetworkRetry(() => pushLocal(io, password))
      // 拉取与推送之间别处又写了一次（409）：重来一轮合并，别把本地改动憋住。
      if (pushed.status === "conflict") {
        await withNetworkRetry(() => pullAndMerge(io, password))
        pushed = await withNetworkRetry(() => pushLocal(io, password))
      }
      const conflicts = pulled.outcome?.conflicts ?? []
      set({
        busy: false,
        status: "idle",
        version: Math.max(pulled.version, pushed.version),
        lastSyncAt: Date.now(),
        conflicts,
        pendingConflicts: pulled.outcome?.conflictDetails ?? [],
        message:
          conflicts.length > 0
            ? `同步完成：有 ${conflicts.length} 项两边都改过，已先保留较新的那份，可在下方改成另一份。`
            : pulled.status === "none" && pushed.status === "unchanged"
              ? "云端还没有配置，本地改动将在下次同步时上传。"
              : "同步完成。",
      })
    } catch (error) {
      void logDiagnostic(`[model-sync] sync failed: ${String(error)}`)
      set({ busy: false, status: "error", message: describeError(error) })
    }
  },

  /**
   * 从云端下载（用户 2026-10-28 提的需求：不能只有同步、没有下载）。
   *
   * 典型场景：本机把某个模型删了，或者换了台机器/重装，需要把云端那份
   * 原样填回设置页。这里用「云端优先覆盖同名项 + 保留本地独有项」的规则，
   * 覆盖前由界面弹确认框。
   */
  restoreFromCloud: async () => {
    const password = await readSecret(PASSWORD_SECRET).catch(() => null)
    if (!password) {
      set({ status: "error", message: "本机没有保存同步密码，请先设置同步密码再下载。" })
      return
    }
    set({ busy: true, status: "pulling", message: "" })
    try {
      const session = await requireSession()
      const result = await withNetworkRetry(() => restoreFromCloudPayload(createIo(session), password))
      if (result.status === "none") {
        set({ busy: false, status: "idle", message: "云端还没有配置，没有可以下载的内容。" })
        return
      }
      set({
        busy: false,
        status: "idle",
        version: result.version,
        lastSyncAt: Date.now(),
        conflicts: [],
        pendingConflicts: [],
        message:
          result.settings > 0
            ? `已从云端下载：${result.providers} 个模型配置，重排 / 向量配置各 1 组。`
            : `已从云端下载：${result.providers} 个模型配置。`,
      })
    } catch (error) {
      void logDiagnostic(`[model-sync] restore failed: ${String(error)}`)
      set({ busy: false, status: "error", message: describeError(error) })
      throw error
    }
  },

  /**
   * 自动同步心跳（App 级每 60 秒调一次）。
   *
   * 这里只是「该不该联网」的判定：距上次拉取超过 5 分钟才拉一次，
   * 其余情况只在本地内容真的变过时才推送（`pushLocal` 内部先比快照）。
   */
  autoSyncTick: async () => {
    const snapshot = get()
    if (!snapshot.enabled || snapshot.busy) return

    const state = await loadSyncState()
    if (shouldPull(state.lastPullAt, Date.now())) {
      await get().syncNow()
      return
    }

    const password = await readSecret(PASSWORD_SECRET).catch(() => null)
    if (!password) return
    const session = await requireSession().catch(() => null)
    if (!session) return
    const io = createIo(session)
    try {
      /*
       * 本机有「同步过、后来被删掉」的条目时不能直接推：载荷只带本机现有的条目，
       * 一推就把云端那份也抹掉了（服务端只留最新一份），之后再也下载不回来。
       * 这种情况改走完整同步（先拉后推），并集策略会先把它补回本地。
       */
      if (await hasPendingDeletion(io).catch(() => false)) {
        await get().syncNow()
        return
      }
      const pushed = await pushLocal(io, password)
      if (pushed.status === "pushed") set({ version: pushed.version, lastSyncAt: Date.now() })
    } catch {
      // 自动同步失败保持安静：下一拍或用户手动「立即同步」再试。
    }
  },

  changePassword: async (currentPassword, nextPassword) => {
    if (nextPassword.trim().length < MIN_SYNC_PASSWORD_LENGTH) {
      throw new Error(`新同步密码至少 ${MIN_SYNC_PASSWORD_LENGTH} 位。`)
    }
    set({ busy: true, status: "pushing", message: "" })
    try {
      const session = await requireSession()
      const io = createIo(session)
      // 先用旧密码验证能解开云端，再写新密码并覆盖上传。
      await withNetworkRetry(() => pullAndMerge(io, currentPassword))
      await writeSecret(PASSWORD_SECRET, nextPassword)
      const result = await withNetworkRetry(() => pushLocal(io, nextPassword))
      set({
        busy: false,
        status: "idle",
        passwordReady: true,
        version: result.version,
        lastSyncAt: Date.now(),
        message: "同步密码已更新，云端配置已用新密码重新加密。",
      })
    } catch (error) {
      void logDiagnostic(`[model-sync] change password failed: ${String(error)}`)
      set({ busy: false, status: "error", message: describeError(error) })
      throw error
    }
  },

  /**
   * 冲突时由用户拍板：把选中的那一份写回本地配置并推送覆盖云端。
   *
   * 只在本次会话有效——冲突明细含 API Key，不落盘（见 pendingConflicts 注释）。
   */
  resolveConflict: async (key, side) => {
    const item = get().pendingConflicts.find((conflict) => conflict.key === key)
    if (!item) return
    set({ busy: true, message: "" })
    try {
      const configs = ((await loadProviderConfigs()) ?? {}) as Record<string, unknown>
      configs[key] = side === "local" ? item.localValue : item.cloudValue
      await saveProviderConfigs(configs as ProviderConfigs)
      useWikiStore.getState().setProviderConfigs(configs as ProviderConfigs)

      const password = await readSecret(PASSWORD_SECRET).catch(() => null)
      const session = password ? await requireSession().catch(() => null) : null
      if (password && session) {
        const pushed = await withNetworkRetry(() => pushLocal(createIo(session), password))
        set({ version: pushed.version, lastSyncAt: Date.now() })
      }

      set((state) => ({
        busy: false,
        pendingConflicts: state.pendingConflicts.filter((conflict) => conflict.key !== key),
        conflicts: state.conflicts.filter((conflictKey) => conflictKey !== key),
        message: `已按「${side === "local" ? "本地版本" : "云端版本"}」保留 ${key}。`,
      }))
    } catch (error) {
      void logDiagnostic(`[model-sync] resolve conflict failed: ${String(error)}`)
      set({ busy: false, status: "error", message: describeError(error) })
    }
  },

  clearMessage: () => {
    if (get().status === "error") set({ status: "idle", message: "" })
  },
}))
