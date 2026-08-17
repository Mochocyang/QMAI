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
 * Standard/strict chapter workflows concatenate every `onToken` into the
 * chapter body, so those English planning notes leak into the editor.
 * Strip them; do not treat Title-Case markdown headers as story text.
 */

const CJK_RE = /[\u4e00-\u9fff]/
const DUMP_HEADER_RE = /^\*\*([^*]+)\*\*\s*$/
const DUMP_PROSE_RE =
  /^(The user (wants|is asking|requested|needs|has asked)|I need to|I'll |I will |Let's |Let me |The request\b|The goal\b|The task\b)/i

export function isThoughtDumpHeader(line: string): boolean {
  const match = line.trim().match(DUMP_HEADER_RE)
  if (!match) return false
  const inner = match[1].trim()
  if (!inner || CJK_RE.test(inner)) return false
  if (!/^[A-Za-z]/.test(inner)) return false
  if (inner.length < 3 || inner.length > 80) return false
  if (!/^[A-Za-z0-9 ,:'\-()/]+$/.test(inner)) return false
  const words = inner.split(/\s+/).filter(Boolean)
  if (words.length === 0) return false
  if (words.length === 1) return /^[A-Z][a-z]+/.test(words[0] ?? "")
  const capitalized = words.filter((word) => /^[A-Z]/.test(word)).length
  return capitalized >= Math.ceil(words.length * 0.5)
}

function isEnglishDumpProse(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || CJK_RE.test(trimmed)) return false
  return DUMP_PROSE_RE.test(trimmed)
}

function isMostlyEnglishProse(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || CJK_RE.test(trimmed)) return false
  const letters = trimmed.match(/[A-Za-z]/g)?.length ?? 0
  const nonSpace = trimmed.replace(/\s/g, "").length
  return letters >= 12 && letters / Math.max(nonSpace, 1) >= 0.7
}

export function looksLikeThoughtDumpBlock(block: string): boolean {
  const trimmed = block.trim()
  if (!trimmed || CJK_RE.test(trimmed)) return false
  const firstLine = trimmed.split("\n")[0] ?? ""
  if (isThoughtDumpHeader(firstLine)) return true
  return isEnglishDumpProse(trimmed)
}

export function isThoughtDumpText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || CJK_RE.test(trimmed)) return false
  if (looksLikeThoughtDumpBlock(trimmed)) return true
  const headerCount = trimmed.split("\n").filter((line) => isThoughtDumpHeader(line)).length
  return headerCount >= 2
}

function isLeadingDumpParagraph(block: string, alreadyInDump: boolean): boolean {
  if (looksLikeThoughtDumpBlock(block)) return true
  return alreadyInDump && isMostlyEnglishProse(block)
}

function stripLeadingThoughtDumpDense(text: string): string {
  if (!/^\s*\*\*[A-Za-z]/.test(text) && !DUMP_PROSE_RE.test(text.trim())) {
    return text.trim()
  }

  const lines = text.split("\n")
  const firstCjk = lines.findIndex((line) => CJK_RE.test(line))
  if (firstCjk < 0) {
    return isThoughtDumpText(text) || isMostlyEnglishProse(text) ? "" : text.trim()
  }

  let keepFrom = firstCjk
  while (keepFrom > 0 && !lines[keepFrom - 1]!.trim()) keepFrom -= 1
  const prefix = lines.slice(0, keepFrom).join("\n")
  if (!prefix.trim()) return text.trim()
  if (!isThoughtDumpText(prefix) && !looksLikeThoughtDumpBlock(prefix)) {
    return text.trim()
  }
  return lines.slice(keepFrom).join("\n").trim()
}

export function stripThoughtDumpFromText(text: string): string {
  if (!text) return text
  const normalized = text.replace(/\r\n?/g, "\n")
  const parts = normalized.split(/\n{2,}/)

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

  if (start >= end) {
    return stripLeadingThoughtDumpDense(normalized)
  }
  if (start === 0 && end === parts.length) {
    return stripLeadingThoughtDumpDense(normalized)
  }
  return parts.slice(start, end).join("\n\n").trim()
}
