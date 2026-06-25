export interface ChatEditTarget {
  chapterNumbers: number[]
  mode: "single" | "batch"
}

export interface ParsedChapterEditFile {
  chapterNumber: number
  content: string
}

export function isChatEditRequest(userRequest: string): boolean {
  const compact = userRequest.replace(/\s+/g, "")
  return /修改|润色|重写|改写|优化/.test(compact)
}

export function resolveChatEditTarget(input: {
  userRequest: string
  selectedChapterNumber: number | null
}): { ok: true; target: ChatEditTarget } | { ok: false; message: string } {
  const compact = input.userRequest.replace(/\s+/g, "")
  const selected = input.selectedChapterNumber

  const explicitChapterMatch = compact.match(/第(\d+)章/)
  if (explicitChapterMatch?.[1]) {
    const chapterNumber = Number.parseInt(explicitChapterMatch[1], 10)
    return {
      ok: true,
      target: {
        chapterNumbers: [chapterNumber],
        mode: "single",
      },
    }
  }

  if (/第?一章/.test(compact)) {
    return {
      ok: true,
      target: {
        chapterNumbers: [1],
        mode: "single",
      },
    }
  }

  if (/前10章|前十章/.test(compact)) {
    if (!selected) {
      return { ok: false, message: "请先选择要修改的章节。" }
    }
    const start = Math.max(1, selected - 9)
    return {
      ok: true,
      target: {
        chapterNumbers: Array.from({ length: selected - start + 1 }, (_, index) => start + index),
        mode: "batch",
      },
    }
  }

  if (/这章|这一章|当前章节|修改/.test(compact)) {
    if (!selected) {
      return { ok: false, message: "请先选择要修改的章节。" }
    }
    return {
      ok: true,
      target: {
        chapterNumbers: [selected],
        mode: "single",
      },
    }
  }

  if (!selected) {
    return { ok: false, message: "请先选择要修改的章节。" }
  }

  return {
    ok: true,
    target: {
      chapterNumbers: [selected],
      mode: "single",
    },
  }
}

export function parseStructuredChapterEdits(content: string): Map<number, string> {
  const normalized = content.replace(/\r\n?/g, "\n").trim()
  const sections = normalized.split(/(?=【第\d+章】)/g).map((section) => section.trim()).filter(Boolean)
  const result = new Map<number, string>()

  for (const section of sections) {
    const match = section.match(/^【第(\d+)章】\n?([\s\S]*)$/)
    if (!match?.[1]) continue
    const chapterNumber = Number.parseInt(match[1], 10)
    const body = (match[2] ?? "").trim()
    if (!body) continue
    result.set(chapterNumber, body)
  }

  return result
}

export function validateStructuredChapterEditResult(input: {
  content: string
  targetChapterNumbers: number[]
}): { ok: true; files: ParsedChapterEditFile[] } | { ok: false; message: string } {
  const parsed = parseStructuredChapterEdits(input.content)
  if (parsed.size !== input.targetChapterNumbers.length) {
    return {
      ok: false,
      message: "修改结果章节数量与目标章节数量不一致，已停止写回。",
    }
  }

  const files: ParsedChapterEditFile[] = []
  for (const chapterNumber of input.targetChapterNumbers) {
    const content = parsed.get(chapterNumber)?.trim()
    if (!content) {
      return {
        ok: false,
        message: `第${chapterNumber}章缺少修改结果，已停止写回。`,
      }
    }
    files.push({ chapterNumber, content })
  }

  return { ok: true, files }
}
