function stripThinkingBlocks(content: string): string {
  return content
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .replace(/<think(?:ing)?>[\s\S]*$/gi, "")
}

function stripLeadingMeta(lines: string[]): string[] {
  let index = 0

  while (index < lines.length && !lines[index].trim()) index += 1

  if (/^#{1,6}\s*第\s*\d+\s*章/.test(lines[index]?.trim() ?? "")) {
    index += 1
  }

  while (index < lines.length && !lines[index].trim()) index += 1

  while (/^>\s*/.test(lines[index]?.trim() ?? "")) {
    index += 1
  }

  while (index < lines.length && !lines[index].trim()) index += 1

  if (/^[-*_]{3,}$/.test(lines[index]?.trim() ?? "")) {
    index += 1
  }

  return lines.slice(index)
}

function stripTrailingAssistantOffer(lines: string[]): string[] {
  const offerIndex = lines.findIndex((line) =>
    /(如果你愿意|我也可以|需要的话).*(继续|下一章|第\s*\d+\s*章|为你写)/.test(line),
  )
  return offerIndex >= 0 ? lines.slice(0, offerIndex) : lines
}

function stripCitationSyntax(content: string): string {
  return content
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\[\d+\]:\s+.*$/gm, "")
    .replace(/\[\[[^\]]+?\]\]\s*\[\d+\]/g, "")
    .replace(/\[\[[^\]]+?\]\]/g, "")
    .replace(/\[(?:\d+(?:\s*,\s*\d+)*)\]/g, "")
}

export function cleanGeneratedChapterContentForSave(content: string): string {
  const withoutThinking = stripThinkingBlocks(content).replace(/\r\n?/g, "\n")
  const withoutCitations = stripCitationSyntax(withoutThinking)
  const lines = stripTrailingAssistantOffer(stripLeadingMeta(withoutCitations.split("\n")))

  const cleaned = lines
    .join("\n")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    .replace(/\s+([，。！？；：、,.!?;:])/g, "$1")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")

  return cleaned
    .split("\n")
    .filter((line, index, all) => {
      if (line.trim()) return true
      const hasBefore = all.slice(0, index).some((item) => item.trim())
      const hasAfter = all.slice(index + 1).some((item) => item.trim())
      return hasBefore && hasAfter
    })
    .join("\n")
}
