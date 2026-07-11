import { describe, expect, it } from "vitest"
import { extractNextStep } from "./outline-next-step"

describe("extractNextStep 容错与正文清理", () => {
  it("标准标记返回清理正文、推荐和 strict 来源", () => {
    const result = extractNextStep(`正文内容\n<!-- next_step -->\n{"completedModule":"人物小传","completedScope":"主角","recommendations":[{"id":"D","label":"自定义","reason":"自行描述"}]}\n<!-- /next_step -->`)
    expect(result.cleanText).toBe("正文内容")
    expect(result.source).toBe("strict")
    expect(result.recommendation?.completedModule).toBe("人物小传")
  })

  it("恢复缺少结束标记、代码围栏、蛇形字段和缺少 reason 的结果", () => {
    const result = extractNextStep(`正文\n<!-- next_step -->\n\`\`\`json\n{"completed_module":"章节细纲","completed_scope":"1-3章","recommendations":[{"id":"A","label":"继续完善人物小传"}]}\n\`\`\``)
    expect(result.cleanText).toBe("正文")
    expect(result.source).toBe("recovered")
    expect(result.recommendation).toMatchObject({ completedModule: "章节细纲", completedScope: "1-3章" })
    expect(result.recommendation?.recommendations[0].reason).toBe("")
  })

  it("不可恢复的大纲完成消息清除残片并生成安全卡片", () => {
    const result = extractNextStep("正常正文\n<!-- next_step -->\n{错误 JSON !!!", {
      allowFallback: true,
      completedModule: "世界观",
    })
    expect(result.cleanText).toBe("正常正文")
    expect(result.source).toBe("fallback")
    expect(result.recommendation?.recommendations.map((item) => item.label)).toEqual([
      "继续完善当前模块",
      "自定义",
    ])
  })

  it("意图分析、错误或停止消息只清理，不生成安全卡片", () => {
    for (const text of ["意图分析\n<!-- /next_step -->", "生成失败：错误 next_step", "已停止 <!-- next_step --> {"]) {
      const result = extractNextStep(text)
      expect(result.source).toBe("none")
      expect(result.recommendation).toBeNull()
      expect(result.cleanText).not.toContain("next_step")
    }
  })
})
