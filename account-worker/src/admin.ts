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
import { consumeRateLimit, findUserByEmail, peekRateLimit, setUserStatus } from "./db"
import { hashClientIp } from "./auth"

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

/**
 * 管理密钥的失败限流。
 *
 * 此前 `/admin/*` 只有常数时间比较、没有任何限流：ADMIN_KEY 短的话可以
 * 无限次试错，而它一旦泄露等于全站会话都能吊销（还能看到所有用户邮箱）。
 * 这里只对**失败**计数（正常运维请求不该被限），15 分钟 10 次，跨端点共用一个桶：
 * 攻击者换端点绕不过去。
 *
 * 先 peek 再决定：已超限就直接 429，连密钥比较都省了（避免把限流本身
 * 变成计时探针）。
 */
const ADMIN_FAIL_LIMIT = 10
const ADMIN_FAIL_WINDOW_SECONDS = 15 * 60

/**
 * 校验管理密钥；不通过时返回应当直接回给客户端的 Response。
 *
 * 所有 `/admin/*` 入口统一调用它，避免以后新增接口时忘记挂限流
 * （原来的写法是每个 handler 各写一遍 verifyAdminKey，漏一个就是缺口）。
 */
export async function guardAdmin(
  request: Request,
  env: Env,
  now = Math.floor(Date.now() / 1000),
): Promise<Response | null> {
  let bucket: string
  try {
    bucket = `admin:fail:ip:${await hashClientIp(env, request)}`
  } catch {
    // 取不到 pepper（配置不全）时不允许降级放行：宁可 503。
    return json({ success: false, code: "UNAUTHORIZED", message: "管理接口暂不可用。" }, 503)
  }

  const peeked = await peekRateLimit(env.DB, bucket, ADMIN_FAIL_LIMIT, ADMIN_FAIL_WINDOW_SECONDS, now)
  if (!peeked.allowed) {
    return new Response(
      JSON.stringify({ success: false, code: "RATE_LIMITED", message: "尝试次数过多，请稍后再试。" }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Retry-After": String(Math.max(1, peeked.retryAfterSeconds)),
        },
      },
    )
  }

  if (verifyAdminKey(env, request)) return null

  const consumed = await consumeRateLimit(env.DB, bucket, ADMIN_FAIL_LIMIT, ADMIN_FAIL_WINDOW_SECONDS, now)
  const retryAfter = Math.max(1, consumed.retryAfterSeconds)
  return new Response(
    JSON.stringify({ success: false, code: "UNAUTHORIZED", message: "管理密钥缺失或错误。" }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...(consumed.allowed ? {} : { "Retry-After": String(retryAfter) }),
      },
    },
  )
}

interface SessionRow {
  id: string
  user_id: number
  email: string | null
  display_name: string | null
  device_label: string | null
  device_id: string | null
  created_at: number
  last_used_at: number
  expires_at: number
  revoked_at: number | null
}

/** GET /admin/sessions?status=active|revoked|all&userId=&page=&size= */
export async function handleAdminListSessions(request: Request, env: Env, url: URL): Promise<Response> {
  const denied = await guardAdmin(request, env)
  if (denied) return denied

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
    `SELECT s.id, s.user_id, u.email, u.display_name, s.device_label, s.device_id,
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
        deviceId: row.device_id ?? null,
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
  scope: "user" | "session" | "all" | "user_status",
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
  const denied = await guardAdmin(request, env)
  if (denied) return denied

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
  const denied = await guardAdmin(request, env)
  if (denied) return denied

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
  const denied = await guardAdmin(request, env)
  if (denied) return denied
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20)))
  const rows = await env.DB.prepare(
    "SELECT id, scope, target, reason, revoked, at FROM revoke_audit ORDER BY id DESC LIMIT ?1",
  )
    .bind(limit)
    .all<Record<string, unknown>>()
  return json({ success: true, data: { entries: rows.results } })
}

/**
 * GET /admin/users —— 用户列表（供中转站同步身份用）。
 *
 * ## 为什么需要这个接口
 *
 * 中转站的 `usage_logs` 只有 user_id 数字，没法在控制台显示
 * 「Moc <pairy0@sina.com> 用了 97.9K token」这种可读信息。
 * 有了这个接口，中转站可以定期拉一次存到本地缓存表。
 *
 * ## 只返回非敏感字段
 *
 * 绝不返回 password_hash、avatar_data（可能几百 KB）。
 * 头像只给一个版本号，需要时再单独取。
 */
export async function handleAdminListUsers(request: Request, env: Env, url: URL): Promise<Response> {
  const denied = await guardAdmin(request, env)
  if (denied) return denied

  const size = Math.min(500, Math.max(1, Number(url.searchParams.get("size") ?? 200)))
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1))
  const since = Number(url.searchParams.get("since") ?? 0)

  // since 用于增量同步：只拉这个时间之后有更新的用户
  const where = since > 0 ? "WHERE u.updated_at >= ?1" : ""
  const args: unknown[] = since > 0 ? [since] : []
  args.push(size, (page - 1) * size)

  const rows = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.status, u.created_at,
            u.updated_at, u.avatar_updated_at, u.display_name_updated_at
       FROM users u
       ${where}
      ORDER BY u.id
      LIMIT ?${args.length - 1} OFFSET ?${args.length}`,
  )
    .bind(...args)
    .all<Record<string, unknown>>()

  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<Record<string, unknown>>()

  return json({
    success: true,
    data: {
      users: (rows.results ?? []).map((r) => ({
        id: Number(r.id),
        email: String(r.email ?? ""),
        displayName: String(r.display_name ?? ""),
        status: String(r.status ?? "active"),
        createdAt: Number(r.created_at ?? 0),
        updatedAt: Number(r.updated_at ?? 0),
        avatarUpdatedAt: Number(r.avatar_updated_at ?? 0),
      })),
      total: Number(total?.n ?? 0),
      page,
      size,
    },
  })
}

/**
 * POST /admin/users/status —— 封禁 / 解封账号。
 *
 * 请求：`{ userId? | email?, status: "active" | "disabled", reason? }`
 *
 * ## 为什么需要它
 *
 * `users.status` 建表起就有、`authenticate()` 一直在按它拦人，但此前
 * **没有任何写入路径**：条款 4.4 承诺「可封禁账号」，实际管理员只能吊销
 * 会话，用户重新登录就复活，等于承诺了做不到的事。
 *
 * ## 封禁必须连带吊销会话
 *
 * `authenticate()` 每次读 DB 判 status，所以封禁对 accessToken 是立刻生效的；
 * 但 sessions 行本身还活着（refresh 会被拒），留着只是脏数据，也不符合
 * 「这个号已被处置」的运维语义。所以封禁时一并吊销该用户全部会话，
 * 审计里记录连带吊销了几条。
 *
 * 解封不动会话：恢复使用应当重新登录，而不是复活旧设备上的登录态。
 */
export async function handleAdminSetUserStatus(request: Request, env: Env): Promise<Response> {
  const denied = await guardAdmin(request, env)
  if (denied) return denied

  let body: { userId?: unknown; email?: unknown; status?: unknown; reason?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ success: false, code: "VALIDATION", message: "请求体不是合法 JSON。" }, 400)
  }

  const status = body.status === "disabled" ? "disabled" : body.status === "active" ? "active" : null
  if (!status) {
    return json({ success: false, code: "VALIDATION", message: 'status 只能是 "active" 或 "disabled"。' }, 400)
  }

  const now = Math.floor(Date.now() / 1000)
  const reason = typeof body.reason === "string" ? body.reason : ""

  const requestedId = Number(body.userId)
  let userId = Number.isInteger(requestedId) && requestedId > 0 ? requestedId : 0
  if (!userId && typeof body.email === "string") {
    const found = await findUserByEmail(env.DB, body.email.trim().toLowerCase())
    if (!found) return json({ success: false, code: "NOT_FOUND", message: "该邮箱没有账号。" }, 404)
    userId = found.id
  }
  if (!userId) {
    return json({ success: false, code: "VALIDATION", message: "需要 userId 或 email。" }, 400)
  }

  const changed = await setUserStatus(env.DB, userId, status, now)
  if (!changed) return json({ success: false, code: "NOT_FOUND", message: "账号不存在。" }, 404)

  let revokedSessions = 0
  if (status === "disabled") {
    const result = await env.DB.prepare(
      "UPDATE sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL",
    )
      .bind(now, userId)
      .run()
    revokedSessions = Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0)
  }

  // 复用吊销审计表：scope 记 "user_status"，revoked 记连带吊销的会话数。
  await writeRevokeAudit(
    env,
    "user_status",
    String(userId),
    `${status}${reason ? `：${reason}` : ""}`,
    revokedSessions,
    now,
  )

  return json({ success: true, data: { userId, status, revokedSessions } })
}
