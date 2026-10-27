/**
 * 账号登录态的本地持久化。
 *
 * 与 builtin-models/session.ts 同一模式：localStorage、读取时结构校验、
 * 写入失败不阻塞本次会话。坏数据直接删除，避免每次启动都解析同一份垃圾。
 */

import { normalizeAccountBaseUrl, parseAccountBaseUrl } from "./api"
import type {
  AccountAuthPayload,
  AccountUser,
  StoredAccountSession,
} from "./types"

export const ACCOUNT_SESSION_STORAGE_KEY = "qmai.account.session.v1"

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function toAccountUser(value: unknown): AccountUser | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = record.id
  const email = record.email
  const displayName = record.displayName
  const createdAt = record.createdAt

  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null
  if (!isNonEmptyString(email)) return null
  if (typeof displayName !== "string") return null
  if (!isFiniteNumber(createdAt)) return null

  // 旧版本会话没有这个字段，缺失/非法一律按「无头像」处理，不判坏数据。
  const avatarUpdatedAt =
    isFiniteNumber(record.avatarUpdatedAt) ? record.avatarUpdatedAt : null

  return { id, email, displayName, createdAt, avatarUpdatedAt }
}

function toStoredSession(value: unknown): StoredAccountSession | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>

  if (!isNonEmptyString(record.baseUrl)) return null
  if (!isNonEmptyString(record.accessToken)) return null
  if (!isFiniteNumber(record.accessExpiresAt)) return null
  if (!isNonEmptyString(record.refreshToken)) return null
  if (!isFiniteNumber(record.refreshExpiresAt)) return null
  if (!isFiniteNumber(record.savedAt)) return null

  const user = toAccountUser(record.user)
  if (!user) return null

  // 旧数据或 XSS 改写的地址不能静默指向默认服务，直接拒绝整份会话。
  const baseUrl = parseAccountBaseUrl(record.baseUrl)
  if (!baseUrl) return null

  return {
    baseUrl,
    accessToken: record.accessToken,
    accessExpiresAt: record.accessExpiresAt,
    refreshToken: record.refreshToken,
    refreshExpiresAt: record.refreshExpiresAt,
    user,
    savedAt: record.savedAt,
  }
}

function removeStoredSession(): void {
  try {
    localStorage.removeItem(ACCOUNT_SESSION_STORAGE_KEY)
  } catch {
    // localStorage 被禁用/配额异常：忽略，调用方按无会话处理。
  }
}

export function createStoredSession(
  baseUrl: string,
  payload: AccountAuthPayload,
): StoredAccountSession {
  return {
    baseUrl: normalizeAccountBaseUrl(baseUrl),
    accessToken: payload.accessToken,
    accessExpiresAt: payload.accessExpiresAt,
    refreshToken: payload.refreshToken,
    refreshExpiresAt: payload.refreshExpiresAt,
    user: { ...payload.user },
    savedAt: Math.floor(Date.now() / 1000),
  }
}

export function loadAccountSession(): StoredAccountSession | null {
  let raw: string | null
  try {
    if (typeof localStorage === "undefined") return null
    raw = localStorage.getItem(ACCOUNT_SESSION_STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    removeStoredSession()
    return null
  }

  const session = toStoredSession(parsed)
  if (!session) {
    removeStoredSession()
    return null
  }
  return session
}

export function saveAccountSession(session: StoredAccountSession): void {
  try {
    if (typeof localStorage === "undefined") return
    localStorage.setItem(ACCOUNT_SESSION_STORAGE_KEY, JSON.stringify(session))
  } catch {
    // 存储满了/被禁用：本次会话仍可用，只是重启后需要重新登录。
  }
}

export function clearAccountSession(): void {
  try {
    if (typeof localStorage === "undefined") return
    removeStoredSession()
  } catch {
    // localStorage 本身不可访问时无需清理。
  }
}

/** access 是否仍在有效期内（默认提前 60 秒判定过期）。 */
export function isAccessTokenFresh(session: StoredAccountSession, skewSeconds = 60): boolean {
  if (!isFiniteNumber(session.accessExpiresAt)) return false
  return session.accessExpiresAt > Date.now() / 1000 + skewSeconds
}
