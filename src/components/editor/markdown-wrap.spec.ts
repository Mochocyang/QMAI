import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("markdown preview wrapping", () => {
  it("file preview and wiki reader allow long markdown lines to wrap", () => {
    const filePreviewSource = readFileSync("src/components/editor/file-preview.tsx", "utf8")
    const wikiReaderSource = readFileSync("src/components/editor/wiki-reader.tsx", "utf8")
    const outlineChatSource = readFileSync("src/components/sources/outline-chat-panel.tsx", "utf8")

    expect(filePreviewSource).toContain("overflowWrap: \"anywhere\"")
    expect(wikiReaderSource).toContain("overflowWrap: \"anywhere\"")
    expect(outlineChatSource).toContain("overflowWrap: \"anywhere\"")
    expect(outlineChatSource).toContain("normalizeOutlineMarkdown")
  })
})
