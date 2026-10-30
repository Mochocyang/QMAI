/**
 * 云同步的共享类型：配置、批次、条目、提示。
 *
 * 这些类型同时被前端（store / 组件）与 Rust 命令的 TS 侧封装使用，
 * 字段名一律 camelCase，与 Rust 侧 `#[serde(rename_all = "camelCase")]` 对齐。
 */

export type CloudProviderId = "baidu" | "webdav" | "folder" | "github"

export type CloudSyncScope = "all" | "current"

/** 持久化在 app-state.json 的 `cloudSyncConfig` 键里。密钥绝不在此结构中。 */
/** 配置里的一个同步目标：一个网盘一套账号与连接态。 */
export interface CloudTarget {
  provider: CloudProviderId
  connected: boolean
  accountLabel?: string
  folderPath?: string
  webdavUrl?: string
  webdavUser?: string
  /** GitHub 目标：仓库所有者（个人或组织）。 */
  githubOwner?: string
  githubRepo?: string
  githubBranch?: string
}

export interface CloudSyncConfig {
  enabled: boolean
  /** 当前激活的目标（下面这些扁平字段都是它的投影，由后端维护）。 */
  provider: CloudProviderId | null
  scope: CloudSyncScope
  connected: boolean
  accountLabel?: string
  folderPath?: string
  webdavUrl?: string
  webdavUser?: string
  lastSyncAt?: number
  /** `.novel/snapshots` 是否一起同步（每章一个文件，会显著放大文件数）。 */
  includeSnapshots: boolean
  schemaVersion: 1 | 2
  /** 参与同步的所有网盘，权威存储。一轮同步对每个已连接的目标各跑一次。 */
  targets?: CloudTarget[]
}

export interface CloudSyncProgress {
  done: number
  total: number
}

export type SyncDirection = "upload" | "download" | "delete" | "conflict" | "skip"

export interface SyncEntry {
  id: string
  batchId: string
  at: number
  direction: SyncDirection
  /** 项目内相对路径（不含项目根）。 */
  path: string
  bookId?: string
  bookName?: string
  bytes?: number
  ok: boolean
  errorCode?: string
  /** 仅用于诊断，不在界面直出。 */
  errorDetail?: string
}

export interface SyncCounts {
  upload: number
  download: number
  delete: number
  conflict: number
  skip: number
  failed: number
}

export type SyncTrigger =
  | "manual"
  | "editor-save"
  | "first-connect"
  | "window-focus"
  | "retry"
  | "auto"

export interface SyncBatch {
  batchId: string
  startedAt: number
  finishedAt?: number
  trigger: SyncTrigger
  state: "running" | "ok" | "partial" | "failed"
  counts: SyncCounts
  /** 这一批同步到的网盘；老历史没有这个字段。 */
  provider?: CloudProviderId | null
}

export function emptyCounts(): SyncCounts {
  return { upload: 0, download: 0, delete: 0, conflict: 0, skip: 0, failed: 0 }
}

export interface CloudSyncNotice {
  kind: "success" | "failure"
  at: number
  batchId?: string
  counts?: SyncCounts
  errorCode?: string
}

export const DEFAULT_CLOUD_SYNC_CONFIG: CloudSyncConfig = {
  enabled: false,
  provider: null,
  scope: "all",
  connected: false,
  includeSnapshots: true,
  schemaVersion: 1,
}

export function normalizeCloudSyncConfig(
  input: Partial<CloudSyncConfig> | null | undefined,
): CloudSyncConfig {
  if (!input) return { ...DEFAULT_CLOUD_SYNC_CONFIG }
  const config: CloudSyncConfig = {
    ...DEFAULT_CLOUD_SYNC_CONFIG,
    ...input,
    schemaVersion: input.schemaVersion === 2 ? 2 : 1,
  }
  // 老后端只给扁平字段：补一个目标出来，界面上「勾了哪些网盘」才有依据。
  if (!config.targets || config.targets.length === 0) {
    config.targets = config.provider
      ? [
          {
            provider: config.provider,
            connected: config.connected,
            accountLabel: config.accountLabel,
            folderPath: config.folderPath,
            webdavUrl: config.webdavUrl,
            webdavUser: config.webdavUser,
          },
        ]
      : []
  }
  return config
}

/** 参与同步的目标列表（兼容老配置：没有 targets 时用扁平字段折算）。 */
export function enabledTargets(config: CloudSyncConfig): CloudTarget[] {
  if (config.targets && config.targets.length > 0) return config.targets
  if (!config.provider) return []
  return [
    {
      provider: config.provider,
      connected: config.connected,
      accountLabel: config.accountLabel,
      folderPath: config.folderPath,
      webdavUrl: config.webdavUrl,
      webdavUser: config.webdavUser,
    },
  ]
}

/** 用户真正感知到的「同步了几项」：跳过项与失败项不算。 */
export function totalSyncedCount(counts: SyncCounts): number {
  return counts.upload + counts.download + counts.delete + counts.conflict
}
