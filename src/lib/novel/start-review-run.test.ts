import { expect, test } from "vitest"
import { resolveReviewChapterTarget } from "./start-review-run"

test("prefers the selected chapter file name over stale chapter frontmatter", () => {
  const content = [
    "---",
    "type: chapter",
    "chapter_number: 3",
    'title: "第3章"',
    "---",
    "",
    "# 第2章",
    "",
    "正文。",
  ].join("\n")

  const target = resolveReviewChapterTarget(content, "/project/wiki/chapters/第2章.md")

  expect(target.chapterNumber).toBe(2)
})
