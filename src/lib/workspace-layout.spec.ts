import { describe, expect, it } from "vitest"
import {
  getPreviewContentContainerClass,
  shouldUseCompactChapterToolbar,
} from "./workspace-layout"

describe("workspace layout", () => {
  it("uses the compact chapter toolbar when the preview header is narrow", () => {
    expect(shouldUseCompactChapterToolbar(640)).toBe(true)
    expect(shouldUseCompactChapterToolbar(560)).toBe(true)
  })

  it("shows the full chapter toolbar when there is enough room", () => {
    expect(shouldUseCompactChapterToolbar(920)).toBe(false)
    expect(shouldUseCompactChapterToolbar(1040)).toBe(false)
  })

  it("keeps the outer preview content from scrolling in immersive chapter writing", () => {
    expect(getPreviewContentContainerClass(true)).toContain("overflow-hidden")
  })

  it("keeps the outer preview content scrollable for normal files", () => {
    expect(getPreviewContentContainerClass(false)).toContain("overflow-auto")
  })
})
