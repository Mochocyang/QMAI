import { describe, expect, it } from "vitest"
import { formatToolResultForModel, keepsFullToolResultForModel } from "./tool-result"

describe("formatToolResultForModel", () => {
  it("returns short tool results unchanged", () => {
    expect(formatToolResultForModel("read_chapter", "短内容", 100)).toBe("短内容")
  })

  it("compresses long results while preserving beginning and ending evidence", () => {
    const result = `${"开头内容".repeat(80)}\n${"中间内容".repeat(80)}\n${"结尾内容".repeat(80)}`
    const compressed = formatToolResultForModel("read_chapter", result, 300)

    expect(compressed.length).toBeLessThan(result.length)
    expect(compressed).toContain("工具 read_chapter 返回内容较长，已压缩给模型使用")
    expect(compressed).toContain("原始长度")
    expect(compressed).toContain("开头内容")
    expect(compressed).toContain("结尾内容")
  })

  it("does not truncate run_chapter_workflow deliverable even when over the limit", () => {
    const chapterBody = "陈远的手还压在西线地图上。".repeat(80)
    const result = [
      "章节工作流完成。",
      "是否返修：是",
      `任务书：${"场景验收标准".repeat(800)}`,
      "",
      "最终正文：",
      chapterBody,
    ].join("\n")

    expect(keepsFullToolResultForModel("run_chapter_workflow")).toBe(true)
    expect(result.length).toBeGreaterThan(300)
    expect(formatToolResultForModel("run_chapter_workflow", result, 300)).toBe(result)
    expect(formatToolResultForModel("run_chapter_workflow", result, 300)).not.toContain("已压缩给模型使用")
    expect(formatToolResultForModel("run_chapter_workflow", result, 300)).toContain("陈远的手还压在西线地图上")
  })
})
