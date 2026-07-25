import { describe, expect, it } from "vitest"
import {
  STREAMING_DISPLAY_MAX_CHARS,
  getStreamingTailDisplay,
} from "./streaming-display-text"

describe("getStreamingTailDisplay", () => {
  it("keeps short streaming text intact", () => {
    expect(getStreamingTailDisplay("hello", true)).toEqual({
      text: "hello",
      truncated: false,
    })
  })

  it("keeps completed long text intact", () => {
    const content = "a".repeat(STREAMING_DISPLAY_MAX_CHARS + 100)
    expect(getStreamingTailDisplay(content, false)).toEqual({
      text: content,
      truncated: false,
    })
  })

  it("truncates long streaming text to the tail", () => {
    const head = "HEAD\n"
    const mid = "m".repeat(STREAMING_DISPLAY_MAX_CHARS)
    const tail = "\nTAIL"
    const content = `${head}${mid}${tail}`
    const result = getStreamingTailDisplay(content, true)
    expect(result.truncated).toBe(true)
    expect(result.text.endsWith("TAIL")).toBe(true)
    expect(result.text.includes("HEAD")).toBe(false)
    expect(result.text.length).toBeLessThanOrEqual(STREAMING_DISPLAY_MAX_CHARS)
  })
})
