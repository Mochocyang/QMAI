/**
 * Shared foreshadowing change parsing and name normalization.
 * Used by chapter ingest, memory rebuild, and cleanup tools.
 */

export type ForeshadowingChangeKind = "plant" | "advance" | "resolve"

export interface ParsedForeshadowingChange {
  kind: ForeshadowingChangeKind
  name: string
  description: string
}

/** 兼容 新增/推进/回收 + 可选「伏笔」二字 + 全角/半角冒号 + 无冒号 */
const PREFIX_RE = /^(新增|推进|回收)(伏笔)?[：:\s-]*/u

const KIND_BY_PREFIX: Record<string, ForeshadowingChangeKind> = {
  新增: "plant",
  推进: "advance",
  回收: "resolve",
}

/**
 * Strip action prefixes and derive a short name + full description.
 * Order: quoted name → keyword split → punctuation split → slice(0, 18).
 */
export function normalizeForeshadowingName(text: string): { name: string; description: string } {
  const cleaned = text
    .trim()
    .replace(/^(新增伏笔|推进伏笔|回收伏笔|新增|推进|回收)[：:\s-]*/u, "")
    .trim()

  if (!cleaned) {
    return { name: "", description: "" }
  }

  const quoted = cleaned.match(/[“"']([^“”"']{1,24})[”"']/u)
  if (quoted?.[1]) {
    const name = quoted[1].trim().slice(0, 18)
    const description =
      cleaned.replace(quoted[0], "").replace(/^[，。；：:、\-\s]+/u, "").trim() || text.trim()
    return { name, description }
  }

  const keywordSplit = cleaned
    .split(/为何|并非|不仅是|存在|成为|将成|将|会|正在|开始|继续|揭示|预示|说明|意味着|指向|却能|不承认/u)
    .map((item) => item.trim())
    .filter(Boolean)
  if (keywordSplit.length >= 2) {
    return { name: keywordSplit[0].slice(0, 18), description: cleaned }
  }

  const punctuationSplit = cleaned.split(/[，。；：:？！]/u).map((item) => item.trim()).filter(Boolean)
  if (punctuationSplit.length >= 2) {
    return { name: punctuationSplit[0].slice(0, 18), description: cleaned }
  }

  return { name: cleaned.slice(0, 18), description: cleaned }
}

/**
 * Parse a foreshadowing change line from a chapter snapshot.
 * Lines without a recognized prefix are treated as `advance`
 * (empirically they are progressive descriptions, not new plants).
 */
export function parseForeshadowingChange(raw: string): ParsedForeshadowingChange | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const match = trimmed.match(PREFIX_RE)
  let kind: ForeshadowingChangeKind
  let rest: string

  if (match) {
    const verb = match[1]
    kind = KIND_BY_PREFIX[verb] ?? "advance"
    rest = trimmed.slice(match[0].length).trim()
  } else {
    // No prefix → treat as advance (do not silently drop)
    kind = "advance"
    rest = trimmed
  }

  if (!rest) return null

  const { name, description } = normalizeForeshadowingName(
    match ? `${match[0]}${rest}` : rest,
  )
  if (!name) return null

  return { kind, name, description: description || rest }
}

/**
 * Match an existing foreshadowing item by normalized name.
 * Exact match first; then prefix match when both names are ≥6 chars.
 */
export function findForeshadowingByNormalizedName<T extends { name: string }>(
  items: readonly T[],
  queryName: string,
): T | undefined {
  const needle = queryName.trim()
  if (!needle) return undefined

  const exact = items.find((f) => f.name === needle)
  if (exact) return exact

  if (needle.length < 6) return undefined

  return items.find((f) => {
    const existing = f.name.trim()
    if (existing.length < 6) return false
    return existing.startsWith(needle) || needle.startsWith(existing)
  })
}

/** Active = not resolved and not abandoned. */
export function isActiveForeshadowingStatus(status: string): boolean {
  return status !== "resolved" && status !== "abandoned"
}
