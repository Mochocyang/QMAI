/**
 * 内置模型的网关接入层。
 *
 * QMAI 的「内置模型」不是本地推理，而是由我们自己运营的一个模型网关
 * （New API / one-api 一类的 OpenAI 兼容中转）统一供模型：
 *
 *   用户注册/登录厂商账号 → 购买额度 → 客户端领到一枚 sk- 令牌
 *   → 写作请求全部走 `${serverUrl}/v1/chat/completions`
 *
 * 这样客户端只需要维护一个 provider（id = `qmai-builtin`），
 * 不需要知道 DeepSeek / GLM / Kimi 各自的密钥与地址。
 *
 * 本文件只做纯 HTTP 编排，不碰 React、不碰 store，方便单测与替换后端。
 * 换自建后端时只要保持同一组路由，客户端不用改。
 */

import { getHttpFetch } from "@/lib/tauri-fetch"

/** 默认网关地址：当前测试环境。正式版换成自家 HTTPS 域名即可。 */
export const DEFAULT_BUILTIN_SERVER_URL = "http://localhost:3000"

/** 给用户自动开通的令牌名。按名字复用，避免每次登录都新建一枚。 */
export const BUILTIN_TOKEN_NAME = "QMAI 内置模型"

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface GatewayUser {
  id: number
  username: string
  displayName: string
  quota: number
  usedQuota: number
  group: string
  role: number
}

export interface GatewayLoginResult {
  accessToken: string
  /** epoch 秒；网关默认发的 access token 只有 15 分钟。 */
  accessExpiresAt: number
  user: GatewayUser
}

export interface GatewayToken {
  id: number
  name: string
  /** 列表里是打码的（TJVU****Jyot），取全量要走 /api/token/{id}/key。 */
  key: string
  status: number
  unlimitedQuota: boolean
  remainQuota: number
  usedQuota: number
}

export interface GatewayPublicStatus {
  systemName: string
  /** 多少 quota 记 1 美元，默认 500000。 */
  quotaPerUnit: number
  /** 充值比例：1 美元额度需要多少本地货币（New API 的 price 字段）。 */
  pricePerUnit: number
  /** 展示汇率：1 美元 = 多少本地货币。 */
  usdExchangeRate: number
  registerEnabled: boolean
}

export interface BuiltinTokenResult {
  tokenId: number
  /** 带 `sk-` 前缀，可直接作为 OpenAI 兼容接口的 Bearer。 */
  key: string
  created: boolean
}

export class GatewayError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code: string, status = 0) {
    super(message)
    this.name = "GatewayError"
    this.code = code
    this.status = status
  }
}

/**
 * 把用户填的地址收敛成 `scheme://host[:port]`：
 * 允许粘贴 `http://localhost:3000/v1`、结尾带斜杠、或整段 chat/completions。
 */
export function normalizeGatewayBaseUrl(raw: string): string {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return ""
  let value = trimmed.replace(/\/+$/, "")
  value = value.replace(/\/v1\/chat\/completions$/i, "").replace(/\/v1$/i, "")
  value = value.replace(/\/(api|v1)$/i, "")
  return value.replace(/\/+$/, "")
}

export function isAccessTokenExpired(expiresAt: number, skewSeconds = 60): boolean {
  if (!expiresAt) return false
  return Date.now() / 1000 >= expiresAt - skewSeconds
}

/** quota → 美元字符串（网关默认 500000 quota = $1）。 */
export function formatQuotaUsd(quota: number, quotaPerUnit: number): string {
  const unit = quotaPerUnit > 0 ? quotaPerUnit : 500000
  const usd = (Number.isFinite(quota) ? quota : 0) / unit
  return `$${usd.toFixed(usd >= 100 ? 0 : 2)}`
}

function jsonHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "Content-Type": "application/json", ...extra }
}

function authHeaders(accessToken: string): Record<string, string> {
  return jsonHeaders({ Authorization: `Bearer ${accessToken}` })
}

async function httpJson(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike | undefined,
  timeoutMs: number,
): Promise<{ status: number; payload: unknown }> {
  const fetcher = fetchImpl ?? (await getHttpFetch())
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetcher(url, { ...init, signal: controller.signal })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new GatewayError(
      `无法连接到内置模型网关（${url}）：${detail}。请确认网关地址可访问、服务已启动。`,
      "network_error",
    )
  } finally {
    clearTimeout(timer)
  }

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    throw toGatewayError(payload, response.status)
  }
  return { status: response.status, payload }
}

/**
 * 网关有两套错误形状：
 *  - 管理接口：`{ success:false, message:"…" }`
 *  - 推理接口：`{ error:{ message, code } }`
 * 两条都要翻译成人话，别把英文/JSON 直接甩给作者。
 */
export function toGatewayError(payload: unknown, status: number): GatewayError {
  const record = (payload ?? {}) as Record<string, unknown>
  const nested = typeof record.error === "object" && record.error !== null
    ? (record.error as Record<string, unknown>)
    : null
  const rawMessage = String(
    (nested?.message as string | undefined)
    ?? (record.message as string | undefined)
    ?? "",
  ).trim()
  const rawCode = String((nested?.code as string | undefined) ?? (record.code as string | undefined) ?? "")
  const haystack = `${rawCode} ${rawMessage}`.toLowerCase()

  if (/insufficient_user_quota|insufficient quota|quota.*(exceed|不足)|余额不足/.test(haystack)) {
    return new GatewayError("账户额度不足，请先充值或兑换额度后再使用内置模型。", "insufficient_quota", status)
  }
  if (/invalid token|令牌无效|token.*(invalid|expired)/.test(haystack)) {
    return new GatewayError("内置模型令牌无效或已被删除，请在「内置模型」页重新开通。", "invalid_token", status)
  }
  if (status === 401) {
    return new GatewayError("登录状态已过期，请重新登录后再操作。", "unauthorized", status)
  }
  if (status === 403) {
    return new GatewayError(rawMessage || "当前账号没有权限使用该模型，请联系管理员。", "forbidden", status)
  }
  if (status >= 500) {
    return new GatewayError("内置模型网关暂时不可用，请稍后重试。", "server_error", status)
  }
  return new GatewayError(rawMessage || `内置模型网关返回 HTTP ${status}`, rawCode || "gateway_error", status)
}

function expectSuccess(payload: unknown, status: number): Record<string, unknown> {
  const record = (payload ?? {}) as Record<string, unknown>
  if (record.success === false) throw toGatewayError(record, status)
  return record
}

function toUser(raw: unknown): GatewayUser {
  const record = (raw ?? {}) as Record<string, unknown>
  return {
    id: Number(record.id ?? 0),
    username: String(record.username ?? ""),
    displayName: String(record.display_name ?? record.displayName ?? record.username ?? ""),
    quota: Number(record.quota ?? 0),
    usedQuota: Number(record.used_quota ?? 0),
    group: String(record.group ?? ""),
    role: Number(record.role ?? 0),
  }
}

export async function gatewayLogin(
  baseUrl: string,
  username: string,
  password: string,
  fetchImpl?: FetchLike,
): Promise<GatewayLoginResult> {
  const base = normalizeGatewayBaseUrl(baseUrl)
  const { status, payload } = await httpJson(
    `${base}/api/user/login`,
    { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ username, password }) },
    fetchImpl,
    20000,
  )
  const body = expectSuccess(payload, status)
  const data = (body.data ?? {}) as Record<string, unknown>
  const accessToken = String(data.access_token ?? "")
  if (!accessToken) {
    // v0.9.x 的登录只返回用户对象 + session cookie，没有 Bearer 令牌。
    // 这类网关的 /api/* 还要额外带 New-Api-User，客户端不做兼容。
    if (data.id !== undefined) {
      throw new GatewayError(
        "这个网关是旧版 New API（v0.9），暂不支持应用内账号登录。请先用下方「测试密钥」启用，或把网关升级到 1.0。",
        "legacy_gateway",
      )
    }
    throw new GatewayError("网关没有返回登录令牌，请确认该地址是 New API 网关。", "bad_gateway")
  }
  return {
    accessToken,
    accessExpiresAt: Number(data.access_expires_at ?? 0),
    user: toUser(data.user),
  }
}

export async function gatewayRegister(
  baseUrl: string,
  username: string,
  password: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  const base = normalizeGatewayBaseUrl(baseUrl)
  const { status, payload } = await httpJson(
    `${base}/api/user/register`,
    {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ username, password, email: "", verification_code: "", aff_code: "" }),
    },
    fetchImpl,
    20000,
  )
  expectSuccess(payload, status)
}

/**
 * 续期账号令牌（不需要请求体）：New API v1.0 的 refresh cookie 只挂在
 * `/api/user/auth` 路径上，Tauri 的 plugin-http 有内存 cookie jar，会在同一次
 * 运行内自动带上。续期失败就回落到「请重新登录」。
 */
export async function gatewayRefreshSession(
  baseUrl: string,
  fetchImpl?: FetchLike,
): Promise<GatewayLoginResult> {
  const base = normalizeGatewayBaseUrl(baseUrl)
  const { status, payload } = await httpJson(
    `${base}/api/user/auth/refresh`,
    { method: "POST", headers: jsonHeaders() },
    fetchImpl,
    15000,
  )
  const body = expectSuccess(payload, status)
  const data = (body.data ?? {}) as Record<string, unknown>
  const accessToken = String(data.access_token ?? "")
  if (!accessToken) throw new GatewayError("登录续期失败，请重新登录。", "unauthorized")
  return {
    accessToken,
    accessExpiresAt: Number(data.access_expires_at ?? 0),
    user: toUser(data.user),
  }
}

export async function gatewayFetchSelf(
  baseUrl: string,
  accessToken: string,
  fetchImpl?: FetchLike,
): Promise<GatewayUser> {
  const base = normalizeGatewayBaseUrl(baseUrl)
  const { status, payload } = await httpJson(
    `${base}/api/user/self`,
    { method: "GET", headers: authHeaders(accessToken) },
    fetchImpl,
    15000,
  )
  const body = expectSuccess(payload, status)
  return toUser(body.data)
}

function toToken(raw: unknown): GatewayToken {
  const record = (raw ?? {}) as Record<string, unknown>
  return {
    id: Number(record.id ?? 0),
    name: String(record.name ?? ""),
    key: String(record.key ?? ""),
    status: Number(record.status ?? 0),
    unlimitedQuota: record.unlimited_quota === true,
    remainQuota: Number(record.remain_quota ?? 0),
    usedQuota: Number(record.used_quota ?? 0),
  }
}

export async function gatewayListTokens(
  baseUrl: string,
  accessToken: string,
  fetchImpl?: FetchLike,
): Promise<GatewayToken[]> {
  const base = normalizeGatewayBaseUrl(baseUrl)
  const { status, payload } = await httpJson(
    `${base}/api/token/?p=1&size=100`,
    { method: "GET", headers: authHeaders(accessToken) },
    fetchImpl,
    15000,
  )
  const body = expectSuccess(payload, status)
  const data = (body.data ?? {}) as Record<string, unknown>
  const items = Array.isArray(data.items) ? data.items : []
  return items.map(toToken)
}

/** 列表里的 key 是打码的；这个接口才返回完整密钥（不含 sk- 前缀）。 */
export async function gatewayRevealTokenKey(
  baseUrl: string,
  accessToken: string,
  tokenId: number,
  fetchImpl?: FetchLike,
): Promise<string> {
  const base = normalizeGatewayBaseUrl(baseUrl)
  const { status, payload } = await httpJson(
    `${base}/api/token/${tokenId}/key`,
    { method: "POST", headers: authHeaders(accessToken) },
    fetchImpl,
    15000,
  )
  const body = expectSuccess(payload, status)
  const data = (body.data ?? {}) as Record<string, unknown>
  const key = String(data.key ?? "")
  if (!key) throw new GatewayError("网关没有返回令牌密钥，请重试。", "empty_token_key")
  return key.startsWith("sk-") ? key : `sk-${key}`
}

async function createBuiltinToken(
  baseUrl: string,
  accessToken: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  const base = normalizeGatewayBaseUrl(baseUrl)
  const { status, payload } = await httpJson(
    `${base}/api/token/`,
    {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        name: BUILTIN_TOKEN_NAME,
        remain_quota: 0,
        // -1 = 永不过期：写作令牌不应该 15 分钟就失效。
        expired_time: -1,
        // 必须开无限额度，否则额度为 0 的令牌会立刻变成「已用尽」状态。
        unlimited_quota: true,
        model_limits_enabled: false,
        model_limits: "",
        allow_ips: "",
        group: "",
      }),
    },
    fetchImpl,
    15000,
  )
  expectSuccess(payload, status)
}

/**
 * 取一枚可用的内置模型令牌：
 *  1. 已有同名且状态正常的令牌 → 直接取回完整密钥（幂等，不重复建）；
 *  2. 没有 → 新建一枚无限额度、永不过期的令牌，再取回密钥。
 */
export async function ensureBuiltinToken(
  baseUrl: string,
  accessToken: string,
  fetchImpl?: FetchLike,
): Promise<BuiltinTokenResult> {
  const tokens = await gatewayListTokens(baseUrl, accessToken, fetchImpl)
  const usable = tokens
    .filter((token) => token.name === BUILTIN_TOKEN_NAME && token.status === 1 && token.unlimitedQuota)
    .sort((a, b) => b.id - a.id)[0]

  if (usable) {
    return {
      tokenId: usable.id,
      key: await gatewayRevealTokenKey(baseUrl, accessToken, usable.id, fetchImpl),
      created: false,
    }
  }

  await createBuiltinToken(baseUrl, accessToken, fetchImpl)
  const after = await gatewayListTokens(baseUrl, accessToken, fetchImpl)
  const fresh = after
    .filter((token) => token.name === BUILTIN_TOKEN_NAME && token.status === 1 && token.unlimitedQuota)
    .sort((a, b) => b.id - a.id)[0]
  if (!fresh) {
    throw new GatewayError("令牌创建后没有出现在列表里，请稍后重试或到网关后台查看。", "token_not_created")
  }
  return {
    tokenId: fresh.id,
    key: await gatewayRevealTokenKey(baseUrl, accessToken, fresh.id, fetchImpl),
    created: true,
  }
}

/** 网关对当前令牌开放的模型（按会员分组/渠道权限返回）。 */
export async function gatewayListModels(
  baseUrl: string,
  apiKey: string,
  fetchImpl?: FetchLike,
): Promise<string[]> {
  const base = normalizeGatewayBaseUrl(baseUrl)
  const key = apiKey.startsWith("sk-") ? apiKey : `sk-${apiKey}`
  const { payload } = await httpJson(
    `${base}/v1/models`,
    { method: "GET", headers: jsonHeaders({ Authorization: `Bearer ${key}` }) },
    fetchImpl,
    20000,
  )
  const record = (payload ?? {}) as Record<string, unknown>
  const data = Array.isArray(record.data) ? record.data : []
  const ids = data
    .map((item) => (typeof item === "string" ? item : String((item as Record<string, unknown>)?.id ?? "")))
    .filter((id) => id.trim().length > 0)
  return [...new Set(ids)]
}

export async function gatewayPublicStatus(
  baseUrl: string,
  fetchImpl?: FetchLike,
): Promise<GatewayPublicStatus> {
  const base = normalizeGatewayBaseUrl(baseUrl)
  const { payload } = await httpJson(`${base}/api/status`, { method: "GET" }, fetchImpl, 15000)
  const record = (payload ?? {}) as Record<string, unknown>
  const data = (record.data ?? {}) as Record<string, unknown>
  return {
    systemName: String(data.system_name ?? "New API"),
    quotaPerUnit: Number(data.quota_per_unit ?? 500000),
    pricePerUnit: Number(data.price ?? 0),
    usdExchangeRate: Number(data.usd_exchange_rate ?? 0),
    registerEnabled: data.register_enabled !== false && data.password_register_enabled !== false,
  }
}

/** 兑换码充值。成功时网关会把额度直接加到当前账号。 */
export async function gatewayRedeem(
  baseUrl: string,
  accessToken: string,
  code: string,
  fetchImpl?: FetchLike,
): Promise<string> {
  const base = normalizeGatewayBaseUrl(baseUrl)
  const { status, payload } = await httpJson(
    `${base}/api/user/topup`,
    { method: "POST", headers: authHeaders(accessToken), body: JSON.stringify({ key: code }) },
    fetchImpl,
    20000,
  )
  const body = expectSuccess(payload, status)
  return String(body.message ?? "兑换成功")
}

export interface GatewayProbeResult {
  content: string
  latencyMs: number
}

/**
 * 发一条最小请求验证令牌 + 模型是否真的能出字。
 * 走非流式，避免把流式解析链路也拖进来；只用于「测试连接」。
 */
export async function gatewayProbeChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  fetchImpl?: FetchLike,
): Promise<GatewayProbeResult> {
  const base = normalizeGatewayBaseUrl(baseUrl)
  const key = apiKey.startsWith("sk-") ? apiKey : `sk-${apiKey}`
  const startedAt = Date.now()
  const { payload } = await httpJson(
    `${base}/v1/chat/completions`,
    {
      method: "POST",
      headers: jsonHeaders({ Authorization: `Bearer ${key}` }),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "请只回复两个字：你好" }],
        max_tokens: 32,
        stream: false,
      }),
    },
    fetchImpl,
    120000,
  )
  const record = (payload ?? {}) as Record<string, unknown>
  const choices = Array.isArray(record.choices) ? record.choices : []
  const first = (choices[0] ?? {}) as Record<string, unknown>
  const message = (first.message ?? {}) as Record<string, unknown>
  const content = String(message.content ?? "").trim()
  return { content: content || "（模型返回了空内容）", latencyMs: Date.now() - startedAt }
}
