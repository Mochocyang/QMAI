import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "soul-view.tsx"), "utf8")

describe("SoulView source", () => {
  it("does not constrain the project soul editor with a narrow centered wrapper", () => {
    expect(source).toContain("<SoulDocEditor />")
    expect(source).not.toContain("max-w-3xl")
    expect(source).not.toContain("mx-auto")
  })
})
