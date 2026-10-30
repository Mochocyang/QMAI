import type {
  SearchApiConfig,
  SearchProvider,
  SearchProviderConfigs,
  SearXngCategory,
  SerpApiEngine,
} from "@/stores/wiki-store"
import { getHttpFetch, isFetchNetworkError } from "@/lib/tauri-fetch"
import { geminiSearchDetailed } from "@/lib/gemini-search"
import { baizhiSearch } from "@/lib/baizhi-search"
import { antigravitySearchDetailed } from "@/lib/antigravity-search"
import { isBuiltinPluginEnabled } from "@/lib/plugins/builtin-state"

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  source: string
}

/**
 * 带附加信息的搜索结果。普通搜索引擎只有 `results`；
 * Gemini（Grounding with Google Search）还会给出它实际执行的搜索词、
 * 综合摘要与 Google 要求展示的搜索建议 HTML。
 */
export interface WebSearchOutcome {
  results: WebSearchResult[]
  queries?: string[]
  summary?: string
  searchSuggestionsHtml?: string
  /**
   * 内置插件「网页搜索」被关闭时为 `true`。
   *
   * 这不是"搜索失败"，而是"本次根本没有联网"：`results` 必然为空，
   * 但没有异常、没有网络请求。调用方据此把"搜了但没结果"和"压根没搜"
   * 在文案上区分开（前者可以提示换个词，后者只该提示去「插件」页打开）。
   */
  disabled?: boolean
  /** 与 `disabled` 搭配的人类可读原因，可以直接进提示词 / 提示信息。 */
  message?: string
}

export const SERPAPI_ENGINE_OPTIONS: { value: SerpApiEngine; label: string; hint: string }[] = [
  { value: "google", label: "Google Web", hint: "SerpApi Google Search API organic results" },
  { value: "google_news", label: "Google News", hint: "News-focused results" },
  { value: "google_scholar", label: "Google Scholar", hint: "Academic papers and citations" },
  { value: "google_patents", label: "Google Patents", hint: "Patent search results" },
  { value: "bing", label: "Bing", hint: "Bing organic results" },
  { value: "duckduckgo", label: "DuckDuckGo", hint: "DuckDuckGo organic results" },
  { value: "google_images", label: "Google Images", hint: "Image search results" },
  { value: "google_videos", label: "Google Videos", hint: "Video search results" },
  { value: "youtube", label: "YouTube", hint: "YouTube video results" },
]

export const SEARXNG_CATEGORY_OPTIONS: { value: SearXngCategory; label: string; hint: string }[] = [
  { value: "general", label: "General", hint: "Default web results" },
  { value: "news", label: "News", hint: "News engines" },
  { value: "science", label: "Science", hint: "Academic and science-focused engines" },
  { value: "it", label: "IT", hint: "Developer and technology engines" },
  { value: "images", label: "Images", hint: "Image search results" },
  { value: "videos", label: "Videos", hint: "Video search results" },
  { value: "files", label: "Files", hint: "File and document search" },
  { value: "map", label: "Map", hint: "Map and location results" },
  { value: "music", label: "Music", hint: "Music engines" },
  { value: "social media", label: "Social", hint: "Social media engines" },
]

export function resolveSearchConfig(config: SearchApiConfig): SearchApiConfig {
  const providerConfigs: SearchProviderConfigs = config.providerConfigs ?? {
    ...(config.provider !== "none" && config.apiKey
      ? {
          [config.provider]: {
            apiKey: config.apiKey,
            serpApiEngine: config.serpApiEngine,
            searXngUrl: config.searXngUrl,
            searXngCategories: config.searXngCategories,
          },
        }
      : {}),
    ...(config.provider === "searxng" && config.searXngUrl
      ? {
          searxng: {
            searXngUrl: config.searXngUrl,
            searXngCategories: config.searXngCategories,
          },
        }
      : {}),
  }

  const activeProvider = config.provider as SearchProvider
  if (activeProvider === "none") {
    return {
      ...config,
      provider: "none",
      apiKey: "",
      serpApiEngine: config.serpApiEngine ?? providerConfigs.serpapi?.serpApiEngine ?? "google",
      searXngUrl: config.searXngUrl ?? providerConfigs.searxng?.searXngUrl ?? "",
      searXngCategories: config.searXngCategories ?? providerConfigs.searxng?.searXngCategories ?? ["general"],
      providerConfigs,
    }
  }

  const activeOverride = providerConfigs[activeProvider]
  return {
    ...config,
    provider: activeProvider,
    // 百智只认自己卡片里填的 Key，不继承顶层 apiKey（可能是别的服务的凭据）。
    apiKey: activeProvider === "baizhi"
      ? activeOverride?.apiKey ?? ""
      : activeOverride?.apiKey ?? config.apiKey ?? "",
    serpApiEngine: activeOverride?.serpApiEngine ?? config.serpApiEngine ?? "google",
    searXngUrl: activeOverride?.searXngUrl ?? config.searXngUrl ?? "",
    searXngCategories: activeOverride?.searXngCategories ?? config.searXngCategories ?? ["general"],
    providerConfigs,
  }
}

const API_KEY_PROVIDERS = new Set<SearchProvider>([
  "bocha",
  "qiniu",
  "metaso",
  "tavily",
  "serpapi",
  "gemini",
  "baizhi",
])

export function providerRequiresApiKey(provider: SearchProvider): boolean {
  return API_KEY_PROVIDERS.has(provider)
}

/** 内置插件「网页搜索」被关闭时，降级结果里带的统一文案（界面 / 提示词共用一份）。 */
export const WEB_SEARCH_DISABLED_MESSAGE = "网页搜索已在「插件」中关闭，本次未联网搜索"

/**
 * 内置插件「网页搜索」当前是否开启。
 *
 * 直接读 `builtin-state` 的同步快照，**不经过 React**：这里的调用方是普通函数
 * （角色光环生成、写作实体搜索、深度研究……），拿不到 hook 上下文。
 * 存储不可用（老环境 / 测试环境没有 localStorage）时按默认值「开启」处理，
 * 与插件页显示的状态保持一致。
 */
export function isWebSearchEnabled(): boolean {
  return isBuiltinPluginEnabled("web-search")
}

/**
 * 插件关闭时的降级结果：**结构合法的空结果**，绝不抛异常。
 *
 * 为什么不抛：这个函数的上游（`character-aura.ts`、`writing-entity-web-search.ts`、
 * `web-research.ts`）都是"搜索只是锦上添花"的路径，有几处没有为"搜索不可用"写
 * try/catch —— 抛出去会让角色生成 / 写作补搜整条链路直接失败，用户看到的会是
 * "生成失败"，而不是"搜索被关掉了"。关掉搜索是用户的正常操作，不该是错误。
 */
function disabledOutcome(): WebSearchOutcome {
  return {
    results: [],
    disabled: true,
    message: WEB_SEARCH_DISABLED_MESSAGE,
  }
}

export async function webSearch(
  query: string,
  config: SearchApiConfig,
  maxResults: number = 10,
): Promise<WebSearchResult[]> {
  // 闸门在 `webSearchDetailed` 里统一收口：关闭时它的 results 为空数组，
  // 这里自然得到 `[]`，不会再往下走到 provider 解析与网络请求。
  return (await webSearchDetailed(query, config, maxResults)).results
}

export async function webSearchDetailed(
  query: string,
  config: SearchApiConfig,
  maxResults: number = 10,
): Promise<WebSearchOutcome> {
  /*
   * 全局闸门：内置插件「网页搜索」被关闭时，这里直接短路。
   *
   * 为什么放在最底层而不是逐个调用点：联网搜索有 6+ 个调用方（角色光环、
   * 写作实体搜索、深度研究、三个 provider 实现、AI 工具）。逐个加检查必然遗漏，
   * 而漏掉的那一处会在用户"关掉了网页搜索"之后继续悄悄联网 —— 这是隐私/资费问题。
   * 在唯一的底层收口，才能保证"关掉就是真的不再联网"。
   *
   * 位置也要最靠前：连 `resolveSearchConfig` 和 provider 的 Key 校验都不做，
   * 关闭时任何分支（包括那个会 throw 的"未配置 Key"）都不可能被走到。
   */
  if (!isWebSearchEnabled()) return disabledOutcome()

  const resolved = resolveSearchConfig(config)
  if (resolved.provider === "gemini") {
    if (!resolved.apiKey?.trim()) {
      throw new Error("未配置 Gemini API Key，请在「设置 → 网页搜索 → Gemini」中填写。")
    }
    const override = resolved.providerConfigs?.gemini
    const outcome = await geminiSearchDetailed(query, {
      apiKey: resolved.apiKey,
      model: override?.geminiModel,
      baseUrl: override?.geminiBaseUrl,
      maxResults,
    })
    return {
      results: outcome.results,
      queries: outcome.queries,
      summary: outcome.summary,
      searchSuggestionsHtml: outcome.searchSuggestionsHtml,
    }
  }
  if (resolved.provider === "antigravity") {
    // 反重力 CLI：不需要 Key，用本机 agy 登录态；只给搜索词 + 摘要（来源只存不显示）。
    const outcome = await antigravitySearchDetailed(query, {
      model: resolved.providerConfigs?.antigravity?.antigravityModel,
      timeoutSecs: resolved.providerConfigs?.antigravity?.antigravityTimeoutSecs,
      maxResults,
    })
    return { results: outcome.results, queries: outcome.queries, summary: outcome.summary }
  }
  return { results: await providerSearch(query, config, maxResults) }
}

async function providerSearch(
  query: string,
  config: SearchApiConfig,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const resolved = resolveSearchConfig(config)
  if (resolved.provider === "none") {
    throw new Error("Web search not configured. Select a search provider in Settings → 网页搜索.")
  }
  if (providerRequiresApiKey(resolved.provider) && !resolved.apiKey?.trim()) {
    throw new Error("Web search not configured. Add an API key in Settings → 网页搜索.")
  }
  if (resolved.provider === "searxng" && !resolved.searXngUrl?.trim()) {
    throw new Error("Web search not configured. Add a SearXNG instance URL in Settings → 网页搜索.")
  }

  switch (resolved.provider) {
    case "bocha":
      return bochaSearch(query, resolved.apiKey, maxResults)
    case "qiniu":
      return qiniuSearch(query, resolved.apiKey, maxResults)
    case "metaso":
      return metasoSearch(query, resolved.apiKey, maxResults)
    case "tavily":
      return tavilySearch(query, resolved.apiKey, maxResults)
    case "baizhi":
      return baizhiSearch(query, resolved.apiKey, maxResults)
    case "serpapi":
      return serpApiSearch(query, resolved.apiKey, maxResults, resolved.serpApiEngine ?? "google")
    case "antigravity":
      return (await antigravitySearchDetailed(query, {
        model: resolved.providerConfigs?.antigravity?.antigravityModel,
        timeoutSecs: resolved.providerConfigs?.antigravity?.antigravityTimeoutSecs,
        maxResults,
      })).results
    case "searxng":
      return searXngSearch(query, resolved.searXngUrl ?? "", maxResults, resolved.searXngCategories ?? ["general"])
    default:
      throw new Error(`Unknown search provider: ${resolved.provider}`)
  }
}

function searXngSearchUrl(instanceUrl: string): URL {
  const trimmed = instanceUrl.trim()
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const url = new URL(withProtocol)
  const path = url.pathname.replace(/\/+$/, "")
  url.pathname = path.endsWith("/search") || path === "/search"
    ? path
    : `${path}/search`
  url.search = ""
  url.hash = ""
  return url
}

async function searXngSearch(
  query: string,
  instanceUrl: string,
  maxResults: number,
  categories: SearXngCategory[],
): Promise<WebSearchResult[]> {
  let endpoint: URL
  try {
    endpoint = searXngSearchUrl(instanceUrl)
  } catch {
    throw new Error("Invalid SearXNG instance URL. Use a valid http(s) URL, for example https://search.example.com.")
  }

  endpoint.searchParams.set("q", query)
  endpoint.searchParams.set("format", "json")
  endpoint.searchParams.set("categories", (categories.length > 0 ? categories : ["general"]).join(","))

  const httpFetch = await getHttpFetch()
  let response: Response
  try {
    response = await httpFetch(endpoint.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    })
  } catch (err) {
    if (isFetchNetworkError(err)) {
      throw new Error(
        "Network error reaching the SearXNG instance. Check the instance URL and whether JSON search is enabled.",
      )
    }
    throw err
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`SearXNG search failed (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  return normalizeSearXngResults(data, maxResults)
}

function normalizeSearXngResults(data: { results?: unknown[] }, maxResults: number): WebSearchResult[] {
  return (data.results ?? [])
    .slice(0, maxResults)
    .map((item) => normalizeSearXngResult(item))
    .filter((item) => item.url.length > 0)
}

function normalizeSearXngResult(item: unknown): WebSearchResult {
  const r = item as {
    title?: string
    url?: string
    content?: string
    engine?: string
    category?: string
  }
  const url = r.url ?? ""
  return {
    title: r.title ?? "Untitled",
    url,
    snippet: r.content ?? "",
    source: hostnameFromUrl(url) || r.engine || r.category || "",
  }
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "")
  } catch {
    return ""
  }
}

export function normalizeBochaResults(data: {
  code?: number | string
  msg?: string | null
  message?: string
  data?: { webPages?: { value?: unknown[] } }
  webPages?: { value?: unknown[] }
}, maxResults: number): WebSearchResult[] {
  // Bocha wraps Bing-style payload as `{ code, data: { webPages } }`.
  // Also accept a bare `{ webPages }` body for tests / older docs.
  if (data.code != null && Number(data.code) !== 200) {
    throw new Error(data.msg?.trim() || data.message?.trim() || `Bocha search failed (code ${data.code})`)
  }
  const pages = data.data?.webPages?.value ?? data.webPages?.value ?? []
  return pages
    .slice(0, maxResults)
    .map((item) => {
      const r = item as {
        name?: string
        title?: string
        url?: string
        snippet?: string
        summary?: string
        siteName?: string
      }
      const url = r.url ?? ""
      return {
        title: r.name ?? r.title ?? "Untitled",
        url,
        // Docs: snippet = short hit; summary = longer page summary (when summary:true).
        snippet: r.summary ?? r.snippet ?? "",
        source: r.siteName || hostnameFromUrl(url),
      }
    })
    .filter((item) => item.url.length > 0)
}

export function normalizeQiniuResults(data: {
  success?: boolean
  message?: string
  data?: { results?: unknown[] }
}, maxResults: number): WebSearchResult[] {
  if (data.success !== true) {
    throw new Error(data.message?.trim() || "Qiniu web search failed")
  }
  return (data.data?.results ?? [])
    .slice(0, maxResults)
    .map((item) => {
      const r = item as {
        title?: string
        url?: string
        content?: string
        source?: string
      }
      const url = r.url ?? ""
      return {
        title: r.title ?? "Untitled",
        url,
        snippet: r.content ?? "",
        source: r.source || hostnameFromUrl(url),
      }
    })
    .filter((item) => item.url.length > 0)
}

export function normalizeMetasoResults(data: {
  webpages?: unknown[]
}, maxResults: number): WebSearchResult[] {
  return (data.webpages ?? [])
    .slice(0, maxResults)
    .map((item) => {
      const r = item as {
        title?: string
        link?: string
        url?: string
        snippet?: string
        summary?: string
      }
      const url = r.link ?? r.url ?? ""
      return {
        title: r.title ?? "Untitled",
        url,
        snippet: r.snippet ?? r.summary ?? "",
        source: hostnameFromUrl(url),
      }
    })
    .filter((item) => item.url.length > 0)
}

async function bochaSearch(
  query: string,
  apiKey: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const httpFetch = await getHttpFetch()
  let response: Response
  try {
    response = await httpFetch("https://api.bochaai.com/v1/web-search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        count: maxResults,
        summary: true,
        // Official default / skill guidance: let the API rewrite time range from the query.
        freshness: "noLimit",
      }),
    })
  } catch (err) {
    if (isFetchNetworkError(err)) {
      throw new Error(
        "Network error reaching api.bochaai.com. Check connectivity and whether the Bocha API key is still valid.",
      )
    }
    throw err
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`Bocha search failed (${response.status}): ${errorText}`)
  }

  return normalizeBochaResults(await response.json(), maxResults)
}

async function qiniuSearch(
  query: string,
  apiKey: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const httpFetch = await getHttpFetch()
  let response: Response
  try {
    response = await httpFetch("https://api.qnaigc.com/v1/search/web", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        search_type: "web",
      }),
    })
  } catch (err) {
    if (isFetchNetworkError(err)) {
      throw new Error(
        "Network error reaching api.qnaigc.com. Check connectivity and whether the Qiniu AI API key is still valid.",
      )
    }
    throw err
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`Qiniu search failed (${response.status}): ${errorText}`)
  }

  return normalizeQiniuResults(await response.json(), maxResults)
}

async function metasoSearch(
  query: string,
  apiKey: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const httpFetch = await getHttpFetch()
  let response: Response
  try {
    response = await httpFetch("https://metaso.cn/api/v1/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        q: query,
        scope: "webpage",
        size: maxResults,
        includeSummary: false,
        includeRawContent: false,
        conciseSnippet: false,
      }),
    })
  } catch (err) {
    if (isFetchNetworkError(err)) {
      throw new Error(
        "Network error reaching metaso.cn. Check connectivity and whether the Metaso API key is still valid.",
      )
    }
    throw err
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`Metaso search failed (${response.status}): ${errorText}`)
  }

  return normalizeMetasoResults(await response.json(), maxResults)
}

async function tavilySearch(
  query: string,
  apiKey: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  // Route through the Tauri HTTP plugin so future non-Tavily search
  // providers (Serper, Exa, Brave, Google CSE, ...) with less friendly
  // CORS don't each need their own workaround. See tauri-fetch.ts.
  const httpFetch = await getHttpFetch()
  let response: Response
  try {
    response = await httpFetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: "advanced",
        include_answer: false,
      }),
    })
  } catch (err) {
    if (isFetchNetworkError(err)) {
      throw new Error(
        "Network error reaching api.tavily.com. Check your connectivity and whether the Tavily API key is still valid.",
      )
    }
    throw err
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`Tavily search failed (${response.status}): ${errorText}`)
  }

  const data = await response.json()

  return (data.results ?? []).map((r: { title: string; url: string; content: string }) => ({
    title: r.title ?? "Untitled",
    url: r.url ?? "",
    snippet: r.content ?? "",
    source: hostnameFromUrl(r.url ?? ""),
  }))
}

async function serpApiSearch(
  query: string,
  apiKey: string,
  maxResults: number,
  engine: SerpApiEngine,
): Promise<WebSearchResult[]> {
  const params = new URLSearchParams({
    engine,
    q: query,
    api_key: apiKey,
    num: String(maxResults),
  })

  const httpFetch = await getHttpFetch()
  let response: Response
  try {
    response = await httpFetch(`https://serpapi.com/search?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    })
  } catch (err) {
    if (isFetchNetworkError(err)) {
      throw new Error(
        "Network error reaching serpapi.com. Check your connectivity and whether the SerpApi API key is still valid.",
      )
    }
    throw err
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`SerpApi search failed (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  if (typeof data.error === "string" && data.error.trim()) {
    throw new Error(`SerpApi search failed: ${data.error}`)
  }

  return normalizeSerpApiResults(data, maxResults)
}

function normalizeSerpApiResults(data: {
  organic_results?: unknown[]
  news_results?: unknown[]
  images_results?: unknown[]
  video_results?: unknown[]
  videos_results?: unknown[]
  shopping_results?: unknown[]
}, maxResults: number): WebSearchResult[] {
  const rawResults =
    data.organic_results ??
    data.news_results ??
    data.images_results ??
    data.video_results ??
    data.videos_results ??
    data.shopping_results ??
    []

  return rawResults
    .slice(0, maxResults)
    .map((item) => normalizeSerpApiResult(item))
}

function normalizeSerpApiResult(item: unknown): WebSearchResult {
  const r = item as {
    title?: string
    link?: string
    url?: string
    source?: string
    snippet?: string
    summary?: string
    description?: string
    thumbnail?: string
    original?: string
    displayed_link?: string
  }
  const url = r.link ?? r.url ?? r.original ?? r.thumbnail ?? ""
  return {
    title: r.title ?? "Untitled",
    url,
    snippet: r.snippet ?? r.summary ?? r.description ?? "",
    source: hostnameFromUrl(url) || r.source || r.displayed_link || "",
  }
}
