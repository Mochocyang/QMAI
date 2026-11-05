import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(__dirname, "../../..")

describe("outline chat web research wiring", () => {
  it("prefetches a pasted URL and leaves market search to the model", () => {
    const source = readFileSync(resolve(root, "src/components/sources/outline-chat-panel.tsx"), "utf8")

    expect(source).toContain("shouldUseWebResearch(prompt)")
    expect(source).toContain("allowSearch: false")
    expect(source).toContain("collectWebResearch")
    expect(source).toContain("buildWebResearchContext")
    expect(source).toContain("webResearchContext.markdown")
    expect(source).toContain("webResearchContext.sources")
    expect(source).toContain("禁止把这些查询发给公网")
    expect(source).not.toContain("联网|网页|网址|打开|搜索")
  })
})
