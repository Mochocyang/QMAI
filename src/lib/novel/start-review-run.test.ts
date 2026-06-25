import { expect, test } from "vitest"
import { resolveReviewChapterTarget } from "./start-review-run"

test("prefers selected chapter file name over stale frontmatter", () => {
  const content = [
    "---",
    "type: chapter",
    "chapter_number: 3",
    'title: "Chapter 3"',
    "---",
    "",
    "# Chapter 2",
    "",
    "Body.",
  ].join("\n")

  const target = resolveReviewChapterTarget(content, "/project/wiki/chapters/chapter-002.md")

  expect(target.chapterNumber).toBe(2)
})
