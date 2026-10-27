import type { ApiErrorCode } from "./types"

const ERROR_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION: 400,
  EMAIL_TAKEN: 409,
  CODE_INVALID: 400,
  CODE_EXPIRED: 400,
  CODE_ATTEMPTS: 429,
  RATE_LIMITED: 429,
  INVALID_CREDENTIALS: 401,
  WRONG_PASSWORD: 401,
  ACCOUNT_DISABLED: 403,
  TOKEN_EXPIRED: 401,
  INVALID_REFRESH: 401,
  EMAIL_SEND_FAILED: 502,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
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
  WRONG_PASSWORD: "当前密码不正确。",
  ACCOUNT_DISABLED: "账号已被停用，请联系支持。",
  TOKEN_EXPIRED: "登录已过期，请重新登录。",
  INVALID_REFRESH: "登录已失效，请重新登录。",
  EMAIL_SEND_FAILED: "验证码邮件发送失败，请稍后重试。",
  PAYLOAD_TOO_LARGE: "文件太大，请选择更小的图片。",
  UNSUPPORTED_MEDIA_TYPE: "仅支持 PNG、JPEG 或 WebP 图片。",
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

  // JSON 接口统一 no-store；头像这类自带长缓存的二进制响应保留自己的缓存头。
  if (!headers.has("Cache-Control") || headers.get("Content-Type")?.startsWith("application/json")) {
    headers.set("Cache-Control", "no-store")
  }
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
    headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
    headers.set(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Content-Length",
    )
    // 头像上传直接发图片字节，前端要读响应状态与图片本体。
    headers.set("Access-Control-Max-Age", "86400")
  }
  return new Response(null, { status: 204, headers })
}

const MAX_BODY_BYTES = 8 * 1024

export type JsonBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response }

type BodyReadResult = { ok: true; text: string } | { ok: false }

/**
 * 流式读取请求体，超过 8 KB 立即 cancel；不把整个 body 先读成字符串。
 * Content-Length 已知且超限时直接拒绝，连 body 都不碰。
 */
async function readBodyText(request: Request): Promise<BodyReadResult> {
  const declaredLength = request.headers.get("Content-Length")
  if (declaredLength !== null) {
    const length = Number(declaredLength)
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) return { ok: false }
  }

  const body = request.body
  if (!body) return { ok: true, text: "" }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        return { ok: false }
      }
      chunks.push(value)
    }
  } catch {
    await reader.cancel().catch(() => undefined)
    return { ok: false }
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, text: new TextDecoder().decode(bytes) }
}

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

  const body = await readBodyText(request)
  if (!body.ok) {
    return { ok: false, response: failure("VALIDATION", "请求内容过大或无法读取。") }
  }

  let value: unknown
  try {
    value = JSON.parse(body.text)
  } catch {
    return { ok: false, response: failure("VALIDATION", "请求内容不是有效 JSON。") }
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, response: failure("VALIDATION") }
  }

  return { ok: true, body: value as Record<string, unknown> }
}
