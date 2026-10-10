import { describe, expect, it } from "vitest"
import {
  buildRepairRequestOverrides,
  extractLeadingJsonObject,
  isPlainObject,
  scanMarkedJsonPayload,
  stripMarkedBlock,
} from "./discuss-protocol-shared"

const OPEN_TEXT = "<!-- demo -->"
const CLOSE_TEXT = "<!-- /demo -->"
const OPEN = /<!--\s*demo\s*-->/i
const CLOSE = /<!--\s*\/demo\s*-->/i

describe("isPlainObject", () => {
  it("accepts plain objects only", () => {
    expect(isPlainObject({ a: 1 })).toBe(true)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject("x")).toBe(false)
  })
})

describe("extractLeadingJsonObject", () => {
  it("returns the first complete top-level object", () => {
    expect(extractLeadingJsonObject('前缀 {"a":{"b":1}} 后缀')).toEqual({
      json: '{"a":{"b":1}}',
      remainder: " 后缀",
    })
  })

  it("returns null when there is no object", () => {
    expect(extractLeadingJsonObject("没有对象")).toBeNull()
  })

  it("ignores braces inside strings", () => {
    expect(extractLeadingJsonObject('{"a":"}"}')?.json).toBe('{"a":"}"}')
  })
})

describe("scanMarkedJsonPayload", () => {
  it("returns none without a marker", () => {
    expect(scanMarkedJsonPayload("普通文本", OPEN, CLOSE)).toEqual({ kind: "none" })
  })

  it("returns the parsed payload for a complete block", () => {
    const scan = scanMarkedJsonPayload(`${OPEN_TEXT}\n{"a":1}\n${CLOSE_TEXT}`, OPEN, CLOSE)
    expect(scan).toEqual({ kind: "payload", payload: { a: 1 } })
  })

  it("falls back to an unclosed block", () => {
    const scan = scanMarkedJsonPayload(`${OPEN_TEXT}\n{"a":1}`, OPEN, CLOSE)
    expect(scan).toEqual({ kind: "payload", payload: { a: 1 } })
  })

  it("reports missing_payload for an empty block", () => {
    expect(scanMarkedJsonPayload(`${OPEN_TEXT}   ${CLOSE_TEXT}`, OPEN, CLOSE))
      .toEqual({ kind: "invalid", reason: "missing_payload" })
  })

  it("reports trailing_content when an unclosed block has extra text", () => {
    expect(scanMarkedJsonPayload(`${OPEN_TEXT}\n{"a":1}\n多余`, OPEN, CLOSE))
      .toEqual({ kind: "invalid", reason: "trailing_content" })
  })

  it("reports unparseable for broken JSON", () => {
    expect(scanMarkedJsonPayload(`${OPEN_TEXT}\n{nope}\n${CLOSE_TEXT}`, OPEN, CLOSE))
      .toEqual({ kind: "invalid", reason: "unparseable" })
  })

  it("reports not_object for non-object JSON", () => {
    expect(scanMarkedJsonPayload(`${OPEN_TEXT}\n[1,2]\n${CLOSE_TEXT}`, OPEN, CLOSE))
      .toEqual({ kind: "invalid", reason: "not_object" })
  })
})

describe("stripMarkedBlock", () => {
  it("removes complete and unclosed blocks", () => {
    expect(stripMarkedBlock(`前${OPEN_TEXT}{"a":1}${CLOSE_TEXT}后`, OPEN, CLOSE)).toBe("前后")
    expect(stripMarkedBlock(`前${OPEN_TEXT}{"a":1}`, OPEN, CLOSE)).toBe("前")
  })
})

describe("buildRepairRequestOverrides", () => {
  it("uses deterministic sampling", () => {
    expect(buildRepairRequestOverrides(1600)).toEqual({ temperature: 0, max_tokens: 1600 })
  })
})
