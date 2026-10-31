/**
 * 管理接口：会话可见 + 可吊销（网关卡方案的止血能力）。
 *
 * 背景：网关卡长期有效，EdDSA 验签无状态 —— 签出去就收不回。
 * 要支持"发现异常后立刻踢人"，就得能操作 sessions 表的 revoked_at。
 * 网关按 sid 回源 `/v1/netcard/verify`（缓存 60 秒），所以吊销后最多 60 秒生效。
 *
 * 鉴权：`x-admin-key: <ADMIN_KEY>`，常数时间比较；未配置 ADMIN_KEY 时 503（失败关闭）。
 * 每次吊销写 revoke_audit，事后可追溯。
 *
 * 返回里**不含** token_hash / family_id / 网关卡本身 —— 列表只给够判断的信息。
 */

import type { Env } from "./types"

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  })
}

/** 常数时间比较，避免时序侧信道。 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function verifyAdminKey(env: Env, request: Request): boolean {
  const configured = (env.ADMIN_KEY ?? "").trim()
  if (!configured) return false
  const provided = request.headers.get("x-admin-key") ?? ""
  return safeEqual(provided, configured)
}

interface SessionRow {
  id: string
  user_id: number
  email: string | null
  display_name: string | null
  device_label: string | null
  created_at: number
  last_used_at: number
  expires_at: number
  revoked_at: number | null
}

/** GET /admin/sessions?status=active|revoked|all&userId=&page=&size= */
export async function handleAdminListSessions(request: Request, env: Env, url: URL): Promise<Response> {
  if (!verifyAdminKey(env, request)) {
    return json({ success: false, code: "UNAUTHORIZED", message: "管理密钥缺失或错误。" }, 401)
  }

  const status = url.searchParams.get("status") ?? "active"
  const userIdParam = (url.searchParams.get("userId") ?? "").trim()
  const size = Math.min(200, Math.max(1, Number(url.searchParams.get("size") ?? 50)))
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1))

  const where: string[] = []
  const args: unknown[] = []
  if (status === "active") where.push("s.revoked_at IS NULL AND s.expires_at > strftime('%s','now')")
  else if (status === "revoked") where.push("s.revoked_at IS NOT NULL")
  if (userIdParam) {
    args.push(Number(userIdParam))
    where.push(`s.user_id = ?${args.length}`)
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
  args.push(size, (page - 1) * size)

  const rows = await env.DB.prepare(
    `SELECT s.id, s.user_id, u.email, u.display_name, s.device_label,
            s.created_at, s.last_used_at, s.expires_at, s.revoked_at
       FROM sessions s
       LEFT JOIN users u ON u.id = s.user_id
       ${whereSql}
      ORDER BY s.last_used_at DESC
      LIMIT ?${args.length - 1} OFFSET ?${args.length}`,
  )
    .bind(...args)
    .all<SessionRow>()

  const total = await env.DB.prepare(
    `SELECT COUNT(*) n FROM sessions s ${whereSql}`,
  )
    .bind(...args.slice(0, args.length - 2))
    .first<{ n: number }>()

  return json({
    success: true,
    data: {
      items: rows.results.map((row) => ({
        id: row.id,
        userId: row.user_id,
        email: row.email,
        displayName: row.display_name,
        deviceLabel: row.device_label,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        status: row.revoked_at != null ? "revoked" : row.expires_at <= Math.floor(Date.now() / 1000) ? "expired" : "active",
      })),
      total: Number(total?.n ?? 0),
      page,
      size,
    },
  })
}

async function writeRevokeAudit(
  env: Env,
  scope: "user" | "session" | "all",
  target: string,
  reason: string,
  revoked: number,
  now: number,
): Promise<void> {
  try {
    await env.DB.prepare(
      "INSERT INTO revoke_audit (scope, target, reason, revoked, at) VALUES (?1,?2,?3,?4,?5)",
    )
      .bind(scope, target, reason.slice(0, 300), revoked, now)
      .run()
  } catch (error) {
    // 审计失败不阻塞吊销本身
    console.error("revoke_audit 写入失败:", error)
  }
}

/** POST /admin/sessions/revoke —— { userId } 或 { sessionId }，带 reason。 */
export async function handleAdminRevoke(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminKey(env, request)) {
    return json({ success: false, code: "UNAUTHORIZED", message: "管理密钥缺失或错误。" }, 401)
  }

  let body: { userId?: unknown; sessionId?: unknown; reason?: unknown }
  try {
    body = (await request.json()) as { userId?: unknown; sessionId?: unknown; reason?: unknown }
  } catch {
    return json({ success: false, code: "VALIDATION", message: "请求体不是合法 JSON。" }, 400)
  }

  const now = Math.floor(Date.now() / 1000)
  const reason = typeof body.reason === "string" ? body.reason : ""
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : ""
  const userId = Number(body.userId)

  let revoked = 0
  if (sessionId) {
    const result = await env.DB.prepare(
      "UPDATE sessions SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL",
    )
      .bind(now, sessionId)
      .run()
    revoked = Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0)
    await writeRevokeAudit(env, "session", sessionId, reason, revoked, now)
  } else if (Number.isInteger(userId) && userId > 0) {
    const result = await env.DB.prepare(
      "UPDATE sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL",
    )
      .bind(now, userId)
      .run()
    revoked = Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0)
    await writeRevokeAudit(env, "user", String(userId), reason, revoked, now)
  } else {
    return json({ success: false, code: "VALIDATION", message: "需要 userId 或 sessionId。" }, 400)
  }

  return json({ success: true, data: { revoked } })
}

/** POST /admin/sessions/revoke-all —— { confirm: "REVOKE-ALL", reason } */
export async function handleAdminRevokeAll(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminKey(env, request)) {
    return json({ success: false, code: "UNAUTHORIZED", message: "管理密钥缺失或错误。" }, 401)
  }

  let body: { confirm?: unknown; reason?: unknown }
  try {
    body = (await request.json()) as { confirm?: unknown; reason?: unknown }
  } catch {
    return json({ success: false, code: "VALIDATION", message: "请求体不是合法 JSON。" }, 400)
  }
  if (body.confirm !== "REVOKE-ALL") {
    return json({ success: false, code: "VALIDATION", message: '全局吊销必须带 confirm: "REVOKE-ALL"。' }, 400)
  }

  const now = Math.floor(Date.now() / 1000)
  const reason = typeof body.reason === "string" ? body.reason : ""
  const result = await env.DB.prepare(
    "UPDATE sessions SET revoked_at = ?1 WHERE revoked_at IS NULL",
  )
    .bind(now)
    .run()
  const revoked = Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0)
  await writeRevokeAudit(env, "all", "ALL", reason, revoked, now)

  return json({ success: true, data: { revoked } })
}

/** GET /admin/revoke-audit —— 最近吊销记录。 */
export async function handleAdminRevokeAudit(request: Request, env: Env, url: URL): Promise<Response> {
  if (!verifyAdminKey(env, request)) {
    return json({ success: false, code: "UNAUTHORIZED", message: "管理密钥缺失或错误。" }, 401)
  }
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20)))
  const rows = await env.DB.prepare(
    "SELECT id, scope, target, reason, revoked, at FROM revoke_audit ORDER BY id DESC LIMIT ?1",
  )
    .bind(limit)
    .all<Record<string, unknown>>()
  return json({ success: true, data: { entries: rows.results } })
}
