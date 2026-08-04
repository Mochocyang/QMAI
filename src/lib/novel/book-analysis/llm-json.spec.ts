import { describe, expect, it } from "vitest"
import { extractJsonObjectCandidate, parseLlmJsonObject } from "./llm-json"

describe("llm-json", () => {
  it("提取 fence 内配平的 JSON object", () => {
    const raw = '说明如下：\n```json\n{"name":"顾司玥","description":"女主"}\n```\n完'
    expect(extractJsonObjectCandidate(raw)).toBe('{"name":"顾司玥","description":"女主"}')
  })

  it("用 jsonrepair 解析含裸换行的角色详情输出", () => {
    const raw = `
模型分析：
\`\`\`json
{
  "name": "顾司玥",
  "aliases": [],
  "category": "protagonist",
  "description": "外貌清冷
出身神秘",
  "personality": "克制",
  "motivation": "查明真相",
  "goals": ["活下去"],
  "fears": ["被抛弃"],
  "growthArc": "从疏离到信任",
  "behaviorPatterns": "先观察后行动",
  "speechStyle": "短句",
  "relationships": [],
  "keyEvents": [],
  "representativeQuotes": [
    {
      "chapterId": "ch-0001",
      "text": "她低声道：
“别跟着我。”"
    }
  ]
}
\`\`\`
`
    const parsed = parseLlmJsonObject(raw)
    expect(parsed).not.toBeNull()
    expect(parsed?.name).toBe("顾司玥")
    expect(String(parsed?.description)).toContain("外貌清冷")
    expect(Array.isArray(parsed?.representativeQuotes)).toBe(true)
  })

  it("用 jsonrepair 消化截断输出", () => {
    const raw = '{"name":"顾司玥","personality":"冷静且'
    const parsed = parseLlmJsonObject(raw)
    expect(parsed?.name).toBe("顾司玥")
    expect(String(parsed?.personality)).toContain("冷静")
  })
})
