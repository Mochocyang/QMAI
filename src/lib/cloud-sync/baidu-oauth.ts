/**
 * 百度网盘开放平台 OAuth2.0 授权（授权码模式，本机回调）。
 *
 * 链路：软件起本机回调服务（Rust，127.0.0.1:17653）→ 打开系统浏览器授权页
 * → 百度带 code 跳回本机 → 前端用 code 换 access_token / refresh_token。
 *
 * fetch 以参数注入（生产用 @tauri-apps/plugin-http 绕 CORS，测试用 mock）。
 */

export const OAUTH_TOKEN_URL = "https://openapi.baidu.com/oauth/2.0/token"
export const OAUTH_AUTHORIZE_URL = "https://openapi.baidu.com/oauth/2.0/authorize"
/** 必须与百度网盘开放平台控制台「安全设置 → OAuth授权回调页地址」逐字一致。 */
export const OAUTH_REDIRECT_URI = `http://127.0.0.1:17653/callback`

export interface BaiduTokens {
  accessToken: string
  refreshToken: string
  /** 绝对过期时间（毫秒），由 expires_in（秒）换算。 */
  expiresAtMs: number
  scope?: string
  baiduName?: string
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: BodyInit | Uint8Array | string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>

/** 生成回调校验用的随机 state（16 字节 hex）。 */
export function randomState(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export function buildAuthorizeUrl(appKey: string, state: string, scope = "basic,netdisk"): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: appKey,
    redirect_uri: OAUTH_REDIRECT_URI,
    scope,
    state,
    display: "page",
  })
  return `${OAUTH_AUTHORIZE_URL}?${params.toString()}`
}

/** OAuth 错误响应形如 { error, error_description }；统一抛成可读中文。 */
function throwOauthError(payload: Record<string, unknown>, status: number): never {
  const code = typeof payload.error === "string" ? payload.error : `HTTP ${status}`
  const detail = typeof payload.error_description === "string" ? `（${payload.error_description}）` : ""
  const hint = hintForOauthError(code)
  throw new Error(`百度网盘授权失败：${code}${detail}${hint}`)
}

function hintForOauthError(code: string): string {
  if (code.includes("redirect_uri") || code.includes("RedirectUri")) {
    return "。请检查开放平台控制台「安全设置」里的授权回调地址是否为 http://127.0.0.1:17653/callback"
  }
  if (code.includes("invalid_grant") || code.includes("authorization_code")) {
    return "。授权码无效或已被使用，请重新发起授权"
  }
  if (code.includes("invalid_client")) {
    return "。请检查 AppKey / SecretKey 是否填对"
  }
  return ""
}

/** 用授权码换取令牌。access_token 有效期 30 天（expires_in=2592000 秒）。 */
export async function exchangeCodeForTokens(
  fetchFn: FetchLike,
  options: { appKey: string; secretKey: string; code: string },
): Promise<BaiduTokens> {
  const url = new URL(OAUTH_TOKEN_URL)
  url.searchParams.set("grant_type", "authorization_code")
  url.searchParams.set("code", options.code)
  url.searchParams.set("client_id", options.appKey)
  url.searchParams.set("client_secret", options.secretKey)
  url.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI)
  const response = await fetchFn(url.toString(), { method: "GET" })
  const payload = (await response.json()) as Record<string, unknown>
  if (!response.ok || typeof payload.access_token !== "string") {
    throwOauthError(payload, response.status)
  }
  return tokensFromPayload(payload)
}

export async function refreshAccessToken(
  fetchFn: FetchLike,
  options: { appKey: string; secretKey: string; refreshToken: string },
): Promise<BaiduTokens> {
  const url = new URL(OAUTH_TOKEN_URL)
  url.searchParams.set("grant_type", "refresh_token")
  url.searchParams.set("refresh_token", options.refreshToken)
  url.searchParams.set("client_id", options.appKey)
  url.searchParams.set("client_secret", options.secretKey)
  const response = await fetchFn(url.toString(), { method: "GET" })
  const payload = (await response.json()) as Record<string, unknown>
  if (!response.ok || typeof payload.access_token !== "string") {
    throwOauthError(payload, response.status)
  }
  return tokensFromPayload(payload)
}

function tokensFromPayload(payload: Record<string, unknown>): BaiduTokens {
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 0
  return {
    accessToken: String(payload.access_token),
    refreshToken: String(payload.refresh_token ?? ""),
    expiresAtMs: Date.now() + expiresIn * 1000,
    scope: typeof payload.scope === "string" ? payload.scope : undefined,
  }
}
