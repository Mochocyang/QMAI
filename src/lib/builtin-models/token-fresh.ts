/**
 * 票据保鲜：保证写作请求拿到的永远是一张没过期的票。
 *
 * 为什么需要单独一层：中转票据只有 30 分钟，而 provider-bridge 会把 tokenKey
 * 写进 provider 配置。用户写着写着一张票就过期了 —— 不去续签，第 31 分钟起
 * 所有请求都会 401。这一层负责：
 *
 *   1. 提前 `SKEW_SECONDS` 秒判定"该换了"，避免卡在请求途中过期；
 *   2. 并发去重：同时来 5 个请求只换 1 次票，不发 5 个请求；
 *   3. 换票失败**不抛给用户**——回退用旧票，让上层按 401 走正常重登引导。
 *
 * 本文件不依赖 React / store，换票与持久化都以参数注入，方便单测。
 */

import { fetchRelayTicket, type RelayTicket } from "./gateway-api"
import type { BuiltinSession } from "./session"

/** 提前多少秒认为票据需要续签。与中转站 30 分钟 TTL 搭配，留 2 分钟余量。 */
export const SKEW_SECONDS = 120

export interface EnsureTicketOptions {
  /** 当前已保存的会话（可能为空：还没启用过）。 */
  session: BuiltinSession | null
  /** 账号服务地址（account.qmai.pro）。 */
  accountBaseUrl: string
  /** 账号登录态 accessToken。 */
  accountAccessToken: string | null
  /** 当前登录的 userId；换账号后旧票不能再用。 */
  userId: number | null
  /** 换票实现，默认打真实账号服务。 */
  exchange?: (accountBaseUrl: string, accessToken: string) => Promise<RelayTicket>
  /** 换到新票后的持久化钩子。 */
  onRefreshed?: (session: BuiltinSession) => void
  /** 测试注入"现在"。 */
  nowSeconds?: number
}

export interface EnsureTicketResult {
  session: BuiltinSession | null
  /** 这次是否真的去换了票。 */
  refreshed: boolean
}

function sessionUsable(
  session: BuiltinSession | null,
  userId: number | null,
  nowSeconds: number,
): boolean {
  if (!session) return false
  if (session.tokenKey.trim().length === 0) return false
  // 换账号了：旧票属于上一个用户，必须重换。
  if (userId !== null && session.userId !== userId) return false
  return !isAccessTokenExpiredAt(session.expiresAt, nowSeconds)
}

function isAccessTokenExpiredAt(expiresAt: number, nowSeconds: number): boolean {
  if (!expiresAt) return true
  return nowSeconds >= expiresAt - SKEW_SECONDS
}

/** 同一次运行内的并发去重：同账号同时只允许一次换票。 */
let inFlight: { key: string; promise: Promise<RelayTicket> } | null = null

export function resetTicketCache(): void {
  inFlight = null
}

export async function ensureBuiltinTicket(options: EnsureTicketOptions): Promise<EnsureTicketResult> {
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)

  if (sessionUsable(options.session, options.userId, nowSeconds)) {
    // 顺便把 isAccessTokenExpired 的语义对齐（提前 120 秒）——两处口径必须一致。
    return { session: options.session, refreshed: false }
  }

  if (!options.accountAccessToken) {
    // 没登录就没有可换的票；把旧票原样交回，让上层走"请先登录"引导。
    return { session: options.session, refreshed: false }
  }

  const exchange = options.exchange ?? ((base, token) => fetchRelayTicket(base, token))
  const key = `${options.accountBaseUrl}#${options.accountAccessToken.slice(-12)}`

  let ticket: RelayTicket
  try {
    if (inFlight && inFlight.key === key) {
      ticket = await inFlight.promise
    } else {
      const promise = exchange(options.accountBaseUrl, options.accountAccessToken)
      inFlight = { key, promise }
      try {
        ticket = await promise
      } finally {
        inFlight = null
      }
    }
  } catch {
    // 换票失败不打断写作：回退旧票，由上层按 401 给出重登提示。
    return { session: options.session, refreshed: false }
  }

  const next: BuiltinSession = {
    serverUrl: options.session?.serverUrl || "",
    tokenKey: ticket.token,
    expiresAt: ticket.expiresAt,
    userId: options.userId ?? options.session?.userId ?? 0,
    updatedAt: Date.now(),
  }
  options.onRefreshed?.(next)
  return { session: next, refreshed: true }
}
