import { describe, expect, it } from "vitest"
import {
  isChapterPathInProject,
  isPathInside,
  normalizeComparablePath,
} from "./path-utils"

describe("path ownership helpers", () => {
  it("normalizes trailing slashes for comparison", () => {
    expect(normalizeComparablePath("C:\\Books\\A\\")).toBe("C:/Books/A")
  })

  it("detects descendant paths without prefix false positives", () => {
    expect(isPathInside("/books/a/wiki/chapters/x.md", "/books/a")).toBe(true)
    expect(isPathInside("/books/ab/wiki/chapters/x.md", "/books/a")).toBe(false)
  })

  it("accepts only chapter markdown under the current project", () => {
    const project = "D:/novels/有钱以后"
    expect(
      isChapterPathInProject("D:\\novels\\有钱以后\\wiki\\chapters\\第001章.md", project),
    ).toBe(true)
    expect(
      isChapterPathInProject("D:/novels/其他书/wiki/chapters/第212章.md", project),
    ).toBe(false)
    expect(
      isChapterPathInProject("D:/novels/有钱以后/wiki/outlines/大纲.md", project),
    ).toBe(false)
    expect(
      isChapterPathInProject("D:/novels/有钱以后/wiki/chapters/notes.txt", project),
    ).toBe(false)
  })
})
