import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const sidebarSource = readFileSync(resolve(__dirname, "sidebar-panel.tsx"), "utf8")
const previewSource = readFileSync(resolve(__dirname, "preview-panel.tsx"), "utf8")
const chatSource = readFileSync(resolve(__dirname, "../chat/chat-panel.tsx"), "utf8")
const outlineChatSource = readFileSync(resolve(__dirname, "../sources/outline-chat-panel.tsx"), "utf8")

describe("workspace top bars", () => {
  it("uses one fixed height for the chapter sidebar, editor toolbar, AI chat and outline chat headers", () => {
    expect(sidebarSource).toContain('className="flex h-12 shrink-0 items-center justify-between border-b px-3"')
    expect(previewSource).toContain('className="flex h-12 shrink-0 items-center border-b px-3"')
    expect(chatSource).toContain('className="flex h-12 shrink-0 items-center gap-2 border-b bg-muted/20 px-2"')
    expect(outlineChatSource).toContain('className="flex h-12 shrink-0 items-center gap-2 border-b bg-muted/20 px-2"')
  })

  it("does not keep the total word count in the chapter sidebar header", () => {
    expect(sidebarSource).not.toContain("buildChapterTotalWordCountLabel(sidebarTotalWordCount)")
    expect(sidebarSource).toContain('className="flex min-w-0 items-center gap-1.5 text-sm font-semibold"')
  })
})
