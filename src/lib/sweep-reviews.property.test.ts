/**
 * Tier 6 — property tests for the LLM-response JSON extractor.
 *
 * 原本 import 的是 `src/lib/sweep-reviews.ts` 内部的 `extractJsonObject`
 * （契约：找不到配平的 `{...}` 时返回 `""`）。
 *
 * 该函数**并未被删除** —— 实现至今仍在 sweep-reviews.ts 里被 `judgeBatch` 调用 ——
 * 但它的 `export` 关键字在提交 01aab5f
 * "refactor(cleanup): 收口测试专用旧模块和未使用导出" 中被移除
 * （原 JSDoc 已写明 "@internal Exported for unit tests only."，即该导出只为测试而存在）。
 * 因此测试无法再从该模块 import 它；只修改测试文件无法恢复导出，
 * 最小生产改动是给 sweep-reviews.ts:137 重新加回 `export`（本次按约束未改生产代码）。
 *
 * 生产代码中语义等价的公开实现是 `extractJsonObjectCandidate`
 * (src/lib/novel/book-analysis/llm-json.ts)：同样是「剥 markdown fence +
 * 按括号深度取第一个配平的 `{...}`（尊重字符串与转义）」，只是签名不同 ——
 * 未匹配时旧版返回 `""`，新版返回 `null`。
 * 下面只在测试侧加一层 null → "" 的归一化适配，被断言的逻辑全部来自生产实现；
 * 原有 5 条 property 的断言与测试意图保持不变。
 */
import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { extractJsonObjectCandidate } from "@/lib/novel/book-analysis/llm-json"

/** 适配旧签名（无匹配 → ""）；新版返回 null，仅做归一化，不改变任何判断逻辑。 */
function extractJsonObject(raw: string): string {
  return extractJsonObjectCandidate(raw) ?? ""
}

/** A valid JSON value. */
const jsonValueArb: fc.Arbitrary<unknown> = fc.jsonValue()

/** A JSON object (top-level {}). */
const jsonObjectArb = fc.dictionary(fc.string(), jsonValueArb)

describe("extractJsonObject — properties", () => {
  // Compare through JSON round-trip so edge cases like -0 vs +0 (which JSON
  // doesn't preserve) don't trip up the property. We care that the object
  // survives a round-trip through our extractor, not that -0 stays negative.
  function jsonRoundTrip(x: unknown): unknown {
    return JSON.parse(JSON.stringify(x))
  }

  it("extracts a bare JSON object unchanged (round-trip parses to same value)", () => {
    fc.assert(
      fc.property(jsonObjectArb, (obj) => {
        const serialized = JSON.stringify(obj)
        const extracted = extractJsonObject(serialized)
        expect(extracted).toBeTruthy()
        expect(JSON.parse(extracted)).toEqual(jsonRoundTrip(obj))
      }),
    )
  })

  it("extracts a fenced JSON object", () => {
    fc.assert(
      fc.property(jsonObjectArb, (obj) => {
        const serialized = JSON.stringify(obj)
        const wrapped = "```json\n" + serialized + "\n```"
        const extracted = extractJsonObject(wrapped)
        expect(JSON.parse(extracted)).toEqual(jsonRoundTrip(obj))
      }),
    )
  })

  it("finds a JSON object trailing after prose (no-brace prose)", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !s.includes("{") && !s.includes("}")),
        jsonObjectArb,
        (prose, obj) => {
          const input = prose + " " + JSON.stringify(obj)
          const extracted = extractJsonObject(input)
          expect(JSON.parse(extracted)).toEqual(jsonRoundTrip(obj))
        },
      ),
    )
  })

  it("returns a balanced {...} substring — depth returns to 0", () => {
    fc.assert(
      fc.property(jsonObjectArb, (obj) => {
        const input = "prose " + JSON.stringify(obj) + " trailing"
        const extracted = extractJsonObject(input)
        if (!extracted) return
        // Count braces outside strings — must balance
        let depth = 0
        let inString = false
        let escape = false
        for (const ch of extracted) {
          if (escape) {
            escape = false
            continue
          }
          if (ch === "\\" && inString) {
            escape = true
            continue
          }
          if (ch === '"') inString = !inString
          else if (!inString) {
            if (ch === "{") depth++
            else if (ch === "}") depth--
          }
        }
        expect(depth).toBe(0)
      }),
    )
  })

  it("never throws, even on random garbage", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(() => extractJsonObject(input)).not.toThrow()
      }),
    )
  })
})
