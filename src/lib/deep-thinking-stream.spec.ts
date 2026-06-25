import { describe, expect, it } from "vitest"
import { createDeepThinkingStreamRenderer } from "./deep-thinking-stream"

describe("deep thinking stream renderer", () => {
  it("updates the same stage in place instead of appending duplicate thinking blocks", () => {
    const stream = createDeepThinkingStreamRenderer()

    stream.updateThinking("## 阶段2：写作任务书\n第一段")
    const content = stream.updateThinking("## 阶段2：写作任务书\n第一段第二段")

    expect(content.match(/<think>/g)).toHaveLength(1)
    expect(content).toContain("第一段第二段")
    expect(content).not.toContain("第一段\n</think>\n\n<think>")
  })

  it("keeps different stages ordered and appends final content after thinking", () => {
    const stream = createDeepThinkingStreamRenderer()

    stream.updateThinking("## 阶段1：上下文分析\n已读取上下文")
    stream.updateThinking("## 阶段2：写作任务书\n任务书")
    const content = stream.appendFinal("正文内容")

    expect(content).toContain("<think>\n## 阶段1：上下文分析")
    expect(content).toContain("<think>\n## 阶段2：写作任务书")
    expect(content.endsWith("正文内容")).toBe(true)
  })
})
