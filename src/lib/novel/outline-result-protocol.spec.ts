import { describe, expect, it } from "vitest"
import {
  coerceOutlineSubAgentResult,
  parseOutlineFinalResult,
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

  it("解析 Markdown 代码块包裹的最终保存协议", () => {
    const result = parseOutlineFinalResult(`\`\`\`json
{
  "outline_type": "chapter-outline",
  "target_folder": "章纲",
  "file_name": "章纲-第001章.md",
  "status": "草稿",
  "content_markdown": "# 章纲（第001章）",
  "quality_check": { "valid": true, "errors": [], "warnings": [] },
  "writeback_items": [],
  "source_agents": ["topic-agent"]
}
\`\`\``)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.fileName).toBe("章纲-第001章.md")
      expect(result.value.qualityCheck.valid).toBe(true)
      expect(result.value.sourceAgents).toEqual(["topic-agent"])
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
})
