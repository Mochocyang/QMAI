type MarkdownQualityIssueCode =
  | "whole-document-code-fence"
  | "missing-title"
  | "unpaired-bold"
  | "missing-table-separator"

export interface MarkdownQualityIssue {
  code: MarkdownQualityIssueCode
  message: string
}

export interface MarkdownQualityInspection {
  valid: boolean
  issues: MarkdownQualityIssue[]
}

const TABLE_SEPARATOR_CELL = /^:?-{3,}:?$/

function normalizeMarkdown(content: string): string {
  return content.replace(/\r\n?/g, "\n").trim()
}

function splitWholeDocumentFence(content: string): {
  fenced: boolean
  body: string
} {
  const normalized = normalizeMarkdown(content)
  const lines = normalized.split("\n")
  if (
    lines.length >= 3
    && /^```[\w-]*\s*$/.test(lines[0] ?? "")
    && /^```\s*$/.test(lines[lines.length - 1] ?? "")
  ) {
    return { fenced: true, body: lines.slice(1, -1).join("\n").trim() }
  }
  return { fenced: false, body: normalized }
}

export function isWholeDocumentMarkdownFence(content: string): boolean {
  const lines = normalizeMarkdown(content).split("\n")
  return lines.length >= 3
    && /^```(?:markdown|md)\s*$/i.test(lines[0] ?? "")
    && /^```\s*$/.test(lines[lines.length - 1] ?? "")
}

function markdownCodeMask(content: string): boolean[] {
  const mask = Array.from({ length: content.length }, () => false)
  let offset = 0
  let fenceMarker = ""
  for (const lineWithNewline of content.match(/.*(?:\n|$)/g) ?? []) {
    if (!lineWithNewline) continue
    const line = lineWithNewline.endsWith("\n")
      ? lineWithNewline.slice(0, -1)
      : lineWithNewline
    const openingFence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? ""
    if (fenceMarker) {
      const trimmed = line.trim()
      const markerCharacter = fenceMarker[0] ?? ""
      const isClosingFence = trimmed.length >= fenceMarker.length
        && Array.from(trimmed).every((character) => character === markerCharacter)
      for (let index = offset; index < offset + lineWithNewline.length; index += 1) {
        mask[index] = true
      }
      if (isClosingFence) fenceMarker = ""
      offset += lineWithNewline.length
      continue
    }
    if (openingFence) {
      for (let index = offset; index < offset + lineWithNewline.length; index += 1) {
        mask[index] = true
      }
      fenceMarker = openingFence
      offset += lineWithNewline.length
      continue
    }

    let cursor = 0
    while (cursor < line.length) {
      if (line[cursor] !== "`") {
        cursor += 1
        continue
      }
      let markerLength = 1
      while (line[cursor + markerLength] === "`") markerLength += 1
      const marker = "`".repeat(markerLength)
      const closeIndex = line.indexOf(marker, cursor + markerLength)
      const end = closeIndex < 0 ? line.length : closeIndex + markerLength
      for (let index = offset + cursor; index < offset + end; index += 1) {
        mask[index] = true
      }
      cursor = end
    }
    offset += lineWithNewline.length
  }
  return mask
}

function boldMarkerIndices(content: string): number[] {
  const codeMask = markdownCodeMask(content)
  const indices: number[] = []
  for (let index = 0; index < content.length - 1; index += 1) {
    if (codeMask[index] || codeMask[index + 1]) continue
    if (content[index] !== "*" || content[index + 1] !== "*") continue
    if (content[index - 1] === "\\" || content[index + 2] === "/") continue
    indices.push(index)
    index += 1
  }
  return indices
}

function tableCells(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null

  const body = trimmed.slice(1, -1)
  const cells: string[] = []
  let current = ""
  let inlineCodeMarkerLength = 0
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] ?? ""
    if (character === "`") {
      let markerLength = 1
      while (body[index + markerLength] === "`") markerLength += 1
      let precedingBackslashes = 0
      for (let cursor = index - 1; cursor >= 0 && body[cursor] === "\\"; cursor -= 1) {
        precedingBackslashes += 1
      }
      if (precedingBackslashes % 2 === 0) {
        if (inlineCodeMarkerLength === 0) inlineCodeMarkerLength = markerLength
        else if (inlineCodeMarkerLength === markerLength) inlineCodeMarkerLength = 0
      }
      current += "`".repeat(markerLength)
      index += markerLength - 1
      continue
    }
    if (character === "|" && inlineCodeMarkerLength === 0) {
      let precedingBackslashes = 0
      for (let cursor = index - 1; cursor >= 0 && body[cursor] === "\\"; cursor -= 1) {
        precedingBackslashes += 1
      }
      if (precedingBackslashes % 2 === 0) {
        cells.push(current.trim())
        current = ""
        continue
      }
    }
    current += character
  }
  cells.push(current.trim())
  return cells.length >= 2 ? cells : null
}

function isTableSeparator(line: string, expectedCells?: number): boolean {
  const cells = tableCells(line)
  return Boolean(
    cells
    && (expectedCells === undefined || cells.length === expectedCells)
    && cells.every((cell) => TABLE_SEPARATOR_CELL.test(cell)),
  )
}

function hasMissingTableSeparator(content: string): boolean {
  const lines = content.split("\n")
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerCells = tableCells(lines[index] ?? "")
    const nextCells = tableCells(lines[index + 1] ?? "")
    if (
      headerCells
      && tableCells(lines[index - 1] ?? "") === null
      && !isTableSeparator(lines[index] ?? "", headerCells.length)
      && nextCells
      && headerCells.length === nextCells.length
      && !isTableSeparator(lines[index + 1] ?? "", headerCells.length)
    ) {
      return true
    }
  }
  return false
}

export function isStructuredMarkdownMaterial(content: string): boolean {
  const body = splitWholeDocumentFence(content).body
  const lines = body.split("\n")
  const hasHeading = lines.some((line) => /^#{1,6}\s+\S/.test(line.trim()))
  const listLineCount = lines.filter((line) => /^\s*(?:[-*+] |\d+[.)]\s+)/.test(line)).length
  const tableLineCount = lines.filter((line) => tableCells(line) !== null).length
  const boldLabelCount = lines.filter((line) => /\*\*[^*\n]+\*\*/.test(line)).length
  const evidenceCount = Number(hasHeading) + Number(listLineCount >= 2)
    + Number(tableLineCount >= 2) + Number(boldLabelCount >= 2)
  return evidenceCount >= 2 || listLineCount >= 2 || tableLineCount >= 2
}

export function inspectStructuredMarkdown(content: string): MarkdownQualityInspection {
  const fenced = splitWholeDocumentFence(content)
  const issues: MarkdownQualityIssue[] = []
  if (fenced.fenced) {
    issues.push({ code: "whole-document-code-fence", message: "不要使用代码围栏包裹全文" })
  }
  if (!/^#\s+\S/m.test(fenced.body)) {
    issues.push({ code: "missing-title", message: "缺少一级标题" })
  }
  const boldMarkerCount = boldMarkerIndices(fenced.body).length
  if (boldMarkerCount % 2 !== 0) {
    issues.push({ code: "unpaired-bold", message: "存在未成对的加粗标记" })
  }
  if (hasMissingTableSeparator(fenced.body)) {
    issues.push({ code: "missing-table-separator", message: "Markdown 表格缺少分隔行" })
  }
  return { valid: issues.length === 0, issues }
}

function repairTitle(content: string): string {
  if (/^#\s+\S/m.test(content)) return content
  const lines = content.split("\n")
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0)
  if (firstContentIndex < 0) return "# 结构化资料"
  const firstLine = lines[firstContentIndex]?.trim() ?? ""
  if (/^#{2,6}\s+\S/.test(firstLine)) {
    lines[firstContentIndex] = firstLine.replace(/^#{2,6}/, "#")
    return lines.join("\n")
  }
  if (
    firstLine.length <= 80
    && !/^\s*(?:[-*+] |\d+[.)]\s+)/.test(firstLine)
    && tableCells(firstLine) === null
  ) {
    lines[firstContentIndex] = `# ${firstLine}`
    return lines.join("\n")
  }
  return `# 结构化资料\n\n${content}`
}

function repairUnpairedBold(content: string): string {
  const markerIndices = boldMarkerIndices(content)
  if (markerIndices.length % 2 === 0) return content
  const lastMarkerIndex = markerIndices[markerIndices.length - 1]
  if (lastMarkerIndex === undefined) return content
  return `${content.slice(0, lastMarkerIndex)}${content.slice(lastMarkerIndex + 2)}`
}

function repairTableSeparators(content: string): string {
  const lines = content.split("\n")
  const repaired: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    repaired.push(line)
    const headerCells = tableCells(line)
    const nextCells = tableCells(lines[index + 1] ?? "")
    if (
      headerCells
      && tableCells(lines[index - 1] ?? "") === null
      && !isTableSeparator(line, headerCells.length)
      && nextCells
      && headerCells.length === nextCells.length
      && !isTableSeparator(lines[index + 1] ?? "", headerCells.length)
    ) {
      repaired.push(`| ${headerCells.map(() => "---").join(" | ")} |`)
    }
  }
  return repaired.join("\n")
}

export function repairStructuredMarkdownLocally(content: string): string {
  const body = splitWholeDocumentFence(content).body
  return repairTableSeparators(repairUnpairedBold(repairTitle(body))).trim()
}

function realTableSeparatorIndices(
  lines: string[],
  codeLines: Set<number>,
): Set<number> {
  const indices = new Set<number>()
  for (let index = 1; index < lines.length - 1; index += 1) {
    if (codeLines.has(index - 1) || codeLines.has(index) || codeLines.has(index + 1)) {
      continue
    }
    const separatorCells = tableCells(lines[index] ?? "")
    const headerCells = tableCells(lines[index - 1] ?? "")
    const dataCells = tableCells(lines[index + 1] ?? "")
    if (
      separatorCells
      && headerCells
      && dataCells
      && separatorCells.length === headerCells.length
      && separatorCells.length === dataCells.length
      && isTableSeparator(lines[index] ?? "", separatorCells.length)
    ) {
      indices.add(index)
    }
  }
  return indices
}

function markdownCodeLineIndices(_content: string, lines: string[]): Set<number> {
  const codeLines = new Set<number>()
  let fenceMarker = ""
  lines.forEach((line, index) => {
    const openingFence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? ""
    if (fenceMarker) {
      codeLines.add(index)
      const trimmed = line.trim()
      const markerCharacter = fenceMarker[0] ?? ""
      const isClosingFence = trimmed.length >= fenceMarker.length
        && Array.from(trimmed).every((character) => character === markerCharacter)
      if (isClosingFence) fenceMarker = ""
      return
    }
    if (openingFence) {
      codeLines.add(index)
      fenceMarker = openingFence
    }
  })
  return codeLines
}

function protectMarkdownCode(content: string): string {
  const mask = markdownCodeMask(content)
  let protectedContent = ""
  let index = 0
  while (index < content.length) {
    if (!mask[index]) {
      protectedContent += content[index]
      index += 1
      continue
    }
    let end = index + 1
    while (end < content.length && mask[end]) end += 1
    const encoded = Array.from(content.slice(index, end))
      .map((character) => character.codePointAt(0)?.toString(16) ?? "")
      .join(".")
    protectedContent += `\uE000${encoded}\uE001`
    index = end
  }
  return protectedContent
}

function removeRecognizedBoldMarkers(content: string): string {
  const markerStarts = new Set(boldMarkerIndices(content))
  let result = ""
  for (let index = 0; index < content.length; index += 1) {
    if (markerStarts.has(index)) {
      index += 1
      continue
    }
    result += content[index]
  }
  return result
}

function normalizeMarkdownContentForIntegrity(content: string): string {
  const body = isWholeDocumentMarkdownFence(content)
    ? splitWholeDocumentFence(content).body
    : normalizeMarkdown(content)
  const lines = body.split("\n")
  const codeLines = markdownCodeLineIndices(body, lines)
  const tableSeparators = realTableSeparatorIndices(lines, codeLines)
  const withoutTableSeparators = lines
    .filter((_, index) => !tableSeparators.has(index))
    .join("\n")
  return removeRecognizedBoldMarkers(protectMarkdownCode(withoutTableSeparators))
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+] |\d+[.)]\s+|>\s*)/gm, "")
    .replace(/\s+/g, "")
}

export function hasMarkdownContentChanged(
  original: string,
  candidate: string,
): boolean {
  return normalizeMarkdownContentForIntegrity(original)
    !== normalizeMarkdownContentForIntegrity(candidate)
}

