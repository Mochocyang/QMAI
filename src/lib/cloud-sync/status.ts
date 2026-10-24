/**
 * 云同步状态派生（纯函数）。
 *
 * 6 个状态只由「持久化配置 + 运行时快照」算出来，不额外存一份，
 * 避免 store 与配置各存一份状态后不同步。
 *
 * 优先级：disabled > login-required > auth-expired > syncing > attention > ready
 */

import type { CloudSyncConfig } from "./types"

export type CloudSyncState =
  | "disabled"
  | "login-required"
  | "ready"
  | "syncing"
  | "attention"
  | "auth-expired"

export type CloudSyncIconName = "Cloud" | "CloudOff" | "CloudUpload" | "CloudCheck" | "CloudAlert"

export type CloudSyncBadge = "error" | "warn" | null

export interface CloudSyncRuntime {
  running: boolean
  /** 本轮已处理项数。 */
  done?: number
  /** 本轮总项数（未知时缺省）。 */
  total?: number
  /** 未处理的失败项数量。 */
  failureCount?: number
  /** token 过期 / WebDAV 认证失败。 */
  authExpired?: boolean
  /** 上一轮成功的时刻，用于 2 秒绿色对勾。 */
  recentSuccessAt?: number
  /** 上一次真正发起同步的时刻（自动同步的间隔判定用）。 */
  lastAttemptAt?: number
  /** 连续失败次数：成功一次清零，用来做退避。 */
  consecutiveFailures?: number
  /** 上一次失败的错误码：识别「重试也不会好」的情况。 */
  lastErrorCode?: string
}

export interface CloudSyncView {
  state: CloudSyncState
  icon: CloudSyncIconName
  badge: CloudSyncBadge
  /** aria-label 与 tooltip 共用一句，便于读屏与悬浮一致。 */
  label: string
}

/** 成功后的绿色对勾持续时长。 */
export const RECENT_SUCCESS_MS = 2_000

export function formatSyncAge(lastSyncAt: number | undefined, now: number): string | null {
  if (!lastSyncAt || !Number.isFinite(lastSyncAt)) return null
  const diff = now - lastSyncAt
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

export function deriveCloudSyncView(
  config: Pick<CloudSyncConfig, "enabled" | "connected" | "lastSyncAt">,
  runtime: CloudSyncRuntime,
  now: number = Date.now(),
): CloudSyncView {
  if (!config.enabled) {
    return { state: "disabled", icon: "CloudOff", badge: null, label: "云同步已关闭" }
  }

  if (!config.connected) {
    return {
      state: "login-required",
      icon: "CloudOff",
      badge: null,
      label: "云同步未登录，点击登录",
    }
  }

  if (runtime.authExpired) {
    return {
      state: "auth-expired",
      icon: "CloudAlert",
      badge: "warn",
      label: "云同步：授权已过期，点击重新登录",
    }
  }

  if (runtime.running) {
    const total = runtime.total ?? 0
    const done = runtime.done ?? 0
    return {
      state: "syncing",
      icon: "CloudUpload",
      badge: null,
      label: total > 0 ? `云同步：正在同步 ${done}/${total}` : "云同步：正在整理变更",
    }
  }

  const failureCount = runtime.failureCount ?? 0
  if (failureCount > 0) {
    return {
      state: "attention",
      icon: "CloudAlert",
      badge: "error",
      label: `云同步：有 ${failureCount} 项同步失败，点击查看`,
    }
  }

  const sinceSuccess =
    typeof runtime.recentSuccessAt === "number" ? now - runtime.recentSuccessAt : Number.NaN
  const recent = Number.isFinite(sinceSuccess) && sinceSuccess >= 0 && sinceSuccess < RECENT_SUCCESS_MS
  const age = formatSyncAge(config.lastSyncAt, now)
  return {
    state: "ready",
    icon: recent ? "CloudCheck" : "Cloud",
    badge: null,
    label: age ? `云同步：已就绪（${age}同步）` : "云同步：已就绪",
  }
}
