/**
 * Gemini 2.5/3.x thought summaries often arrive as ordinary text parts
 * (no `thought: true`), shaped like:
 *
 *   **Defining the Request**
 *   The user wants the full text for Chapter 14...
 *
 *   **Pinpointing Chapter Details**
 *   ...
 *
 * They can also start with an unlabelled first-person planning paragraph and
 * quote a small amount of Chinese source text. Keep the detector deliberately
 * narrow: an English paragraph is only allowed to start a dump when it contains
 * an explicit assistant-workflow signal. Plain English narrative is not enough.
 */

const CJK_RE = /[\u4e00-\u9fff]/g
const DUMP_HEADER_RE = /^\*\*([^*]+)\*\*\s*$/
const DUMP_HEADER_TOPIC_RE =
  /\b(?:Analy[sz](?:ing|is)|Assess(?:ing|ment)|Clarifying|Considering|Crafting|Defining|Detailing|Developing|Ensuring|Evaluating|Evaluation|Examining|Exploring|Focusing|Formulating|Identifying|Initiating|Mapping|Pinpointing|Planning|Reasoning|Refining|Reviewing|Structuring|Understanding)\b/i
const REQUEST_DUMP_PROSE_RE =
  /^(?:The user (?:wants|is asking|requested|needs|has asked)\b|The (?:request|goal|task)\b)/i
const LEGACY_FIRST_PERSON_DUMP_PROSE_RE =
  /^(?:I need to\b|I(?:['’]ll| will)\b|Let(?:['’]s| me)\b)/i
const FIRST_PERSON_DUMP_PROSE_RE =
  /^I(?:['’]m| am)(?: currently| now)? (?:dissecting|focused on (?:defining|analy[sz]ing|examining|identifying|refining|reviewing|structuring)|focusing on|diving deep into (?:analy[sz]ing|examining|reviewing)|zeroing in on|analy[sz]ing|examining|evaluating|assessing|refining|clarifying|defining|identifying|mapping out|detailing|reviewing|considering|exploring|structuring|crafting|formulating|developing)|^I(?:['’]ve| have) been (?:mapping out|analy[sz]ing|examining|evaluating|assessing|refining|reviewing|considering|exploring|identifying|detailing)/i
const DUMP_CONTEXT_RE =
  /\b(?:task|request|goal|project scope|source text|text|novel|chapter|story|narrative|plot|scene|conflict|character|rewrite|response|output|instruction|constraint|detail|content|dialogue|framework|objective|requirement)s?\b/i

function cjkCount(text: string): number {
  return text.match(CJK_RE)?.length ?? 0
}

/**
 * A few quoted CJK terms inside a long English planning paragraph are not a
 * body boundary. A CJK-heavy line or paragraph still is.
 */
function hasSubstantiveCjk(text: string): boolean {
  const cjk = cjkCount(text)
  if (cjk === 0) return false
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0
  if (cjk <= 6 && latin >= 40) return false
  return latin < 12 || cjk >= 8 || cjk / Math.max(cjk + latin, 1) > 0.12
}

function isThoughtDumpHeader(line: string): boolean {
  const match = line.trim().match(DUMP_HEADER_RE)
  if (!match) return false
  const inner = match[1].trim()
  if (!inner || cjkCount(inner) > 0) return false
  if (!/^[A-Za-z]/.test(inner)) return false
  if (inner.length < 3 || inner.length > 80) return false
  if (!/^[A-Za-z0-9 ,:'’\-()/]+$/.test(inner)) return false
  const words = inner.split(/\s+/).filter(Boolean)
  if (words.length === 0) return false
  const capitalized = words.filter((word) => /^[A-Z]/.test(word)).length
  const titleCase = words.length === 1
    ? /^[A-Z][a-z]+/.test(words[0] ?? "")
    : capitalized >= Math.ceil(words.length * 0.5)
  return titleCase && DUMP_HEADER_TOPIC_RE.test(inner)
}

function isMostlyEnglishProse(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || hasSubstantiveCjk(trimmed)) return false
  const letters = trimmed.match(/[A-Za-z]/g)?.length ?? 0
  const nonSpace = trimmed.replace(/\s/g, "").length
  return letters >= 12 && letters / Math.max(nonSpace, 1) >= 0.65
}

function isEnglishDumpProse(text: string): boolean {
  const trimmed = text.trim()
  if (!isMostlyEnglishProse(trimmed)) return false
  if (REQUEST_DUMP_PROSE_RE.test(trimmed)) return true
  return (
    FIRST_PERSON_DUMP_PROSE_RE.test(trimmed)
    || LEGACY_FIRST_PERSON_DUMP_PROSE_RE.test(trimmed)
  ) && DUMP_CONTEXT_RE.test(trimmed)
}

function looksLikeThoughtDumpBlock(block: string): boolean {
  const trimmed = block.trim()
  if (!trimmed || hasSubstantiveCjk(trimmed)) return false
  const firstLine = trimmed.split("\n").find((line) => line.trim()) ?? ""
  if (isThoughtDumpHeader(firstLine)) return true
  return isEnglishDumpProse(trimmed)
}

function isDumpContinuationBlock(block: string): boolean {
  return looksLikeThoughtDumpBlock(block) || isMostlyEnglishProse(block)
}

function splitParagraphs(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split(/\n{2,}/)
}

export function isThoughtDumpText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  const parts = splitParagraphs(trimmed)
  if (!looksLikeThoughtDumpBlock(parts[0] ?? "")) return false
  const hasThoughtHeader = trimmed.split("\n").some((line) => isThoughtDumpHeader(line))
  if (parts.length === 1 && !hasThoughtHeader && !/[.!?][\"')\]]?$/.test(trimmed)) {
    // Do not drop an unfinished SSE fragment. Its continuation may contain the
    // only boundary between the thought summary and the requested content.
    return false
  }
  return parts.slice(1).every((part) => isDumpContinuationBlock(part))
}

function isLeadingDumpParagraph(block: string, alreadyInDump: boolean): boolean {
  if (looksLikeThoughtDumpBlock(block)) return true
  return alreadyInDump && isMostlyEnglishProse(block)
}

function stripLeadingThoughtDumpDense(text: string): string {
  const trimmed = text.trim()
  const firstLine = trimmed.split("\n").find((line) => line.trim()) ?? ""
  if (!isThoughtDumpHeader(firstLine) && !isEnglishDumpProse(firstLine)) {
    return trimmed
  }

  const lines = text.split("\n")
  const firstBodyLine = lines.findIndex((line) => hasSubstantiveCjk(line))
  if (firstBodyLine < 0) {
    return isThoughtDumpText(text) ? "" : trimmed
  }

  let keepFrom = firstBodyLine
  while (keepFrom > 0 && !lines[keepFrom - 1]!.trim()) keepFrom -= 1
  const prefix = lines.slice(0, keepFrom).join("\n")
  if (!prefix.trim() || !isThoughtDumpText(prefix)) {
    return trimmed
  }
  return lines.slice(keepFrom).join("\n").trim()
}

export function stripThoughtDumpFromText(text: string): string {
  if (!text) return text
  const normalized = text.replace(/\r\n?/g, "\n")
  const parts = splitParagraphs(normalized)

  let start = 0
  let inDump = false
  while (start < parts.length && isLeadingDumpParagraph(parts[start]!, inDump)) {
    inDump = true
    start += 1
  }
  let end = parts.length
  inDump = false
  while (end > start) {
    const block = parts[end - 1]!
    if (looksLikeThoughtDumpBlock(block) || (inDump && isMostlyEnglishProse(block))) {
      inDump = true
      end -= 1
      continue
    }
    break
  }

  if (start >= end) return ""
  if (start === 0 && end === parts.length) {
    return stripLeadingThoughtDumpDense(normalized)
  }
  return parts.slice(start, end).join("\n\n").trim()
}
