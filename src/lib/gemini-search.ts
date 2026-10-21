/**
 * Gemini「Grounding with Google Search」作为独立的联网搜索后端。
 *
 * 与写作所用的模型无关：这里只拿 Gemini 当搜索引擎，把它返回的
 * 搜索词、引用来源和综合摘要映射成 `WebSearchResult`，交给现有的联网查询流程。
 *
 * 端点选择：
 *  - 首选 Interactions API（`POST /v1beta/interactions`），是官方文档当前的写法
 *    （2026-10-13 更新），返回 `google_search_call` / `google_search_result` /
 *    `model_output`（带 `url_citation` 注解）。
 *  - 若该端点 404/405（多见于只转发 `generateContent` 的代理/中转），自动回退到
 *    `POST /v1beta/models/{model}:generateContent` + `tools: [{ google_search: {} }]`，
 *    解析 `groundingMetadata`。
 *
 * ⚠️ 实测（真实 key，中文查询）：两个端点给出的引用下标都是 **UTF-8 字节偏移**，
 * 不是 JS 字符下标，中文按字符切会切歪；这里统一按字节切。
 */
import type { WebSearchResult } from "@/lib/web-search"
import { getHttpFetch, isFetchNetworkError } from "@/lib/tauri-fetch"

export const DEFAULT_GEMINI_SEARCH_MODEL = "gemini-3.8-flash"
export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com"

export interface GeminiSearchOptions {
  apiKey: string
  model?: string
  baseUrl?: string
  maxResults?: number
}

export interface GeminiSearchOutcome {
  /** Gemini 实际执行的搜索词。 */
  queries: string[]
  /** Gemini 综合出的回答（带引用的那段文本）。 */
  summary: string
  /** 每个被引用的来源一条；snippet 是被引用的原文片段。 */
  results: WebSearchResult[]
  /** Google 要求展示的搜索建议 HTML（ToS），可能为空。 */
  searchSuggestionsHtml: string
  endpoint: "interactions" | "generateContent"
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** 按 UTF-8 字节偏移截取文本（Gemini 引用下标是字节偏移）。 */
export function sliceUtf8(text: string, start: number | undefined, end: number | undefined): string {
  const bytes = encoder.encode(text)
  const s = Math.max(0, Math.min(bytes.length, start ?? 0))
  const e = Math.max(s, Math.min(bytes.length, end ?? bytes.length))
  return decoder.decode(bytes.slice(s, e)).replace(/\uFFFD/g, "").trim()
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? "").trim() || DEFAULT_GEMINI_BASE_URL
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withProtocol.replace(/\/+$/, "").replace(/\/v1beta$/, "")
}

function sourceFromTitle(title: string, url: string): string {
  if (title && /^[\w.-]+\.[a-z]{2,}$/i.test(title)) return title.replace(/^www\./, "")
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return title
  }
}

interface Citation { url: string; title: string; snippet: string }

/** 同一个 URL 被多段引用时合并成一条，片段用「…」连接。 */
function mergeCitations(citations: Citation[], maxResults: number): WebSearchResult[] {
  const byUrl = new Map<string, Citation>()
  for (const citation of citations) {
    if (!citation.url) continue
    const existing = byUrl.get(citation.url)
    if (!existing) byUrl.set(citation.url, { ...citation })
    else if (citation.snippet && !existing.snippet.includes(citation.snippet)) {
      existing.snippet = existing.snippet ? `${existing.snippet} … ${citation.snippet}` : citation.snippet
    }
  }
  return [...byUrl.values()].slice(0, maxResults).map((citation) => ({
    title: citation.title || sourceFromTitle("", citation.url) || "Untitled",
    url: citation.url,
    // 片段截自模型的 Markdown 回答，去掉加粗标记，便于当作摘要阅读。
    snippet: citation.snippet.replace(/\*\*/g, "").replace(/^[*\-#\s]+/, "").trim(),
    source: sourceFromTitle(citation.title, citation.url),
  }))
}

/* ---------- Interactions API ---------- */

interface InteractionStep {
  type?: string
  arguments?: { queries?: unknown }
  result?: Array<{ search_suggestions?: unknown }>
  content?: Array<{
    type?: string
    text?: string
    annotations?: Array<{ type?: string; url?: string; title?: string; start_index?: number; end_index?: number }>
  }>
}

export function parseGeminiInteraction(data: unknown, maxResults = 10): Omit<GeminiSearchOutcome, "endpoint"> {
  const steps = ((data as { steps?: InteractionStep[] })?.steps ?? []) as InteractionStep[]
  const queries: string[] = []
  const suggestions: string[] = []
  const summaryParts: string[] = []
  const citations: Citation[] = []
  for (const step of steps) {
    if (step.type === "google_search_call") {
      const q = step.arguments?.queries
      if (Array.isArray(q)) queries.push(...q.filter((item): item is string => typeof item === "string" && item.trim() !== ""))
    } else if (step.type === "google_search_result") {
      for (const item of step.result ?? []) {
        if (typeof item.search_suggestions === "string" && item.search_suggestions.trim()) suggestions.push(item.search_suggestions)
      }
    } else if (step.type === "model_output") {
      for (const block of step.content ?? []) {
        if (block.type !== "text" || typeof block.text !== "string") continue
        summaryParts.push(block.text)
        for (const annotation of block.annotations ?? []) {
          if (annotation.type !== "url_citation" || !annotation.url) continue
          citations.push({
            url: annotation.url,
            title: annotation.title ?? "",
            snippet: sliceUtf8(block.text, annotation.start_index, annotation.end_index),
          })
        }
      }
    }
  }
  return {
    queries: [...new Set(queries)],
    summary: summaryParts.join("\n").trim(),
    results: mergeCitations(citations, maxResults),
    searchSuggestionsHtml: suggestions.join("\n"),
  }
}

/* ---------- generateContent（回退） ---------- */

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    groundingMetadata?: {
      webSearchQueries?: unknown
      searchEntryPoint?: { renderedContent?: string }
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>
      groundingSupports?: Array<{ segment?: { text?: string; startIndex?: number; endIndex?: number }; groundingChunkIndices?: number[] }>
    }
  }>
}

export function parseGeminiGenerateContent(data: unknown, maxResults = 10): Omit<GeminiSearchOutcome, "endpoint"> {
  const candidate = (data as GenerateContentResponse)?.candidates?.[0]
  const summary = (candidate?.content?.parts ?? []).map((part) => part.text ?? "").join("").trim()
  const metadata = candidate?.groundingMetadata
  const chunks = metadata?.groundingChunks ?? []
  const citations: Citation[] = []
  const cited = new Set<number>()
  for (const support of metadata?.groundingSupports ?? []) {
    const snippet = support.segment?.text?.trim()
      || sliceUtf8(summary, support.segment?.startIndex, support.segment?.endIndex)
    for (const index of support.groundingChunkIndices ?? []) {
      const web = chunks[index]?.web
      if (!web?.uri) continue
      cited.add(index)
      citations.push({ url: web.uri, title: web.title ?? "", snippet })
    }
  }
  // 有来源但没有逐段引用时，也把来源列出来（片段留空）。
  chunks.forEach((chunk, index) => {
    if (!cited.has(index) && chunk.web?.uri) citations.push({ url: chunk.web.uri, title: chunk.web.title ?? "", snippet: "" })
  })
  const rawQueries = metadata?.webSearchQueries
  return {
    queries: Array.isArray(rawQueries) ? rawQueries.filter((q): q is string => typeof q === "string" && q.trim() !== "") : [],
    summary,
    results: mergeCitations(citations, maxResults),
    searchSuggestionsHtml: metadata?.searchEntryPoint?.renderedContent ?? "",
  }
}

/* ---------- 请求 ---------- */

function buildPrompt(query: string): string {
  return `请使用 Google 搜索查询以下内容，并基于搜索结果用中文给出简明、可核对的事实摘要（标明关键数字、时间与人名）：\n${query}`
}

function describeHttpError(status: number, body: string): string {
  let detail = ""
  try {
    detail = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? ""
  } catch {
    detail = body.slice(0, 200)
  }
  const suffix = detail ? `（${detail}）` : ""
  // 实测：key 无效时 Gemini 返回的是 400（reason: API_KEY_INVALID），不是 401。
  if (/API_KEY_INVALID|API key not valid|API key expired/i.test(body)) {
    return `Gemini API Key 无效或已过期，请在「设置 → 网页搜索 → Gemini」中检查${suffix}`
  }
  if (status === 400) return `Gemini 搜索请求无效，请检查模型名是否支持 Google 搜索${suffix}`
  if (status === 401 || status === 403) return `Gemini API Key 无效或无权限，请在「设置 → 网页搜索 → Gemini」中检查${suffix}`
  if (status === 404) return `Gemini 搜索地址或模型不存在，请检查自定义地址与模型名${suffix}`
  if (status === 429) return `Gemini 搜索额度或频率超限，请稍后再试${suffix}`
  if (status >= 500) return `Gemini 服务暂时不可用（${status}），请稍后再试${suffix}`
  return `Gemini 搜索失败（${status}）${suffix}`
}

async function postJson(url: string, apiKey: string, body: unknown): Promise<Response> {
  const httpFetch = await getHttpFetch()
  try {
    return await httpFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    })
  } catch (err) {
    if (isFetchNetworkError(err)) {
      throw new Error("无法连接 Gemini 搜索服务，请检查网络、代理设置或自定义地址。")
    }
    throw err
  }
}

export async function geminiSearchDetailed(query: string, options: GeminiSearchOptions): Promise<GeminiSearchOutcome> {
  const apiKey = options.apiKey?.trim()
  if (!apiKey) throw new Error("未配置 Gemini API Key，请在「设置 → 网页搜索 → Gemini」中填写。")
  const model = options.model?.trim() || DEFAULT_GEMINI_SEARCH_MODEL
  const base = normalizeBaseUrl(options.baseUrl)
  const maxResults = options.maxResults ?? 10
  const prompt = buildPrompt(query)

  let outcome: GeminiSearchOutcome
  const interactions = await postJson(`${base}/v1beta/interactions`, apiKey, {
    model,
    input: prompt,
    tools: [{ type: "google_search" }],
  })
  if (interactions.ok) {
    outcome = { ...parseGeminiInteraction(await interactions.json(), maxResults), endpoint: "interactions" }
  } else if (interactions.status === 404 || interactions.status === 405) {
    // 代理/中转可能只支持 generateContent：回退。
    const legacy = await postJson(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, apiKey, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
    })
    if (!legacy.ok) throw new Error(describeHttpError(legacy.status, await legacy.text().catch(() => "")))
    outcome = { ...parseGeminiGenerateContent(await legacy.json(), maxResults), endpoint: "generateContent" }
  } else {
    throw new Error(describeHttpError(interactions.status, await interactions.text().catch(() => "")))
  }

  if (outcome.results.length === 0) {
    throw new Error(
      outcome.summary
        ? "Gemini 这次没有执行 Google 搜索或没有给出引用来源，结果无法核对，已不采用。可换个更具体的关键词重试。"
        : "Gemini 搜索没有返回任何内容，请稍后重试。",
    )
  }
  return outcome
}
