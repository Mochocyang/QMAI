import { describe, expect, it } from "vitest"
import {
  coerceOutlineSubAgentResult,
  parseOutlineSubAgentResult,
} from "./outline-result-protocol"

describe("AI大纲结构化输出协议", () => {
  it("解析合法子 Agent 输出", () => {
    const result = parseOutlineSubAgentResult(JSON.stringify({
      agent_id: "topic-agent",
      agent_name: "题材 Agent",
      stage: "topic_analysis",
      used_skills: ["male-xuanhuan-xianxia"],
      confidence: 0.86,
      summary: "突出升级压迫和势力冲突。",
      content_markdown: "## 题材判断\n玄幻升级流。",
      constraints: ["力量体系必须有代价"],
      writeback_items: [],
      risks: [],
      questions: [],
    }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.agentId).toBe("topic-agent")
      expect(result.value.usedSkills).toEqual(["male-xuanhuan-xianxia"])
      expect(result.value.contentMarkdown).toContain("玄幻升级流")
    }
  })

  it("缺少必要字段时返回中文错误", () => {
    const result = parseOutlineSubAgentResult(JSON.stringify({
      agent_id: "topic-agent",
      agent_name: "题材 Agent",
    }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("缺少必要字段")
      expect(result.error).toContain("content_markdown")
    }
  })

  it("将子 Agent 的 Markdown 输出容错转换为结构化结果", () => {
    const result = coerceOutlineSubAgentResult(
      [
        "## 题材判断",
        "这是玄幻升级流，核心卖点是压迫感和突破感。",
      ].join("\n"),
      {
        agentId: "topic-agent",
        agentName: "题材 Agent",
        usedSkills: ["male-xuanhuan-xianxia"],
      },
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.agentId).toBe("topic-agent")
      expect(result.value.agentName).toBe("题材 Agent")
      expect(result.value.usedSkills).toEqual(["male-xuanhuan-xianxia"])
      expect(result.value.summary).toContain("题材判断")
      expect(result.value.contentMarkdown).toContain("玄幻升级流")
    }
  })

  it("子 Agent 空输出时返回明确的中文错误而不是 JSON 解析异常", () => {
    const result = coerceOutlineSubAgentResult("", {
      agentId: "character-agent",
      agentName: "角色 Agent",
      usedSkills: ["supporting-cast"],
      stage: "character",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("子 Agent 未返回内容")
      expect(result.error).not.toContain("Unexpected end of JSON input")
    }
  })
})
