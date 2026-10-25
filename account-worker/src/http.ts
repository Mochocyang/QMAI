import type { ApiErrorCode } from "./types"

const ERROR_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION: 400,
  EMAIL_TAKEN: 409,
  CODE_INVALID: 400,
  CODE_EXPIRED: 400,
  CODE_ATTEMPTS: 429,
  RATE_LIMITED: 429,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_DISABLED: 403,
  TOKEN_EXPIRED: 401,
  INVALID_REFRESH: 401,
  EMAIL_SEND_FAILED: 502,
  SERVER_ERROR: 500,
  NOT_FOUND: 404,
}

const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION: "请检查填写的内容。",
  EMAIL_TAKEN: "这个邮箱已经注册过，直接登录即可。",
  CODE_INVALID: "验证码不正确，请重新输入。",
  CODE_EXPIRED: "验证码已过期，请重新获取。",
  CODE_ATTEMPTS: "验证码尝试次数过多，请重新获取。",
  RATE_LIMITED: "操作太频繁，请稍后再试。",
  INVALID_CREDENTIALS: "邮箱或密码不正确。",
  ACCOUNT_DISABLED: "账号已被停用，请联系支持。",
  TOKEN_EXPIRED: "登录已过期，请重新登录。",
  INVALID_REFRESH: "登录已失效，请重新登录。",
  EMAIL_SEND_FAILED: "验证码邮件发送失败，请稍后重试。",
  SERVER_ERROR: "账号服务暂时不可用，请稍后再试。",
  NOT_FOUND: "接口不存在。",
}

export function errorStatus(code: ApiErrorCode): number {
  return ERROR_STATUS[code]
}

export function errorMessage(code: ApiErrorCode): string {
  return ERROR_MESSAGES[code]
}

function baseHeaders(): Headers {
  const headers = new Headers()
  headers.set("Content-Type", "application/json; charset=utf-8")
  headers.set("Cache-Control", "no-store")
  headers.set("X-Content-Type-Options", "nosniff")
  return headers
}

export function jsonSuccess(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: baseHeaders(),
  })
}

export function failure(
  code: ApiErrorCode,
  message = errorMessage(code),
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = baseHeaders()
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value)
  return new Response(JSON.stringify({ success: false, code, message }), {
    status: errorStatus(code),
    headers,
  })
}

/** 兼容命名；内部统一用 failure。 */
export const jsonFailure = failure

export function parseAllowedOrigins(value: string | undefined): string[] {
  if (typeof value !== "string") return []
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
}

/** 只有精确命中 allowlist 的 Origin 才返回其值；不在名单内不返回 CORS 头。 */
export function resolveAllowedOrigin(
  request: Request,
  allowedOrigins: string[],
): string | null {
  const origin = request.headers.get("Origin")
  if (!origin) return null
  return allowedOrigins.includes(origin) ? origin : null
}

export function applyResponseHeaders(
  response: Response,
  request: Request,
  allowedOrigins: string[],
): Response {
  const headers = new Headers(response.headers)
  headers.set("Cache-Control", "no-store")
  headers.set("X-Content-Type-Options", "nosniff")

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8")
  }

  const origin = resolveAllowedOrigin(request, allowedOrigins)
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin)
    headers.set("Vary", "Origin")
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function preflightResponse(request: Request, allowedOrigins: string[]): Response {
  const headers = new Headers()
  headers.set("Cache-Control", "no-store")
  const origin = resolveAllowedOrigin(request, allowedOrigins)
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin)
    headers.set("Vary", "Origin")
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type")
    headers.set("Access-Control-Max-Age", "86400")
  }
  return new Response(null, { status: 204, headers })
}

const MAX_BODY_BYTES = 8 * 1024

export type JsonBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response }

/**
 * 只接受 application/json（允许 charset 参数），请求体 ≤ 8 KB，
 * 且顶层必须是 JSON 对象；任何不满足都返回统一 VALIDATION 信封。
 */
export async function readJsonBody(request: Request): Promise<JsonBodyResult> {
  const contentType = request.headers.get("Content-Type") ?? ""
  const mime = contentType.split(";")[0]?.trim().toLowerCase()
  if (mime !== "application/json") {
    return {
      ok: false,
      response: failure("VALIDATION", "请求内容必须为 JSON。"),
    }
  }

  let text: string
  try {
    text = await request.text()
  } catch {
    return { ok: false, response: failure("VALIDATION") }
  }

  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return { ok: false, response: failure("VALIDATION", "请求内容过大。") }
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, response: failure("VALIDATION", "请求内容不是有效 JSON。") }
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, response: failure("VALIDATION") }
  }

  return { ok: true, body: value as Record<string, unknown> }
}
