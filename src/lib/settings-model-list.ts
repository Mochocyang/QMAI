import { getProviderConfig, withCustomOriginHeader } from "@/lib/llm-providers"
import { detectLocalCliConfig } from "@/lib/local-cli-config"
import { ensureCursorProxyRunning, restartCursorProxyWithAuth, withCursorProxyEndpoint } from "@/lib/cursor-cli-proxy"
import { isDirectRerankEndpoint } from "@/lib/rerank-api"
import { getHttpFetch } from "@/lib/tauri-fetch"
import type { EmbeddingConfig, LlmConfig, RerankConfig } from "@/stores/wiki-store"

export interface LlmModelListResult {
  models: string[]
}

const MODEL_LIST_COMPAT_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) QMaiWrite",
}

function uniqueSortedModels(models: string[]): string[] {
  return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  )
}

function parseModelListResponse(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return []
  const candidates = Array.isArray((raw as { data?: unknown }).data)
    ? (raw as { data: unknown[] }).data
    : Array.isArray((raw as { models?: unknown }).models)
      ? (raw as { models: unknown[] }).models
      : []

  return candidates.map((item) => {
    if (typeof item === "string") return item
    if (item && typeof item === "object") {
      const id = (item as { id?: unknown; name?: unknown; model?: unknown }).id
        ?? (item as { id?: unknown; name?: unknown; model?: unknown }).name
        ?? (item as { id?: unknown; name?: unknown; model?: unknown }).model
      return typeof id === "string" ? id : ""
    }
    return ""
  })
}

function stripGoogleApiKeyQuery(endpoint: string): string {
  if (!endpoint.includes("?")) return endpoint
  try {
    const url = new URL(endpoint)
    url.searchParams.delete("key")
    return url.toString()
  } catch {
    return endpoint.replace(/([?&])key=[^&]*&?/i, (_, prefix: string) => (prefix === "?" ? "?" : "&"))
      .replace(/[?&]$/, "")
      .replace("?&", "?")
  }
}

function buildEndpointModelsUrl(endpoint: string): string {
  const trimmed = endpoint.trim()
  if (!trimmed) {
    throw new Error("请先填写接口地址后再拉取模型列表。")
  }

  if (trimmed.includes("generativelanguage.googleapis.com") || /:embedcontent(\?|$)/i.test(trimmed)) {
    const base = stripGoogleApiKeyQuery(trimmed)
      .replace(/\/+$/, "")
      .replace(/\/models\/[^/?]+:(?:embedContent|batchEmbedContents)(?:\?.*)?$/i, "")
      .replace(/\/models\/[^/?]+(?:\?.*)?$/i, "")
      .replace(/\/models(?:\?.*)?$/i, "")
    return `${base}/models`
  }

  if (/\/embeddings(?:\?.*)?$/i.test(trimmed)) {
    return trimmed.replace(/\/embeddings(?:\?.*)?$/i, "/models")
  }
  if (/\/chat\/completions(?:\?.*)?$/i.test(trimmed)) {
    return trimmed.replace(/\/chat\/completions(?:\?.*)?$/i, "/models")
  }
  if (/\/responses(?:\?.*)?$/i.test(trimmed)) {
    return trimmed.replace(/\/responses(?:\?.*)?$/i, "/models")
  }
  if (/\/messages(?:\?.*)?$/i.test(trimmed)) {
    return trimmed.replace(/\/messages(?:\?.*)?$/i, "/models")
  }
  if (/\/rerank(?:\?.*)?$/i.test(trimmed)) {
    return trimmed.replace(/\/rerank(?:\?.*)?$/i, "/models")
  }
  if (/\/models(?:\?.*)?$/i.test(trimmed)) {
    return trimmed
  }
  return `${trimmed.replace(/\/+$/, "")}/models`
}

function toModelListResult(models: string[]): LlmModelListResult {
  return { models: uniqueSortedModels(models) }
}

function buildModelsUrl(config: LlmConfig): { url: string; headers: Record<string, string> } {
  if (config.provider === "google") {
    const base = stripGoogleApiKeyQuery(config.customEndpoint.trim() || "https://generativelanguage.googleapis.com/v1beta")
      .replace(/\/+$/, "")
      .replace(/\/models(?:\/[^/?]+(?::(?:embedContent|batchEmbedContents))?)?$/i, "")
    return {
      url: `${base}/models`,
      headers: config.apiKey ? { "x-goog-api-key": config.apiKey } : {},
    }
  }

  if (config.provider === "claude-code" || config.provider === "codex-cli") {
    return {
      url: "",
      headers: {},
    }
  }

  const providerConfig = getProviderConfig(config)
  const url = providerConfig.url
  let modelsUrl: string

  if (/\/chat\/completions(?:\?.*)?$/i.test(url)) {
    modelsUrl = url.replace(/\/chat\/completions(?:\?.*)?$/i, "/models")
  } else if (/\/responses(?:\?.*)?$/i.test(url)) {
    modelsUrl = url.replace(/\/responses(?:\?.*)?$/i, "/models")
  } else if (/\/messages(?:\?.*)?$/i.test(url)) {
    modelsUrl = url.replace(/\/messages(?:\?.*)?$/i, "/models")
  } else if (/\/rerank(?:\?.*)?$/i.test(url)) {
    modelsUrl = url.replace(/\/rerank(?:\?.*)?$/i, "/models")
  } else {
    modelsUrl = `${url.replace(/\/+$/, "")}/models`
  }

  const headers = config.provider === "custom"
    ? withCustomOriginHeader(providerConfig.headers, modelsUrl)
    : providerConfig.headers
  const { "Content-Type": _contentType, ...modelListHeaders } = headers
  return { url: modelsUrl, headers: modelListHeaders }
}

async function fetchModelList(url: string, headers: Record<string, string>, _currentModel: string): Promise<LlmModelListResult> {
  const httpFetch = await getHttpFetch()
  let response = await httpFetch(url, {
    method: "GET",
    headers,
  })
  let original403Text: string | null = null

  if (response.status === 403) {
    original403Text = await response.text().catch(() => "")
    try {
      response = await httpFetch(url, {
        method: "GET",
        headers: {
          ...headers,
          ...MODEL_LIST_COMPAT_HEADERS,
        },
      })
      original403Text = null
    } catch {
      throw new Error(`模型列表拉取失败：HTTP 403${original403Text ? ` ${original403Text.slice(0, 200)}` : ""}`)
    }
  }

  if (!response.ok) {
    const text = original403Text ?? await response.text().catch(() => "")
    throw new Error(`模型列表拉取失败：HTTP ${response.status}${text ? ` ${text.slice(0, 200)}` : ""}`)
  }

  return toModelListResult(parseModelListResponse(await response.json()))
}

async function fetchLocalCliModel(config: LlmConfig): Promise<LlmModelListResult> {
  const explicitModel = config.model.trim()
  if (explicitModel) return { models: [explicitModel] }

  const detect = await detectLocalCliConfig(config.provider)
  const localModel = detect?.model?.trim() ?? ""
  if (!localModel) {
    throw new Error("当前本地 CLI 未配置默认模型，请先在本地 CLI 中设置模型，或在软件里手动填写模型。")
  }
  return { models: [localModel] }
}

export async function fetchLlmModelList(config: LlmConfig): Promise<LlmModelListResult> {
  if (config.provider === "claude-code" || config.provider === "codex-cli") {
    return fetchLocalCliModel(config)
  }

  let runtimeConfig = config
  if (config.provider === "cursor-cli") {
    const endpoint = await ensureCursorProxyRunning(config)
    runtimeConfig = withCursorProxyEndpoint(config, endpoint)
  }

  const { url, headers } = buildModelsUrl(runtimeConfig)

  const load = async () => {
    const result = await fetchModelList(url, headers, runtimeConfig.model)
    if (runtimeConfig.provider === "google") {
      return toModelListResult(result.models.map((model) => model.replace(/^models\//, "")))
    }
    return result
  }

  try {
    return await load()
  } catch (error) {
    if (runtimeConfig.provider !== "cursor-cli") throw error
    const message = error instanceof Error ? error.message : String(error)
    if (!/authentication required|CURSOR_API_KEY|CURSOR_AUTH_TOKEN/i.test(message)) {
      throw error
    }
    const endpoint = await restartCursorProxyWithAuth(runtimeConfig)
    runtimeConfig = withCursorProxyEndpoint(runtimeConfig, endpoint)
    const retry = buildModelsUrl(runtimeConfig)
    const result = await fetchModelList(retry.url, retry.headers, runtimeConfig.model)
    return result
  }
}

export async function fetchEmbeddingModelList(config: EmbeddingConfig): Promise<LlmModelListResult> {
  const url = buildEndpointModelsUrl(config.endpoint)
  const isGoogle = url.includes("generativelanguage.googleapis.com")
  const headers: Record<string, string> = {}

  if (config.apiKey.trim()) {
    if (isGoogle) {
      headers["x-goog-api-key"] = config.apiKey.trim()
    } else {
      headers.Authorization = `Bearer ${config.apiKey.trim()}`
    }
  }

  const result = await fetchModelList(url, headers, config.model)
  if (isGoogle) {
    return toModelListResult(result.models.map((model) => model.replace(/^models\//, "")))
  }
  return result
}

export async function fetchRerankModelList(
  llmConfig: LlmConfig,
  rerankConfig: RerankConfig,
): Promise<LlmModelListResult> {
  if (rerankConfig.useMainLlm) {
    return fetchLlmModelList(llmConfig)
  }

  if (isDirectRerankEndpoint({ provider: rerankConfig.provider, customEndpoint: rerankConfig.customEndpoint })) {
    return fetchModelList(
      buildEndpointModelsUrl(rerankConfig.customEndpoint),
      rerankConfig.apiKey.trim() ? { Authorization: `Bearer ${rerankConfig.apiKey.trim()}` } : {},
      rerankConfig.model,
    )
  }

  return fetchLlmModelList({
    provider: rerankConfig.provider,
    apiKey: rerankConfig.apiKey,
    model: rerankConfig.model,
    ollamaUrl: rerankConfig.ollamaUrl,
    customEndpoint: rerankConfig.customEndpoint,
    apiMode: rerankConfig.provider === "custom" ? rerankConfig.apiMode : undefined,
    maxContextSize: Math.min(llmConfig.maxContextSize ?? 65_536, 65_536),
    reasoning: { mode: "off" },
  })
}
