import { describe, expect, it } from "vitest"
import { ToolEvidenceLedger } from "./tool-evidence-ledger"

describe("ToolEvidenceLedger", () => {
  it("相同工具、参数和结果再次出现时返回证据引用", () => {
    const ledger = new ToolEvidenceLedger(500)
    const first = ledger.format("read_chapter", { chapter: 1 }, "第一章完整内容")
    const second = ledger.format("read_chapter", { chapter: 1 }, "第一章完整内容")

    expect(first).toContain("第一章完整内容")
    expect(second).toContain("工具证据引用")
    expect(second).not.toContain("第一章完整内容")
  })

  it("不同参数不会错误复用证据", () => {
    const ledger = new ToolEvidenceLedger(500)
    ledger.format("read_chapter", { chapter: 1 }, "第一章")

    expect(ledger.format("read_chapter", { chapter: 2 }, "第二章")).toContain("第二章")
  })

  it("章节工作流终稿不按证据限额截断", () => {
    const ledger = new ToolEvidenceLedger(300)
    const result = [
      "章节工作流完成。",
      "是否返修：否",
      `任务书：${"必须完成项".repeat(120)}`,
      "",
      "最终正文：",
      "陈远的手还压在西线地图上。".repeat(80),
    ].join("\n")

    const formatted = ledger.format("run_chapter_workflow", { chapterNumber: 240 }, result)

    expect(formatted).toContain("最终正文：")
    expect(formatted).toContain("陈远的手还压在西线地图上")
    expect(formatted).not.toContain("已压缩给模型使用")
    expect(formatted).toContain(result)
  })
})
