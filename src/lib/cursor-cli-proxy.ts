/**
 * Cursor CLI local provider helpers.
 *
 * Ensures cursor-api-proxy is reachable before HTTP chat / model-list calls.
 * The listening port is chosen by Tauri (prefer 8765, else a free port) and
 * returned so callers can point OpenAI-compatible requests at the live URL.
 */

import { invoke } from "@tauri-apps/api/core"
import type { LlmConfig } from "@/stores/wiki-store"
import { isTauri } from "@/lib/platform"
import type { LocalCliDetectResult } from "./local-cli-config"

export const DEFAULT_CURSOR_PROXY_BASE = "http://127.0.0.1:8765"
export const DEFAULT_CURSOR_PROXY_V1 = "http://127.0.0.1:8765/v1"

export interface CursorProxyStatus {
  healthy: boolean
  base_url: string
  managed: boolean
  error: string | null
}

export function toCursorProxyV1Endpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "")
  if (/\/v1$/i.test(trimmed)) return trimmed
  return `${trimmed}/v1`
}

export async function detectCursorCli(): Promise<LocalCliDetectResult> {
  if (!isTauri()) {
    return {
      installed: false,
      version: null,
      path: null,
      error: "仅桌面端支持本地 CLI 检测",
    }
  }
  return invoke<LocalCliDetectResult>("cursor_cli_detect")
}

export async function getCursorProxyStatus(): Promise<CursorProxyStatus> {
  if (!isTauri()) {
    return {
      healthy: false,
      base_url: DEFAULT_CURSOR_PROXY_BASE,
      managed: false,
      error: "仅桌面端可托管 cursor-api-proxy",
    }
  }
  return invoke<CursorProxyStatus>("cursor_proxy_status")
}

/**
 * Ensure proxy is up; returns the live OpenAI-compatible base (`…/v1`).
 */
export async function ensureCursorProxyRunning(
  config: Pick<LlmConfig, "provider">,
  options?: { forceRestart?: boolean },
): Promise<string> {
  if (config.provider !== "cursor-cli") {
    return DEFAULT_CURSOR_PROXY_V1
  }
  if (!isTauri()) {
    throw new Error("Cursor CLI 仅桌面端可用。请在 Tauri 应用中使用，或手动启动 cursor-api-proxy。")
  }
  const status = await invoke<CursorProxyStatus>("cursor_proxy_ensure", {
    forceRestart: options?.forceRestart ?? false,
  })
  if (!status.healthy) {
    throw new Error(status.error ?? `cursor-api-proxy 未就绪：${status.base_url}`)
  }
  return toCursorProxyV1Endpoint(status.base_url)
}

/** After Authentication required, kill managed proxy and respawn with zshrc credentials. */
export async function restartCursorProxyWithAuth(
  config: Pick<LlmConfig, "provider">,
): Promise<string> {
  return ensureCursorProxyRunning(config, { forceRestart: true })
}

/** Apply the live proxy `/v1` endpoint onto an LlmConfig for HTTP dispatch. */
export function withCursorProxyEndpoint(config: LlmConfig, v1Endpoint: string): LlmConfig {
  return { ...config, customEndpoint: v1Endpoint, apiMode: "chat_completions" }
}
