import pangu from "pangu"
import { parseFrontmatter } from "@/lib/frontmatter"

const CJK_MODEL_HYPHEN =
  /(?<=[\p{Script=Han}])-(?=(?=[A-Z0-9-]*\d)[A-Z0-9]+(?:-[A-Z0-9]+)*)/gu
const LOSSY_MIDDLE_DOT = /[·•‧]/gu
const PROTECTED_TEXT_PATTERN = /\uE100(\d+)\uE101/gu

function spacingChapterText(text: string): string {
  const protectedValues: string[] = []
  const protect = (value: string): string => {
    const index = protectedValues.push(value) - 1
    return `\uE100${index}\uE101`
  }

  const protectedText = text
    .replace(LOSSY_MIDDLE_DOT, (value) => protect(value))
    .replace(CJK_MODEL_HYPHEN, () => protect("-"))

  return pangu
    .spacingText(protectedText)
    .replace(PROTECTED_TEXT_PATTERN, (_match, index: string) => protectedValues[Number(index)] ?? "")
}

function isStructuralMarkdownLine(trimmed: string): boolean {
  return /^(#{1,6}\s|>\s|[-*+]\s|\d+\.\s|\|)/.test(trimmed) || /^\s*[-]{3,}\s*$/.test(trimmed)
}

export function formatChapterWriting(markdown: string): string {
  const { rawBlock, body } = parseFrontmatter(markdown)
  const lines = body.split("\n")
  const formatted: string[] = []
  let inFence = false
  let pendingBlank = false
  let lastKind: "normal" | "structural" | "fence" | null = null

  for (const rawLine of lines) {
    const line = rawLine.replace(/[ \t]+$/g, "")
    const trimmed = line.trim()

    if (trimmed.startsWith("```")) {
      if (formatted.length > 0 && pendingBlank && formatted[formatted.length - 1] !== "") {
        formatted.push("")
      }
      formatted.push(trimmed)
      inFence = !inFence
      pendingBlank = false
      lastKind = "fence"
      continue
    }

    if (inFence) {
      formatted.push(line)
      lastKind = "fence"
      continue
    }

    if (!trimmed) {
      pendingBlank = formatted.length > 0
      continue
    }

    if (isStructuralMarkdownLine(trimmed)) {
      if (formatted.length > 0 && pendingBlank && formatted[formatted.length - 1] !== "") {
        formatted.push("")
      }
      formatted.push(trimmed)
      pendingBlank = true
      lastKind = "structural"
      continue
    }

    if (
      formatted.length > 0 &&
      pendingBlank &&
      formatted[formatted.length - 1] !== "" &&
      lastKind !== "normal"
    ) {
      formatted.push("")
    }
    const content = trimmed.replace(/^[　 ]+/, "")
    formatted.push(`　　${spacingChapterText(content)}`)
    pendingBlank = true
    lastKind = "normal"
  }

  while (formatted.length > 0 && formatted[formatted.length - 1] === "") {
    formatted.pop()
  }

  return rawBlock + formatted.join("\n")
}
