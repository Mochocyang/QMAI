// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { scrollChapterDirectory } from "./chapter-directory-scroll"

function createDirectory() {
  const viewport = document.createElement("div")
  viewport.dataset.slot = "scroll-area-viewport"
  Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 1200 })

  const container = document.createElement("div")
  const firstRow = document.createElement("div")
  firstRow.dataset.pagePath = "C:/Novel/wiki/chapters/第1章.md"
  const currentRow = document.createElement("div")
  currentRow.dataset.pagePath = "C:/Novel/wiki/chapters/第80章.md"
  currentRow.scrollIntoView = vi.fn()

  container.append(firstRow, currentRow)
  viewport.append(container)

  return { viewport, container, currentRow }
}

describe("scrollChapterDirectory", () => {
  it("scrolls the restored current chapter into the center", () => {
    const { viewport, container, currentRow } = createDirectory()

    const result = scrollChapterDirectory(
      container,
      "C:\\Novel\\wiki\\chapters\\第80章.md",
    )

    expect(result).toBe("selected")
    expect(currentRow.scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
      inline: "nearest",
    })
    expect(viewport.scrollTop).toBe(0)
  })

  it("scrolls to the end when no chapter is open", () => {
    const { viewport, container } = createDirectory()

    expect(scrollChapterDirectory(container, null)).toBe("end")
    expect(viewport.scrollTop).toBe(1200)
  })

  it("waits for a selected chapter row instead of falling back to the end", () => {
    const { viewport, container } = createDirectory()

    expect(scrollChapterDirectory(
      container,
      "C:/Novel/wiki/chapters/第100章.md",
    )).toBeNull()
    expect(viewport.scrollTop).toBe(0)
  })
})
