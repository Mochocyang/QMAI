import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "App.tsx"), "utf8")

describe("App search mode", () => {
  it("no longer wires standalone search-window bootstrap into the app entry", () => {
    expect(source).not.toContain("getSearchWindowContextFromLocation")
    expect(source).not.toContain("SearchWindowView")
    expect(source).not.toContain("SEARCH_OPEN_FILE_EVENT")
  })
})
