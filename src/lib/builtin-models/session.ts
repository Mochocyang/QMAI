/**
 * 「内置模型」的本地登录态。
 *
 * 存 localStorage 而不是 app-state.json 的原因：
 *  - 它只属于这台机器的登录会话，不参与「数据导出/导入」；
 *  - 令牌泄漏风险面更小（导出包里不会带 sk- 令牌）。
 * 写作本身只用 tokenKey，accessToken 过期不影响正文；账号相关操作会提示重登。
 */

import { DEFAULT_BUILTIN_SERVER_URL } from "./gateway-api"

export const BUILTIN_SESSION_STORAGE_KEY = "qmai.builtin.session.v1"

export interface BuiltinSession {
  serverUrl: string
  /** 账号接口令牌，New API 默认 15 分钟过期；只用于看余额/开通/充值。 */
  accessToken: string
  accessExpiresAt: number
  userId: number
  username: string
  displayName: string
  group: string
  quota: number
  usedQuota: number
  /** 网关的 quota→美元换算基数（默认 500000）。 */
  quotaPerUnit: number
  /** 展示汇率：1 美元 = 多少本地货币（New API 的 usd_exchange_rate）。 */
  usdExchangeRate: number
  tokenId: number
  /** 写作用的 sk- 令牌，长期有效。 */
  tokenKey: string
  updatedAt: number
}

export interface BuiltinSessionDraft {
  serverUrl: string
  accessToken: string
  accessExpiresAt: number
  userId: number
  username: string
  displayName: string
  group: string
  quota: number
  usedQuota: number
  quotaPerUnit?: number
  usdExchangeRate?: number
  tokenId: number
  tokenKey: string
}

export function createBuiltinSession(draft: BuiltinSessionDraft): BuiltinSession {
  return {
    serverUrl: draft.serverUrl || DEFAULT_BUILTIN_SERVER_URL,
    accessToken: draft.accessToken,
    accessExpiresAt: draft.accessExpiresAt,
    userId: draft.userId,
    username: draft.username,
    displayName: draft.displayName || draft.username,
    group: draft.group,
    quota: draft.quota,
    usedQuota: draft.usedQuota,
    quotaPerUnit: draft.quotaPerUnit ?? 500000,
    usdExchangeRate: draft.usdExchangeRate ?? 0,
    tokenId: draft.tokenId,
    tokenKey: draft.tokenKey,
    updatedAt: Date.now(),
  }
}

function isValidSession(value: unknown): value is BuiltinSession {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return typeof record.serverUrl === "string"
    && typeof record.tokenKey === "string"
    && record.tokenKey.length > 0
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
    // 存储满了/被禁用：本次会话仍可用，只是重启后要重新登录。
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

/** 只露头尾，避免在界面上把完整令牌亮出来。 */
export function maskSecret(secret: string): string {
  const value = (secret ?? "").trim()
  if (value.length <= 12) return value ? "****" : ""
  return `${value.slice(0, 7)}…${value.slice(-4)}`
}
