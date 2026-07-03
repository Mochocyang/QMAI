import type { Tool } from "../types"
import { getHttpFetch } from "@/lib/tauri-fetch"

interface FetchResponseLike {
  ok: boolean
  status: number
  headers?: {
    get(name: string): string | null
  }
  text(): Promise<string>
}

interface ReadWebPageDeps {
  fetchPage?: (url: string, init?: RequestInit) => Promise<FetchResponseLike>
}

export interface ReadWebPageToolResult {
  status: "ok" | "error"
  url: string
  title?: string
  content: string
  truncated: boolean
  message?: string
}

function toPositiveInteger(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(max, Math.floor(n))
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match ? decodeHtmlEntities(match[1].replace(/\s+/g, " ").trim()) : undefined
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
}

function parseHttpUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl)
    return url.protocol === "http:" || url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

export function createReadWebPageTool(deps: ReadWebPageDeps = {}): Tool {
  return {
    name: "read_web_page",
    description: "读取指定网页正文。仅支持 http/https 地址，用于在 web_search 返回结果后读取页面内容。",
    category: "read",
    parameters: {
      url: { type: "string", description: "要读取的网页 URL", required: true },
      maxChars: { type: "integer", description: "最多返回字符数，默认 6000，最大 20000" },
    },
    execute: async (params) => {
      const rawUrl = String(params.url ?? "").trim()
      const url = parseHttpUrl(rawUrl)
      const maxChars = toPositiveInteger(params.maxChars, 6000, 20000)

      if (!url) {
        const result: ReadWebPageToolResult = {
          status: "error",
          url: rawUrl,
          content: "",
          truncated: false,
          message: "网页地址无效，只支持 http 或 https URL。",
        }
        return JSON.stringify(result)
      }

      try {
        const fetchPage = deps.fetchPage ?? await getHttpFetch()
        const response = await fetchPage(url.toString(), {
          method: "GET",
          headers: { Accept: "text/html,text/plain;q=0.9,*/*;q=0.8" },
        })
        if (!response.ok) {
          const result: ReadWebPageToolResult = {
            status: "error",
            url: url.toString(),
            content: "",
            truncated: false,
            message: `网页读取失败，HTTP 状态码：${response.status}`,
          }
          return JSON.stringify(result)
        }

        const contentType = response.headers?.get("content-type") ?? ""
        const rawText = await response.text()
        const title = /html/i.test(contentType) || /<html|<title|<body/i.test(rawText)
          ? extractTitle(rawText)
          : undefined
        const cleaned = /html/i.test(contentType) || /<html|<title|<body/i.test(rawText)
          ? stripHtml(rawText)
          : rawText.replace(/\s+/g, " ").trim()
        const truncated = cleaned.length > maxChars
        const content = truncated ? cleaned.slice(0, maxChars) : cleaned

        const result: ReadWebPageToolResult = {
          status: "ok",
          url: url.toString(),
          title,
          content,
          truncated,
          message: truncated ? `网页正文超过 ${maxChars} 字符，已截断。` : undefined,
        }
        return JSON.stringify(result)
      } catch (error) {
        const result: ReadWebPageToolResult = {
          status: "error",
          url: url.toString(),
          content: "",
          truncated: false,
          message: `网页读取失败：${error instanceof Error ? error.message : String(error)}`,
        }
        return JSON.stringify(result)
      }
    },
  }
}
