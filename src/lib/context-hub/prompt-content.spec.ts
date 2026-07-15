import { describe, expect, it } from "vitest"
import { buildContextHubSystemContent, flattenContextHubSystemContent } from "./prompt-content"
import type { ContextHubResult } from "./types"

const result = {
  stableCore: "稳定项目核心",
  sessionSummary: "当前会话摘要",
  dynamicContext: "任务动态片段",
  warnings: [],
} as ContextHubResult

describe("context hub system content", () => {
  it("places stable core after software rules and marks its end as cacheable", () => {
    const content = buildContextHubSystemContent("软件规则", result, ["本轮任务规则"])

    expect(content).toEqual([
      { type: "text", text: "软件规则\n\n" },
      { type: "text", text: "## 项目稳定核心\n稳定项目核心", cacheControl: true },
      { type: "text", text: "\n\n## 当前会话摘要\n当前会话摘要\n\n## 本轮动态上下文\n任务动态片段\n\n本轮任务规则" },
    ])
  })

  it("flattens blocks byte-for-byte for non-Anthropic provider configs", () => {
    const content = buildContextHubSystemContent("软件规则", result, ["本轮任务规则"])

    expect(flattenContextHubSystemContent(content)).toBe(content.map((block) => block.text).join(""))
  })
})
