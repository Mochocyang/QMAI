/**
 * 云同步唯一的 IO 边界：Tauri 命令封装 + 事件订阅。
 *
 * 组件与 store 一律通过本文件访问后端；这里统一做 isTauri() 守卫，
 * 让 jsdom 组件测试无需 mock IPC 也能跑（非 Tauri 环境返回默认值）。
 */

import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

import { isTauri } from "@/lib/platform"
import {
  DEFAULT_CLOUD_SYNC_CONFIG,
  normalizeCloudSyncConfig,
  type CloudProviderId,
  type CloudSyncConfig,
  type CloudTarget,
  type CloudSyncNotice,
  type SyncBatch,
  type SyncEntry,
  type SyncTrigger,
} from "./types"

export const CLOUD_SYNC_EVENTS = {
  state: "cloud-sync://state",
  progress: "cloud-sync://progress",
  entries: "cloud-sync://entries",
  notice: "cloud-sync://notice",
} as const

/**
 * 前端内部事件：请外壳把设置页打开到某个分类。
 * 设置页的「是否显示设置」由外壳的 showGlobalSettings 掌管，
 * 组件不能自己改，否则无项目时会掉回书架。
 */
export const CLOUD_SYNC_OPEN_SETTINGS_EVENT = "qmai:cloud-sync-open-settings"

export interface CloudSyncStatus {
  config: CloudSyncConfig
  running: boolean
  done: number
  total: number
  failureCount: number
  authExpired: boolean
}

export interface CloudSyncProjectRef {
  id: string
  name: string
  path: string
}

export interface ConnectResult {
  ok: boolean
  errorCode?: string
  /** 连接成功后后端落好的配置（账号名等由后端算，前端不重复猜）。 */
  config?: CloudSyncConfig
}

export interface CloudSyncHistory {
  batches: SyncBatch[]
  entries: SyncEntry[]
}

export interface CloudSyncEventHandlers {
  onStatus: (status: CloudSyncStatus) => void
  onProgress: (payload: { batchId: string; done: number; total: number }) => void
  onEntries: (payload: { batchId: string; entries: SyncEntry[] }) => void
  onNotice: (payload: CloudSyncNoticePayload) => void
}

export interface CloudSyncNoticePayload {
  kind: "success" | "failure"
  batchId?: string
  counts?: CloudSyncNotice["counts"]
  errorCode?: string
}

const EMPTY_HISTORY: CloudSyncHistory = { batches: [], entries: [] }

export async function getCloudSyncConfig(): Promise<CloudSyncConfig> {
  if (!isTauri()) return { ...DEFAULT_CLOUD_SYNC_CONFIG }
  const raw = await invoke<Partial<CloudSyncConfig> | null>("cloud_sync_get_config")
  return normalizeCloudSyncConfig(raw)
}

export async function setCloudSyncConfig(patch: Partial<CloudSyncConfig>): Promise<CloudSyncConfig> {
  if (!isTauri()) return normalizeCloudSyncConfig(patch)
  const raw = await invoke<Partial<CloudSyncConfig> | null>("cloud_sync_set_config", { patch })
  return normalizeCloudSyncConfig(raw)
}

export async function getCloudSyncStatus(): Promise<CloudSyncStatus> {
  if (!isTauri()) {
    return {
      config: { ...DEFAULT_CLOUD_SYNC_CONFIG },
      running: false,
      done: 0,
      total: 0,
      failureCount: 0,
      authExpired: false,
    }
  }
  const raw = await invoke<{
    config?: Partial<CloudSyncConfig> | null
    running?: boolean
    done?: number
    total?: number
    failureCount?: number
    authExpired?: boolean
  }>("cloud_sync_status")
  return {
    config: normalizeCloudSyncConfig(raw?.config),
    running: raw?.running === true,
    done: raw?.done ?? 0,
    total: raw?.total ?? 0,
    failureCount: raw?.failureCount ?? 0,
    authExpired: raw?.authExpired === true,
  }
}

export interface BeginLoginResult {
  authUrl: string
  errorCode?: string
  /** GitHub 设备流：给用户看的 8 位码。 */
  userCode?: string
  verificationUri?: string
  expiresIn?: number
  /** 之前已经授权过，不用再走一遍设备流。 */
  alreadyAuthorized?: boolean
  accountLabel?: string
}

export async function beginCloudSyncLogin(provider: string): Promise<BeginLoginResult> {
  if (!isTauri()) return { authUrl: "" }
  const raw = await invoke<{
    authUrl?: string
    errorCode?: string
    userCode?: string
    verificationUri?: string
    expiresIn?: number
    alreadyAuthorized?: boolean
    accountLabel?: string
  }>("cloud_sync_begin_login", { provider })
  return {
    authUrl: raw?.authUrl ?? "",
    errorCode: raw?.errorCode,
    userCode: raw?.userCode,
    verificationUri: raw?.verificationUri,
    expiresIn: raw?.expiresIn,
    alreadyAuthorized: raw?.alreadyAuthorized,
    accountLabel: raw?.accountLabel,
  }
}

export interface GithubRepoChoice {
  owner: string
  name: string
  private: boolean
  defaultBranch: string
  canPush: boolean
  updatedAt?: string
}

export async function getGithubAuthState(): Promise<{
  authorized: boolean
  accountLabel: string
  loginPending: boolean
  target?: CloudTarget
}> {
  if (!isTauri()) return { authorized: false, accountLabel: "", loginPending: false }
  return invoke("cloud_sync_github_auth_state")
}

export async function listGithubRepos(): Promise<{
  ok: boolean
  repos?: GithubRepoChoice[]
  errorCode?: string
}> {
  if (!isTauri()) return { ok: false, errorCode: "net.offline" }
  return invoke("cloud_sync_github_repos")
}

export async function createGithubRepo(name: string): Promise<{
  ok: boolean
  repo?: GithubRepoChoice
  errorCode?: string
}> {
  if (!isTauri()) return { ok: false, errorCode: "net.offline" }
  return invoke("cloud_sync_github_create_repo", { name })
}

export async function makeGithubRepoPrivate(
  owner: string,
  repo: string,
): Promise<{ ok: boolean; repo?: GithubRepoChoice; errorCode?: string }> {
  if (!isTauri()) return { ok: false, errorCode: "net.offline" }
  return invoke("cloud_sync_github_make_private", { owner, repo })
}

export async function connectCloudSyncGithub(input: {
  owner: string
  repo: string
  branch?: string
}): Promise<ConnectResult> {
  if (!isTauri()) return { ok: false, errorCode: "net.offline" }
  return invoke<ConnectResult>("cloud_sync_connect_github", input)
}

export async function cancelCloudSyncLogin(): Promise<void> {
  if (!isTauri()) return
  await invoke("cloud_sync_cancel_login")
}

export async function connectCloudSyncWebdav(input: {
  url: string
  user: string
  password: string
}): Promise<ConnectResult> {
  if (!isTauri()) return { ok: false, errorCode: "net.offline" }
  return invoke<ConnectResult>("cloud_sync_connect_webdav", input)
}

export async function connectCloudSyncFolder(path: string): Promise<ConnectResult> {
  if (!isTauri()) return { ok: false, errorCode: "net.offline" }
  return invoke<ConnectResult>("cloud_sync_connect_folder", { path })
}

export async function stopCloudSync(): Promise<void> {
  if (!isTauri()) return
  await invoke("cloud_sync_stop")
}

export async function logoutCloudSync(provider?: CloudProviderId | null): Promise<CloudSyncConfig> {
  if (!isTauri()) return { ...DEFAULT_CLOUD_SYNC_CONFIG }
  // 只退出当前这个网盘：多选时「退出登录」不该把别的盘一起断掉。
  const config = await invoke<Partial<CloudSyncConfig>>("cloud_sync_logout", { provider: provider ?? null })
  return normalizeCloudSyncConfig(config)
}

export interface CloudSyncRunResult {
  /** 空字符串表示这一轮根本没启动（看 `errorCode`）。 */
  batchId: string
  errorCode?: string
}

export async function runCloudSyncNow(
  projects: CloudSyncProjectRef[],
  trigger: SyncTrigger = "manual",
): Promise<CloudSyncRunResult> {
  if (!isTauri()) return { batchId: "" }
  return invoke<CloudSyncRunResult>("cloud_sync_run_now", { trigger, projects })
}

export interface ResolveConflictInput {
  /** 这个冲突是相对哪个网盘的：多网盘时同一文件可能只在某个盘冲突。 */
  provider?: CloudProviderId | null
  projectId: string
  projectPath: string
  bookName?: string
  rel: string
  /** `local` = 保留本地这份；`cloud` = 改用云端那份。 */
  choice: "local" | "cloud"
}

export interface ResolveConflictResult {
  ok: boolean
  errorCode?: string
  message?: string
}

/**
 * 逐项定夺冲突。
 *
 * 传的是**项目路径**而不是书 id：后端不持有项目注册表，
 * 而真正要改的是磁盘上的文件和远端清单。
 */
export async function resolveCloudSyncConflict(input: ResolveConflictInput): Promise<ResolveConflictResult> {
  const result = await invoke<ResolveConflictResult>("cloud_sync_resolve_conflict", {
    projectId: input.projectId,
    projectPath: input.projectPath,
    bookName: input.bookName,
    rel: input.rel,
    choice: input.choice,
    provider: input.provider ?? null,
  })
  return result ?? { ok: false, errorCode: "unknown" }
}

export async function readCloudSyncHistory(limit = 200): Promise<CloudSyncHistory> {
  if (!isTauri()) return EMPTY_HISTORY
  const raw = await invoke<Partial<CloudSyncHistory> | null>("cloud_sync_history", { limit })
  return { batches: raw?.batches ?? [], entries: raw?.entries ?? [] }
}

export async function clearCloudSyncHistory(): Promise<void> {
  if (!isTauri()) return
  await invoke("cloud_sync_clear_history")
}

export async function revealCloudSyncRemote(provider?: CloudProviderId | null): Promise<void> {
  if (!isTauri()) return
  // 带 provider：多网盘时「打开远端内容」要打开的是**这一个**盘，不是当前激活的那个。
  if (provider) {
    await invoke("cloud_sync_reveal_target_remote", { provider })
    return
  }
  await invoke("cloud_sync_reveal_remote")
}

/**
 * 订阅四个同步事件。只有主窗口订阅：独立窗口（reader-*）不该弹第二次气泡。
 * 返回 unlisten 函数，供 store 在应用卸载时清理。
 */
export async function subscribeCloudSync(
  handlers: CloudSyncEventHandlers,
): Promise<() => void> {
  if (!isTauri()) return () => {}

  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  if (getCurrentWindow().label !== "main") return () => {}

  const unlisteners: UnlistenFn[] = []
  unlisteners.push(await listen<CloudSyncStatus>(CLOUD_SYNC_EVENTS.state, (event) => handlers.onStatus(event.payload)))
  unlisteners.push(
    await listen<{ batchId: string; done: number; total: number }>(CLOUD_SYNC_EVENTS.progress, (event) =>
      handlers.onProgress(event.payload),
    ),
  )
  unlisteners.push(
    await listen<{ batchId: string; entries: SyncEntry[] }>(CLOUD_SYNC_EVENTS.entries, (event) =>
      handlers.onEntries(event.payload),
    ),
  )
  unlisteners.push(
    await listen<CloudSyncNoticePayload>(CLOUD_SYNC_EVENTS.notice, (event) => handlers.onNotice(event.payload)),
  )

  return () => {
    for (const unlisten of unlisteners) unlisten()
  }
}
