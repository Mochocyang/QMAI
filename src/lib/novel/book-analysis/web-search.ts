/**
 * 拆书 6 维度分析 - web 搜索客户端
 *
 * 内部执行（前端 fetch），使用：
 *   1) DuckDuckGo Instant Answer API  (https://api.duckduckgo.com/?q=...&format=json)
 *   2) Wikipedia REST summary API   (https://zh.wikipedia.org/api/rest_v1/page/summary/...)
 *
 * 无需 API key，无需后端代理。CORS 已开放。
 *
 * 失败时返回 null，由调用方决定 LLM 兜底。
 *
 * 重试策略（feature/book-analysis-6d-skill）：
 *   - 5xx / 网络错误 / 超时 → 指数退避重试
 *   - 4xx（除 429）→ 不重试，返回 null
 *   - 最多 3 次（默认），退避 200ms → 400ms，加 ≤50ms 抖动
 *   - 收到 AbortSignal → 立即停止，不重试
 */

const DDG_ENDPOINT = "https://api.duckduckgo.com/"
const WIKIPEDIA_ENDPOINTS = [
  "https://zh.wikipedia.org/api/rest_v1/page/summary/",
  "https://en.wikipedia.org/api/rest_v1/page/summary/",
]

const DEFAULT_TIMEOUT_MS = 6000
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_BACKOFF_MS = 200
const DEFAULT_MAX_BACKOFF_MS = 2000
const DEFAULT_JITTER_MS = 50

/** 测试可注入：把 timeout 强制设成很小（或 0 让其不超时） */
const TEST_TIMEOUT_OVERRIDE: { ms: number | null } = { ms: null }
export function __setWebSearchTimeoutForTest(ms: number | null) {
  TEST_TIMEOUT_OVERRIDE.ms = ms
}

/** 测试可注入：替换 fetch 实现 */
const TEST_FETCH_OVERRIDE: {
  fn: ((input: any, init?: any) => Promise<Response>) | null
} = { fn: null }
export function __setWebSearchFetchForTest(
  fn: ((input: any, init?: any) => Promise<Response>) | null
) {
  TEST_FETCH_OVERRIDE.fn = fn
}

/** 测试可注入：替换退避 sleep（默认是真实 setTimeout） */
const TEST_SLEEP_OVERRIDE: {
  fn: ((ms: number) => Promise<void>) | null
} = { fn: null }
export function __setWebSearchSleepForTest(
  fn: ((ms: number) => Promise<void>) | null
) {
  TEST_SLEEP_OVERRIDE.fn = fn
}

export interface WebSearchResult {
  source: "duckduckgo" | "wikipedia-zh" | "wikipedia-en"
  title: string
  abstract: string
  url: string
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  const effectiveMs = TEST_TIMEOUT_OVERRIDE.ms ?? ms
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timeout ${effectiveMs}ms`)),
      effectiveMs
    )
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

async function sleep(ms: number): Promise<void> {
  if (TEST_SLEEP_OVERRIDE.fn) {
    return await TEST_SLEEP_OVERRIDE.fn(ms)
  }
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function doFetch(url: string, init?: RequestInit): Promise<Response> {
  if (TEST_FETCH_OVERRIDE.fn) {
    return await TEST_FETCH_OVERRIDE.fn(url, init)
  }
  return await fetch(url, init)
}

/**
 * 把一次"会失败的 fetch"包装成"指数退避重试"调用
 *
 * 行为：
 * - 默认最多 3 次
 * - 第 n 次重试前等待 baseMs * 2^(n-1)（封顶 maxMs）+ 0~jitterMs 抖动
 * - 收到 abort → 立即抛 AbortError，不再重试
 * - 5xx / 网络错误 / 超时 → 重试
 * - 4xx 由调用方处理（不会到这里）
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number
    baseMs?: number
    maxMs?: number
    jitterMs?: number
    signal?: AbortSignal
    onRetry?: (attempt: number, error: unknown, delayMs: number) => void
  } = {}
): Promise<T> {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseMs = DEFAULT_BASE_BACKOFF_MS,
    maxMs = DEFAULT_MAX_BACKOFF_MS,
    jitterMs = DEFAULT_JITTER_MS,
    signal,
    onRetry,
  } = options

  let attempt = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt++
    if (signal?.aborted) {
      throw new Error("aborted")
    }
    try {
      return await fn()
    } catch (err) {
      if (signal?.aborted) {
        throw err
      }
      if (attempt >= maxAttempts) {
        throw err
      }
      const exp = Math.min(baseMs * 2 ** (attempt - 1), maxMs)
      const jitter = Math.random() * jitterMs
      const delayMs = Math.floor(exp + jitter)
      onRetry?.(attempt, err, delayMs)
      await sleep(delayMs)
    }
  }
}

/**
 * 把一次 fetch 包成"5xx/网络/超时 → 重试，4xx → 直接抛"
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit | undefined,
  label: string,
  signal: AbortSignal | undefined
): Promise<Response> {
  return await withRetry(
    async () => {
      const resp = await withTimeout(doFetch(url, init), DEFAULT_TIMEOUT_MS, label)
      if (resp.status >= 500 || resp.status === 429) {
        // 触发外层重试
        throw new Error(`${label} HTTP ${resp.status}`)
      }
      return resp
    },
    { signal }
  )
}

/**
 * DuckDuckGo Instant Answer 抓取
 * 返回首个有内容的摘要，没有则返回 null
 */
export async function searchDuckDuckGo(
  characterName: string,
  bookTitle: string,
  signal?: AbortSignal
): Promise<WebSearchResult | null> {
  const query = `${characterName} ${bookTitle} 角色`
  const url = `${DDG_ENDPOINT}?q=${encodeURIComponent(query)}&format=json&no_redirects=1&t=character-aura`
  try {
    const resp = await fetchWithRetry(
      url,
      { method: "GET", signal },
      "duckduckgo",
      signal
    )
    if (!resp.ok) return null
    const data = (await resp.json()) as {
      Abstract?: string
      AbstractURL?: string
      Heading?: string
      AbstractSource?: string
    }
    if (data.Abstract && data.Abstract.length > 20) {
      return {
        source: "duckduckgo",
        title: data.Heading || characterName,
        abstract: data.Abstract,
        url: data.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Wikipedia summary 抓取（中英都试一次）
 */
export async function searchWikipedia(
  characterName: string,
  signal?: AbortSignal
): Promise<WebSearchResult | null> {
  for (const base of WIKIPEDIA_ENDPOINTS) {
    const url = `${base}${encodeURIComponent(characterName)}`
    try {
      const resp = await fetchWithRetry(
        url,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          signal,
        },
        "wikipedia",
        signal
      )
      if (resp.status === 404) continue
      if (!resp.ok) continue
      const data = (await resp.json()) as {
        title?: string
        extract?: string
        content_urls?: { desktop?: { page?: string } }
      }
      if (data.extract && data.extract.length > 30) {
        return {
          source: base.includes("/zh.") ? "wikipedia-zh" : "wikipedia-en",
          title: data.title || characterName,
          abstract: data.extract,
          url: data.content_urls?.desktop?.page || url,
        }
      }
    } catch {
      // 继续尝试下一个
    }
  }
  return null
}

/**
 * 一站式"获取角色外部资料"（DuckDuckGo → Wikipedia 失败兜底）
 * 全部失败时返回 null，调用方需要 LLM 兜底
 */
export async function fetchCharacterExternalMaterial(
  characterName: string,
  bookTitle: string,
  signal?: AbortSignal
): Promise<WebSearchResult | null> {
  const ddg = await searchDuckDuckGo(characterName, bookTitle, signal)
  if (ddg) return ddg
  return await searchWikipedia(characterName, signal)
}

/**
 * 内部使用：暴露 withRetry 供测试
 * @internal
 */
export const __internal = { withRetry }
