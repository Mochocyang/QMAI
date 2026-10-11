import { describe, expect, it } from "vitest"
import { extractJsonArrayCandidate, extractJsonObjectCandidate, parseLlmJsonArray, parseLlmJsonObject } from "./llm-json"

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

  // 人物 Skill 报障回归：提示词要 {"skills":[…]}，模型只给那个数组本身。
  // parseLlmJsonObject 对 `[{…}]` 会取出里面第一个对象、再因缺 skills 键返回 null，
  // 于是整轮静默作废 —— 必须有一条单独的数组解析路径。
  it("解析裸数组（模型没给 skills 外壳）", () => {
    const raw = '[{"name":"杨寒","fields":{"怎么说话":"短句。"}}]'
    const parsed = parseLlmJsonArray(raw)
    expect(parsed).toHaveLength(1)
    expect((parsed?.[0] as { name: string }).name).toBe("杨寒")
  })

  it("从对象里取出内层数组也能交给 parseLlmJsonArray 兜底", () => {
    const raw = '{"skills":[{"name":"杨寒"}]}'
    expect(extractJsonArrayCandidate(raw)).toBe('[{"name":"杨寒"}]')
    expect(parseLlmJsonArray(raw)).toHaveLength(1)
  })

  it("数组外有 fence 与前言也能解析", () => {
    const raw = '结果：\n```json\n[{"name":"杨寒"},{"name":"林小满"}]\n```\n以上。'
    expect(parseLlmJsonArray(raw)).toHaveLength(2)
  })

  it("根本没有数组时返回 null", () => {
    expect(parseLlmJsonArray("我把 JSON 忘了")).toBeNull()
  })
})
