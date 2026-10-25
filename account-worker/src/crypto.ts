/**
 * WebCrypto 封装：验证码/refresh/IP 哈希、PBKDF2 密码、HS256 JWT。
 * 只使用 Workers 运行时自带的 crypto.subtle，不引入第三方加密库。
 */

import type { AccessTokenClaims, CodePurpose } from "./types"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const JWT_ISSUER = "qmai-account"
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
export const REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60
export const DEFAULT_PASSWORD_ITERATIONS = 210_000
const MAX_PASSWORD_ITERATIONS = 1_000_000
const PBKDF2_HASH_BYTES = 32
const PBKDF2_SALT_BYTES = 16

function toHex(bytes: Uint8Array): string {
  let hex = ""
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0")
  return hex
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function base64UrlToBytes(value: string): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("invalid base64url")
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function base64UrlEncodeString(value: string): string {
  return bytesToBase64Url(encoder.encode(value))
}

export function base64UrlDecodeString(value: string): string {
  return decoder.decode(base64UrlToBytes(value))
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value))
  return toHex(new Uint8Array(digest))
}

/** SHA-256(pepper + email + purpose + code)，数据库中只保存这个值。 */
export function hashEmailCode(
  pepper: string,
  email: string,
  purpose: CodePurpose,
  code: string,
): Promise<string> {
  return sha256Hex(`${pepper}${email}${purpose}${code}`)
}

/** IP 先加盐（pepper）再哈希，用于限流与审计，不落原始 IP。 */
export function hashIp(pepper: string, ip: string): Promise<string> {
  return sha256Hex(`${pepper}:ip:${ip}`)
}

export function generateNumericCode(): string {
  const max = 1_000_000
  // 拒绝采样，避免 Uint32 取模带来的低位偏置。
  const limit = Math.floor(0x1_0000_0000 / max) * max
  const buffer = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buffer)
    const value = buffer[0] ?? 0
    if (value < limit) return String(value % max).padStart(6, "0")
  }
}

export function generateRefreshToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

export function hashRefreshToken(token: string): Promise<string> {
  return sha256Hex(token)
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function resolvePasswordIterations(value: string | undefined): number {
  const parsed = typeof value === "string" ? Number(value.trim()) : Number.NaN
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > MAX_PASSWORD_ITERATIONS) {
    return DEFAULT_PASSWORD_ITERATIONS
  }
  return parsed
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
  bits: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  )
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    bits,
  )
  return new Uint8Array(derived)
}

/** 生成 `pbkdf2$迭代数$盐$哈希`，迭代数写进串里，后续可无损升级。 */
export async function hashPassword(
  password: string,
  iterations = DEFAULT_PASSWORD_ITERATIONS,
): Promise<string> {
  const salt = new Uint8Array(PBKDF2_SALT_BYTES)
  crypto.getRandomValues(salt)
  const derived = await derivePassword(password, salt, iterations, PBKDF2_HASH_BYTES * 8)
  return `pbkdf2$${iterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(derived)}`
}

/** 用存储串里的迭代数校验，不依赖当前环境变量。 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof stored !== "string") return false
  const parts = stored.split("$")
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false

  const iterations = Number(parts[1])
  if (
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > MAX_PASSWORD_ITERATIONS
  ) {
    return false
  }

  let salt: Uint8Array
  let expected: Uint8Array
  try {
    salt = base64UrlToBytes(parts[2] ?? "")
    expected = base64UrlToBytes(parts[3] ?? "")
  } catch {
    return false
  }
  if (salt.length < 8 || expected.length !== PBKDF2_HASH_BYTES) return false

  try {
    const actual = await derivePassword(password, salt, iterations, expected.length * 8)
    if (actual.length !== expected.length) return false
    let diff = 0
    for (let i = 0; i < actual.length; i += 1) diff |= (actual[i] ?? 0) ^ (expected[i] ?? 0)
    return diff === 0
  } catch {
    return false
  }
}

/**
 * 用户不存在时执行一次等价 PBKDF2，避免用响应时间探测邮箱是否注册。
 * 结果丢弃；使用固定盐，不写库。
 */
export async function dummyPasswordCheck(
  password: string,
  iterations = DEFAULT_PASSWORD_ITERATIONS,
): Promise<void> {
  const salt = new Uint8Array(PBKDF2_SALT_BYTES)
  for (let i = 0; i < salt.length; i += 1) salt[i] = i + 1
  await derivePassword(password, salt, iterations, PBKDF2_HASH_BYTES * 8)
}

export interface SignedAccessToken {
  token: string
  expiresAt: number
  jti: string
  claims: AccessTokenClaims
}

export async function signAccessToken(
  secret: string,
  user: { id: number; email: string },
  nowSeconds: number,
): Promise<SignedAccessToken> {
  const claims: AccessTokenClaims = {
    iss: JWT_ISSUER,
    sub: String(user.id),
    email: user.email,
    iat: nowSeconds,
    exp: nowSeconds + ACCESS_TOKEN_TTL_SECONDS,
    jti: crypto.randomUUID(),
  }
  const header = { alg: "HS256", typ: "JWT" }
  const data = `${base64UrlEncodeString(JSON.stringify(header))}.${base64UrlEncodeString(
    JSON.stringify(claims),
  )}`

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data))
  return {
    token: `${data}.${bytesToBase64Url(new Uint8Array(signature))}`,
    expiresAt: claims.exp,
    jti: claims.jti,
    claims,
  }
}

export type JwtFailureReason = "malformed" | "signature" | "issuer" | "expired"

export class JwtVerificationError extends Error {
  readonly reason: JwtFailureReason

  constructor(reason: JwtFailureReason) {
    super(`JWT verification failed: ${reason}`)
    this.name = "JwtVerificationError"
    this.reason = reason
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * 校验 HS256 签名、alg、iss、exp；payload 字段也做类型检查。
 * 任何异常都转换成 JwtVerificationError，调用方只需处理一种错误。
 */
export async function verifyAccessToken(
  secret: string,
  token: string,
  nowSeconds: number,
): Promise<AccessTokenClaims> {
  if (typeof token !== "string") throw new JwtVerificationError("malformed")
  const parts = token.split(".")
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new JwtVerificationError("malformed")
  }

  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string]

  let header: unknown
  try {
    header = JSON.parse(base64UrlDecodeString(headerPart))
  } catch {
    throw new JwtVerificationError("malformed")
  }
  if (!isRecord(header) || header.alg !== "HS256") {
    throw new JwtVerificationError("malformed")
  }

  let signature: Uint8Array
  try {
    signature = base64UrlToBytes(signaturePart)
  } catch {
    throw new JwtVerificationError("malformed")
  }

  let signatureValid = false
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    )
    signatureValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      encoder.encode(`${headerPart}.${payloadPart}`),
    )
  } catch {
    signatureValid = false
  }
  if (!signatureValid) throw new JwtVerificationError("signature")

  let payload: unknown
  try {
    payload = JSON.parse(base64UrlDecodeString(payloadPart))
  } catch {
    throw new JwtVerificationError("malformed")
  }
  if (!isRecord(payload)) throw new JwtVerificationError("malformed")

  const { iss, sub, email, iat, exp, jti } = payload
  if (
    typeof iss !== "string" ||
    typeof sub !== "string" ||
    sub.length === 0 ||
    typeof email !== "string" ||
    typeof iat !== "number" ||
    !Number.isFinite(iat) ||
    typeof exp !== "number" ||
    !Number.isFinite(exp) ||
    typeof jti !== "string" ||
    jti.length === 0
  ) {
    throw new JwtVerificationError("malformed")
  }
  if (iss !== JWT_ISSUER) throw new JwtVerificationError("issuer")
  if (exp <= nowSeconds) throw new JwtVerificationError("expired")

  return { iss, sub, email, iat, exp, jti }
}
