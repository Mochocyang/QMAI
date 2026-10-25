import type { CodePurpose } from "./types"

/** trim + 小写；非字符串返回空串。 */
export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

/** RFC 5321 长度上限 + 常见字符集校验；不追求完整 RFC 兼容。 */
export function isValidEmail(email: string): boolean {
  if (typeof email !== "string" || email.length === 0 || email.length > 254) return false
  const at = email.lastIndexOf("@")
  if (at <= 0 || at > 64) return false
  return EMAIL_RE.test(email)
}

/** 密码只限制长度 8–128，不强制大小写/符号；空白密码视为非法。 */
export function isValidPassword(password: unknown): password is string {
  return (
    typeof password === "string" &&
    password.length >= 8 &&
    password.length <= 128 &&
    /\S/.test(password)
  )
}

/** 验证码必须是 6 位 ASCII 数字。 */
export function isValidCode(code: unknown): code is string {
  return typeof code === "string" && /^[0-9]{6}$/.test(code)
}

export function normalizePurpose(value: unknown): CodePurpose | null {
  if (typeof value !== "string") return null
  const purpose = value.trim().toLowerCase()
  return purpose === "register" || purpose === "reset" ? purpose : null
}

export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? ""
  return local || "作者"
}

/** 去控制字符、trim，空则回退邮箱前缀；最多 48 个字符。 */
export function normalizeDisplayName(value: unknown, email: string): string {
  const fallback = displayNameFromEmail(email)
  if (typeof value !== "string") return fallback
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim()
  if (!cleaned) return fallback
  return Array.from(cleaned).slice(0, 48).join("")
}

/** 32 字节随机 refresh token 的 base64url 形态固定为 43 个字符。 */
export function isValidRefreshTokenFormat(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)
}

/** 设备描述只做展示，截断避免超长写入。 */
export function normalizeDeviceLabel(value: unknown): string | null {
  if (typeof value !== "string") return null
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim()
  return cleaned ? Array.from(cleaned).slice(0, 100).join("") : null
}

/** 头像允许的图片类型白名单。 */
export const ALLOWED_AVATAR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const

export type AvatarMimeType = (typeof ALLOWED_AVATAR_MIME_TYPES)[number]

/** 头像上限 200 KB：客户端已裁剪到 256×256，正常 WebP 只有十几 KB。 */
export const MAX_AVATAR_BYTES = 200 * 1024

export function normalizeAvatarMime(value: unknown): AvatarMimeType | null {
  if (typeof value !== "string") return null
  const mime = value.trim().toLowerCase()
  // 兼容 image/jpg 这种非标准写法。
  if (mime === "image/jpg") return "image/jpeg"
  return (ALLOWED_AVATAR_MIME_TYPES as readonly string[]).includes(mime)
    ? (mime as AvatarMimeType)
    : null
}

/**
 * 用文件头魔数二次确认格式，避免只信 Content-Type 被塞进 HTML/SVG。
 * 这一步同时挡掉 SVG（它含脚本，不能当图片直接对外提供）。
 */
export function detectImageMime(bytes: Uint8Array): AvatarMimeType | null {
  if (bytes.length < 12) return null

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png"
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"

  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp"
  }

  return null
}
