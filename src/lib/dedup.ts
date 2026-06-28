/**
 * Duplicate-entity / -concept detection and merge for wiki maintenance.
 *
 * Problem: across re-ingests, the LLM names the same underlying
 * topic differently — `paos` vs `聚磷菌`, `dpao` vs `dpaos` (plural)
 * vs `反硝化除磷菌`, `vfa` vs `volatile-fatty-acids`. Each becomes a
 * separate page even though they're the same entity. The page-merge
 * layer only catches *exact* slug collisions; this module catches
 * the soft-collision case via an LLM-driven self-check.
 *
 * Three stages, each independently testable:
 *
 *   1. extractEntitySummaries: walk wiki/entities and wiki/concepts,
 *      pull (slug, title, description, tags) per page. Pure-data;
 *      no LLM.
 *   2. detectDuplicateGroups: hand the summary list to an LLM, ask
 *      it to identify groups of slugs likely to refer to the same
 *      thing. Returns parsed JSON groups with reason + confidence.
 *      The LLM call is injected so unit tests don't hit a model.
 *   3. mergeDuplicateGroup: given a confirmed group + chosen
 *      canonical slug, merge bodies (LLM call), union frontmatter
 *      array fields (deterministic), rewrite every wikilink /
 *      `related:` reference / index.md entry across the wiki, and
 *      package up a result the caller writes to disk + backs up.
 *
 * The caller (UI) is responsible for filesystem reads/writes and
 * for showing the user the candidate groups. This module only
 * transforms data.
 */

import { parseFrontmatter } from "./frontmatter"
import {
  parseFrontmatterArray,
  mergeArrayFieldsIntoContent,
  writeFrontmatterArray,
} from "./sources-merge"

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

export interface EntitySummary {
  /** kebab-case slug (basename without `.md`). */
  slug: string
  /** Path relative to project root, e.g. `wiki/entities/foo.md`. */
  path: string
  /** entity | concept | source | ... — frontmatter `type` field. */
  type: string
  title: string
  /** Optional one-line description from frontmatter `description`,
   *  or the first non-empty body paragraph as a fallback. Truncated
   *  to ~200 chars to keep the detector prompt small. */
  description?: string
  tags: string[]
}

export interface DuplicateGroup {
  /** Two or more slugs from the input list. */
  slugs: string[]
  /** Why the model believes these are duplicates. Short prose. */
  reason: string
  confidence: "high" | "medium" | "low"
}

export interface MergeRequest {
  /** Pages in the duplicate group, with their full content loaded. */
  group: { slug: string; path: string; content: string }[]
  /** Slug to keep. Must be one of group[].slug. The other pages
   *  are deleted; their wikilinks/related entries get rewritten
   *  to point here. */
  canonicalSlug: string
  /** Every other .md under the project's wiki/ tree. Used to
   *  rewrite cross-references when the merge replaces multiple
   *  pages with one. */
  otherWikiPages: { path: string; content: string }[]
}

export interface MergeResult {
  /** Final content of the canonical page (frontmatter + body),
   *  after LLM body merge + deterministic frontmatter unification. */
  canonicalContent: string
  /** Path of the canonical page on disk (one of the group's). */
  canonicalPath: string
  /** Cross-reference rewrites in other wiki pages. Caller writes
   *  each (path → newContent) back to disk. */
  rewrites: { path: string; newContent: string }[]
  /** Paths to delete after canonical + rewrites are written.
   *  Excludes the canonical path. */
  pagesToDelete: string[]
  /** Snapshot of every file the merge touches BEFORE the merge
   *  was computed. Caller persists this to .qmai/page-history/
   *  before writing changes so a bad merge can be rolled back. */
  backup: { path: string; content: string }[]
}

/**
 * Generic two-prompt LLM call. Both detector and merger use it.
 * Production wraps `streamChat`; tests use mocks.
 */
export type DedupLlmCall = (
  systemPrompt: string,
  userMessage: string,
  signal?: AbortSignal,
) => Promise<string>

// ──────────────────────────────────────────────────────────────────
// Stage 1: extract summaries (no LLM)
// ──────────────────────────────────────────────────────────────────

/**
 * Build an EntitySummary from a single page's path + content.
 * `pathRelativeToProject` should be the canonical wiki-relative
 * form (`wiki/entities/foo.md`) so callers downstream can derive
 * slugs consistently.
 */
export function extractEntitySummary(
  pathRelativeToProject: string,
  content: string,
): EntitySummary | null {
  const { frontmatter, body } = parseFrontmatter(content)
  if (!frontmatter) return null
  const type = stringField(frontmatter.type) ?? "unknown"
  const title = stringField(frontmatter.title) ?? slugFromPath(pathRelativeToProject)
  const description = stringField(frontmatter.description) ?? firstBodyParagraph(body)
  const tags = arrayField(frontmatter.tags)
  return {
    slug: slugFromPath(pathRelativeToProject),
    path: pathRelativeToProject,
    type,
    title,
    description: description ? truncate(description, 200) : undefined,
    tags,
  }
}

function slugFromPath(path: string): string {
  const base = path.split("/").pop() ?? path
  return base.replace(/\.md$/, "")
}

function stringField(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim() !== "") return v.trim()
  return undefined
}

function arrayField(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "")
}

function firstBodyParagraph(body: string): string | undefined {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean)
  // Skip leading h1/h2 lines so the description isn't just the title again.
  for (const line of lines) {
    if (line.startsWith("#")) continue
    if (line.startsWith("|")) continue // table — too noisy
    return line
  }
  return undefined
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + "…"
}

// ──────────────────────────────────────────────────────────────────
// Stage 2: LLM-driven duplicate detection
// ──────────────────────────────────────────────────────────────────

const DETECTOR_SYSTEM_PROMPT = `你是一个维基维护助手。你将收到一个维基中的实体/概念页面列表。请找出那些很可能指向同一主题但名称不同的 slug 分组——例如：

- 同一名称的不同语言版本（中英文等）
- 单复数形式（如 "dpao" 和 "dpaos"）
- 缩写与全称（如 "vfa" 和 "volatile-fatty-acids"）
- 同义词
- 同一专有名词的不同拼写

只输出有效的 JSON。不要输出散文、markdown 代码块或 JSON 之外的任何解释。JSON 结构如下：

{
  "groups": [
    {
      "slugs": ["slug-a", "slug-b"],
      "reason": "两个页面都指向 X；第一个是英文，第二个是中文。",
      "confidence": "high"
    }
  ]
}

规则：
- 只包含输入列表中 2 个或更多 slug 的分组。
- "high" = 明显是同一实体，只是命名不同。
- "medium" = 可能是同一实体，但需要结合上下文判断。
- "low" = 不确定，需要用户仔细审查。
- 不要编造输入列表中不存在的 slug。
- 如果没有重复项，输出 {"groups": []}。
- 不同 \`type\`（如 entity 和 concept）的页面通常不应分在一组——只有在明确是同一事物时才跨类型分组。

重要：reason 字段必须使用中文描述。`

/**
 * Run the LLM duplicate-detector. The caller hands in summaries
 * (typically every entity + concept page in the wiki) and a
 * function that wraps an LLM call. Returns parsed, validated
 * groups — invalid entries (slugs not in the input, single-element
 * groups) are filtered out so the caller never sees garbage.
 *
 * Already-confirmed-not-duplicate groups passed in `notDuplicates`
 * are filtered out before returning so the same false positive
 * doesn't keep appearing on every run.
 */
export async function detectDuplicateGroups(
  summaries: EntitySummary[],
  llmCall: DedupLlmCall,
  options: { signal?: AbortSignal; notDuplicates?: string[][] } = {},
): Promise<DuplicateGroup[]> {
  if (summaries.length < 2) return []

  const userMessage = buildDetectorUserMessage(summaries)
  const response = await llmCall(DETECTOR_SYSTEM_PROMPT, userMessage, options.signal)
  const parsed = parseDetectorResponse(response)

  const validSlugs = new Set(summaries.map((s) => s.slug))
  const notDupSet = new Set(
    (options.notDuplicates ?? []).map((g) => normalizeGroupKey(g)),
  )

  return parsed
    .map((g) => ({ ...g, slugs: g.slugs.filter((s) => validSlugs.has(s)) }))
    .filter((g) => g.slugs.length >= 2)
    .filter((g) => !notDupSet.has(normalizeGroupKey(g.slugs)))
}

function buildDetectorUserMessage(summaries: EntitySummary[]): string {
  const lines = summaries.map((s) => {
    const tagPart = s.tags.length > 0 ? ` [${s.tags.join(", ")}]` : ""
    const descPart = s.description ? ` — ${s.description}` : ""
    return `- type=${s.type}, slug=${s.slug}, title=${JSON.stringify(s.title)}${tagPart}${descPart}`
  })
  return `## Wiki pages to scan (${summaries.length} entries)\n\n${lines.join("\n")}\n\nReturn duplicate groups as JSON only.`
}

/**
 * Tolerant JSON extraction. The LLM might wrap output in code
 * fences (\`\`\`json), prepend "Sure, here you go:", or trail
 * with a polite "Let me know if...". Pull the first {…} block
 * with balanced braces and parse it. Returns [] for any failure
 * — the caller treats "no duplicates found" identically to "LLM
 * output garbled".
 */
export function parseDetectorResponse(raw: string): DuplicateGroup[] {
  const jsonText = extractFirstJsonObject(raw)
  if (!jsonText) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== "object") return []
  const groupsRaw = (parsed as { groups?: unknown }).groups
  if (!Array.isArray(groupsRaw)) return []

  const out: DuplicateGroup[] = []
  for (const g of groupsRaw) {
    if (!g || typeof g !== "object") continue
    const obj = g as Record<string, unknown>
    const slugs = Array.isArray(obj.slugs)
      ? obj.slugs.filter((s): s is string => typeof s === "string")
      : []
    if (slugs.length < 2) continue
    const reason = typeof obj.reason === "string" ? obj.reason : ""
    const confidence: DuplicateGroup["confidence"] =
      obj.confidence === "high" || obj.confidence === "medium"
        ? obj.confidence
        : "low"
    out.push({ slugs, reason, confidence })
  }
  return out
}

/** Extract the first balanced `{...}` substring from arbitrary text. */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{")
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === "\\") {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** Canonical key for a group — lowercased, sorted, comma-joined. */
function normalizeGroupKey(slugs: string[]): string {
  return [...slugs].map((s) => s.toLowerCase()).sort().join(",")
}

// ──────────────────────────────────────────────────────────────────
// Stage 3: merge a confirmed duplicate group
// ──────────────────────────────────────────────────────────────────

const MERGER_SYSTEM_PROMPT = `你是一个维基维护助手。你将收到几个描述同一实体或概念但名称不同的维基页面。请将它们合并为一个连贯的维基页面。

输出完整的合并文件（frontmatter + 正文）。你回复的第一个字符必须是 "-"（"---" 的开头）。不要输出前言或文件之外的任何解释。

规则：
- 保留每个输入页面中所有不同的事实性陈述。
- 消除冗余（不要在多个章节中重复相同的内容）。
- 重新组织章节结构，使其对统一后的主题具有逻辑性，而不是简单拼接输入内容。
- 在正文中使用 [[wikilink]] 语法（如果输入中使用了的话）。
- Frontmatter：保留标准字段（type, title, created, updated, tags, related, sources）。调用方会在之后用确定性合并覆盖 sources / tags / related / updated 字段——你的任务是生成合理的正文和合理的 frontmatter 结构。
- 选择最具描述性的标题。如果输入使用了不同语言，优先选择与正文内容多数语言匹配的语言。`

const FIELDS_TO_UNION = ["sources", "tags", "related"] as const

/**
 * Compute everything needed to merge a confirmed duplicate group:
 *   - LLM call to produce the merged canonical body
 *   - Deterministic frontmatter union (sources, tags, related)
 *   - Canonical slug enforcement on title path
 *   - Cross-reference rewrites across every other wiki page
 *   - Backup snapshot of all touched files
 *
 * Returns a MergeResult; the CALLER is responsible for actually
 * writing canonicalContent + each rewrite + deleting the merged-
 * away files + storing the backup. Splitting compute from I/O
 * keeps this testable.
 */
export async function mergeDuplicateGroup(
  req: MergeRequest,
  llmCall: DedupLlmCall,
  options: { signal?: AbortSignal; today?: () => string } = {},
): Promise<MergeResult> {
  const canonical = req.group.find((p) => p.slug === req.canonicalSlug)
  if (!canonical) {
    throw new Error(
      `canonicalSlug "${req.canonicalSlug}" is not in the group: ${req.group.map((p) => p.slug).join(", ")}`,
    )
  }
  if (req.group.length < 2) {
    throw new Error("mergeDuplicateGroup requires at least 2 pages in the group")
  }

  // 1. LLM body merge
  const userMessage = buildMergerUserMessage(req.group)
  const llmOutput = await llmCall(MERGER_SYSTEM_PROMPT, userMessage, options.signal)

  // 2. Frontmatter union (deterministic post-processing of LLM output).
  //    For each unioned field, fold every input page's values into
  //    the LLM output via mergeArrayFieldsIntoContent.
  let merged = llmOutput
  for (const page of req.group) {
    merged = mergeArrayFieldsIntoContent(merged, page.content, [...FIELDS_TO_UNION])
  }

  // 3. Stamp updated to today and force a sensible title.
  const today = (options.today ?? defaultToday)()
  merged = setFrontmatterScalar(merged, "updated", today)
  // If LLM output's frontmatter parses cleanly we leave its title;
  // if not, the application layer doesn't try to manufacture one.

  // 4. Cross-reference rewrites: every other wiki page that mentions
  //    a non-canonical slug needs its wikilinks / related entries
  //    rewritten to the canonical.
  const slugRedirects = new Map<string, string>()
  for (const page of req.group) {
    if (page.slug !== req.canonicalSlug) {
      slugRedirects.set(page.slug, req.canonicalSlug)
    }
  }
  const rewrites: MergeResult["rewrites"] = []
  for (const page of req.otherWikiPages) {
    const rewritten = rewriteCrossReferences(page.content, slugRedirects)
    if (rewritten !== page.content) {
      rewrites.push({ path: page.path, newContent: rewritten })
    }
  }

  // 5. Backup: every touched file's PRE-merge content.
  const backup: MergeResult["backup"] = []
  for (const page of req.group) {
    backup.push({ path: page.path, content: page.content })
  }
  for (const r of rewrites) {
    const orig = req.otherWikiPages.find((p) => p.path === r.path)
    if (orig) backup.push({ path: orig.path, content: orig.content })
  }

  // 6. Pages to delete: every group member except the canonical.
  const pagesToDelete = req.group
    .filter((p) => p.slug !== req.canonicalSlug)
    .map((p) => p.path)

  return {
    canonicalContent: merged,
    canonicalPath: canonical.path,
    rewrites,
    pagesToDelete,
    backup,
  }
}

function buildMergerUserMessage(
  group: { slug: string; content: string }[],
): string {
  const sections = group.map((p, i) => {
    return [
      `## Page ${i + 1} (slug: ${p.slug})`,
      "",
      p.content,
      "",
    ].join("\n")
  })
  return [
    `These ${group.length} wiki pages have been confirmed by the user to describe the same topic.`,
    `Merge them into a single coherent page (the canonical slug will be "${group[0].slug}" or whichever the caller chose).`,
    "",
    sections.join("\n---\n\n"),
    "",
    "Now output the merged file. First character must be `-`.",
  ].join("\n")
}

/**
 * Rewrite cross-references to merged-away slugs throughout one
 * page's content. Three forms get rewritten:
 *
 *   1. `[[old-slug]]` and `[[old-slug|alias]]` in the body
 *      — replace just the target portion, keep alias if present.
 *   2. `related: [..., old-slug, ...]` (inline form) — substitute
 *      old-slug with canonical inside the array, then dedup.
 *   3. `related:\n  - old-slug` (block form) — same substitution.
 *
 * `wiki/index.md`-style listings of files are out of scope here —
 * the caller handles index regeneration separately.
 */
export function rewriteCrossReferences(
  content: string,
  slugRedirects: Map<string, string>,
): string {
  let out = content

  // 1. Wikilinks in the body — both [[slug]] and [[slug|alias]].
  for (const [oldSlug, newSlug] of slugRedirects) {
    const escaped = escapeRegex(oldSlug)
    const re = new RegExp(`\\[\\[${escaped}(\\|[^\\]]+)?\\]\\]`, "g")
    out = out.replace(re, (_match, alias) => `[[${newSlug}${alias ?? ""}]]`)
  }

  // 2. & 3. `related` field — re-parse and rewrite.
  const existing = parseFrontmatterArray(out, "related")
  if (existing.length > 0) {
    const rewritten = existing.map((s) => slugRedirects.get(s) ?? s)
    // Deduplicate (case-insensitive, first-seen casing wins)
    const seen = new Set<string>()
    const unique: string[] = []
    for (const s of rewritten) {
      const k = s.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      unique.push(s)
    }
    if (
      unique.length !== existing.length ||
      unique.some((s, i) => s !== existing[i])
    ) {
      out = writeFrontmatterArray(out, "related", unique)
    }
  }

  return out
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function setFrontmatterScalar(
  content: string,
  field: string,
  value: string,
): string {
  const m = content.match(/^(---\n)([\s\S]*?)(\n---)/)
  if (!m) return content
  const [, open, body, close] = m
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const newLine = `${field}: ${value}`
  const lineRe = new RegExp(`^${escaped}:\\s*(?!\\[)([^\\n]*)`, "m")
  if (lineRe.test(body)) {
    const rewritten = body.replace(lineRe, newLine)
    return `${open}${rewritten}${close}${content.slice(m[0].length)}`
  }
  return `${open}${body}\n${newLine}${close}${content.slice(m[0].length)}`
}

function defaultToday(): string {
  return new Date().toISOString().slice(0, 10)
}

// ──────────────────────────────────────────────────────────────────
// Index rewriter — wiki/index.md-specific
// ──────────────────────────────────────────────────────────────────

/**
 * Remove entries for merged-away slugs from `wiki/index.md`.
 * Index files are typically formatted as bullet / link lists
 * grouped by section. This is a CONSERVATIVE rewriter:
 *   - Removes any whole line that contains a markdown link or
 *     wikilink to a merged-away slug.
 *   - Preserves all other content verbatim (other sections,
 *     intros, the canonical entry).
 * The caller (UI) shows the user a diff before writing so any
 * over-removal is visible.
 */
export function rewriteIndexMd(
  content: string,
  removedSlugs: Set<string>,
): string {
  if (removedSlugs.size === 0) return content
  const lines = content.split("\n")
  const out: string[] = []
  for (const line of lines) {
    if (lineRefersToSlug(line, removedSlugs)) continue
    out.push(line)
  }
  return out.join("\n")
}

function lineRefersToSlug(line: string, slugs: Set<string>): boolean {
  for (const slug of slugs) {
    const escaped = escapeRegex(slug)
    // Wikilink form: [[slug]] or [[slug|alias]]
    if (new RegExp(`\\[\\[${escaped}(\\|[^\\]]*)?\\]\\]`).test(line)) return true
    // Markdown link form: [...](slug.md) or [...](path/slug.md)
    if (new RegExp(`\\(([^)]*\\/)?${escaped}\\.md\\)`).test(line)) return true
    // Bare slug.md mention (rare but seen in raw lists)
    if (new RegExp(`\\b${escaped}\\.md\\b`).test(line)) return true
  }
  return false
}
