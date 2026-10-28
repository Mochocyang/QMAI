/**
 * D1 数据访问层。
 * 所有 SQL 都使用 prepared statement 参数绑定；动态 SQL 只出现在固定的
 * bucket / 表名层面，不拼接任何用户输入。
 */

import { peekRateLimitDecision, type RateLimitDecision, type RateLimitPeek } from "./rate-limit"
import { MAX_CODE_ATTEMPTS, NAME_CHANGE_COOLDOWN_SECONDS } from "./constants"
import type { EmailCodeRow, SessionRow, UserRow } from "./types"

const USER_COLUMNS =
  "id, email, display_name, password_hash, status, created_at, updated_at, avatar_updated_at, display_name_updated_at"
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
  const user = await db
    .prepare(
      `INSERT INTO users (email, display_name, password_hash, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'active', ?4, ?4)
       RETURNING ${USER_COLUMNS}`,
    )
    .bind(input.email, input.displayName, input.passwordHash, input.now)
    .first<UserRow>()

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

/**
 * 改昵称：同时写下 `display_name_updated_at`（每月一次的判据）。
 *
 * 条件里再判一次 `display_name_updated_at`：并发两个请求时，只有一个能真正写入，
 * 否则"每月一次"在双击/双设备下会被绕过。
 */
export async function updateUserDisplayName(
  db: D1Database,
  userId: number,
  displayName: string,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE users SET display_name = ?2, display_name_updated_at = ?3, updated_at = ?3
       WHERE id = ?1 AND (display_name_updated_at IS NULL OR display_name_updated_at <= ?4)`,
    )
    .bind(userId, displayName, now, now - NAME_CHANGE_COOLDOWN_SECONDS)
    .run()
  return (result.meta?.changes ?? 0) > 0
}

/** 只取头像二进制，避免把整行（含密码哈希）读进来。 */
export async function findUserAvatar(
  db: D1Database,
  userId: number,
): Promise<{ mime: string; data: Uint8Array } | null> {
  const row = await db
    .prepare("SELECT avatar_mime, avatar_data FROM users WHERE id = ?1")
    .bind(userId)
    .first<{ avatar_mime: string | null; avatar_data: unknown }>()

  if (!row?.avatar_mime || row.avatar_data === null || row.avatar_data === undefined) {
    return null
  }

  // D1 返回二进制的形态不稳定：可能是 ArrayBuffer、TypedArray，
  // 实测在线上运行时是普通 number[]（Object.prototype.toString 为 [object Array]）。
  // 三种都兼容，否则会出现「数据库有 1227 字节、接口却返回 0 字节」。
  const raw = row.avatar_data
  let bytes: Uint8Array
  if (ArrayBuffer.isView(raw)) {
    bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength).slice()
  } else if (raw instanceof ArrayBuffer) {
    bytes = new Uint8Array(raw).slice()
  } else if (Array.isArray(raw)) {
    bytes = Uint8Array.from(raw as number[])
  } else {
    return null
  }

  if (bytes.byteLength === 0) return null

  return { mime: row.avatar_mime, data: bytes }
}

/** 写入头像并更新版本号；返回新版本号（Unix 秒）。 */
export async function updateUserAvatar(
  db: D1Database,
  userId: number,
  mime: string,
  data: ArrayBuffer,
  now: number,
): Promise<number> {
  await db
    .prepare(
      "UPDATE users SET avatar_mime = ?2, avatar_data = ?3, avatar_updated_at = ?4, updated_at = ?4 WHERE id = ?1",
    )
    .bind(userId, mime, data, now)
    .run()
  return now
}

/** 删除头像；没有头像时也是成功（幂等）。 */
export async function clearUserAvatar(
  db: D1Database,
  userId: number,
  now: number,
): Promise<void> {
  await db
    .prepare(
      "UPDATE users SET avatar_mime = NULL, avatar_data = NULL, avatar_updated_at = NULL, updated_at = ?2 WHERE id = ?1",
    )
    .bind(userId, now)
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

/**
 * 撤销该用户除指定 refresh token 之外的会话。
 * 改密后保留当前设备，其它设备强制重新登录。
 */
export async function revokeOtherUserSessions(
  db: D1Database,
  userId: number,
  keepTokenHash: string,
  now: number,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE sessions SET revoked_at = ?3
       WHERE user_id = ?1 AND revoked_at IS NULL
         AND token_hash <> ?2 AND (previous_token_hash IS NULL OR previous_token_hash <> ?2)`,
    )
    .bind(userId, keepTokenHash, now)
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

/**
 * 返回累加后的尝试次数；调用方据此决定 CODE_INVALID / CODE_ATTEMPTS。
 * 只有请求 IP 与发码 IP 一致（或发码时没记录 IP）才累加，避免其他 IP
 * 用错误码烧掉受害者的验证码。条件 UPDATE 后 SELECT 当前值。
 */
export async function recordCodeAttempt(
  db: D1Database,
  id: number,
  ipHash: string,
): Promise<number> {
  await db
    .prepare(
      `UPDATE email_codes SET attempts = attempts + 1
       WHERE id = ?1
         AND (request_ip_hash IS NULL OR request_ip_hash = ?2)
         AND consumed_at IS NULL`,
    )
    .bind(id, ipHash)
    .run()
  const row = await db
    .prepare("SELECT attempts FROM email_codes WHERE id = ?1")
    .bind(id)
    .first<{ attempts: number }>()
  return row?.attempts ?? MAX_CODE_ATTEMPTS
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
 * 原子消费一次限流配额：单条 UPSERT ... RETURNING，返回的 count 已含本次。
 * allowed = count <= limit；窗口起点以首次请求为准，窗口结束自动重置。
 */
export async function consumeRateLimit(
  db: D1Database,
  bucket: string,
  limit: number,
  windowSeconds: number,
  now: number,
): Promise<RateLimitDecision> {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT(bucket) DO UPDATE SET
         window_start = CASE WHEN rate_limits.window_start <= ?2
                              AND ?2 < rate_limits.window_start + ?3
                             THEN rate_limits.window_start ELSE ?2 END,
         count = CASE WHEN rate_limits.window_start <= ?2
                        AND ?2 < rate_limits.window_start + ?3
                       THEN rate_limits.count + 1 ELSE 1 END
       RETURNING window_start, count`,
    )
    .bind(bucket, now, windowSeconds)
    .first<{ window_start: number; count: number }>()

  if (!row) throw new Error("rate limit upsert returned no row")

  const allowed = row.count <= limit
  return {
    allowed,
    state: { windowStart: row.window_start, count: row.count },
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, row.window_start + windowSeconds - now),
  }
}

/** 只读判断当前桶是否还有配额，不写入；用于登录前保护 PBKDF2。 */
export async function peekRateLimit(
  db: D1Database,
  bucket: string,
  limit: number,
  windowSeconds: number,
  now: number,
): Promise<RateLimitPeek> {
  const row = await db
    .prepare("SELECT window_start, count FROM rate_limits WHERE bucket = ?1")
    .bind(bucket)
    .first<{ window_start: number; count: number }>()

  return peekRateLimitDecision(
    row ? { windowStart: row.window_start, count: row.count } : null,
    limit,
    windowSeconds,
    now,
  )
}

export async function deleteRateLimit(db: D1Database, bucket: string): Promise<void> {
  await db.prepare("DELETE FROM rate_limits WHERE bucket = ?1").bind(bucket).run()
}

export interface CleanupCounts {
  rateLimits: number
  emailCodes: number
  sessions: number
}

/**
 * 每日清理：24 小时前的限流桶、7 天前的验证码、过期或撤销 30 天前的会话。
 * 由 index.ts 的 scheduled 调用，使用 D1 batch 一次提交。
 */
export async function cleanupExpiredData(
  db: D1Database,
  now: number,
): Promise<CleanupCounts> {
  const daySeconds = 24 * 60 * 60
  const results = await db.batch([
    db
      .prepare("DELETE FROM rate_limits WHERE window_start < ?1")
      .bind(now - daySeconds),
    db
      .prepare("DELETE FROM email_codes WHERE created_at < ?1")
      .bind(now - 7 * daySeconds),
    db
      .prepare(
        `DELETE FROM sessions
         WHERE expires_at < ?1
            OR (revoked_at IS NOT NULL AND revoked_at < ?1)`,
      )
      .bind(now - 30 * daySeconds),
  ])

  return {
    rateLimits: results[0]?.meta.changes ?? 0,
    emailCodes: results[1]?.meta.changes ?? 0,
    sessions: results[2]?.meta.changes ?? 0,
  }
}
