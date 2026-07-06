import { describe, expect, it } from "vitest"
import {
  getPreviewContentContainerClass,
  splitConversationToolbarItems,
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

  it("keeps active, working, and today's conversations in the top toolbar and moves the rest to history", () => {
    const today = Date.now()
    const yesterday = today - 24 * 60 * 60 * 1000
    const conversations = [
      { id: "old", updatedAt: yesterday },
      { id: "today-1", updatedAt: today - 1000 },
      { id: "today-2", updatedAt: today - 2000 },
      { id: "working", updatedAt: yesterday + 1000 },
      { id: "active", updatedAt: yesterday + 2000 },
    ]

    const result = splitConversationToolbarItems(
      conversations,
      "active",
      (id) => id === "working",
    )

    expect(result.topConversations.map((item) => item.id)).toEqual(["active", "working", "today-1"])
    expect(result.historyConversations.map((item) => item.id)).toContain("today-2")
    expect(result.historyConversations.map((item) => item.id)).toContain("old")
  })
})
