

const SUPPORTED_SCHEMES = ["http:", "https:"] as const

type ValidateResult = { ok: true } | { ok: false; error: string }

export function validateProxyUrl(url: string): ValidateResult {
  const trimmed = url.trim()
  if (trimmed === "") return { ok: false, error: "URL is empty" }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, error: "Not a valid URL" }
  }

  if (!parsed.protocol) {
    return { ok: false, error: "URL is missing a scheme (http:// or https://)" }
  }
  if (!SUPPORTED_SCHEMES.includes(parsed.protocol as (typeof SUPPORTED_SCHEMES)[number])) {
    return {
      ok: false,
      error: `Unsupported scheme "${parsed.protocol}". Use http:// or https://`,
    }
  }
  if (!parsed.hostname) {
    return { ok: false, error: "URL is missing a host" }
  }
  return { ok: true }
}
