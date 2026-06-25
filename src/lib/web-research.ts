import type { SearchApiConfig } from "@/stores/wiki-store"
import { getHttpFetch } from "@/lib/tauri-fetch"
import { webSearch, type WebSearchResult } from "@/lib/web-search"

export interface WebResearchDocument {
  title: string
  url: string
  source: string
  content: string
}

export interface WebResearchInput {
  text: string
  searchApiConfig: SearchApiConfig
  maxSearchResults?: number
  maxImportedDocuments?: number
  allowSearch?: boolean
  allowReadUrls?: boolean
}

export interface WebResearchResult {
  query: string
  urls: string[]
  searchResults: WebSearchResult[]
  importedDocuments: WebResearchDocument[]
  failedUrls: string[]
  notes: string[]
}

export interface WebResearchContextInput {
  query: string
  searchResults: WebSearchResult[]
  importedDocuments: WebResearchDocument[]
  failedUrls: string[]
}

export function extractWebUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"'，。！？；、]+/gi) ?? []
  const seen = new Set<string>()
  const urls: string[] = []
  for (const raw of matches) {
    const cleaned = raw.replace(/[，。！？；、,.!?;:)\]}）】》]+$/g, "")
    if (!cleaned || seen.has(cleaned)) continue
    seen.add(cleaned)
    urls.push(cleaned)
  }
  return urls
}

export function shouldUseWebResearch(text: string): boolean {
  if (extractWebUrls(text).length > 0) return true
  return /联网|网页|网址|打开|搜索|搜一下|查一下|查找|最新|热门|榜单|趋势|爆款|平台|外部资料|网络资料|资料来源/i.test(text)
}

export function deriveWebResearchQuery(text: string): string {
  const withoutUrls = text.replace(/https?:\/\/[^\s<>"']+/gi, " ")
  const cleaned = withoutUrls
    .replace(/请|帮我|给我|一下|联网|网页|网址|打开|搜索|搜一下|查一下|查找|相关内容|相关资料/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return (cleaned || text.trim()).slice(0, 120)
}

export async function collectWebResearch(input: WebResearchInput): Promise<WebResearchResult> {
  const maxSearchResults = clampInt(input.maxSearchResults ?? 5, 1, 10)
  const maxImportedDocuments = clampInt(input.maxImportedDocuments ?? 4, 1, 8)
  const allowSearch = input.allowSearch ?? true
  const allowReadUrls = input.allowReadUrls ?? true
  const urls = extractWebUrls(input.text)
  const query = deriveWebResearchQuery(input.text)
  const notes: string[] = []
  const failedUrls: string[] = []
  let searchResults: WebSearchResult[] = []

  if (allowSearch && query) {
    try {
      searchResults = await webSearch(query, input.searchApiConfig, maxSearchResults)
    } catch (error) {
      notes.push(`网页搜索失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const urlsToRead = [
    ...urls,
    ...searchResults.map((result) => result.url),
  ].filter(Boolean)
  const dedupedUrls = [...new Set(urlsToRead)].slice(0, maxImportedDocuments)
  const importedDocuments = allowReadUrls
    ? await readWebResearchDocuments(dedupedUrls, searchResults, failedUrls)
    : []

  return {
    query,
    urls,
    searchResults,
    importedDocuments,
    failedUrls,
    notes,
  }
}

export function buildWebResearchContext(input: WebResearchContextInput): { markdown: string; sources: string[] } {
  const sources = dedupeSources([
    ...input.searchResults.map((result) => `${result.title} - ${result.url}`),
    ...input.importedDocuments.map((document) => `${document.title} - ${document.url}`),
  ])
  const lines: string[] = [
    "## 联网研究资料",
    "",
    `搜索问题：${input.query || "用户指定网页资料"}`,
    "",
    "使用规则：",
    "- 这些资料只作为外部参考，不要把网页内容当成当前小说已经发生的事实。",
    "- 写大纲或拆文分析时可以提炼趋势、结构、卖点、套路和读者期待。",
    "- 不要大段复述网页原文；如果资料不足，请明确说明资料不足。",
  ]

  if (input.searchResults.length > 0) {
    lines.push("", "### 搜索结果")
    input.searchResults.slice(0, 8).forEach((result, index) => {
      lines.push(
        `${index + 1}. ${result.title}`,
        `   来源：${result.source || hostnameFromUrl(result.url)}`,
        `   链接：${result.url}`,
        `   摘要：${clipText(result.snippet, 260)}`,
      )
    })
  }

  if (input.importedDocuments.length > 0) {
    lines.push("", "### 网页正文摘录")
    input.importedDocuments.slice(0, 5).forEach((document, index) => {
      lines.push(
        `#### ${index + 1}. ${document.title}`,
        `来源：${document.source || hostnameFromUrl(document.url)}`,
        `链接：${document.url}`,
        "",
        clipText(document.content, 1200),
      )
    })
  }

  if (input.failedUrls.length > 0) {
    lines.push("", "### 读取失败")
    input.failedUrls.forEach((url) => lines.push(`- ${url}`))
  }

  return {
    markdown: clipText(lines.join("\n"), 5000),
    sources,
  }
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

async function readWebResearchDocuments(
  urls: string[],
  searchResults: WebSearchResult[],
  failedUrls: string[],
): Promise<WebResearchDocument[]> {
  if (urls.length === 0) return []
  let httpFetch: typeof fetch
  try {
    httpFetch = await getHttpFetch()
  } catch {
    failedUrls.push(...urls)
    return []
  }

  const documents: WebResearchDocument[] = []
  for (const url of urls) {
    try {
      const response = await httpFetch(url, { method: "GET", headers: { Accept: "text/html, text/plain, */*" } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const raw = await response.text()
      const content = htmlToPlainText(raw)
      if (!content) throw new Error("empty content")
      const matchedResult = searchResults.find((result) => result.url === url)
      documents.push({
        title: matchedResult?.title || hostnameFromUrl(url) || url,
        url,
        source: matchedResult?.source || hostnameFromUrl(url),
        content,
      })
    } catch {
      failedUrls.push(url)
    }
  }
  return documents
}

function clipText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength).trim()}\n...[已截断]`
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

function dedupeSources(sources: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const source of sources) {
    const cleaned = source.trim()
    if (!cleaned || seen.has(cleaned)) continue
    seen.add(cleaned)
    output.push(cleaned)
  }
  return output
}
