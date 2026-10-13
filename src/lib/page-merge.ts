/**
 * Merge a wiki page that the LLM just generated with whatever's
 * already on disk. Solves silent data loss across re-ingests where
 * a second source contributes content to the same entity / concept
 * page.
 *
 * Architecture: pure logic, LLM call injected as a parameter.
 * Production wires this up against `streamChat`; tests use mocks.
 *
 * Three layers of protection:
 *   1. Frontmatter array fields (sources / tags / related) — always
 *      union-merged at the application layer regardless of whether
 *      the LLM is involved. Zero-cost, deterministic.
 *   2. Body — if old and new bodies differ, ask the LLM to produce
 *      a coherent merge. Sanity-checked on length and structure
 *      before accepting.
 *   3. Locked frontmatter fields (type / title / created) — even if
 *      the LLM rewrote them, the existing values are forced back.
 *      type/title shifting breaks wikilinks; created is a one-time
 *      stamp.
 *
 * Fallback: any LLM failure or sanity-check rejection falls back to
 * the previous (Array-merged-frontmatter + new body) behavior, with
 * an optional backup of the existing content for user recovery.
 */
import { parseFrontmatter } from "./frontmatter"
import { mergeArrayFieldsIntoContent } from "./sources-merge"

/** Frontmatter array fields unioned across re-ingests. */
const UNION_FIELDS = ["sources", "tags", "related"] as const

/**
 * Frontmatter scalar fields whose existing value MUST survive an
 * ingest, even if the LLM emits a different value:
 *   - type: changing it would re-categorize the page across folders;
 *     the wiki schema isn't designed for that.
 *   - title: every wikilink that resolves to this page goes through
 *     `[[slug]]` keyed off the slug, but the displayed title is the
 *     `title` field — silently rewriting it would break user mental
 *     maps and any prose that references the title verbatim.
 *   - created: a one-time stamp; an "updated" stamp is computed
 *     separately.
 */
const LOCKED_FIELDS = ["type", "title", "created", "chapter_number", "chapter_status", "outline_type"] as const

/**
 * Body length safety threshold. If the LLM's merged body is shorter
 * than 70% of the longer of (existing body, incoming body), reject
 * the merge — the LLM almost certainly stripped content rather than
 * legitimately deduplicating. 0.7 allows for ~30% legitimate dedup
 * compression while catching obvious truncation / lazy summaries.
 */
const BODY_SHRINK_THRESHOLD = 0.7

export interface MergeFn {
  /**
   * Implements the LLM-call portion of the merge. Receives the
   * existing on-disk content and the incoming new content (already
   * array-field-merged); returns the LLM's full proposed merged
   * file (frontmatter + body) as a string.
   */
  (
    existingContent: string,
    incomingContent: string,
    sourceFileName: string,
    signal?: AbortSignal,
  ): Promise<string>
}

interface MergePageOptions {
  /** Source filename being ingested — passed through to the merger
   *  and used in fallback log messages. */
  sourceFileName: string
  /** Wiki-relative page path (e.g. wiki/entities/foo.md). Used only
   *  for log messages today; the file write itself is the caller's
   *  responsibility. */
  pagePath: string
  /** Abort signal forwarded to the merger. */
  signal?: AbortSignal
  /** Best-effort hook to back up the existing content before any
   *  fallback write. Errors are swallowed — backup must never
   *  block the merge. */
  backup?: (existingContent: string) => Promise<void>
  /** Date provider for the `updated` field. Injectable for
   *  deterministic tests. Defaults to today's UTC date. */
  today?: () => string
}

export async function mergePageContent(
  newContent: string,
  existingContent: string | null,
  merger: MergeFn,
  opts: MergePageOptions,
): Promise<string> {
  // Fast path 1: brand-new page.
  if (!existingContent) return newContent

  // Fast path 2: byte-identical — re-ingest of the same source file
  // with no actual change. Stable reference helps callers.
  if (newContent === existingContent) return existingContent

  // Step 1 — always-on: union the array frontmatter fields.
  const arrayMerged = mergeArrayFieldsIntoContent(
    newContent,
    existingContent,
    [...UNION_FIELDS],
  )

  // Fast path 3: bodies are identical (only frontmatter array-fields
  // differed). The array merge has already produced the right output;
  // skip the LLM.
  const oldParsed = parseFrontmatter(existingContent)
  const arrayMergedParsed = parseFrontmatter(arrayMerged)
  if (oldParsed.body.trim() === arrayMergedParsed.body.trim()) {
    return arrayMerged
  }

  // Step 2 — ask the merger to produce a unified body. Failures fall
  // through to the array-merged-only path with a best-effort backup.
  let llmOutput: string
  try {
    llmOutput = await merger(
      existingContent,
      arrayMerged,
      opts.sourceFileName,
      opts.signal,
    )
  } catch (err) {
    console.warn(
      `[page-merge] LLM merge failed for ${opts.pagePath}, falling back to incoming + array-field union: ${err instanceof Error ? err.message : err}`,
    )
    await tryBackup(opts, existingContent)
    return arrayMerged
  }

  // Sanity 1: LLM output must parse as a frontmatter-bearing wiki
  // page. No-frontmatter output would silently corrupt the page.
  const llmParsed = parseFrontmatter(llmOutput)
  if (llmParsed.frontmatter === null) {
    console.warn(
      `[page-merge] LLM output for ${opts.pagePath} has no frontmatter — rejecting, falling back`,
    )
    await tryBackup(opts, existingContent)
    return arrayMerged
  }

  // Sanity 2: body length. Reject obvious truncation / lazy summary.
  const oldBodyLen = oldParsed.body.length
  const newBodyLen = arrayMergedParsed.body.length
  const llmBodyLen = llmParsed.body.length
  const minThreshold = Math.max(oldBodyLen, newBodyLen) * BODY_SHRINK_THRESHOLD
  if (llmBodyLen < minThreshold) {
    console.warn(
      `[page-merge] LLM merge for ${opts.pagePath} produced body ${llmBodyLen} chars, below threshold ${minThreshold.toFixed(0)} (max input was ${Math.max(oldBodyLen, newBodyLen)}) — rejecting, falling back`,
    )
    await tryBackup(opts, existingContent)
    return arrayMerged
  }

  // Step 3 — apply deterministic post-processing: lock fields back
  // to existing values, force array fields to the union, set
  // updated to today.
  let final = llmOutput
  for (const field of LOCKED_FIELDS) {
    const existingValue = oldParsed.frontmatter?.[field]
    if (typeof existingValue === "string" && existingValue !== "") {
      final = setFrontmatterScalar(final, field, existingValue)
    }
  }
  // Re-apply union merges on top of the LLM's frontmatter using
  // arrayMerged (which is already existing+incoming union) as the
  // reference. The LLM may have output a subset of array values —
  // defensively re-union against BOTH sides so neither contributor
  // is dropped, regardless of which side the LLM chose to echo.
  final = mergeArrayFieldsIntoContent(final, arrayMerged, [...UNION_FIELDS])
  // Updated is always today on a successful merge.
  const todayFn = opts.today ?? defaultToday
  final = setFrontmatterScalar(final, "updated", todayFn())

  return final
}

async function tryBackup(
  opts: MergePageOptions,
  existingContent: string,
): Promise<void> {
  if (!opts.backup) return
  try {
    await opts.backup(existingContent)
  } catch (err) {
    console.warn(
      `[page-merge] backup failed for ${opts.pagePath}: ${err instanceof Error ? err.message : err}`,
    )
  }
}

function defaultToday(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Set a scalar frontmatter field to `value` in the inline form
 * `field: value`. If the field already exists in the frontmatter,
 * the line is replaced in place. If it doesn't, the field is
 * appended at the end of the frontmatter block.
 *
 * Keeps the rest of the document unchanged. Returns content
 * unchanged if it has no frontmatter at all.
 *
 * Quoting: `value` comes from a previously *parsed* page, so it can
 * be any string a user or model put there — not just a plain
 * identifier. It is re-serialized through `serializeScalar`, which
 * adds double quotes only when a YAML plain scalar couldn't carry
 * the value (see `needsYamlQuoting`). The common cases — plain
 * identifiers and ISO dates like `created: 2026-04-09` — are written
 * byte-identically to before.
 */
function setFrontmatterScalar(
  content: string,
  fieldName: string,
  value: string,
): string {
  const fmMatch = content.match(/^(---\n)([\s\S]*?)(\n---)/)
  if (!fmMatch) return content
  const [, openDelim, fmBody, closeDelim] = fmMatch
  const escapedName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const newLine = `${fieldName}: ${serializeScalar(value)}`

  // Only match scalar form (no `[`, no `\n  -`). Array-form fields
  // are handled by sources-merge.
  const lineRe = new RegExp(`^${escapedName}:\\s*(?!\\[)([^\\n]*)`, "m")
  if (lineRe.test(fmBody)) {
    const rewritten = fmBody.replace(lineRe, newLine)
    return `${openDelim}${rewritten}${closeDelim}${content.slice(fmMatch[0].length)}`
  }
  // Field absent — append.
  const rewritten = `${fmBody}\n${newLine}`
  return `${openDelim}${rewritten}${closeDelim}${content.slice(fmMatch[0].length)}`
}

/**
 * 把值写成 YAML 标量：能当裸标量写就原样写，写不了才加双引号。
 *
 * 为什么需要它：`value` 取自**已经解析过**的 frontmatter，可能是用户或模型
 * 写下的任意字符串。真实事故来源是 ingest 的兜底摘要页 —— 它写的是
 * `title: "Source: 文件名"`，这个值天然含 `: `（冒号 + 空格），而 YAML 的裸
 * 标量不允许出现它。锁回 title 时若原样拼成 `title: Source: x`，磁盘上就留下
 * 一个 `bad indentation of a mapping entry` 的文件：标题、正文乃至整个
 * frontmatter 全部读不回来（parseFrontmatter 返回 null）。
 *
 * 用 JSON.stringify 做转义：YAML 的双引号风格是 JSON 字符串的超集，
 * `"`、`\`、换行与控制字符都能安全表达，不必自己拼转义表。
 *
 * 刻意**不**处理「看起来像数字/日期」的值：仓库里解析用的是
 * `yaml.JSON_SCHEMA`，`2026-04-09`、`12` 这类裸标量本来就按字符串读回来
 * （normalize → stringifyScalar），加引号只会平白改掉磁盘上的既有写法。
 */
function serializeScalar(value: string): string {
  return needsYamlQuoting(value) ? JSON.stringify(value) : value
}

/** 判断一个字符串能否安全地作为 YAML 裸标量写出。 */
function needsYamlQuoting(value: string): boolean {
  if (value === "") return true
  // 首尾空白在裸标量里会被吃掉
  if (value !== value.trim()) return true
  // 会成为 null / 布尔的保留字，读回来就不是原本的字符串了
  if (/^(?:~|null|true|false)$/i.test(value)) return true
  // 指示符开头：裸标量里没有安全含义（`-` 还是列表项）
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return true
  // `: ` 会把它变成嵌套映射，` #` 会把它截断成注释，行尾 `:` 同理
  if (value.includes(": ") || value.endsWith(":") || value.includes(" #")) {
    return true
  }
  if (/[\n\r\t]/.test(value)) return true
  return false
}
