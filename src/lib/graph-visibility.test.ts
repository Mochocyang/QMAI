import { describe, expect, it } from "vitest"
import { shouldHideNodeType } from "./graph-visibility"

describe("graph visibility helpers", () => {
  it("hides nodes whose type is selected in the legend", () => {
    const hidden = new Set(["source", "query"])

    expect(shouldHideNodeType("source", hidden)).toBe(true)
    expect(shouldHideNodeType("entity", hidden)).toBe(false)
  })

  it("does not hide nodes with missing type metadata", () => {
    expect(shouldHideNodeType(undefined, new Set(["source"]))).toBe(false)
  })
})
