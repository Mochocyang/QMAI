import { normalizePath } from "@/lib/path-utils"

export type ChapterDirectoryScrollResult = "selected" | "end" | null

/**
 * Position the chapter directory after its async rows have been rendered.
 * A missing selected row returns null so the caller can retry on the next tree update.
 */
export function scrollChapterDirectory(
  container: HTMLElement,
  selectedChapterPath: string | null,
): ChapterDirectoryScrollResult {
  const viewport = container.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
  if (!viewport) return null

  if (selectedChapterPath) {
    const normalizedSelectedPath = normalizePath(selectedChapterPath)
    const selectedRow = Array.from(
      container.querySelectorAll<HTMLElement>("[data-page-path]"),
    ).find((row) => normalizePath(row.dataset.pagePath ?? "") === normalizedSelectedPath)

    if (!selectedRow) return null

    selectedRow.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" })
    return "selected"
  }

  viewport.scrollTop = viewport.scrollHeight
  return "end"
}
