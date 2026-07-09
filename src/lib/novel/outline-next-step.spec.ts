import { describe, it, expect } from "vitest"
import { parseNextStep, isRecommendationForbidden } from "./outline-next-step"

describe("parseNextStep", () => {
  it("解析正常推荐", () => {
    const text = `<!-- next_step -->
{"completedModule":"章节细纲","completedScope":"第1-3章细纲","recommendations":[{"id":"A","label":"完善人物小传","reason":"提及3个未立传角色"},{"id":"D","label":"自定义","reason":"由你描述"}]}
<!-- /next_step -->`
    const result = parseNextStep(text)
    expect(result).not.toBeNull()
    expect(result!.completedModule).toBe("章节细纲")
    expect(result!.recommendations).toHaveLength(2)
  })

  it("无标记块时返回 null", () => {
    expect(parseNextStep("普通文本")).toBeNull()
  })

  it("过滤掉被禁止的正文生成推荐", () => {
    const text = `<!-- next_step -->
{"completedModule":"章节细纲","completedScope":"第1-3章细纲","recommendations":[{"id":"A","label":"生成对应章节正文","reason":"可以开始写正文了"},{"id":"B","label":"完善人物小传","reason":"提及3个未立传角色"}]}
<!-- /next_step -->`
    const result = parseNextStep(text)
    expect(result).not.toBeNull()
    expect(result!.recommendations).toHaveLength(1)
    expect(result!.recommendations[0].label).toBe("完善人物小传")
  })
})

describe("isRecommendationForbidden", () => {
  it("禁止包含正文生成关键词", () => {
    expect(isRecommendationForbidden("生成对应章节正文")).toBe(true)
    expect(isRecommendationForbidden("写正文")).toBe(true)
    expect(isRecommendationForbidden("生成章节内容")).toBe(true)
  })

  it("允许大纲体系内的推荐", () => {
    expect(isRecommendationForbidden("完善人物小传")).toBe(false)
    expect(isRecommendationForbidden("生成组织势力设定")).toBe(false)
  })
})
