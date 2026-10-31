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

import { authenticate } from "./auth"
import { jsonSuccess, failure } from "./http"
import { signNetCard } from "./netcard"
import { findSessionByTokenHash } from "./db"
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

  let body: { refreshToken?: unknown; deviceHash?: unknown } = {}
  try {
    body = (await request.clone().json()) as { refreshToken?: unknown; deviceHash?: unknown }
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
    const signed = await signNetCard(env, auth.user.id, session.id, now, isValidDeviceHash(body.deviceHash) ? body.deviceHash : null)
    return jsonSuccess({ netcard: signed.token })
  } catch {
    return failure("SERVER_ERROR", "网关卡尚未配置，请联系管理员。")
  }
}

/**
 * POST /v1/netcard/verify —— 回源校验（给中转站的吊销检查用）。
 *
 * 请求：`{ sessionId }`
 * 响应：`{ valid: boolean, reason?, userId? }`
 *
 * 注意：这个接口**不需要鉴权**（中转站持有的是自己的密钥，不是用户凭证），
 * 但它只回答"某个 session id 是否还有效"，不泄露任何用户信息（userId 是内部 id）。
 */
export async function handleVerifyNetCard(
  request: Request,
  env: Env,
  now: number,
): Promise<Response> {
  let body: { sessionId?: unknown } = {}
  try {
    body = (await request.json()) as { sessionId?: unknown }
  } catch {
    return failure("VALIDATION")
  }
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
  if (!sessionId) return failure("VALIDATION")

  const result = await env.DB.prepare(
    "SELECT id, user_id, revoked_at, expires_at FROM sessions WHERE id = ?1 LIMIT 1",
  )
    .bind(sessionId)
    .first<{ id: string; user_id: number; revoked_at: number | null; expires_at: number }>()

  if (!result) return jsonSuccess({ valid: false, reason: "session_not_found" })
  if (result.revoked_at !== null) return jsonSuccess({ valid: false, reason: "revoked" })
  if (result.expires_at <= now) return jsonSuccess({ valid: false, reason: "expired" })
  return jsonSuccess({ valid: true, userId: result.user_id })
}
