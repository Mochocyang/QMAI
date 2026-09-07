import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const sidebarSource = readFileSync(resolve(__dirname, "review-center-sidebar-panel.tsx"), "utf8")
const reviewViewSource = readFileSync(resolve(__dirname, "../review/review-view.tsx"), "utf8")
const reviewCenterViewSource = readFileSync(resolve(__dirname, "../review/review-center-view.tsx"), "utf8")

describe("review-center-sidebar-panel", () => {
  it("keeps the chapter target selector available", () => {
    expect(sidebarSource).toContain('t("reviewCenter.chapterTarget")')
    expect(sidebarSource).toContain("selectedReviewFilePath")
    expect(sidebarSource).toContain("<select")
  })

  it("builds labels from chapter content without re-prefixing chapter numbers", () => {
    expect(sidebarSource).toContain("parseFrontmatter")
    expect(sidebarSource).toContain("const baseTitle = fmTitle || headingTitle")
    expect(sidebarSource).not.toContain('`第${meta.chapterNumber}章-')
  })

  it("keeps per-dimension navigation buttons", () => {
    expect(sidebarSource).toContain("SIX_DIMENSIONS.map")
    expect(sidebarSource).toContain("setSelectedReviewDimension(dim.key)")
  })

  it("reuses the shared review start helpers", () => {
    expect(reviewCenterViewSource).toContain("startSixDimensionReviewRun({")
    expect(reviewViewSource).toContain("startNovelReviewRun({")
  })

  it("switches dimension when clicking a dimension row", () => {
    expect(sidebarSource).toContain("setSelectedReviewDimension(dim.key)")
  })
})
