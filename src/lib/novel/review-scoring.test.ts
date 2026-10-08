import { describe, it, expect } from "vitest"
import { scoreReviewResults } from "./review-scoring"
import type { NovelReviewResult } from "./review-adapter"

describe("review-scoring", () => {
  it("returns full score for empty results", () => {
    const report = scoreReviewResults([])
    expect(report.totalScore).toBe(100)
    expect(report.totalIssues).toBe(0)
    expect(report.severity).toBe("excellent")
    expect(report.dimensions.length).toBe(6)
    for (const dim of report.dimensions) {
      expect(dim.score).toBe(100)
      expect(dim.issueCount).toBe(0)
    }
  })

  it("subtracts correct amount for single error", () => {
    const results: NovelReviewResult[] = [{
      severity: "error",
      type: "character_consistency",
      message: "人设崩坏",
      evidence: "第3章第5段",
      relatedMemory: "",
      suggestion: "修正",
    }]
    const report = scoreReviewResults(results)
    expect(report.totalIssues).toBe(1)
    const charDim = report.dimensions.find(d => d.key === "character")
    expect(charDim).toBeDefined()
    expect(charDim!.score).toBe(80)
    expect(charDim!.issueCount).toBe(1)
    expect(report.totalScore).toBeLessThan(100)
  })

  it("handles mixed severity types correctly", () => {
    const results: NovelReviewResult[] = [
      { severity: "error", type: "timeline", message: "时间线错误", evidence: "", relatedMemory: "", suggestion: "" },
      { severity: "warning", type: "plot", message: "略微水文", evidence: "", relatedMemory: "", suggestion: "" },
      { severity: "info", type: "style", message: "句式建议", evidence: "", relatedMemory: "", suggestion: "" },
    ]
    const report = scoreReviewResults(results)
    expect(report.totalIssues).toBe(3)
    const factsDim = report.dimensions.find(d => d.key === "facts")
    const plotDim = report.dimensions.find(d => d.key === "plot")
    expect(factsDim!.score).toBe(80)
    expect(plotDim!.score).toBe(90)
  })

  it("does not go below 0 for any dimension", () => {
    const results: NovelReviewResult[] = Array.from({ length: 10 }, (_, i) => ({
      severity: "error" as const,
      type: "character_consistency",
      message: `问题${i}`,
      evidence: "",
      relatedMemory: "",
      suggestion: "",
    }))
    const report = scoreReviewResults(results)
    const charDim = report.dimensions.find(d => d.key === "character")
    expect(charDim!.score).toBe(0)
  })

  it("classifies severity levels correctly", () => {
    expect(scoreReviewResults([]).severity).toBe("excellent")

    const oneError: NovelReviewResult[] = [
      { severity: "error", type: "timeline", message: "错误", evidence: "", relatedMemory: "", suggestion: "" },
    ]
    const goodReport = scoreReviewResults(oneError)
    expect(goodReport.severity).toBe("good")

    const manyErrors: NovelReviewResult[] = Array.from({ length: 6 }, (_, i) => ({
      severity: "error" as const,
      type: "timeline",
      message: `错误${i}`,
      evidence: "",
      relatedMemory: "",
      suggestion: "",
    }))
    const fairReport = scoreReviewResults(manyErrors)
    expect(fairReport.severity).toBe("fair")

    const tooManyErrors: NovelReviewResult[] = Array.from({ length: 12 }, (_, i) => ({
      severity: "error" as const,
      type: "timeline",
      message: `错误${i}`,
      evidence: "",
      relatedMemory: "",
      suggestion: "",
    }))
    const poorReport = scoreReviewResults(tooManyErrors)
    expect(poorReport.severity).toBe("poor")
  })

  it("accepts custom dimension weights", () => {
    const results: NovelReviewResult[] = [{
      severity: "error",
      type: "timeline",
      message: "时间线错误",
      evidence: "",
      relatedMemory: "",
      suggestion: "",
    }]
    
    const defaultReport = scoreReviewResults(results)
    const customReport = scoreReviewResults(results, {
      dimensionWeights: { facts: 0.5, plot: 0.1, character: 0.1, world: 0.1, pacing: 0.1, compliance: 0.1 },
    })
    
    expect(customReport.dimensions.length).toBe(6)
    const factsDim = customReport.dimensions.find(d => d.key === "facts")
    expect(factsDim!.weight).toBe(0.5)
    
    const defaultFactsDim = defaultReport.dimensions.find(d => d.key === "facts")
    expect(defaultFactsDim!.weight).toBe(0.25)
  })

  it("accepts custom severity deductions", () => {
    const results: NovelReviewResult[] = [{
      severity: "error",
      type: "timeline",
      message: "时间线错误",
      evidence: "",
      relatedMemory: "",
      suggestion: "",
    }]
    
    const defaultReport = scoreReviewResults(results)
    const customReport = scoreReviewResults(results, {
      severityDeductions: { error: 30, warning: 15, info: 8 },
    })
    
    const factsDim = customReport.dimensions.find(d => d.key === "facts")
    expect(factsDim!.score).toBe(70)
    
    const defaultFactsDim = defaultReport.dimensions.find(d => d.key === "facts")
    expect(defaultFactsDim!.score).toBe(80)
  })

  it("partial overrides keep defaults for unspecified values", () => {
    const results: NovelReviewResult[] = [{
      severity: "info",
      type: "style",
      message: "句式建议",
      evidence: "",
      relatedMemory: "",
      suggestion: "",
    }]
    
    const report = scoreReviewResults(results, {
      severityDeductions: { error: 50 },
    })
    
    const pacingDim = report.dimensions.find(d => d.key === "pacing")
    expect(pacingDim!.score).toBe(95)
    
    expect(pacingDim!.weight).toBe(0.15)
  })

  // 原「calibrated empty results still give 100」用例已删除（2026-08-24 的 01aab5f
  // 「收口测试专用旧模块和未使用导出」把 CALIBRATED_DIMENSION_WEIGHTS 与
  // CALIBRATED_SEVERITY_DEDUCTION 两个常量连同其 JSDoc 一并删掉，全仓库已无该符号）。
  // 该用例传入的是 undefined，且断言的是**空结果集**——空结果下维度权重与扣分根本不会被读取，
  // 断言恒等于 100/excellent，**无法失败**，属「通过但不能失败」的假绿。
  // 空结果 100 分与自定义权重/扣分的行为已分别由本文件其它用例覆盖。
})