import { expect, test } from "vitest"
import { getCopyableAssistantContent } from "./chat-copy-content"

test("copies generated chapter edit content instead of surrounding outline context", () => {
  const content = [
    "大纲：这里是检索到的大纲，不应该复制。",
    "",
    '<file_edit path="wiki/chapters/第3章.md">',
    "<search>",
    "旧章节。",
    "</search>",
    "<replace>",
    "# 第3章",
    "",
    "宋惊蛰停在门口，第一次意识到自己没有退路。",
    "</replace>",
    "</file_edit>",
  ].join("\n")

  const copied = getCopyableAssistantContent(content)

  expect(copied).toContain("宋惊蛰停在门口")
  expect(copied).not.toContain("大纲")
  expect(copied).not.toContain("<file_edit")
})
