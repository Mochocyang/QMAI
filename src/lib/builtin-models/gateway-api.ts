/**
 * 内置模型网关的接入层（网关卡版）。
 *
 * ## 与上一版的区别
 *
 * 上一版这里有一个 `fetchRelayTicket`：用登录态换 30 分钟票据。现在没有了 ——
 * 网关卡在**登录时就已经随登录态下发**，与账号同生共死，不需要换、不会过期。
 *
 * 所以这个文件只剩两个动作，都需要调用方把卡传进来：
 *   1. 拉清单：`GET <relay>/v1/models`            ← Bearer <网关卡>
 *   2. 探活：  `POST <relay>/v1/chat/completions`  ← Bearer <网关卡>
 *
 * 卡从哪来由上层决定（`netcard.ts` 从登录态读、`auth-hook.ts` 在请求时注入），
 * 这样这一层可以纯粹做 HTTP 编排，不依赖任何状态。
 */

import { getHttpFetch } from "@/lib/tauri-fetch"

/** 中转站地址：独立域名，与账号服务分开部署。 */
export const DEFAULT_RELAY_URL = "https://relay.qmai.work"

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

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
 * 允许粘贴 `https://relay.qmai.work/v1`、结尾带斜杠、或整段 chat/completions。
 */
export function normalizeGatewayBaseUrl(raw: string): string {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return ""
  let value = trimmed.replace(/\/+$/, "")
  value = value.replace(/\/v1\/chat\/completions$/i, "").replace(/\/v1$/i, "")
  value = value.replace(/\/(api|v1)$/i, "")
  return value.replace(/\/+$/, "")
}

/**
 * 把网关的两种错误形状翻译成人话：
 *  - 中转站：`{ error: { message, type } }`
 *  - 账号服务：`{ success:false, code:"…", message:"…" }`
 * 绝不把英文/JSON 直接甩给作者。
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
  const rawCode = String((nested?.type as string | undefined) ?? (record.code as string | undefined) ?? "")
  const haystack = `${rawCode} ${rawMessage}`.toLowerCase()

  if (status === 401) {
    return new GatewayError(rawMessage || "登录状态已失效，请重新登录后再使用内置模型。", "unauthorized", status)
  }
  if (status === 403) {
    return new GatewayError(
      rawMessage || "当前账号没有使用内置模型的权限，请联系管理员开通。",
      "forbidden",
      status,
    )
  }
  if (status === 404) {
    return new GatewayError(rawMessage || "内置模型不存在或已下线，请刷新模型列表后重试。", "not_found", status)
  }
  if (/没有可用的上游通道|配置不完整/.test(rawMessage)) {
    return new GatewayError("内置模型服务尚未配置完成，请联系管理员。", "upstream_missing", status)
  }
  if (status === 429 || /rate|限流/.test(haystack)) {
    return new GatewayError("请求过于频繁，请稍后再试。", "rate_limited", status)
  }
  if (status >= 500) {
    return new GatewayError("内置模型服务暂时不可用，请稍后重试。", "server_error", status)
  }
  return new GatewayError(rawMessage || `内置模型服务返回 HTTP ${status}`, rawCode || "gateway_error", status)
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
    throw new GatewayError(`无法连接到内置模型服务（${url}）：${detail}`, "network_error")
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

  if (!response.ok) throw toGatewayError(payload, response.status)
  return { status: response.status, payload }
}

function jsonHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "Content-Type": "application/json", ...extra }
}

/** 拉取当前网关卡能用的模型清单（对外名，不含上游信息）。 */
export async function gatewayListModels(
  relayBaseUrl: string,
  netcard: string,
  fetchImpl?: FetchLike,
): Promise<string[]> {
  const base = normalizeGatewayBaseUrl(relayBaseUrl)
  if (!netcard) throw new GatewayError("请先登录账号，再使用内置模型。", "unauthorized")
  const { payload } = await httpJson(
    `${base}/v1/models`,
    { method: "GET", headers: jsonHeaders({ Authorization: `Bearer ${netcard}` }) },
    fetchImpl,
    20_000,
  )
  const record = (payload ?? {}) as Record<string, unknown>
  const data = Array.isArray(record.data) ? record.data : []
  const ids = data
    .map((item) => (typeof item === "string" ? item : String((item as Record<string, unknown>)?.id ?? "")))
    .filter((id) => id.trim().length > 0)
  return [...new Set(ids)]
}

export interface GatewayProbeResult {
  content: string
  latencyMs: number
}

/**
 * 发一条最小请求验证网关卡 + 模型是否真的能出字。
 * 走非流式，避免把流式解析链路也拖进来；只用于「测试连接」。
 */
export async function gatewayProbeChat(
  relayBaseUrl: string,
  netcard: string,
  model: string,
  fetchImpl?: FetchLike,
): Promise<GatewayProbeResult> {
  const base = normalizeGatewayBaseUrl(relayBaseUrl)
  if (!netcard) throw new GatewayError("请先登录账号，再使用内置模型。", "unauthorized")
  const startedAt = Date.now()
  const { payload } = await httpJson(
    `${base}/v1/chat/completions`,
    {
      method: "POST",
      headers: jsonHeaders({ Authorization: `Bearer ${netcard}` }),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "请只回复两个字：你好" }],
        max_tokens: 32,
        stream: false,
      }),
    },
    fetchImpl,
    120_000,
  )
  const record = (payload ?? {}) as Record<string, unknown>
  const choices = Array.isArray(record.choices) ? record.choices : []
  const first = (choices[0] ?? {}) as Record<string, unknown>
  const message = (first.message ?? {}) as Record<string, unknown>
  const content = String(message.content ?? "").trim()
  return { content: content || "（模型返回了空内容）", latencyMs: Date.now() - startedAt }
}
