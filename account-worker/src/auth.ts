/**
 * 账号业务层：发码、注册、登录、续期、退出、me、重置密码。
 * 所有函数只返回统一信封 Response；路由与 CORS 在 index.ts 收口。
 */

import {
  REFRESH_TOKEN_TTL_SECONDS,
  JwtVerificationError,
  dummyPasswordCheck,
  generateNumericCode,
  generateRefreshToken,
  hashEmailCode,
  hashIp,
  hashPassword,
  hashRefreshToken,
  resolvePasswordIterations,
  sha256Hex,
  signAccessToken,
  timingSafeEqualHex,
  verifyAccessToken,
  verifyPassword,
} from "./crypto"
import {
  consumeEmailCode,
  consumeRateLimit,
  deleteEmailCode,
  deleteRateLimit,
  findLatestEmailCode,
  findSessionByPreviousTokenHash,
  findSessionByTokenHash,
  findUserByEmail,
  findUserById,
  insertEmailCode,
  insertSession,
  insertUser,
  invalidateEmailCodes,
  peekRateLimit,
  recordCodeAttempt,
  revokeAllUserSessions,
  revokeSessionByTokenHash,
  revokeSessionFamily,
  rotateSession,
  updateUserPassword,
} from "./db"
import { MAX_CODE_ATTEMPTS } from "./constants"
import { sendRegisteredNotice, sendVerificationEmail } from "./email"
import { failure, jsonSuccess, readJsonBody } from "./http"
import type {
  ApiErrorCode,
  AuthPayload,
  CodePurpose,
  Env,
  PublicUser,
  SessionRow,
  UserRow,
} from "./types"
import {
  isValidCode,
  isValidEmail,
  isValidPassword,
  isValidRefreshTokenFormat,
  normalizeDeviceLabel,
  normalizeDisplayName,
  normalizeEmail,
  normalizePurpose,
} from "./validation"

const EMAIL_CODE_TTL_SECONDS = 10 * 60
const EMAIL_SEND_COOLDOWN_SECONDS = 60
const EMAIL_SEND_HOURLY_LIMIT = 5
const IP_SEND_HOURLY_LIMIT = 20
const VERIFY_EMAIL_HOURLY_LIMIT = 20
const VERIFY_IP_HOURLY_LIMIT = 30
const VERIFY_EMAIL_GLOBAL_LIMIT = 20
const VERIFY_EMAIL_GLOBAL_WINDOW_SECONDS = 10 * 60
const LOGIN_FAIL_WINDOW_SECONDS = 15 * 60
const LOGIN_FAIL_EMAIL_LIMIT = 10
const LOGIN_FAIL_IP_LIMIT = 30
const HOUR_SECONDS = 60 * 60

type CodeVerification =
  | { ok: true }
  | {
      ok: false
      code: Extract<
        ApiErrorCode,
        "CODE_INVALID" | "CODE_EXPIRED" | "CODE_ATTEMPTS" | "RATE_LIMITED"
      >
    }

function currentSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function logEvent(event: string, fields: Record<string, string | number> = {}): void {
  console.log(`[account] ${event}`, fields)
}

function getJwtSecret(env: Env): string {
  if (!env.AUTH_JWT_SECRET) throw new Error("AUTH_JWT_SECRET is not configured")
  return env.AUTH_JWT_SECRET
}

function getPepper(env: Env): string {
  if (!env.AUTH_CODE_PEPPER) throw new Error("AUTH_CODE_PEPPER is not configured")
  return env.AUTH_CODE_PEPPER
}

function isDevCodeAllowed(env: Env): boolean {
  return env.ENVIRONMENT === "development" && env.ALLOW_DEV_CODE === "true"
}

function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    createdAt: user.created_at,
  }
}

function clientIp(request: Request, env: Env): string {
  // 本地 wrangler 也会注入 CF-Connecting-IP（通常恒为 127.0.0.1），
  // 开发模式优先用 X-Forwarded-For，便于联调/冒烟模拟不同来源 IP。
  if (env.ENVIRONMENT === "development") {
    const forwarded = request.headers.get("X-Forwarded-For")
    if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown"
  }
  const connectingIp = request.headers.get("CF-Connecting-IP")
  if (connectingIp) return connectingIp
  return "unknown"
}

function rateLimited(retryAfterSeconds: number): Response {
  return failure("RATE_LIMITED", undefined, {
    "Retry-After": String(Math.max(1, retryAfterSeconds)),
  })
}

async function verifyEmailCode(
  env: Env,
  email: string,
  purpose: CodePurpose,
  code: string,
  now: number,
  ipHash: string,
): Promise<CodeVerification> {
  // 先限制校验次数，避免攻击者用错误码快速烧掉受害者的验证码。
  const ipLimit = await consumeRateLimit(
    env.DB,
    `verify:ip:${ipHash}`,
    VERIFY_IP_HOURLY_LIMIT,
    HOUR_SECONDS,
    now,
  )
  if (!ipLimit.allowed) return { ok: false, code: "RATE_LIMITED" }

  const emailKey = await sha256Hex(email)
  const perIpEmailBucket = `verify:email:${emailKey}:${ipHash}`
  const emailLimit = await consumeRateLimit(
    env.DB,
    perIpEmailBucket,
    VERIFY_EMAIL_HOURLY_LIMIT,
    HOUR_SECONDS,
    now,
  )
  if (!emailLimit.allowed) return { ok: false, code: "RATE_LIMITED" }

  // 全局 per-email 猜测桶（10 分钟，与码 TTL 一致）防止攻击者换 IP 猜同一邮箱。
  const globalEmailBucket = `verify:email:global:${emailKey}`
  const globalLimit = await consumeRateLimit(
    env.DB,
    globalEmailBucket,
    VERIFY_EMAIL_GLOBAL_LIMIT,
    VERIFY_EMAIL_GLOBAL_WINDOW_SECONDS,
    now,
  )
  if (!globalLimit.allowed) return { ok: false, code: "RATE_LIMITED" }

  const record = await findLatestEmailCode(env.DB, email, purpose)
  if (!record) return { ok: false, code: "CODE_INVALID" }
  if (record.expires_at <= now) return { ok: false, code: "CODE_EXPIRED" }
  if (record.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, code: "CODE_ATTEMPTS" }

  const expected = await hashEmailCode(getPepper(env), email, purpose, code)
  if (!timingSafeEqualHex(expected, record.code_hash)) {
    const attempts = await recordCodeAttempt(env.DB, record.id, ipHash)
    return {
      ok: false,
      code: attempts >= MAX_CODE_ATTEMPTS ? "CODE_ATTEMPTS" : "CODE_INVALID",
    }
  }

  const consumed = await consumeEmailCode(env.DB, record.id, now)
  if (!consumed) return { ok: false, code: "CODE_INVALID" }

  // 成功验码后清掉本 IP 邮箱桶与全局桶，避免成功用户被后续请求连累。
  await deleteRateLimit(env.DB, perIpEmailBucket)
  await deleteRateLimit(env.DB, globalEmailBucket)
  return { ok: true }
}

async function issueAuthPayload(
  env: Env,
  user: UserRow,
  now: number,
  deviceLabel: string | null,
): Promise<AuthPayload> {
  const refreshToken = generateRefreshToken()
  const refreshTokenHash = await hashRefreshToken(refreshToken)
  const refreshExpiresAt = now + REFRESH_TOKEN_TTL_SECONDS

  const session: SessionRow = {
    id: crypto.randomUUID(),
    user_id: user.id,
    family_id: crypto.randomUUID(),
    token_hash: refreshTokenHash,
    previous_token_hash: null,
    device_label: deviceLabel,
    created_at: now,
    last_used_at: now,
    expires_at: refreshExpiresAt,
    revoked_at: null,
  }
  await insertSession(env.DB, session)

  const access = await signAccessToken(
    getJwtSecret(env),
    { id: user.id, email: user.email },
    now,
  )

  return {
    user: toPublicUser(user),
    accessToken: access.token,
    accessExpiresAt: access.expiresAt,
    refreshToken,
    refreshExpiresAt,
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /unique/i.test(error.message)
}

/** POST /v1/auth/send-code */
export async function handleSendCode(
  request: Request,
  env: Env,
  now = currentSeconds(),
): Promise<Response> {
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  const email = normalizeEmail(parsed.body.email)
  if (!isValidEmail(email)) return failure("VALIDATION")

  const purpose = normalizePurpose(parsed.body.purpose)
  if (!purpose) return failure("VALIDATION")

  const emailKey = await sha256Hex(email)
  const ipHash = await hashIp(getPepper(env), clientIp(request, env))

  const cooldown = await consumeRateLimit(
    env.DB,
    `send:email:${emailKey}`,
    1,
    EMAIL_SEND_COOLDOWN_SECONDS,
    now,
  )
  if (!cooldown.allowed) return rateLimited(cooldown.retryAfterSeconds)

  const hourlyEmail = await consumeRateLimit(
    env.DB,
    `send:email:hour:${emailKey}`,
    EMAIL_SEND_HOURLY_LIMIT,
    HOUR_SECONDS,
    now,
  )
  if (!hourlyEmail.allowed) return rateLimited(hourlyEmail.retryAfterSeconds)

  const hourlyIp = await consumeRateLimit(
    env.DB,
    `send:ip:${ipHash}`,
    IP_SEND_HOURLY_LIMIT,
    HOUR_SECONDS,
    now,
  )
  if (!hourlyIp.allowed) return rateLimited(hourlyIp.retryAfterSeconds)

  const user = await findUserByEmail(env.DB, email)

  // 已注册邮箱请求注册验证码：不写码，只发“请直接登录”通知，响应保持一致。
  if (purpose === "register" && user) {
    const notice = await sendRegisteredNotice(env, email)
    if (!notice.ok) logEvent("registered_notice_failed")
    return jsonSuccess({ cooldownSeconds: EMAIL_SEND_COOLDOWN_SECONDS })
  }

  // 未注册邮箱请求重置验证码：同样返回成功，避免账号枚举。
  if (purpose === "reset" && !user) {
    return jsonSuccess({ cooldownSeconds: EMAIL_SEND_COOLDOWN_SECONDS })
  }

  const code = generateNumericCode()
  const codeHash = await hashEmailCode(getPepper(env), email, purpose, code)

  await invalidateEmailCodes(env.DB, email, purpose, now)
  const codeId = await insertEmailCode(env.DB, {
    email,
    purpose,
    codeHash,
    createdAt: now,
    expiresAt: now + EMAIL_CODE_TTL_SECONDS,
    requestIpHash: ipHash,
  })

  const sent = await sendVerificationEmail(env, { to: email, code, purpose })
  if (!sent.ok) {
    // 发送失败时删掉刚写入的码，避免留下用户永远收不到的有效码。
    await deleteEmailCode(env.DB, codeId)
    return failure("EMAIL_SEND_FAILED")
  }

  const data: { cooldownSeconds: number; devCode?: string } = {
    cooldownSeconds: EMAIL_SEND_COOLDOWN_SECONDS,
  }
  if (isDevCodeAllowed(env)) data.devCode = code
  return jsonSuccess(data)
}

/** POST /v1/auth/register */
export async function handleRegister(
  request: Request,
  env: Env,
  now = currentSeconds(),
): Promise<Response> {
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  const email = normalizeEmail(parsed.body.email)
  if (!isValidEmail(email)) return failure("VALIDATION")

  const code = parsed.body.code
  if (!isValidCode(code)) return failure("VALIDATION")

  const password = parsed.body.password
  if (!isValidPassword(password)) return failure("VALIDATION")

  if (await findUserByEmail(env.DB, email)) return failure("EMAIL_TAKEN")

  const ipHash = await hashIp(getPepper(env), clientIp(request, env))
  const verification = await verifyEmailCode(env, email, "register", code, now, ipHash)
  if (!verification.ok) return failure(verification.code)

  const passwordHash = await hashPassword(
    password,
    resolvePasswordIterations(env.PASSWORD_ITERATIONS),
  )
  const displayName = normalizeDisplayName(parsed.body.displayName, email)

  let user: UserRow
  try {
    user = await insertUser(env.DB, { email, displayName, passwordHash, now })
  } catch (error) {
    if (isUniqueConstraintError(error)) return failure("EMAIL_TAKEN")
    throw error
  }

  const payload = await issueAuthPayload(env, user, now, normalizeDeviceLabel(parsed.body.deviceLabel))
  logEvent("register_ok", { userId: user.id })
  return jsonSuccess(payload)
}

/** POST /v1/auth/login */
export async function handleLogin(
  request: Request,
  env: Env,
  now = currentSeconds(),
): Promise<Response> {
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  const email = normalizeEmail(parsed.body.email)
  if (!isValidEmail(email)) return failure("VALIDATION")

  const password = parsed.body.password
  if (typeof password !== "string" || password.length === 0 || password.length > 128) {
    return failure("VALIDATION")
  }

  const emailKey = await sha256Hex(email)
  const ipHash = await hashIp(getPepper(env), clientIp(request, env))
  const failEmailBucket = `login:fail:email:${emailKey}`
  const failIpBucket = `login:fail:ip:${ipHash}`

  // IP 闸门先于 PBKDF2：失败次数已满时直接拒绝，避免被用来打 CPU。
  const ipPeek = await peekRateLimit(
    env.DB,
    failIpBucket,
    LOGIN_FAIL_IP_LIMIT,
    LOGIN_FAIL_WINDOW_SECONDS,
    now,
  )
  if (!ipPeek.allowed) return rateLimited(ipPeek.retryAfterSeconds)

  // 邮箱失败桶只做只读判断；即使已满，也仍要验密，正确密码可清桶放行，
  // 防止攻击者用错误尝试永久锁死受害者账号。
  const emailPeek = await peekRateLimit(
    env.DB,
    failEmailBucket,
    LOGIN_FAIL_EMAIL_LIMIT,
    LOGIN_FAIL_WINDOW_SECONDS,
    now,
  )

  const iterations = resolvePasswordIterations(env.PASSWORD_ITERATIONS)
  const user = await findUserByEmail(env.DB, email)

  let passwordValid = false
  if (user) {
    passwordValid = await verifyPassword(password, user.password_hash)
  } else {
    // 账号不存在时也执行一次等价 PBKDF2，避免时间侧信道枚举邮箱。
    await dummyPasswordCheck(password, iterations)
  }

  if (!passwordValid) {
    const emailFail = await consumeRateLimit(
      env.DB,
      failEmailBucket,
      LOGIN_FAIL_EMAIL_LIMIT,
      LOGIN_FAIL_WINDOW_SECONDS,
      now,
    )
    const ipFail = await consumeRateLimit(
      env.DB,
      failIpBucket,
      LOGIN_FAIL_IP_LIMIT,
      LOGIN_FAIL_WINDOW_SECONDS,
      now,
    )

    const retryAfterSeconds = Math.max(
      emailFail.retryAfterSeconds,
      ipFail.retryAfterSeconds,
    )
    if (!emailPeek.allowed || !emailFail.allowed || !ipFail.allowed) {
      return rateLimited(retryAfterSeconds)
    }
    return failure("INVALID_CREDENTIALS")
  }

  // 密码正确才清邮箱失败桶；IP 桶保留，避免换号绕过 IP 级失败上限。
  await deleteRateLimit(env.DB, failEmailBucket)

  // 密码校验通过必然存在用户；这里仅为类型收窄与防御性兜底。
  if (!user) return failure("INVALID_CREDENTIALS")
  if (user.status !== "active") return failure("ACCOUNT_DISABLED")

  const payload = await issueAuthPayload(env, user, now, normalizeDeviceLabel(parsed.body.deviceLabel))
  logEvent("login_ok", { userId: user.id })
  return jsonSuccess(payload)
}

/** POST /v1/auth/refresh */
export async function handleRefresh(
  request: Request,
  env: Env,
  now = currentSeconds(),
): Promise<Response> {
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  const refreshToken = parsed.body.refreshToken
  if (!isValidRefreshTokenFormat(refreshToken)) return failure("INVALID_REFRESH")

  const tokenHash = await hashRefreshToken(refreshToken)
  const session = await findSessionByTokenHash(env.DB, tokenHash)

  if (session) {
    if (session.revoked_at !== null) return failure("INVALID_REFRESH")
    if (session.expires_at <= now) {
      await revokeSessionByTokenHash(env.DB, tokenHash, now)
      return failure("INVALID_REFRESH")
    }

    const user = await findUserById(env.DB, session.user_id)
    if (!user) {
      await revokeSessionByTokenHash(env.DB, tokenHash, now)
      return failure("INVALID_REFRESH")
    }
    if (user.status !== "active") {
      await revokeSessionByTokenHash(env.DB, tokenHash, now)
      return failure("ACCOUNT_DISABLED")
    }

    const newRefreshToken = generateRefreshToken()
    const newTokenHash = await hashRefreshToken(newRefreshToken)
    const refreshExpiresAt = now + REFRESH_TOKEN_TTL_SECONDS
    const rotated = await rotateSession(
      env.DB,
      session.id,
      tokenHash,
      newTokenHash,
      now,
      refreshExpiresAt,
    )
    // 条件更新失败 = 同一 refresh 被并发提交，已不再可信。
    if (!rotated) {
      logEvent("refresh_rotation_conflict", {
        userId: user.id,
        sessionId: session.id,
      })
      return failure("INVALID_REFRESH")
    }

    const access = await signAccessToken(
      getJwtSecret(env),
      { id: user.id, email: user.email },
      now,
    )

    return jsonSuccess({
      user: toPublicUser(user),
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken: newRefreshToken,
      refreshExpiresAt,
    })
  }

  // 命中 previous_token_hash：刚被轮换的旧 token 又出现，判定泄露并撤销整族。
  const reused = await findSessionByPreviousTokenHash(env.DB, tokenHash)
  if (reused) {
    const revoked = await revokeSessionFamily(env.DB, reused.family_id, now)
    logEvent("refresh_reuse_detected", { userId: reused.user_id, revoked })
  }

  return failure("INVALID_REFRESH")
}

/** POST /v1/auth/logout（幂等） */
export async function handleLogout(
  request: Request,
  env: Env,
  now = currentSeconds(),
): Promise<Response> {
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  const refreshToken = parsed.body.refreshToken
  if (isValidRefreshTokenFormat(refreshToken)) {
    const tokenHash = await hashRefreshToken(refreshToken)
    await revokeSessionByTokenHash(env.DB, tokenHash, now)
  }

  return jsonSuccess(null)
}

/** GET /v1/auth/me */
export async function handleMe(
  request: Request,
  env: Env,
  now = currentSeconds(),
): Promise<Response> {
  const authorization = request.headers.get("Authorization") ?? ""
  const match = /^Bearer\s+(.+)$/i.exec(authorization)
  if (!match?.[1]) return failure("TOKEN_EXPIRED")

  let claims
  try {
    claims = await verifyAccessToken(getJwtSecret(env), match[1], now)
  } catch (error) {
    if (error instanceof JwtVerificationError) {
      logEvent("access_token_rejected", { reason: error.reason })
    }
    return failure("TOKEN_EXPIRED")
  }

  const userId = Number(claims.sub)
  if (!Number.isInteger(userId) || userId <= 0) return failure("TOKEN_EXPIRED")

  const user = await findUserById(env.DB, userId)
  if (!user) return failure("TOKEN_EXPIRED")
  if (user.status !== "active") return failure("ACCOUNT_DISABLED")

  return jsonSuccess({ user: toPublicUser(user) })
}

/** POST /v1/auth/password/reset */
export async function handleResetPassword(
  request: Request,
  env: Env,
  now = currentSeconds(),
): Promise<Response> {
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  const email = normalizeEmail(parsed.body.email)
  if (!isValidEmail(email)) return failure("VALIDATION")

  const code = parsed.body.code
  if (!isValidCode(code)) return failure("VALIDATION")

  const password = parsed.body.password
  if (!isValidPassword(password)) return failure("VALIDATION")

  const user = await findUserByEmail(env.DB, email)
  // 未注册邮箱与“没有有效码”返回同一个错误，避免账号枚举。
  if (!user) return failure("CODE_INVALID")

  const ipHash = await hashIp(getPepper(env), clientIp(request, env))
  const verification = await verifyEmailCode(env, email, "reset", code, now, ipHash)
  if (!verification.ok) return failure(verification.code)

  const passwordHash = await hashPassword(
    password,
    resolvePasswordIterations(env.PASSWORD_ITERATIONS),
  )
  await updateUserPassword(env.DB, user.id, passwordHash, now)
  const revoked = await revokeAllUserSessions(env.DB, user.id, now)
  logEvent("password_reset_ok", { userId: user.id, revoked })
  return jsonSuccess(null)
}
