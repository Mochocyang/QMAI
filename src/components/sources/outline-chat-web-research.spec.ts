import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(__dirname, "../../..")

describe("outline chat web research wiring", () => {
  it("injects controlled web research into outline chat when the user asks for it", () => {
    const source = readFileSync(resolve(root, "src/components/sources/outline-chat-panel.tsx"), "utf8")

    expect(source).toContain("shouldUseWebResearch(prompt)")
    expect(source).toContain("collectWebResearch")
    expect(source).toContain("buildWebResearchContext")
    expect(source).toContain("webResearchContext.markdown")
    expect(source).toContain("webResearchContext.sources")
  })
})
