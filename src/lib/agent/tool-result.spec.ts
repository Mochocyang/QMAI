import { describe, expect, it } from "vitest"
import { formatToolResultForModel } from "./tool-result"

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
})
