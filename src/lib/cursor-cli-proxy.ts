/**
 * Cursor CLI local provider helpers.
 *
 * Ensures cursor-api-proxy is reachable before HTTP chat / model-list calls.
 * The listening port is chosen by Tauri (prefer 8765, else a free port) and
 * returned so callers can point OpenAI-compatible requests at the live URL.
 */

import { invoke } from "@tauri-apps/api/core"
import type { LlmConfig } from "@/stores/wiki-store"
import {
  getCursorCliCatalog,
  inferCursorEffortFromModel,
  inferCursorSpeedModeFromModel,
  rememberCursorCliCatalog,
  toCursorAcpModelId,
  toCursorHttpModel,
} from "@/lib/cursor-acp-models"
import { isTauri } from "@/lib/platform"
import type { LocalCliDetectResult } from "./local-cli-config"

const DEFAULT_CURSOR_PROXY_BASE = "http://127.0.0.1:8765"
const DEFAULT_CURSOR_PROXY_V1 = "http://127.0.0.1:8765/v1"

interface CursorProxyStatus {
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

export interface CursorAgentAboutResult {
  installed: boolean
  version: string | null
  latest_status: string | null
  latest_version: string | null
  path: string | null
  error: string | null
}

export interface CursorAgentUpdateResult {
  ok: boolean
  version: string | null
  output: string
  error: string | null
}

export async function checkCursorAgentUpdate(): Promise<CursorAgentAboutResult> {
  if (!isTauri()) {
    return {
      installed: false,
      version: null,
      latest_status: null,
      latest_version: null,
      path: null,
      error: "仅桌面端支持本地 CLI 检测",
    }
  }
  return invoke<CursorAgentAboutResult>("cursor_cli_about")
}

export async function updateCursorAgent(): Promise<CursorAgentUpdateResult> {
  if (!isTauri()) {
    return {
      ok: false,
      version: null,
      output: "",
      error: "仅桌面端可更新 Cursor agent",
    }
  }
  return invoke<CursorAgentUpdateResult>("cursor_cli_update")
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
  config: Pick<LlmConfig, "provider"> & Partial<Pick<LlmConfig, "model" | "apiKey">>,
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
  const endpoint = toCursorProxyV1Endpoint(status.base_url)
  await refreshCursorCliCatalogIfEmpty(endpoint, config.apiKey)
  const acpModel = toCursorAcpModelId(config.model ?? "")
  if (acpModel) {
    const cliModel = toCursorHttpModel(config.model ?? "")
    await invoke("cursor_cli_apply_acp_model", {
      model: acpModel,
      cliModel,
      fast: inferCursorSpeedModeFromModel(cliModel) === "fast",
      effort: inferCursorEffortFromModel(cliModel),
    })
  }
  return endpoint
}

async function refreshCursorCliCatalogIfEmpty(
  v1Endpoint: string,
  apiKey?: string,
): Promise<void> {
  if (getCursorCliCatalog().length > 0) return
  try {
    const { getHttpFetch } = await import("@/lib/tauri-fetch")
    const httpFetch = await getHttpFetch()
    const response = await httpFetch(`${v1Endpoint.replace(/\/+$/, "")}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey?.trim() || "unused"}`,
      },
    })
    if (!response.ok) return
    const raw = await response.json() as { data?: unknown[] }
    const ids: string[] = []
    for (const item of raw.data ?? []) {
      if (typeof item === "string" && item.trim()) ids.push(item.trim())
      else if (item && typeof item === "object") {
        const id = (item as { id?: unknown }).id
        if (typeof id === "string" && id.trim()) ids.push(id.trim())
      }
    }
    if (ids.length > 0) rememberCursorCliCatalog(ids)
  } catch {
    /* catalog stays empty; HTTP falls back to heuristics */
  }
}

/** After Authentication required, kill managed proxy and respawn with zshrc credentials. */
export async function restartCursorProxyWithAuth(
  config: Pick<LlmConfig, "provider">,
): Promise<string> {
  return ensureCursorProxyRunning(config, { forceRestart: true })
}

/** Apply the live proxy `/v1` endpoint onto an LlmConfig for HTTP dispatch. */
export function withCursorProxyEndpoint(config: LlmConfig, v1Endpoint: string): LlmConfig {
  return {
    ...config,
    customEndpoint: v1Endpoint,
    apiMode: "chat_completions",
    // Send a CLI catalog id so overlapping requests keep their own --model.
    // ACP names are remapped to auto; default/auto stay default.
    model: toCursorHttpModel(config.model ?? ""),
  }
}
