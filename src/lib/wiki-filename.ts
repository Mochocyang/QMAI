/**
 * Filename generation helpers.
 */

export function makeQuerySlug(title: string): string {
  const slug = title
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 50)
  return slug.length > 0 ? slug : "query"
}

export function makeQueryFileName(
  title: string,
  now: Date = new Date(),
): { slug: string; fileName: string; date: string; time: string } {
  const slug = makeQuerySlug(title)
  const iso = now.toISOString()
  const date = iso.slice(0, 10)
  const time = iso.slice(11, 19).replace(/:/g, "")
  return {
    slug,
    date,
    time,
    fileName: `${slug}-${date}-${time}.md`,
  }
}

export function makeSafeFileSlug(title: string, fallback = "untitled"): string {
  const slug = title
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/[^\p{L}\p{N}._-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
  return slug.length > 0 ? slug : fallback
}

function stripChapterPrefix(title: string): string {
  const normalized = title.normalize("NFKC").trim()
  return normalized
    .replace(/^第\s*(?:\d+|[零〇一二三四五六七八九十百千万两]+)\s*[章节卷回]\s*[-_:：，、.。]?\s*/, "")
    .trim()
}

export function makeDefaultChapterTitle(chapterNumber: number, chapterName = ""): string {
  const normalizedNumber = Math.max(1, Math.trunc(chapterNumber))
  const cleanedName = stripChapterPrefix(chapterName)
  return cleanedName ? `第${normalizedNumber}章-${cleanedName}` : `第${normalizedNumber}章`
}

export function makeChapterFileStem(title: string, chapterNumber?: number | null): string {
  const cleanTitle = title.normalize("NFKC").trim()
  if (typeof chapterNumber === "number" && Number.isFinite(chapterNumber) && chapterNumber > 0) {
    const namePart = stripChapterPrefix(cleanTitle)
    const safeName = namePart ? makeSafeFileSlug(namePart) : ""
    return safeName ? `第${chapterNumber}章-${safeName}` : `第${chapterNumber}章`
  }
  return makeSafeFileSlug(cleanTitle)
}

export function makeChapterFileName(title: string, chapterNumber?: number | null): string {
  return `${makeChapterFileStem(title, chapterNumber)}.md`
}
