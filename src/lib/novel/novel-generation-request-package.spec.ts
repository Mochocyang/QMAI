import { describe, expect, it } from "vitest"
import {
  buildOutlineRegenerationInput,
  createNovelGenerationRequestPackage,
  getNovelGenerationModelContent,
  getOutlineMessageModelContent,
  isExplicitStructuredGenerationFollowUp,
  mapOutlineConversationsForModel,
  mapOutlineMessagesForModel,
} from "./novel-generation-request-package"
import type { OutlineWizardRequest } from "./outline-wizard"

const request: OutlineWizardRequest = {
  task: "newBook", length: "long", channel: "male", genre: "xuanhuan",
  customGenre: "", inspiration: "?????????????", sellingPoints: ["????"],
  targets: ["??", "????"], scale: "120?", narrative: "thirdPerson", materialSource: "none",
}

describe("???????", () => {
  it("??????????????", () => {
    const value = createNovelGenerationRequestPackage(request, "??????")
    expect(value.version).toBe(1)
    expect(value.summary).not.toBe("??????")
    expect(value.details.length).toBeGreaterThan(0)
    expect(getNovelGenerationModelContent(value)).toBe("??????")
    expect(getOutlineMessageModelContent({ content: value.summary, novelGenerationRequest: value })).toBe("??????")
  })

  it("?????????????????????", () => {
    const value = createNovelGenerationRequestPackage(request, "??????")
    expect(mapOutlineMessagesForModel([
      { role: "user", content: value.summary, novelGenerationRequest: value },
      { role: "assistant", content: "", isAgentRunning: true },
      { role: "assistant", content: "??" },
    ])).toEqual([{ role: "user", content: "??????" }, { role: "assistant", content: "??" }])
  })

  it("preserves assistant reasoning_content for model replay", () => {
    expect(mapOutlineMessagesForModel([
      { role: "user", content: "继续完善大纲" },
      { role: "assistant", content: "已更新人物设定", reasoning_content: "先核对冲突" },
      { role: "assistant", content: "已确认方向", reasoning_content: "" },
    ])).toEqual([
      { role: "user", content: "继续完善大纲" },
      { role: "assistant", content: "已更新人物设定", reasoning_content: "先核对冲突" },
      { role: "assistant", content: "已确认方向", reasoning_content: "" },
    ])
  })

  it("????????????", () => {
    const value = createNovelGenerationRequestPackage(request, "??????")
    const messages = [
      { role: "user" as const, content: value.summary, novelGenerationRequest: value },
      { role: "assistant" as const, content: "??" },
      { role: "user" as const, content: "????" },
    ]
    expect(buildOutlineRegenerationInput(messages)).toEqual({
      request: "????",
      history: [{ role: "user", content: "??????" }, { role: "assistant", content: "??" }],
      structuredGeneration: false,
    })
    expect(mapOutlineConversationsForModel([{ id: "c1", title: "??", messages }])[0].messages[0].content).toBe("??????")
  })

  it("??????????????????????????", () => {
    expect(isExplicitStructuredGenerationFollowUp("\u751f\u6210\u4eba\u7269\u8bbe\u5b9a", { generationContext: false })).toBe(true)
    expect(isExplicitStructuredGenerationFollowUp("\u751f\u6210\u4e16\u754c\u89c2", { generationContext: false })).toBe(true)
    expect(isExplicitStructuredGenerationFollowUp("\u89e3\u91ca\u4e00\u4e0b\u8fd9\u4e2a\u8bbe\u5b9a", { generationContext: false })).toBe(false)
    expect(isExplicitStructuredGenerationFollowUp("\u7ee7\u7eed\u5b8c\u5584\u4eba\u7269\u5173\u7cfb", { generationContext: true })).toBe(true)
  })

  it("??????????????????????", () => {
    const generationRequest = createNovelGenerationRequestPackage(request, "???????")
    expect(buildOutlineRegenerationInput([
      { role: "user", content: generationRequest.summary, novelGenerationRequest: generationRequest },
    ])).toEqual({ request: "???????", history: [], structuredGeneration: true })
  })
})
