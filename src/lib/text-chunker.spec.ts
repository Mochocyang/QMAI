import { describe, expect, it } from "vitest"
import { chunkMarkdown } from "./text-chunker"

describe("chunkMarkdown", () => {
  it("terminates on a lone table row that is not part of a table", () => {
    // A single `|` line fails the "two or more rows" table check and then
    // hits the paragraph branch, whose guard rejects `|`. That combination
    // used to consume nothing and loop until the process ran out of memory.
    const content = [
      "# 单位",
      "",
      "前置说明。",
      "",
      "| 苏联船厂 | 单座水中厂区 | NAYARD | 外形见苏联船坞 |",
      "",
      "后续说明。",
    ].join("\n")

    const chunks = chunkMarkdown(content)

    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.map((chunk) => chunk.text).join("\n")).toContain("NAYARD")
  })

  it("keeps a real table in one chunk", () => {
    const content = [
      "## 台账",
      "",
      "| 名称 | 数量 |",
      "| --- | --- |",
      "| 矿车 | 3 |",
    ].join("\n")

    const chunks = chunkMarkdown(content)
    const table = chunks.find((chunk) => chunk.text.includes("矿车"))

    expect(table?.text).toContain("| 名称 | 数量 |")
    expect(table?.text).toContain("| --- | --- |")
  })

  it("splits a long document into several chunks", () => {
    const paragraph = "这是一段用于测试切分的正文。".repeat(20)
    const content = ["# 标题", "", paragraph, "", paragraph].join("\n")

    const chunks = chunkMarkdown(content, { targetChars: 200, overlapChars: 20 })

    expect(chunks.length).toBeGreaterThan(1)
  })
})
