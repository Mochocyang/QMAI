import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "knowledge-tree.tsx"), "utf8")

describe("knowledge-tree chapter format", () => {
  it("renders chapter word count aligned to the right without showing chapter status", () => {
    expect(source).toContain("wordCountLabel")
    expect(source).not.toContain("page.statusLabel")
    expect(source).toContain("page.wordCountLabel")
    expect(source).toContain("justify-between")
    expect(source).toContain("text-right")
  })
})
