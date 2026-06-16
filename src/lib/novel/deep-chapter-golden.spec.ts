import { describe, expect, it } from "vitest"
import {
  buildDeepChapterBriefPrompt,
  buildDeepChapterDraftPrompt,
  buildDeepChapterExpansionPrompt,
  buildDeepChapterFinalPolishPrompt,
  buildDeepChapterRevisionPrompt,
} from "./deep-chapter-prompts"
import { detectGoldenThreeChapterRequest } from "./golden-three-chapters"
import type { NovelReviewResult } from "./review-adapter"

describe("deep chapter prompts with golden three chapter constraints", () => {
  it("injects golden constraints into every deep generation prompt stage", () => {
    const golden = detectGoldenThreeChapterRequest("生成前三章")
    const reviewResults: NovelReviewResult[] = [{
      severity: "error",
      type: "plot",
      message: "测试问题",
      evidence: "",
      relatedMemory: "",
      suggestion: "",
    }]
    const prompts = [
      buildDeepChapterBriefPrompt("", "上下文包内容", "生成前三章", 1, golden),
      buildDeepChapterDraftPrompt("", "上下文包内容", "写作任务书内容", "生成前三章", 1, golden),
      buildDeepChapterRevisionPrompt("", "上下文包内容", "写作任务书内容", "初稿正文内容", reviewResults, "生成前三章", 1, golden),
      buildDeepChapterExpansionPrompt("", "上下文包内容", "写作任务书内容", "当前正文", "生成前三章", 1, golden),
      buildDeepChapterFinalPolishPrompt("", "上下文包内容", "写作任务书内容", "当前正文", "生成前三章", 1, golden),
    ]

    for (const prompt of prompts) {
      expect(prompt).toContain("黄金三章写作约束")
      expect(prompt).toContain("前 300-500 字内必须进入主体事件、危机、任务、冲突或异常")
      expect(prompt).toContain("只生成第一章正文")
    }
  })
})
