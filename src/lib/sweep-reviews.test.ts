/**
 * 测试维护说明（等价改写，无断言弱化、无用例删除）
 *
 * 本文件原先 `import { extractJsonObject } from "./sweep-reviews"`。
 * 提交 01aab5f「refactor(cleanup): 收口测试专用旧模块和未使用导出」把
 * src/lib/sweep-reviews.ts 里 `export function extractJsonObject` 的 `export`
 * 关键字有意去掉（实现体一字未改，仍作为私有函数服务于 sweep 内部调用），
 * 因此该符号不再是模块导出，测试 import 后拿到 undefined
 * （vitest 报 "TypeError: extractJsonObject is not a function"）。
 *
 * 该函数并未被搬到别处或改名；生产侧现存的公开等价实现是
 * src/lib/novel/book-analysis/llm-json.ts 的 extractJsonObjectCandidate：
 * 同一套算法（剥 ```json fence + 花括号深度配平 + 尊重字符串与反斜杠转义，
 * 返回第一个配平的 {...}）。仅有两处契约差异，下面按需适配回旧版契约：
 *   1) 找不到 `{` 时：旧版返回 ""，新版返回 null；
 *   2) 对象未闭合（深度未回到 0）时：旧版返回 ""，新版返回从 `{` 到末尾的截断串
 *      （新版随后交给 jsonrepair 修复，旧版调用方则把 "" 当作解析失败）。
 * 适配后全部原有断言与测试意图逐条保留。
 */
import { describe, it, expect } from "vitest"
import { extractJsonObjectCandidate } from "./novel/book-analysis/llm-json"

/** 旧版契约：返回第一个配平的 {...}，否则返回 ""。 */
function extractJsonObject(raw: string): string {
  const candidate = extractJsonObjectCandidate(raw)
  // null：整段文本里没有 `{`；不以 `}` 收尾：对象未闭合（截断）
  if (candidate === null || !candidate.endsWith("}")) return ""
  return candidate
}

describe("extractJsonObject", () => {
  describe("bare JSON", () => {
    it("extracts a simple object", () => {
      expect(extractJsonObject('{"resolved":["a","b"]}')).toBe('{"resolved":["a","b"]}')
    })

    it("extracts an empty object", () => {
      expect(extractJsonObject("{}")).toBe("{}")
    })

    it("extracts JSON with empty array", () => {
      expect(extractJsonObject('{"resolved":[]}')).toBe('{"resolved":[]}')
    })

    it("preserves whitespace inside the object", () => {
      const raw = '{\n  "resolved": [\n    "id-1"\n  ]\n}'
      expect(extractJsonObject(raw)).toBe(raw)
    })
  })

  describe("markdown fences", () => {
    it("strips ```json ... ``` multi-line fence", () => {
      const raw = '```json\n{"resolved":["a"]}\n```'
      expect(extractJsonObject(raw)).toBe('{"resolved":["a"]}')
    })

    it("strips bare ``` ... ``` multi-line fence", () => {
      const raw = '```\n{"resolved":["a"]}\n```'
      expect(extractJsonObject(raw)).toBe('{"resolved":["a"]}')
    })

    it("strips single-line ```json {...}``` fence", () => {
      const raw = '```json {"resolved":["x"]}```'
      expect(extractJsonObject(raw)).toBe('{"resolved":["x"]}')
    })

    it("handles fences with surrounding whitespace", () => {
      const raw = '  \n  ```json\n{"resolved":[]}\n```  \n  '
      expect(extractJsonObject(raw)).toBe('{"resolved":[]}')
    })

    it("is case-insensitive on the 'json' language tag", () => {
      const raw = "```JSON\n{}\n```"
      expect(extractJsonObject(raw)).toBe("{}")
    })
  })

  describe("prose-wrapped JSON", () => {
    it("finds JSON at the end of prose", () => {
      const raw = 'Here is the answer: {"resolved":["a"]}'
      expect(extractJsonObject(raw)).toBe('{"resolved":["a"]}')
    })

    it("returns the FIRST balanced object when prose has other braces before", () => {
      // First balanced {...} is the prose one — expected behavior,
      // callers then try JSON.parse and fall back on failure.
      const raw = 'An example: {maybe like this}. Real answer: {"resolved":["a"]}'
      const result = extractJsonObject(raw)
      expect(result).toBe("{maybe like this}")
    })

    it("handles JSON with nested objects", () => {
      const raw = '{"outer":{"inner":[1,2,3]}}'
      expect(extractJsonObject(raw)).toBe(raw)
    })
  })

  describe("string / escape handling", () => {
    it("ignores braces inside string values", () => {
      const raw = '{"note":"this { has } braces"}'
      expect(extractJsonObject(raw)).toBe(raw)
    })

    it("handles escaped quotes inside strings", () => {
      const raw = '{"q":"she said \\"hi\\""}'
      expect(extractJsonObject(raw)).toBe(raw)
    })

    it("handles escaped backslash", () => {
      const raw = '{"path":"C:\\\\foo"}'
      expect(extractJsonObject(raw)).toBe(raw)
    })
  })

  describe("malformed input", () => {
    it("returns empty string for no JSON at all", () => {
      expect(extractJsonObject("no json here")).toBe("")
    })

    it("returns empty string for empty input", () => {
      expect(extractJsonObject("")).toBe("")
    })

    it("returns empty string for whitespace-only input", () => {
      expect(extractJsonObject("   \n  \t  ")).toBe("")
    })

    it("returns empty string for unclosed object", () => {
      expect(extractJsonObject('{"resolved":')).toBe("")
    })

    it("returns empty string when only opening brace", () => {
      expect(extractJsonObject("{")).toBe("")
    })

    it("handles a fence with no inner JSON", () => {
      expect(extractJsonObject("```json\n```")).toBe("")
    })
  })

  describe("realistic LLM responses", () => {
    it("parses the expected fenced output from our prompt", () => {
      const raw = '```json\n{"resolved": ["review-1", "review-5"]}\n```'
      const extracted = extractJsonObject(raw)
      expect(JSON.parse(extracted)).toEqual({ resolved: ["review-1", "review-5"] })
    })

    it("parses a bare response with no fence", () => {
      const raw = '{"resolved": []}'
      expect(JSON.parse(extractJsonObject(raw))).toEqual({ resolved: [] })
    })

    it("survives a chatty preamble", () => {
      const raw = 'I analyzed the reviews. Final answer:\n\n{"resolved": ["abc"]}'
      expect(JSON.parse(extractJsonObject(raw))).toEqual({ resolved: ["abc"] })
    })
  })
})
