import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "search-view.tsx"), "utf8")

describe("search-view search module loading", () => {
  it("does not load heavy search modules when the panel mounts", () => {
    expect(source).not.toMatch(/import\s*\{\s*searchWiki\b/)
    expect(source).not.toMatch(/import\s*\{\s*searchPlot\b/)
    expect(source).toContain("includeVector: false")
    expect(source).toContain("includeGraph: false")
    expect(source).toContain("includeRecentChapters: false")
  })
})
