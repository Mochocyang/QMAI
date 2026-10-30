/**
 * 内置模型的本地会话。
 *
 * 与上一版（New API）相比，这里只保留**一件东西**：一张会过期的票据。
 * 没有用户名密码、没有额度快照、没有 sk- 令牌 —— 身份来自 QMAI 账号登录态。
 *
 * 存 localStorage 而不是 app-state.json 的原因：
 *  - 它只属于这台机器的会话，不参与「数据导出/导入」；
 *  - 票据泄漏面更小（导出包里不会带它）。
 */

import { DEFAULT_RELAY_URL } from "./gateway-api"

export const BUILTIN_SESSION_STORAGE_KEY = "qmai.builtin.session.v2"

export interface BuiltinSession {
  /** 中转站地址，例如 https://relay.qmai.work */
  serverUrl: string
  /** 30 分钟票据，直接当 Bearer 用。 */
  tokenKey: string
  /** epoch 秒；过期前要重新换。 */
  expiresAt: number
  /** 票据对应的账号 userId，用于换账号时判定"这张票不能用了"。 */
  userId: number
  updatedAt: number
}

export interface BuiltinSessionDraft {
  serverUrl?: string
  tokenKey: string
  expiresAt: number
  userId: number
}

export function createBuiltinSession(draft: BuiltinSessionDraft): BuiltinSession {
  return {
    serverUrl: draft.serverUrl || DEFAULT_RELAY_URL,
    tokenKey: draft.tokenKey,
    expiresAt: draft.expiresAt,
    userId: draft.userId,
    updatedAt: Date.now(),
  }
}

function isValidSession(value: unknown): value is BuiltinSession {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return typeof record.serverUrl === "string"
    && typeof record.tokenKey === "string"
    && record.tokenKey.length > 0
    && typeof record.expiresAt === "number"
    && typeof record.userId === "number"
}

export function loadBuiltinSession(): BuiltinSession | null {
  if (typeof localStorage === "undefined") return null
  try {
    const raw = localStorage.getItem(BUILTIN_SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isValidSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveBuiltinSession(session: BuiltinSession): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(BUILTIN_SESSION_STORAGE_KEY, JSON.stringify(session))
  } catch {
    // 存储满了/被禁用：本次会话仍可用，只是重启后要重新启用。
  }
}

export function clearBuiltinSession(): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.removeItem(BUILTIN_SESSION_STORAGE_KEY)
  } catch {
    // ignore
  }
}

/** 只露头尾，避免在界面上把完整票据亮出来。 */
export function maskSecret(secret: string): string {
  const value = (secret ?? "").trim()
  if (value.length <= 12) return value ? "****" : ""
  return `${value.slice(0, 7)}…${value.slice(-4)}`
}
