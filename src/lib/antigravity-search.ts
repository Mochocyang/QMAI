import type { WebSearchResult } from "@/lib/web-search"

/**
 * 「反重力 CLI」（Google Antigravity CLI，`agy`）搜索后端。
 *
 * Rust 端 `antigravity_cli_search`（src-tauri/src/commands/antigravity_search.rs）单独起一个
 * `agy -p <提示词> --output-format stream-json --json-schema {queries, summary}` 进程，
 * 用本机 agy 的登录态，借 agy 内置的 search_web（Google 搜索）工具查询，返回原始 NDJSON。
 * 这里负责解析：
 *  - 实际搜索词：优先取 `step_update.tool_info` 里 search_web 调用的参数，取不到再用最终 JSON 的 queries；
 *  - 摘要：最终 `result` 事件里按 --json-schema 输出的 summary（由模型基于搜索结果生成，不是谷歌官方摘要）；
 *  - 来源链接：能从 search_web 的输出里认出 URL 就存进结果（时间线不显示，也不进写作上下文）。
 *
 * agy 1.4.3 实测：search_web 的 tool_info 只有 `{ name, parameters: { query } }`，同一次调用会出现
 * ACTIVE / DONE 两条（需去重），没有 output，所以拿不到来源链接；--json-schema 的结构化结果在
 * `result.structured_output`（`result.response` 里是同样内容的 JSON 字符串）。默认 request-review
 * 权限模式下 search_web 不需要审核，可以直接执行。来源解析仍保留，以兼容以后带 output 的版本。
 */

export const ANTIGRAVITY_SEARCH_TIMEOUT_SECS = 180

/** 搜索模型留空时使用的默认模型：最低档 Flash，避免 agy 默认的 Gemini 4 Argon 额度消耗过高。 */
export const DEFAULT_ANTIGRAVITY_SEARCH_MODEL = "gemini-3.8-flash-low"
/** 设置里显式选择「agy 默认模型」时保存的值：调用时不传 --model。 */
export const ANTIGRAVITY_AGY_DEFAULT_MODEL = "__agy_default__"

/** 把设置里保存的搜索模型换成实际传给 agy 的 --model；null 表示不传。 */
export function resolveAntigravitySearchModel(model?: string | null): string | null {
  const trimmed = model?.trim() ?? ""
  if (!trimmed) return DEFAULT_ANTIGRAVITY_SEARCH_MODEL
  if (trimmed === ANTIGRAVITY_AGY_DEFAULT_MODEL) return null
  return trimmed
}

/** 由 agy 模型 slug 生成展示名，如 gemini-3.8-flash-low → Gemini 3.8 Flash (Low)。 */
export function antigravityModelLabel(slug: string): string {
  const parts = slug.trim().split("-").filter(Boolean)
  if (parts.length === 0) return slug
  const tiers = ["low", "medium", "high"]
  const last = parts[parts.length - 1].toLowerCase()
  const tier = tiers.includes(last) ? parts.pop()! : ""
  const cap = (w: string) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)
  const name = parts.map((w) => (w.toLowerCase() === "gpt" || w.toLowerCase() === "oss" ? w.toUpperCase() : cap(w))).join(" ")
  return tier ? `${name} (${cap(tier)})` : name
}

export interface AntigravitySearchRaw {
  notInstalled: boolean
  timedOut: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  error: string | null
}

export interface AntigravitySearchOutcome {
  results: WebSearchResult[]
  queries: string[]
  summary: string
}

export interface AntigravitySearchOptions {
  model?: string
  maxResults?: number
  timeoutSecs?: number
  /** 测试注入；默认用 Tauri invoke。 */
  invoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>
}

const INSTALL_HINT = "请先在本机安装 Antigravity CLI（curl -fsSL https://antigravity.google/cli/install.sh | bash）"
const LOGIN_HINT = "请先在终端运行一次 agy，用 Google 账号登录后再试"

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === "string" ? v : "")

function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const body = fenced ? fenced[1] : trimmed
  try {
    return JSON.parse(body)
  } catch {
    const start = body.indexOf("{")
    const end = body.lastIndexOf("}")
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1))
      } catch {
        return undefined
      }
    }
    return undefined
  }
}

function toolName(info: Obj, update: Obj): string {
  return (str(info.name) || str(info.tool_name) || str(info.canonical_name) || str(update.tool_name)).toLowerCase()
}

function isSearchTool(name: string): boolean {
  return name === "search_web" || name.endsWith("search_web") || name === "google_search" || name === "web_search"
}

function queriesFromParams(params: unknown): string[] {
  const p = isObj(params) ? params : isObj(parseJsonLoose(str(params))) ? (parseJsonLoose(str(params)) as Obj) : null
  if (!p) return []
  const out: string[] = []
  for (const key of ["query", "q", "search_query", "searchQuery"]) {
    if (str(p[key]).trim()) out.push(str(p[key]).trim())
  }
  for (const key of ["queries", "search_queries"]) {
    const list = p[key]
    if (Array.isArray(list)) out.push(...list.map(str).map((s) => s.trim()).filter(Boolean))
  }
  return out
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

/** 从 search_web 的输出里尽量认出来源链接（结构化数组或纯文本里的 URL）。 */
function sourcesFromOutput(output: unknown): WebSearchResult[] {
  const out: WebSearchResult[] = []
  const push = (url: string, title = "", snippet = "") => {
    if (!/^https?:\/\//i.test(url)) return
    out.push({ title: title || hostname(url) || url, url, snippet, source: hostname(url) })
  }
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || value == null) return
    if (typeof value === "string") {
      const parsed = value.trim().startsWith("{") || value.trim().startsWith("[") ? parseJsonLoose(value) : undefined
      if (parsed !== undefined) return visit(parsed, depth + 1)
      for (const match of value.matchAll(/https?:\/\/[^\s)\]"'<>]+/g)) push(match[0].replace(/[.,;，。]+$/, ""))
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1))
      return
    }
    if (isObj(value)) {
      const url = str(value.url) || str(value.link) || str(value.uri)
      if (url) {
        push(url, str(value.title), str(value.snippet) || str(value.content) || str(value.description))
        return
      }
      Object.values(value).forEach((item) => visit(item, depth + 1))
    }
  }
  visit(output, 0)
  return out
}

export class AntigravitySearchError extends Error {}

/** 解析 agy stream-json 输出。失败时抛出带中文说明的 AntigravitySearchError。 */
export function parseAntigravitySearchOutput(stdout: string, maxResults = 10): AntigravitySearchOutcome {
  const toolQueries: string[] = []
  const sources: WebSearchResult[] = []
  let result: Obj | null = null
  let sawEvent = false

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith("{")) continue
    let evt: unknown
    try {
      evt = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObj(evt)) continue
    sawEvent = true
    if (evt.event === "step_update" && isObj(evt.step_update)) {
      const update = evt.step_update
      const info = isObj(update.tool_info) ? update.tool_info : null
      if (!info) continue
      if (!isSearchTool(toolName(info, update))) continue
      toolQueries.push(...queriesFromParams(info.parameters ?? info.params ?? info.arguments ?? info.args ?? info.input))
      sources.push(...sourcesFromOutput(info.output ?? info.result))
    } else if (evt.event === "result" && isObj(evt.result)) {
      result = evt.result
    }
  }

  if (!result) {
    throw new AntigravitySearchError(
      sawEvent ? "反重力 CLI 没有返回最终结果，可能被中断。" : "无法解析反重力 CLI 的输出（不是 stream-json）。可能 agy 版本过旧（需要 1.1.8 及以上）。",
    )
  }
  const status = str(result.status)
  if (status && status !== "SUCCESS") {
    const detail = str(result.error) || str(result.message) || status
    throw new AntigravitySearchError(`反重力 CLI 搜索失败：${detail}`)
  }

  let structured: unknown = result.structured_output ?? result.structuredOutput ?? result.output
  if (!isObj(structured)) structured = parseJsonLoose(str(result.response))
  if (!isObj(structured) && isObj(result.response)) structured = result.response
  const summary = isObj(structured) ? str(structured.summary).trim() : str(result.response).trim()
  const schemaQueries = isObj(structured) && Array.isArray(structured.queries)
    ? structured.queries.map(str).map((s) => s.trim()).filter(Boolean)
    : []
  if (!summary) {
    throw new AntigravitySearchError("反重力 CLI 返回了结果，但没有摘要内容，无法解析。")
  }

  const seen = new Set<string>()
  const results = sources.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true))).slice(0, maxResults)
  const queries = [...new Set(toolQueries.length ? toolQueries : schemaQueries)]
  return { results, queries, summary }
}

/** 把 Rust 端的原始结果变成结果或中文错误。 */
export function interpretAntigravitySearchRaw(raw: AntigravitySearchRaw, maxResults = 10): AntigravitySearchOutcome {
  if (raw.notInstalled) throw new AntigravitySearchError(`未检测到 Antigravity CLI（agy）。${INSTALL_HINT}。`)
  const combined = `${raw.stderr}\n${raw.stdout}`
  if (/authentication required|authentication failed|authentication interrupted|not authenticated|please (log ?in|sign ?in)|unauthenticated/i.test(combined)) {
    throw new AntigravitySearchError(`Antigravity CLI 未登录。${LOGIN_HINT}。`)
  }
  if (raw.timedOut) throw new AntigravitySearchError("反重力 CLI 搜索超时，已结束 agy 进程。请稍后重试。")
  if (raw.error) throw new AntigravitySearchError(`反重力 CLI 搜索失败：${raw.error}`)
  if (!raw.stdout.trim()) {
    const tail = raw.stderr.trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 300)
    throw new AntigravitySearchError(
      `反重力 CLI 没有输出${raw.exitCode != null ? `（退出码 ${raw.exitCode}）` : ""}${tail ? `：${tail}` : "。"}`,
    )
  }
  return parseAntigravitySearchOutput(raw.stdout, maxResults)
}

async function defaultInvoke(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke(cmd, args)
}

export async function antigravitySearchDetailed(
  query: string,
  options: AntigravitySearchOptions = {},
): Promise<AntigravitySearchOutcome> {
  const maxResults = options.maxResults ?? 10
  let raw: AntigravitySearchRaw
  try {
    raw = (await (options.invoke ?? defaultInvoke)("antigravity_cli_search", {
      query,
      model: resolveAntigravitySearchModel(options.model),
      maxResults,
      timeoutSecs: options.timeoutSecs ?? ANTIGRAVITY_SEARCH_TIMEOUT_SECS,
    })) as AntigravitySearchRaw
  } catch (error) {
    throw new AntigravitySearchError(
      `无法调用反重力 CLI 搜索：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!raw || typeof raw !== "object") throw new AntigravitySearchError("反重力 CLI 搜索返回了无效数据。")
  return interpretAntigravitySearchRaw(raw, maxResults)
}
