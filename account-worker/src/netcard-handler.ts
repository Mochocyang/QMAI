/**
 * 网卡片的签发与吊销查询。
 *
 * 两个接口：
 *   POST /v1/netcard         用当前登录态换一张网关卡（老用户升级用；换过一次就永久不用再换）
 *   POST /v1/netcard/verify  回源校验：这张卡对应的 session 还有效吗？
 *
 * 设计要点：
 *   - 卡与 sessions 表的一行绑定。签发要拿 session.id，所以**必须带 refreshToken**
 *     （accessToken 里只有 sub/email/jti，没有与 session 行对应的 id）。
 *   - 中转站平时靠本地 EdDSA 验签（只持公钥，无状态、快）。
 *     只有需要"立刻踢人"时才回调 `/v1/netcard/verify`，或者由中转站自己缓存吊销名单。
 */

import { authenticate, hashClientIp } from "./auth"
import { jsonSuccess, failure } from "./http"
import { signNetCard } from "./netcard"
import { consumeRateLimit, findSessionByTokenHash } from "./db"
import { hashRefreshToken } from "./crypto"
import { isValidDeviceHash } from "./device"
import type { Env } from "./types"

/** POST /v1/netcard —— 用 accessToken + refreshToken 换一张长期网关卡。 */
export async function handleIssueNetCard(
  request: Request,
  env: Env,
  now: number,
): Promise<Response> {
  const auth = await authenticate(request, env, now)
  if (!auth.ok) return auth.response

  let body: { refreshToken?: unknown; deviceHash?: unknown; devicePublicKey?: unknown } = {}
  try {
    body = (await request.clone().json()) as { refreshToken?: unknown; deviceHash?: unknown; devicePublicKey?: unknown }
  } catch {
    body = {}
  }
  const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : ""
  if (!refreshToken) return failure("VALIDATION")

  const tokenHash = await hashRefreshToken(refreshToken)
  const session = await findSessionByTokenHash(env.DB, tokenHash)
  // 会话必须属于当前用户、未吊销、未过期 —— 三者任一不满足都不签卡。
  if (!session) return failure("INVALID_REFRESH")
  if (session.user_id !== auth.user.id) return failure("INVALID_REFRESH")
  if (session.revoked_at !== null) return failure("INVALID_REFRESH")
  if (session.expires_at <= now) return failure("INVALID_REFRESH")

  try {
    const signed = await signNetCard(env, auth.user.id, session.id, now, isValidDeviceHash(body.deviceHash) ? body.deviceHash : null, typeof body.devicePublicKey === "string" ? body.devicePublicKey : null)
    return jsonSuccess({ netcard: signed.token })
  } catch {
    return failure("SERVER_ERROR", "网关卡尚未配置，请联系管理员。")
  }
}

/**
 * POST /v1/netcard/verify —— 回源校验（给中转站的吊销检查用）。
 *
 * 请求：`{ sessionId }`
 * 响应：`{ valid: boolean, reason? }`
 *
 * ## 为什么不再返回 userId
 *
 * 这个接口按设计**不需要鉴权**（中转站持自己的密钥，不是用户凭证）。
 * 但匿名可调 + 回吐 `userId`（自增整数）意味着任何人只要拿到一个 sessionId
 * 就能把「会话 → 账号」对上，还能顺着枚举摸出账号总量。账号身份不是
 * 这个接口的职责，中转站要用户信息应当走 /admin/users（有 ADMIN_KEY）。
 * 现在只回答「这面卡还能不能用」。
 *
 * ## 为什么要查 users.status
 *
 * 原来只查 sessions：封禁账号后，已签发的长期卡（10 年有效）照样通过校验，
 * 等于「封了号还能白嫖中转额度」。现在连 users 一起读，非 active 一律拒绝。
 *
 * ## 限流
 *
 * 匿名端点必须有闸门，否则可以用来批量探测 sessionId 是否有效。
 * 中转站侧有 60 秒缓存、调用频率很低，300 次/分钟/IP 对正常用量充裕。
 */
const VERIFY_PER_MINUTE_LIMIT = 300
const VERIFY_WINDOW_SECONDS = 60

export async function handleVerifyNetCard(
  request: Request,
  env: Env,
  now: number,
): Promise<Response> {
  const ipHash = await hashClientIp(env, request)
  const limited = await consumeRateLimit(
    env.DB,
    `netcard:verify:ip:${ipHash}`,
    VERIFY_PER_MINUTE_LIMIT,
    VERIFY_WINDOW_SECONDS,
    now,
  )
  if (!limited.allowed) {
    return failure("RATE_LIMITED", undefined, {
      "Retry-After": String(Math.max(1, limited.retryAfterSeconds)),
    })
  }

  let body: { sessionId?: unknown } = {}
  try {
    body = (await request.json()) as { sessionId?: unknown }
  } catch {
    return failure("VALIDATION")
  }
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
  if (!sessionId) return failure("VALIDATION")

  const result = await env.DB.prepare(
    `SELECT s.id, s.revoked_at, s.expires_at, u.status AS user_status
       FROM sessions s
       LEFT JOIN users u ON u.id = s.user_id
      WHERE s.id = ?1
      LIMIT 1`,
  )
    .bind(sessionId)
    .first<{ id: string; revoked_at: number | null; expires_at: number; user_status: string | null }>()

  if (!result) return jsonSuccess({ valid: false, reason: "session_not_found" })
  // 账号已不存在（LEFT JOIN 未命中）或已被封禁：卡立即失效。
  if (result.user_status !== "active") return jsonSuccess({ valid: false, reason: "account_disabled" })
  if (result.revoked_at !== null) return jsonSuccess({ valid: false, reason: "revoked" })
  if (result.expires_at <= now) return jsonSuccess({ valid: false, reason: "expired" })
  return jsonSuccess({ valid: true })
}
