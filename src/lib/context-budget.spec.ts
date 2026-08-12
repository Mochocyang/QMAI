import { describe, expect, it } from "vitest"
import {
  computeOutlineIngestBodyBudget,
  OUTLINE_INGEST_MIN_BODY_BUDGET,
} from "./context-budget"

describe("computeOutlineIngestBodyBudget", () => {
  const promptOverhead = 2_500

  it("uses at least the legacy floor on large windows", () => {
    const budget = computeOutlineIngestBodyBudget(204_800, promptOverhead, 1)
    expect(budget).toBeGreaterThan(OUTLINE_INGEST_MIN_BODY_BUDGET)
  })

  it("scales down for smaller context windows", () => {
    const large = computeOutlineIngestBodyBudget(204_800, promptOverhead, 1)
    const small = computeOutlineIngestBodyBudget(32_768, promptOverhead, 1)
    expect(small).toBeLessThan(large)
    expect(small).toBeGreaterThan(0)
  })

  it("gives CJK fewer characters because each token holds less text", () => {
    const english = computeOutlineIngestBodyBudget(128_000, promptOverhead, 4)
    const cjk = computeOutlineIngestBodyBudget(128_000, promptOverhead, 1)
    expect(cjk).toBeLessThan(english)
  })
})
