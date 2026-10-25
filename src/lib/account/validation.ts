/**
 * 账号表单的本地校验。
 *
 * 规则与 account-worker/src/validation.ts 保持同一口径：
 * 邮箱 254 上限、本地部分 1–64、域名带点；密码 8–128 且不能全空白；
 * 验证码固定 6 位 ASCII 数字。
 */

/** trim + 小写；非字符串返回空串。 */
export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

export function isValidEmail(email: string): boolean {
  if (typeof email !== "string" || email.length === 0 || email.length > 254) return false

  const at = email.indexOf("@")
  if (at <= 0 || at > 64) return false
  if (at !== email.lastIndexOf("@")) return false

  const domain = email.slice(at + 1)
  if (!domain.includes(".")) return false

  return EMAIL_RE.test(email)
}

/** 校验密码；合法返回 null，非法返回可直接展示的中文文案。 */
export function validateAccountPassword(password: string): string | null {
  if (typeof password !== "string" || password.length < 8) return "密码至少需要 8 位。"
  if (password.length > 128) return "密码最多 128 位。"
  if (!/\S/.test(password)) return "密码不能全是空白字符。"
  return null
}

/** 验证码必须是 6 位 ASCII 数字。 */
export function isSixDigitCode(value: unknown): boolean {
  return typeof value === "string" && /^[0-9]{6}$/.test(value)
}
