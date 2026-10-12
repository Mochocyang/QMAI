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

  it("accepts an unclosed block followed by extra text", () => {
    expect(scanMarkedJsonPayload(`${OPEN_TEXT}\n{"a":1}\n请确认后继续`, OPEN, CLOSE))
      .toEqual({ kind: "payload", payload: { a: 1 } })
  })

  it("accepts an unclosed block wrapped in a json fence", () => {
    const text = `判断写在前面。\n${OPEN_TEXT}\n\`\`\`json\n{"status":"ready"}\n\`\`\`\n`
    expect(scanMarkedJsonPayload(text, OPEN, CLOSE))
      .toEqual({ kind: "payload", payload: { status: "ready" } })
  })

  it("accepts a malformed closing marker as trailing text", () => {
    expect(scanMarkedJsonPayload(`${OPEN_TEXT}\n{"status":"ready"}\n<!-- demo/ -->`, OPEN, CLOSE))
      .toEqual({ kind: "payload", payload: { status: "ready" } })
  })

  it("accepts a closed block that contains a fence and a preface", () => {
    const text = `${OPEN_TEXT}\n协议如下：\n\`\`\`json\n{"status":"ready"}\n\`\`\`\n${CLOSE_TEXT}`
    expect(scanMarkedJsonPayload(text, OPEN, CLOSE))
      .toEqual({ kind: "payload", payload: { status: "ready" } })
  })

  it("prefers the last object carrying a status over an earlier example", () => {
    const text = `${OPEN_TEXT}\n示例 {"id":"A"}\n{"status":"needs_decision"}\n${CLOSE_TEXT}`
    expect(scanMarkedJsonPayload(text, OPEN, CLOSE))
      .toEqual({ kind: "payload", payload: { status: "needs_decision" } })
  })

  it("prefers clarity over a later status object when clarity is listed first", () => {
    const text = `${OPEN_TEXT}\n{"clarity":"clear","module":"卷纲"}\n{"status":"ready"}`
    expect(scanMarkedJsonPayload(text, OPEN, CLOSE, ["clarity", "status"]))
      .toEqual({ kind: "payload", payload: { clarity: "clear", module: "卷纲" } })
  })

  it("skips a stray brace instead of losing the protocol after it", () => {
    const text = `${OPEN_TEXT}\n注意 { 这个括号没配平\n{"status":"ready"}`
    expect(scanMarkedJsonPayload(text, OPEN, CLOSE))
      .toEqual({ kind: "payload", payload: { status: "ready" } })
    const closed = `${OPEN_TEXT}\n{"status":"ready"}\n注意 { 这个括号没配平`
    expect(scanMarkedJsonPayload(closed, OPEN, CLOSE))
      .toEqual({ kind: "payload", payload: { status: "ready" } })
  })

  it("still fails a truncated object instead of patching it up", () => {
    expect(scanMarkedJsonPayload(`${OPEN_TEXT}\n{"status":"ready","judgment":"写到一半`, OPEN, CLOSE))
      .toEqual({ kind: "invalid", reason: "missing_payload" })
  })

  it("repairs a balanced object with unescaped inner quotes", () => {
    const text = `${OPEN_TEXT}\n{"status":"ready","judgment":"采纳"楚家的人"这一版"}\n${CLOSE_TEXT}`
    const scan = scanMarkedJsonPayload(text, OPEN, CLOSE)
    expect(scan.kind).toBe("payload")
    if (scan.kind !== "payload") return
    expect(scan.payload.status).toBe("ready")
  })

  it("reports unparseable for broken JSON", () => {
    expect(scanMarkedJsonPayload(`${OPEN_TEXT}\n{不是 JSON}\n${CLOSE_TEXT}`, OPEN, CLOSE))
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
