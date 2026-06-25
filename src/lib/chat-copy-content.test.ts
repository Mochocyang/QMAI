import { expect, test } from "vitest"
import { getCopyableAssistantContent } from "./chat-copy-content"

test("copies generated chapter edit content instead of surrounding context", () => {
  const content = [
    "Outline context that should not be copied.",
    "",
    '<file_edit path="wiki/chapters/chapter-003.md">',
    "<search>",
    "Old chapter text.",
    "</search>",
    "<replace>",
    "# Chapter 3",
    "",
    "The usable chapter body starts here.",
    "</replace>",
    "</file_edit>",
  ].join("\n")

  const copied = getCopyableAssistantContent(content)

  expect(copied).toContain("The usable chapter body starts here.")
  expect(copied).not.toContain("Outline context")
  expect(copied).not.toContain("<file_edit")
})
