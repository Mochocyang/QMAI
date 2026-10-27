/**
 * WorkBuddy 本地网关的前端句柄。
 *
 * 后端在应用进程内起了一个极小的 OpenAI 兼容网关（`src-tauri/src/workbuddy/gateway.rs`），
 * 绑 `127.0.0.1:0`（随机端口）并要求一个每进程随机的令牌。前端只需要两件事：
 *   1. `ensureWorkbuddyGateway()` —— 拿到 `{ baseUrl, token }`；
 *   2. `withWorkbuddyEndpoint(config)` —— 把 `customEndpoint` / `apiKey` 临时指过去。
 *
 * 与 `cursor-cli-proxy.ts` 同构：那一家也是「先确保本地代理在跑，再把 config
 * 改写成普通 OpenAI HTTP」。于是聊天链路、模型列表、连通性测试、中断全部复用
 * 既有实现，WorkBuddy 在系统里就是一个普通供应方。
 *
 * 令牌**不落盘**：它每次启动都变，写进 localStorage 只会变成一个过期的假配置。
 */

import { invoke } from "@tauri-apps/api/core"
import type { LlmConfig } from "@/stores/wiki-store"
import { isTauri } from "@/lib/platform"

export interface WorkbuddyGateway {
  baseUrl: string
  /** `http://127.0.0.1:<port>/v1`，直接当 `customEndpoint` 用 */
  v1BaseUrl: string
  token: string
}

interface GatewayEnsureResponse {
  ready: boolean
  baseUrl?: string
  v1BaseUrl?: string
  token?: string
  error?: string
}

/**
 * 确保网关在跑。失败抛错（文案直接用后端给的，它已经写了「为什么起不来」）。
 */
export async function ensureWorkbuddyGateway(): Promise<WorkbuddyGateway> {
  if (!isTauri()) {
    throw new Error("WorkBuddy 账号登录仅桌面端可用。")
  }
  const result = await invoke<GatewayEnsureResponse>("workbuddy_gateway_ensure")
  if (!result?.ready || !result.baseUrl || !result.token) {
    throw new Error(result?.error || "WorkBuddy 网关未就绪")
  }
  return {
    baseUrl: result.baseUrl,
    v1BaseUrl: result.v1BaseUrl ?? `${result.baseUrl}/v1`,
    token: result.token,
  }
}

/**
 * 把网关地址与令牌套到一个 provider 为 `workbuddy` 的配置上。
 *
 * 只改三个字段：`customEndpoint` / `apiKey` / `apiMode`。其余（模型、上下文、
 * 推理档位、工具开关）全部保留用户的选择 —— 这些是模型属性，与走哪个通道无关。
 */
export function withWorkbuddyEndpoint(config: LlmConfig, gateway: WorkbuddyGateway): LlmConfig {
  return {
    ...config,
    customEndpoint: gateway.v1BaseUrl,
    apiKey: gateway.token,
    apiMode: "chat_completions",
  }
}
