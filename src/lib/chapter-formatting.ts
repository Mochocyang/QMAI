import { parseFrontmatter } from "@/lib/frontmatter"

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
    formatted.push(`　　${trimmed.replace(/^[　 ]+/, "")}`)
    pendingBlank = true
    lastKind = "normal"
  }

  while (formatted.length > 0 && formatted[formatted.length - 1] === "") {
    formatted.pop()
  }

  return rawBlock + formatted.join("\n")
}
