/**
 * 百度网盘 OAuth 授权中转（授权码模式）。
 *
 * 为什么必须放在服务端：授权码模式换 token 需要 client_secret，而 client_secret
 * 一旦进了客户端安装包就等于公开（Tauri 的 asar/exe 都能被解包）。百度开放平台
 * 的接入规范也明确要求「以开发者自身注册的应用身份接入」，不接受让用户或部署者
 * 自己填凭据。
 *
 * 三个端点：
 *   POST /v1/oauth/baidu/begin   客户端要一个授权链接（带 sessionId）
 *   GET  /oauth/baidu/callback   百度把浏览器重定向回来（不在 /v1 下，见 wrangler 路由）
 *   GET  /v1/oauth/baidu/poll    客户端轮询取 token（取走即删）
 *
 * 安全要点：
 *   1. token 用 AES-GCM 加密后落库，密钥由 AUTH_CODE_PEPPER 派生；
 *   2. session 一次性：poll 成功立即删除；
 *   3. state 校验防 CSRF；
 *   4. 日志只打错误码与阶段，绝不打 token。
 */

import { bytesToBase64Url, base64UrlToBytes, sha256Hex } from "./crypto"
import type { Env } from "./types"

/**
 * 两种授权模式。
 *
 * 它们的**端点、scope、换 token 方式全都不同**，参数不能混用 ——
 * 用错组合时百度只回一句「无法打开授权页面，操作失败，请重试」，没有更多信息。
 *
 * - `general`（通用授权，默认）
 *   `openapi.baidu.com/oauth/2.0/authorize` + `response_type=code`
 *   + `scope=basic,netdisk` → 用 `oauth/2.0/token` 换 token
 *   访问范围由平台强制限制在 `/apps/{应用名}`（对 2026-06-03 之后创建的应用），
 *   所以隔离性同样有保障，且**不需要用户选目录**，换机恢复路径固定。
 *
 * - `dir`（目录级授权）
 *   `pan.baidu.com/union/oauth/authorize` + `scope=nd_open_read,nd_open_write`
 *   → 用 `pan.baidu.com/xpan/oauth/get?method=token` 换 token
 *   用户在授权页自己选目录；返回 authorized_paths，客户端每次读写前校验。
 *   需要应用先获得这两个 scope 的权限，否则授权页打不开。
 *
 * 通过 `BAIDU_AUTH_MODE` 环境变量切换，不用改代码重发。
 */
export type BaiduAuthMode = "general" | "dir"

/** 目录级授权端点。 */
export const BAIDU_DIR_AUTHORIZE_URL = "https://pan.baidu.com/union/oauth/authorize"
export const BAIDU_DIR_TOKEN_URL = "https://pan.baidu.com/xpan/oauth/get"
export const BAIDU_DIR_SCOPE = "nd_open_read,nd_open_write"

/** 通用授权端点（与目录级完全不同）。 */
export const BAIDU_GENERAL_AUTHORIZE_URL = "https://openapi.baidu.com/oauth/2.0/authorize"
export const BAIDU_GENERAL_TOKEN_URL = "https://openapi.baidu.com/oauth/2.0/token"
export const BAIDU_GENERAL_SCOPE = "basic,netdisk"

/** 兼容旧导出名：目录级 scope。 */
export const BAIDU_SCOPE = BAIDU_DIR_SCOPE

/** 当前生效的授权模式。未设置或非法值一律回落 `general`（已开通权限的那个）。 */
export function resolveAuthMode(env: Env): BaiduAuthMode {
  return env.BAIDU_AUTH_MODE === "dir" ? "dir" : "general"
}

/** 某种模式对应的 scope。 */
export function scopeForMode(mode: BaiduAuthMode): string {
  return mode === "dir" ? BAIDU_DIR_SCOPE : BAIDU_GENERAL_SCOPE
}

/** 会话存活时间：用户从点「连接」到在浏览器里完成授权，10 分钟够用。 */
const SESSION_TTL_SECONDS = 600
/** 客户端轮询时，token 最长保留 60 秒不被清理（给客户端重试留余量）。 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{32,64}$/

interface BeginBody {
  /** 兼容将来多应用场景；当前只认 baidu。 */
  provider?: unknown
}

interface SessionRow {
  session_id: string
  state: string
  status: string
  token_cipher: string | null
  token_iv: string | null
  scope: string | null
  authorized_paths: string | null
  error_code: string | null
  created_at: number
  expires_at: number
}

// ---------------------------------------------------------------- 加密

/**
 * 从 AUTH_CODE_PEPPER 派生 AES-GCM 密钥。
 *
 * 用 HKDF 而不是直接拿 pepper 当 key：pepper 长度不固定，HKDF 能稳定产出 32 字节。
 * 加 info 标签，避免这把密钥与验证码场景混用。
 */
async function deriveTokenKey(env: Env): Promise<CryptoKey | null> {
  const pepper = env.AUTH_CODE_PEPPER
  if (!pepper || pepper.length < 16) return null
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    "HKDF",
    false,
    ["deriveKey"],
  )
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode("qmai-baidu-token-v1"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
}

async function encryptToken(
  env: Env,
  plaintext: string,
): Promise<{ cipher: string; iv: string } | null> {
  const key = await deriveTokenKey(env)
  if (!key) return null
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  return {
    cipher: bytesToBase64Url(new Uint8Array(cipher)),
    iv: bytesToBase64Url(iv),
  }
}

async function decryptToken(
  env: Env,
  cipher: string,
  iv: string,
): Promise<string | null> {
  const key = await deriveTokenKey(env)
  if (!key) return null
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlToBytes(iv) },
      key,
      base64UrlToBytes(cipher),
    )
    return new TextDecoder().decode(plain)
  } catch {
    // 密钥轮换或密文损坏：当作取不到，让用户重新授权。
    return null
  }
}

// ---------------------------------------------------------------- 工具

function randomToken(bytes = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}

/** 回调页是给用户看的，必须是人话，不是 JSON。 */
function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}

function requiresConfiguration(env: Env): string | null {
  if (!env.BAIDU_APP_KEY) return "BAIDU_APP_KEY"
  if (!env.BAIDU_APP_SECRET) return "BAIDU_APP_SECRET"
  if (!env.AUTH_CODE_PEPPER) return "AUTH_CODE_PEPPER"
  return null
}

/** 回调地址必须与百度后台配置的完全一致，包括尾部斜杠。 */
function callbackUri(env: Env): string {
  return env.BAIDU_REDIRECT_URI || "https://qmai.pro/oauth/baidu/callback"
}

// ---------------------------------------------------------------- begin

/**
 * POST /v1/oauth/baidu/begin
 *
 * 返回 { sessionId, authorizeUrl, expiresIn }。客户端打开 authorizeUrl，
 * 用户在百度页面授权后，浏览器会跳到回调端点。
 */
export async function handleBaiduBegin(request: Request, env: Env): Promise<Response> {
  const missing = requiresConfiguration(env)
  if (missing) {
    console.error("[baidu-oauth] configuration_invalid", { variable: missing })
    return json({ ok: false, errorCode: "server.misconfigured" }, 500)
  }

  // 请求体当前无用，但保留解析以免将来加参数时破坏兼容。
  try {
    await request.clone().json<BeginBody>()
  } catch {
    /* 空 body 是合法调用 */
  }

  const sessionId = randomToken(32)
  const state = randomToken(32)
  const now = nowSeconds()

  try {
    await env.DB.prepare(
      `INSERT INTO baidu_oauth_sessions
         (session_id, state, status, created_at, expires_at)
       VALUES (?, ?, 'pending', ?, ?)`,
    )
      .bind(sessionId, state, now, now + SESSION_TTL_SECONDS)
      .run()
  } catch (error) {
    console.error("[baidu-oauth] session_insert_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    })
    return json({ ok: false, errorCode: "server.error" }, 500)
  }

  const mode = resolveAuthMode(env)
  const url =
    mode === "dir"
      ? new URL(BAIDU_DIR_AUTHORIZE_URL)
      : new URL(BAIDU_GENERAL_AUTHORIZE_URL)
  url.searchParams.set("client_id", env.BAIDU_APP_KEY!)
  url.searchParams.set("redirect_uri", callbackUri(env))
  url.searchParams.set("state", state)
  url.searchParams.set("scope", scopeForMode(mode))
  if (mode === "general") {
    // 通用授权必须显式声明授权码模式；目录级端点不需要这个参数。
    url.searchParams.set("response_type", "code")
    url.searchParams.set("display", "page")
  }

  return json({
    ok: true,
    sessionId,
    authorizeUrl: url.toString(),
    expiresIn: SESSION_TTL_SECONDS,
    authMode: mode,
    // 目录级授权下要提示用户「保持勾选『创建并保存应用文件』」；
    // 通用授权没有这个选项，路径固定为 /apps/{应用名}。
    requireAppFolder: mode === "dir",
  })
}

// ---------------------------------------------------------------- callback

interface BaiduTokenPayload {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  scope?: unknown
  authorized_paths?: unknown
  error?: unknown
  error_description?: unknown
}

/** 把百度返回的 authorized_paths 归一化成字符串数组。 */
export function normalizeAuthorizedPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim())
    } else if (item && typeof item === "object") {
      // 兼容对象形态：{ path: "/apps/xxx" } 或 { dir: ... }
      const record = item as Record<string, unknown>
      const path = record.path ?? record.dir ?? record.dirname
      if (typeof path === "string" && path.trim()) out.push(path.trim())
    }
  }
  return out
}

/**
 * GET /oauth/baidu/callback?code=...&state=...
 *
 * 百度把用户浏览器重定向到这里。本端点用 code + AppKey + SecretKey 换 token，
 * 加密后暂存到会话行，然后给用户一个「可以回到软件了」的页面。
 */
export async function handleBaiduCallback(request: Request, env: Env): Promise<Response> {
  const missing = requiresConfiguration(env)
  if (missing) {
    console.error("[baidu-oauth] configuration_invalid", { variable: missing })
    return html(failurePage("服务端配置不完整，请联系开发者。"), 500)
  }

  const url = new URL(request.url)
  const state = url.searchParams.get("state") ?? ""
  const code = url.searchParams.get("code")
  const denied = url.searchParams.get("error")
  const errno = url.searchParams.get("errno")
  const errmsg = url.searchParams.get("errmsg")

  if (!state) {
    return html(failurePage("回调缺少 state 参数，请回到软件重新发起授权。"), 400)
  }

  const session = await env.DB.prepare(
    `SELECT * FROM baidu_oauth_sessions WHERE state = ?`,
  )
    .bind(state)
    .first<SessionRow>()

  if (!session) {
    // state 不存在：可能是伪造回调，也可能会话已被清理。
    console.error("[baidu-oauth] callback_unknown_state")
    return html(failurePage("授权会话不存在或已过期，请回到软件重新发起授权。"), 400)
  }

  if (session.expires_at < nowSeconds()) {
    await deleteSession(env, session.session_id)
    return html(failurePage("授权会话已过期，请回到软件重新发起授权。"), 400)
  }

  // 用户在百度页面点了「拒绝」。
  if (denied) {
    await failSession(env, session.session_id, denied)
    return html(failurePage("你取消了授权。如果仍想使用网盘同步，请回到软件重新发起授权。"))
  }

  // 百度侧返回错误码。
  if (errno || !code) {
    const codeText = errno ?? "missing_code"
    await failSession(env, session.session_id, codeText)
    console.error("[baidu-oauth] callback_provider_error", { errno: codeText })
    return html(failurePage(`授权没有完成（${errmsg || codeText}）。请回到软件重试。`))
  }

  /*
   * 用 code 换 token。两种模式的端点和参数都不同：
   *   通用 → oauth/2.0/token?grant_type=authorization_code
   *   目录级 → xpan/oauth/get?method=token
   * redirect_uri 必须与发起授权时完全一致，否则百度会拒绝。
   */
  const mode = resolveAuthMode(env)
  const tokenUrl =
    mode === "dir" ? new URL(BAIDU_DIR_TOKEN_URL) : new URL(BAIDU_GENERAL_TOKEN_URL)
  if (mode === "dir") {
    tokenUrl.searchParams.set("method", "token")
  } else {
    tokenUrl.searchParams.set("grant_type", "authorization_code")
  }
  tokenUrl.searchParams.set("client_id", env.BAIDU_APP_KEY!)
  tokenUrl.searchParams.set("client_secret", env.BAIDU_APP_SECRET!)
  tokenUrl.searchParams.set("code", code)
  tokenUrl.searchParams.set("redirect_uri", callbackUri(env))

  let payload: BaiduTokenPayload
  try {
    const response = await fetch(tokenUrl.toString(), {
      method: "GET",
      headers: { "User-Agent": "pan.baidu.com" },
    })
    payload = (await response.json()) as BaiduTokenPayload
  } catch (error) {
    console.error("[baidu-oauth] token_exchange_network_error", {
      name: error instanceof Error ? error.name : "UnknownError",
    })
    await failSession(env, session.session_id, "network")
    return html(failurePage("连接百度服务失败，请回到软件重试。"))
  }

  const accessToken = typeof payload.access_token === "string" ? payload.access_token : ""
  if (!accessToken) {
    const reason =
      typeof payload.error === "string"
        ? payload.error
        : typeof payload.error_description === "string"
          ? payload.error_description
          : "no_access_token"
    console.error("[baidu-oauth] token_exchange_rejected", { reason })
    await failSession(env, session.session_id, reason)
    return html(failurePage("百度没有返回访问凭证，请回到软件重试。"))
  }

  const tokens = JSON.stringify({
    accessToken,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : null,
    // 模式随令牌一起交给客户端：它要据此决定要不要做 authorized_paths 校验。
    authMode: mode,
  })
  const encrypted = await encryptToken(env, tokens)
  if (!encrypted) {
    console.error("[baidu-oauth] token_encrypt_failed")
    await failSession(env, session.session_id, "encrypt_failed")
    return html(failurePage("服务端无法安全保存凭证，请联系开发者。"), 500)
  }

  const paths = normalizeAuthorizedPaths(payload.authorized_paths)

  try {
    await env.DB.prepare(
      `UPDATE baidu_oauth_sessions
          SET status = 'authorized',
              token_cipher = ?,
              token_iv = ?,
              scope = ?,
              authorized_paths = ?,
              expires_at = ?
        WHERE session_id = ?`,
    )
      .bind(
        encrypted.cipher,
        encrypted.iv,
        typeof payload.scope === "string" ? payload.scope : scopeForMode(mode),
        JSON.stringify(paths),
        // 授权成功后给客户端 60 秒来取，不需要再等 10 分钟。
        nowSeconds() + 60,
        session.session_id,
      )
      .run()
  } catch (error) {
    console.error("[baidu-oauth] session_update_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    })
    return html(failurePage("保存授权结果失败，请回到软件重试。"), 500)
  }

  console.log("[baidu-oauth] authorized", { pathCount: paths.length })
  return html(successPage())
}

// ---------------------------------------------------------------- poll

interface StoredTokens {
  accessToken: string
  refreshToken: string | null
  expiresIn: number | null
}

/**
 * GET /v1/oauth/baidu/poll?sessionId=xxx
 *
 * 客户端轮询。返回：
 *   { status: "pending" }                       用户还没授权完
 *   { status: "authorized", tokens, authorizedPaths, scope }
 *   { status: "failed", errorCode }
 *   { status: "expired" }
 *
 * 拿到 token 后立刻删除会话行：这个 token 只该被交付一次。
 */
export async function handleBaiduPoll(request: Request, env: Env): Promise<Response> {
  const sessionId = new URL(request.url).searchParams.get("sessionId") ?? ""
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return json({ ok: false, errorCode: "invalid_session" }, 400)
  }

  const session = await env.DB.prepare(
    `SELECT * FROM baidu_oauth_sessions WHERE session_id = ?`,
  )
    .bind(sessionId)
    .first<SessionRow>()

  if (!session) return json({ ok: true, status: "expired" })

  if (session.expires_at < nowSeconds()) {
    await deleteSession(env, session.session_id)
    return json({ ok: true, status: "expired" })
  }

  if (session.status === "pending") {
    return json({ ok: true, status: "pending" })
  }

  if (session.status === "failed") {
    const errorCode = session.error_code ?? "authorization_failed"
    await deleteSession(env, session.session_id)
    return json({ ok: true, status: "failed", errorCode })
  }

  // authorized：交付 token 并立刻销毁会话（一次性）。
  if (!session.token_cipher || !session.token_iv) {
    await deleteSession(env, session.session_id)
    return json({ ok: true, status: "failed", errorCode: "token_missing" })
  }

  const decrypted = await decryptToken(env, session.token_cipher, session.token_iv)
  await deleteSession(env, session.session_id)
  if (!decrypted) {
    return json({ ok: true, status: "failed", errorCode: "token_unreadable" })
  }

  let tokens: StoredTokens
  try {
    tokens = JSON.parse(decrypted) as StoredTokens
  } catch {
    return json({ ok: true, status: "failed", errorCode: "token_unreadable" })
  }

  let authorizedPaths: string[] = []
  try {
    authorizedPaths = session.authorized_paths
      ? (JSON.parse(session.authorized_paths) as string[])
      : []
  } catch {
    authorizedPaths = []
  }

  return json({
    ok: true,
    status: "authorized",
    tokens,
    scope: session.scope ?? BAIDU_DIR_SCOPE,
    authorizedPaths,
    authMode: resolveAuthMode(env),
  })
}

// ---------------------------------------------------------------- 杂项

async function deleteSession(env: Env, sessionId: string): Promise<void> {
  try {
    await env.DB.prepare(`DELETE FROM baidu_oauth_sessions WHERE session_id = ?`)
      .bind(sessionId)
      .run()
  } catch (error) {
    console.error("[baidu-oauth] session_delete_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    })
  }
}

async function failSession(env: Env, sessionId: string, errorCode: string): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE baidu_oauth_sessions
          SET status = 'failed', error_code = ?, expires_at = ?
        WHERE session_id = ?`,
    )
      .bind(errorCode.slice(0, 120), nowSeconds() + 60, sessionId)
      .run()
  } catch {
    /* 标记失败本身失败时，让会话自然过期即可 */
  }
}

/**
 * POST /v1/oauth/baidu/refresh
 *
 * 刷新 access_token。**必须走服务端**：百度刷新同样要 client_secret。
 *
 * 两个坑（官方文档明确写了）：
 *   1. refresh_token **单次有效**，刷新后必须用响应里的新值覆盖旧值；
 *   2. 刷新失败时旧的 refresh_token 也会失效，此时只能让用户重新授权，
 *      不能拿旧的反复重试。
 */
export async function handleBaiduRefresh(request: Request, env: Env): Promise<Response> {
  const missing = requiresConfiguration(env)
  if (missing) {
    console.error("[baidu-oauth] configuration_invalid", { variable: missing })
    return json({ ok: false, errorCode: "server.misconfigured" }, 500)
  }

  let refreshToken = ""
  try {
    const body = (await request.json()) as { refreshToken?: unknown }
    if (typeof body?.refreshToken === "string") refreshToken = body.refreshToken.trim()
  } catch {
    /* 落到下面的校验 */
  }
  if (!refreshToken) {
    return json({ ok: false, errorCode: "refresh_token_missing" }, 400)
  }

  const mode = resolveAuthMode(env)
  const url =
    mode === "dir" ? new URL(BAIDU_DIR_TOKEN_URL) : new URL(BAIDU_GENERAL_TOKEN_URL)
  if (mode === "dir") {
    url.searchParams.set("method", "refresh_token")
  } else {
    url.searchParams.set("grant_type", "refresh_token")
  }
  url.searchParams.set("client_id", env.BAIDU_APP_KEY!)
  url.searchParams.set("client_secret", env.BAIDU_APP_SECRET!)
  url.searchParams.set("refresh_token", refreshToken)

  let payload: BaiduTokenPayload
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { "User-Agent": "pan.baidu.com" },
    })
    payload = (await response.json()) as BaiduTokenPayload
  } catch (error) {
    console.error("[baidu-oauth] refresh_network_error", {
      name: error instanceof Error ? error.name : "UnknownError",
    })
    return json({ ok: false, errorCode: "network" }, 502)
  }

  const accessToken = typeof payload.access_token === "string" ? payload.access_token : ""
  if (!accessToken) {
    const reason =
      typeof payload.error === "string" ? payload.error : "refresh_rejected"
    console.error("[baidu-oauth] refresh_rejected", { reason })
    // refresh_token 已失效：客户端应提示用户重新授权，而不是继续重试。
    return json({ ok: false, errorCode: "reauthorize_required", detail: reason }, 401)
  }

  return json({
    ok: true,
    tokens: {
      accessToken,
      refreshToken:
        typeof payload.refresh_token === "string" ? payload.refresh_token : null,
      expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : null,
    },
    scope: typeof payload.scope === "string" ? payload.scope : scopeForMode(mode),
    authorizedPaths: normalizeAuthorizedPaths(payload.authorized_paths),
  })
}

/** 会话清理：由 cron 调用，删掉过期行。 */
export async function cleanupBaiduSessions(env: Env): Promise<number> {
  const result = await env.DB.prepare(
    `DELETE FROM baidu_oauth_sessions WHERE expires_at < ?`,
  )
    .bind(nowSeconds())
    .run()
  return result.meta?.changes ?? 0
}

/** 供单测使用：把 state 映射成会话键（当前直接是 state 本身）。 */
export async function stateFingerprint(state: string): Promise<string> {
  return sha256Hex(state)
}

function successPage(): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>授权成功 · 青幕AI写作</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#f6f7f9;font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2328}
  .card{max-width:420px;padding:40px 32px;background:#fff;border-radius:16px;
        box-shadow:0 8px 32px rgba(0,0,0,.06);text-align:center}
  .tick{width:56px;height:56px;margin:0 auto 20px;border-radius:50%;background:#e7f7ec;
        display:flex;align-items:center;justify-content:center;font-size:28px;color:#1a7f37}
  h1{margin:0 0 12px;font-size:20px}
  p{margin:0;color:#57606a;font-size:14px}
</style></head>
<body><div class="card">
  <div class="tick">&#10003;</div>
  <h1>授权成功</h1>
  <p>可以关闭这个页面，回到 青幕AI写作 继续操作。</p>
</div></body></html>`
}

function failurePage(message: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>授权未完成 · 青幕AI写作</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#f6f7f9;font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2328}
  .card{max-width:420px;padding:40px 32px;background:#fff;border-radius:16px;
        box-shadow:0 8px 32px rgba(0,0,0,.06);text-align:center}
  .mark{width:56px;height:56px;margin:0 auto 20px;border-radius:50%;background:#fff4e5;
        display:flex;align-items:center;justify-content:center;font-size:28px;color:#bc4c00}
  h1{margin:0 0 12px;font-size:20px}
  p{margin:0;color:#57606a;font-size:14px}
</style></head>
<body><div class="card">
  <div class="mark">!</div>
  <h1>授权未完成</h1>
  <p>${message.replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[ch]!)}</p>
</div></body></html>`
}
