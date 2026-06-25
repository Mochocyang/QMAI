/**
 * Clean up user-entered LLM endpoint URLs. Catches the two most common
 * mistakes:
 *
 *   1. User pastes the full path (e.g. ".../v1/chat/completions") — our
 *      dispatch would then append ANOTHER "/chat/completions" on top,
 *      producing a 404. Always strip trailing path segments that belong
 *      on the request, not on the base.
 *
 *   2. User forgets the version segment entirely (e.g. "https://host.com"
 *      with no /v1). We can't auto-add it because providers use different
 *      segments (OpenAI `/v1`, Zhipu `/api/paas/v4`, Groq `/openai/v1`) —
 *      but we CAN flag it so the user sees the hint.
 *
 * Auto-fixes apply deterministically on blur; hints explain what happened.
 * Warnings are shown inline but never block saving — some self-hosted
 * gateways really do mount the API at a bare host.
 */

export type EndpointMode = "chat_completions" | "responses" | "anthropic_messages" | "azure"

export interface NormalizedEndpoint {
  /** The cleaned-up URL to store. Empty string for empty input. */
  normalized: string
  /** True if normalization changed the input (show a "will use" hint). */
  changed: boolean
  /** Human-readable hint / warning. Undefined when the input is fine. */
  warning?: string
}

// Path tails that are always wrong as a base URL and can be safely
// stripped regardless of mode — these belong on the request, not on the
// configured endpoint.
const ALWAYS_WRONG_TAILS = /\/+(chat\/completions|responses|embeddings)\/?$/i
// `/messages` is ambiguous: in anthropic_messages mode our dispatch uses
// it verbatim when present, so we must preserve it. Only strip when the
// configured mode is chat_completions.
const MESSAGES_TAIL = /\/+messages\/?$/i

export function normalizeEndpoint(raw: string, mode: EndpointMode): NormalizedEndpoint {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return { normalized: "", changed: false }

  // Detect missing protocol — we never auto-add https:// because that
  // would mask the user's typo; just flag it.
  const missingProtocol = !/^https?:\/\//i.test(trimmed)
  if (missingProtocol) {
    return {
      normalized: trimmed.replace(/\/+$/, ""),
      changed: trimmed !== trimmed.replace(/\/+$/, ""),
      warning: "接口地址需要以 http:// 或 https:// 开头。",
    }
  }

  let url = trimmed
  const notes: string[] = []

  // Sanity-check the URL can be parsed at all. `new URL(...)` catches
  // typos like five-octet IPs ("192.168.1.1.50"), triple-t protocols
  // ("htttp://"), stray backslashes, and similar paste mistakes that
  // would otherwise only be diagnosed at request time by the HTTP
  // client — a much worse user experience. Emit the warning up front
  // and still return whatever we've got so the input field behaves.
  let parsed: URL | null = null
  try {
    parsed = new URL(trimmed)
  } catch {
    return {
      normalized: trimmed.replace(/\/+$/, ""),
      changed: trimmed !== trimmed.replace(/\/+$/, ""),
      warning: "接口地址格式不正确，请检查域名、端口或路径是否填写错误。",
    }
  }

  // Also catch IPv4-shaped hostnames with too many / too few octets
  // — these parse fine as generic DNS names but will fail at lookup.
  // If the hostname looks IP-shaped but isn't a valid IPv4, flag it.
  const host = parsed.hostname
  const looksNumericDotted = /^\d+(?:\.\d+)+$/.test(host)
  if (looksNumericDotted) {
    const octets = host.split(".")
    const validIpv4 =
      octets.length === 4 &&
      octets.every((o) => {
        const n = Number(o)
        return Number.isInteger(n) && n >= 0 && n <= 255
      })
    if (!validIpv4) {
      notes.push(
        `主机地址 "${host}" 看起来像 IPv4，但包含 ${octets.length} 段；正确 IPv4 应为 4 段，且每段在 0-255 之间。`,
      )
    }
  }

  // Strip trailing slashes (cheap, always safe)
  url = url.replace(/\/+$/, "")

  // Azure OpenAI uses resource/deployment URLs and an api-version query
  // parameter configured separately, so keep deployment paths but strip
  // the final request suffix.
  if (mode === "azure" || isAzureOpenAiEndpoint(url)) {
    try {
      const u = new URL(url)
      let pathname = u.pathname.replace(/\/+$/, "")
      if (/\/chat\/completions\/?$/i.test(pathname)) {
        pathname = pathname.replace(/\/chat\/completions\/?$/i, "")
        notes.push("已移除末尾的 chat/completions；Azure 请求时会自动添加。")
      }
      url = `${u.origin}${pathname}`
      if (u.search) notes.push("已移除查询参数；api-version 会使用单独的设置。")
    } catch {
      if (/\/chat\/completions\/?($|\?)/i.test(url)) {
        url = url.replace(/\/chat\/completions\/?(?=$|\?)/i, "")
        notes.push("已移除末尾的 chat/completions；Azure 请求时会自动添加。")
      }
    }
    return {
      normalized: url,
      changed: url !== trimmed,
      warning: notes.length ? notes.join(" ") : undefined,
    }
  }

  // Strip request-path tails users paste by accident. Works in both
  // modes for /chat/completions and /embeddings (wrong shape for either
  // wire). /messages is only wrong in chat_completions mode — in
  // anthropic_messages mode the dispatch uses it verbatim.
  if (ALWAYS_WRONG_TAILS.test(url)) {
    const match = url.match(ALWAYS_WRONG_TAILS)
    url = url.replace(ALWAYS_WRONG_TAILS, "")
    if (match) notes.push(`已移除末尾的 "${match[0].replace(/^\/+/, "").replace(/\/+$/, "")}"；这部分会在请求时自动追加，不需要写在基础地址里。`)
  } else if (mode === "chat_completions" && MESSAGES_TAIL.test(url)) {
    const match = url.match(MESSAGES_TAIL)
    url = url.replace(MESSAGES_TAIL, "")
    if (match) notes.push(`已移除末尾的 "${match[0].replace(/^\/+/, "").replace(/\/+$/, "")}"；这是 Anthropic 兼容路径，不是 OpenAI 兼容基础地址。`)
  }

  // After stripping, check for the "bare host, no version segment" case.
  // Only hint for chat_completions — anthropic_messages endpoints sit at
  // various non-/v1 paths (MiniMax `/anthropic`, Anthropic native `/`)
  // and we can't reliably flag them.
  if (mode === "chat_completions" || mode === "responses") {
    try {
      const u = new URL(url)
      const pathname = u.pathname.replace(/\/+$/, "")
      const hasVersionSegment = /\/(v\d+|paas\/v\d+|openai\/v\d+|api\/v\d+)$/i.test(pathname)
      if (!hasVersionSegment && !notes.length) {
        notes.push("接口地址缺少版本路径，例如 /v1。请根据服务商文档确认正确的接口地址。")
      }
    } catch {
      // Malformed URL — leave alone, browser will fail loudly at fetch time.
    }
  }

  const changed = url !== trimmed
  return {
    normalized: url,
    changed,
    warning: notes.length ? notes.join(" ") : undefined,
  }
}
import { isAzureOpenAiEndpoint } from "@/lib/azure-openai"
