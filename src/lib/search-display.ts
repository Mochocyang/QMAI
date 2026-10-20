/**
 * 联网搜索的「附加信息」（目前只有 Gemini 后端提供）：实际执行的搜索词、
 * 综合摘要、Google 要求展示的搜索建议 HTML。
 *
 * 兼容约定：
 *  - 其它搜索后端没有这些字段，所有函数在缺字段时返回 null / 原样，
 *    上下文文本、工具结果、时间线显示与改动前逐字节一致；
 *  - 旧的持久化工作流记录没有这些字段，读取时同样返回 null，时间线按原样显示。
 */

export interface SearchDisplaySource {
  id: string
  title: string
  url: string
  source: string
}

export interface SearchDisplayDetail {
  queries: string[]
  summary: string
  sources: SearchDisplaySource[]
  suggestionsHtml: string
}

/** 工具结果 JSON 里只给界面用、不发给模型的字段。 */
export const TOOL_UI_DISPLAY_KEY = "uiDisplay"

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : []
const str = (value: unknown): string => (typeof value === "string" ? value : "")

function toSources(value: unknown): SearchDisplaySource[] {
  if (!Array.isArray(value)) return []
  const out: SearchDisplaySource[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    const url = str(r.url)
    if (!url) continue
    out.push({ id: `S${out.length + 1}`, title: str(r.title), url, source: str(r.source) })
  }
  return out
}

function parseObject(text: string | undefined): Record<string, unknown> | null {
  if (!text?.trim().startsWith("{")) return null
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function build(queries: string[], summary: string, sources: SearchDisplaySource[], suggestionsHtml: string): SearchDisplayDetail | null {
  if (queries.length === 0 && !summary.trim()) return null
  return { queries, summary, sources, suggestionsHtml }
}

/**
 * 从工作流里一条工具调用的原始结果中取出搜索附加信息。
 * 支持 web_search 工具结果与写作流程「联网搜索」步骤的持久化记录；
 * 没有附加信息（其它后端 / 旧记录）时返回 null。
 */
export function extractSearchDisplayDetail(result: string | undefined): SearchDisplayDetail | null {
  const parsed = parseObject(result)
  if (!parsed) return null

  // web_search 工具结果：{ status, query, results, queries?, summary?, uiDisplay? }
  if (Array.isArray(parsed.results) && typeof parsed.status === "string") {
    const ui = (parsed[TOOL_UI_DISPLAY_KEY] ?? {}) as Record<string, unknown>
    return build(strings(parsed.queries), str(parsed.summary), toSources(parsed.results), str(ui.searchSuggestionsHtml))
  }

  // 写作流程联网补搜：{ content, searchedNames, notes, items: [{ name, results, searchQueries?, summary?, searchSuggestionsHtml? }] }
  if (Array.isArray(parsed.items)) {
    const queries: string[] = []
    const summaries: string[] = []
    const suggestions: string[] = []
    const rawSources: unknown[] = []
    for (const item of parsed.items) {
      if (!item || typeof item !== "object") continue
      const r = item as Record<string, unknown>
      queries.push(...strings(r.searchQueries))
      if (str(r.summary).trim()) summaries.push(str(r.summary).trim())
      if (str(r.searchSuggestionsHtml).trim()) suggestions.push(str(r.searchSuggestionsHtml))
      if (Array.isArray(r.results)) rawSources.push(...r.results)
    }
    return build([...new Set(queries)], summaries.join("\n\n"), toSources(rawSources), suggestions.join("\n"))
  }
  return null
}

/**
 * 把工具结果拆成「发给模型的文本」与「存进记录、给界面用的完整结果」。
 * 只有带 `uiDisplay` 字段的 JSON 才会被改写；其它结果原样返回（逐字节一致）。
 */
export function splitToolResultForModel(result: string): string {
  if (!result.includes(`"${TOOL_UI_DISPLAY_KEY}"`)) return result
  const parsed = parseObject(result)
  if (!parsed || !(TOOL_UI_DISPLAY_KEY in parsed)) return result
  const { [TOOL_UI_DISPLAY_KEY]: _omit, ...rest } = parsed
  return JSON.stringify(rest)
}

/* ---------- 写给模型的上下文（仅 Gemini 使用） ---------- */

/**
 * 摘要只在**单独就超过预算**时才截断，并且截在段落边界（空行），
 * 找不到合适的段落边界时退到行边界。
 */
export function truncateSummaryAtParagraph(summary: string, budget: number): string {
  const text = summary.trim()
  if (text.length <= budget) return text
  const marker = "\n...[摘要超出预算，以下省略]"
  const limit = Math.max(0, budget - marker.length)
  const head = text.slice(0, limit)
  const paragraph = head.lastIndexOf("\n\n")
  const cut = paragraph > limit * 0.5 ? paragraph : head.lastIndexOf("\n")
  return `${(cut > 0 ? head.slice(0, cut) : head).trimEnd()}${marker}`
}

export interface GeminiContextBlockInput {
  queries?: string[]
  summary: string
  /** 本块可用的字符预算；不传则不限（摘要永远完整）。 */
  budget?: number
  labels?: { queries: string; summary: string }
}

const DEFAULT_LABELS = {
  queries: "实际搜索词：",
  summary: "### 搜索摘要（Gemini 基于 Google 搜索综合）",
}

/**
 * Gemini 搜索结果写给模型的文本**只有两部分**：实际搜索词 + 完整摘要。
 * 摘要只有单独超过整个预算时才截断（截在段落边界）。
 * 来源、编号、引用片段、链接一律不进上下文——它们只在时间线里展示。
 */
export function formatGeminiContextBlock(input: GeminiContextBlockInput): string[] {
  const labels = input.labels ?? DEFAULT_LABELS
  const budget = input.budget ?? Number.POSITIVE_INFINITY
  const lines: string[] = []
  if (input.queries?.length) lines.push(`${labels.queries}${input.queries.join("；")}`)
  const used = lines.reduce((sum, line) => sum + line.length + 1, 0)
  lines.push(labels.summary, truncateSummaryAtParagraph(input.summary, budget - used - labels.summary.length - 2))
  return lines
}
