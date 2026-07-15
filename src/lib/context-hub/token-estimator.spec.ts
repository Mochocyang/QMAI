import { describe, expect, it } from "vitest"
import { estimateContextTokens } from "./token-estimator"

describe("estimateContextTokens", () => {
  it("counts CJK characters conservatively", () => {
    expect(estimateContextTokens("测试")).toBe(2)
  })

  it("groups ASCII characters in fours", () => {
    expect(estimateContextTokens("abcd")).toBe(1)
    expect(estimateContextTokens("abcde")).toBe(2)
  })

  it("is deterministic for mixed content", () => {
    expect(estimateContextTokens("测试abcd")).toBe(3)
    expect(estimateContextTokens("测试abcd")).toBe(estimateContextTokens("测试abcd"))
  })
})
