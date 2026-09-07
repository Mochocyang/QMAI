import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "sidebar-panel.tsx"), "utf8")

describe("sidebar-panel outline tree", () => {
  it("uses the outline knowledge tree in novel mode instead of the raw source sidebar", () => {
    expect(source).toContain('filterType={isChapter ? "chapter" : "outline"}')
    expect(source).not.toContain("<SourceSidebar onRequestCreate={beginCreate} />")
  })

  it("wires chapter context-menu send actions into the AI chat reference queue", () => {
    expect(source).toContain("useChatStore")
    expect(source).toContain("handleSendChapterToChat")
    expect(source).toContain("enqueueReferenceTokens")
    expect(source).toContain("setChatExpanded(true)")
    expect(source).toContain("onSendToChat={isChapter ? handleSendChapterToChat : undefined}")
  })

  it("wires outline context-menu send actions into the AI outline reference queue", () => {
    expect(source).toContain("useOutlineChatStore")
    expect(source).toContain("handleSendOutlineToOutlineChat")
    expect(source).toContain("setOutlineChatOpen(true)")
    expect(source).toContain("onSendToOutline={!isChapter ? handleSendOutlineToOutlineChat : undefined}")
  })
})
