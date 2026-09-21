import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "outline-action-toolbar.tsx"), "utf8")

describe("OutlineActionToolbar", () => {
  it("toggles the AI outline panel instead of only opening it", () => {
    expect(source).toContain("outlineChatOpen")
    expect(source).toContain("setOutlineChatOpen(!outlineChatOpen)")
    expect(source).toContain('aria-pressed={outlineChatOpen}')
  })

  it("asks whether to extract all or only pending outlines before bulk ingest", () => {
    expect(source).toContain("bulkIngestDialogOpen")
    expect(source).toContain('handleBulkIngest("pending")')
    expect(source).toContain('handleBulkIngest("all")')
    expect(source).toContain('runBulkOutlineIngest(project.path, { mode })')
  })

  it("opens default model settings when the ingest LLM toast is clicked", () => {
    expect(source).toContain("openDefaultModelSettings")
    expect(source).toContain("toast.error(err.message, { onClick: openDefaultModelSettings })")
  })
})
