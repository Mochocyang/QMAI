import { describe, expect, it } from "vitest"
import { buildChapterWordCountLabel } from "./chapter-display"

describe("buildChapterWordCountLabel", () => {
  it("formats the word count label in Chinese", () => {
    expect(buildChapterWordCountLabel(12345)).toBe("12345字")
  })
})