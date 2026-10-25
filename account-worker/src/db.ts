/**
 * D1 数据访问层。
 * 所有 SQL 都使用 prepared statement 参数绑定；动态 SQL 只出现在固定的
 * bucket / 表名层面，不拼接任何用户输入。
 */

import { evaluateRateLimit, type RateLimitDecision } from "./rate-limit"
import type { EmailCodeRow, SessionRow, UserRow } from "./types"

const USER_COLUMNS =
  "id, email, display_name, password_hash, status, created_at, updated_at"
const SESSION_COLUMNS =
  "id, user_id, family_id, token_hash, previous_token_hash, device_label, created_at, last_used_at, expires_at, revoked_at"
const EMAIL_CODE_COLUMNS =
  "id, email, purpose, code_hash, created_at, expires_at, attempts, consumed_at, request_ip_hash"

export async function findUserByEmail(
  db: D1Database,
  email: string,
): Promise<UserRow | null> {
  return db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?1`)
    .bind(email)
    .first<UserRow>()
}

export async function findUserById(db: D1Database, id: number): Promise<UserRow | null> {
  return db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?1`)
    .bind(id)
    .first<UserRow>()
}

export async function insertUser(
  db: D1Database,
  input: {
    email: string
    displayName: string
    passwordHash: string
    now: number
  },
): Promise<UserRow> {
  await db
    .prepare(
      `INSERT INTO users (email, display_name, password_hash, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'active', ?4, ?4)`,
    )
    .bind(input.email, input.displayName, input.passwordHash, input.now)
    .run()

  const user = await findUserByEmail(db, input.email)
  if (!user) throw new Error("inserted user not found")
  return user
}

export async function updateUserPassword(
  db: D1Database,
  userId: number,
  passwordHash: string,
  now: number,
): Promise<void> {
  await db
    .prepare("UPDATE users SET password_hash = ?2, updated_at = ?3 WHERE id = ?1")
    .bind(userId, passwordHash, now)
    .run()
}

export async function insertSession(db: D1Database, session: SessionRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sessions
         (id, user_id, family_id, token_hash, previous_token_hash, device_label,
          created_at, last_used_at, expires_at, revoked_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      session.id,
      session.user_id,
      session.family_id,
      session.token_hash,
      session.previous_token_hash,
      session.device_label,
      session.created_at,
      session.last_used_at,
      session.expires_at,
      session.revoked_at,
    )
    .run()
}

export async function findSessionByTokenHash(
  db: D1Database,
  tokenHash: string,
): Promise<SessionRow | null> {
  return db
    .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE token_hash = ?1`)
    .bind(tokenHash)
    .first<SessionRow>()
}

export async function findSessionByPreviousTokenHash(
  db: D1Database,
  tokenHash: string,
): Promise<SessionRow | null> {
  return db
    .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE previous_token_hash = ?1 LIMIT 1`)
    .bind(tokenHash)
    .first<SessionRow>()
}

/**
 * 轮换 refresh：当前 token_hash 挪到 previous_token_hash，再写入新哈希。
 * 同一设备始终只保留一行；条件里带 revoked_at IS NULL，避免撤销后又被改写。
 */
export async function rotateSession(
  db: D1Database,
  sessionId: string,
  previousTokenHash: string,
  newTokenHash: string,
  now: number,
  expiresAt: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE sessions
       SET previous_token_hash = ?2, token_hash = ?3, last_used_at = ?4, expires_at = ?5
       WHERE id = ?1 AND token_hash = ?2 AND revoked_at IS NULL`,
    )
    .bind(sessionId, previousTokenHash, newTokenHash, now, expiresAt)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export async function revokeSessionByTokenHash(
  db: D1Database,
  tokenHash: string,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE sessions SET revoked_at = ?2 WHERE token_hash = ?1 AND revoked_at IS NULL")
    .bind(tokenHash, now)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export async function revokeSessionFamily(
  db: D1Database,
  familyId: string,
  now: number,
): Promise<number> {
  const result = await db
    .prepare("UPDATE sessions SET revoked_at = ?2 WHERE family_id = ?1 AND revoked_at IS NULL")
    .bind(familyId, now)
    .run()
  return result.meta.changes ?? 0
}

export async function revokeAllUserSessions(
  db: D1Database,
  userId: number,
  now: number,
): Promise<number> {
  const result = await db
    .prepare("UPDATE sessions SET revoked_at = ?2 WHERE user_id = ?1 AND revoked_at IS NULL")
    .bind(userId, now)
    .run()
  return result.meta.changes ?? 0
}

export async function findLatestEmailCode(
  db: D1Database,
  email: string,
  purpose: string,
): Promise<EmailCodeRow | null> {
  return db
    .prepare(
      `SELECT ${EMAIL_CODE_COLUMNS} FROM email_codes
       WHERE email = ?1 AND purpose = ?2 AND consumed_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .bind(email, purpose)
    .first<EmailCodeRow>()
}

/** 新码生效时旧码立即作废（标记 consumed_at，而不是删除，保留审计痕迹）。 */
export async function invalidateEmailCodes(
  db: D1Database,
  email: string,
  purpose: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      "UPDATE email_codes SET consumed_at = ?3 WHERE email = ?1 AND purpose = ?2 AND consumed_at IS NULL",
    )
    .bind(email, purpose, now)
    .run()
}

export async function insertEmailCode(
  db: D1Database,
  input: {
    email: string
    purpose: string
    codeHash: string
    createdAt: number
    expiresAt: number
    requestIpHash: string
  },
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO email_codes
         (email, purpose, code_hash, created_at, expires_at, attempts, consumed_at, request_ip_hash)
       VALUES (?1, ?2, ?3, ?4, ?5, 0, NULL, ?6)
       RETURNING id`,
    )
    .bind(
      input.email,
      input.purpose,
      input.codeHash,
      input.createdAt,
      input.expiresAt,
      input.requestIpHash,
    )
    .first<{ id: number }>()
  if (!row) throw new Error("inserted email code not found")
  return row.id
}

export async function deleteEmailCode(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM email_codes WHERE id = ?1").bind(id).run()
}

/** 返回累加后的尝试次数；调用方据此决定 CODE_INVALID / CODE_ATTEMPTS。 */
export async function recordCodeAttempt(db: D1Database, id: number): Promise<number> {
  await db
    .prepare("UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?1 AND consumed_at IS NULL")
    .bind(id)
    .run()
  const row = await db
    .prepare("SELECT attempts FROM email_codes WHERE id = ?1")
    .bind(id)
    .first<{ attempts: number }>()
  return row?.attempts ?? 5
}

/** 原子消费：只有 consumed_at 仍为空时才能成功，避免同一码被并发复用。 */
export async function consumeEmailCode(
  db: D1Database,
  id: number,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE email_codes SET consumed_at = ?2 WHERE id = ?1 AND consumed_at IS NULL AND expires_at > ?2",
    )
    .bind(id, now)
    .run()
  return (result.meta.changes ?? 0) > 0
}

/**
 * 限流消费：读取当前窗口状态，用纯函数判定，再写回。
 * Workers 同一 isolate 内请求串行执行；跨 isolate 的极小概率竞态可接受。
 */
export async function consumeRateLimit(
  db: D1Database,
  bucket: string,
  limit: number,
  windowSeconds: number,
  now: number,
): Promise<RateLimitDecision> {
  const previous = await db
    .prepare("SELECT window_start, count FROM rate_limits WHERE bucket = ?1")
    .bind(bucket)
    .first<{ window_start: number; count: number }>()

  const decision = evaluateRateLimit(
    previous ? { windowStart: previous.window_start, count: previous.count } : null,
    limit,
    windowSeconds,
    now,
  )

  if (decision.allowed) {
    await db
      .prepare(
        `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?1, ?2, ?3)
         ON CONFLICT(bucket) DO UPDATE SET window_start = ?2, count = ?3`,
      )
      .bind(bucket, decision.state.windowStart, decision.state.count)
      .run()
  }

  return decision
}
