import { describe, expect, it } from "vitest"
import {
  findAllMatches,
  findInitialMatchIndex,
  findNextMatchIndex,
  findPrevMatchIndex,
  buildFindHighlightParts,
} from "./textarea-find"

describe("textarea-find", () => {
  it("collects all matches in order", () => {
    expect(findAllMatches("abcabc", "abc")).toEqual([0, 3])
    expect(findAllMatches("Hello hello", "hello", { caseSensitive: false })).toEqual([0, 6])
    expect(findAllMatches("Hello hello", "HELLO", { caseSensitive: false })).toEqual([0, 6])
  })

  it("returns empty matches for empty query", () => {
    expect(findAllMatches("abc", "")).toEqual([])
  })

  it("finds initial match at or after cursor", () => {
    const matches = findAllMatches("abcabc", "abc")
    expect(findInitialMatchIndex(matches, 0)).toBe(0)
    expect(findInitialMatchIndex(matches, 1)).toBe(1)
    expect(findInitialMatchIndex(matches, 4)).toBe(0)
  })

  it("wraps initial match to first result when cursor is after last match", () => {
    const matches = findAllMatches("abcabc", "abc")
    expect(findInitialMatchIndex(matches, 6)).toBe(0)
  })

  it("finds next and previous matches with wrap", () => {
    const matches = findAllMatches("abcabc", "abc")
    expect(findNextMatchIndex(matches, 0, 3)).toBe(1)
    expect(findNextMatchIndex(matches, 3, 3)).toBe(0)
    expect(findPrevMatchIndex(matches, 3)).toBe(0)
    expect(findPrevMatchIndex(matches, 0)).toBe(1)
  })

  it("returns -1 for next match when wrap is disabled and already at last", () => {
    const matches = findAllMatches("abcabc", "abc")
    expect(findNextMatchIndex(matches, 3, 3, false)).toBe(-1)
  })

  it("builds highlight parts with one active match", () => {
    const text = "这是一段正文，正文里有重复正文。"
    const matches = findAllMatches(text, "正文")
    const parts = buildFindHighlightParts(text, matches, "正文".length, 1)
    expect(parts).toEqual([
      { text: "这是一段", kind: "plain" },
      { text: "正文", kind: "match" },
      { text: "，", kind: "plain" },
      { text: "正文", kind: "active" },
      { text: "里有重复", kind: "plain" },
      { text: "正文", kind: "match" },
      { text: "。", kind: "plain" },
    ])
  })
})
