import { beforeEach, describe, expect, it, vi } from "vitest"
import { classifyTaskIntent, TASK_INTENT_CLASSIFIER_SYSTEM } from "./task-intent-classifier"
import {
  NOVEL_TASK_INTENT_LABELS,
  TASK_ROUTE_FALLBACK_CONFIDENCE,
  isChapterWritingIntent,
  routeTask,
  type NovelTaskIntent,
} from "./task-router"

vi.mock("./task-intent-classifier", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./task-intent-classifier")>()
  return {
    ...actual,
    classifyTaskIntent: vi.fn(async () => null),
  }
})

function model(intent: NovelTaskIntent, confidence = 0.86) {
  return { classification: { intent, confidence } }
}

describe("routeTask chapter generation", () => {
  beforeEach(() => {
    vi.mocked(classifyTaskIntent).mockReset().mockResolvedValue(null)
  })

  it("uses the model intent and confidence instead of keyword weights", async () => {
    vi.mocked(classifyTaskIntent).mockResolvedValueOnce({ intent: "continue_chapter", confidence: 0.73 })

    const route = await routeTask("继续生成下一章")

    expect(classifyTaskIntent).toHaveBeenCalledOnce()
    expect(route.intent).toBe("continue_chapter")
    expect(route.confidence).toBe(0.73)
    expect(route.chapterNumber).toBeUndefined()
  })

  it("keeps a provided classification and does not call the model again", async () => {
    const route = await routeTask(
      "请根据当前小说上下文、记忆库、最新章节结尾、下一章推进建议和章纲，继续生成下一章正文。",
      model("continue_chapter", 0.91),
    )

    expect(classifyTaskIntent).not.toHaveBeenCalled()
    expect(route.intent).toBe("continue_chapter")
    expect(route.confidence).toBe(0.91)
  })

  it("extracts Chinese chapter numbers without turning the number into an intent", async () => {
    const route = await routeTask("请根据第八章章纲生成正文", model("write_chapter", 0.8))

    expect(route.intent).toBe("write_chapter")
    expect(route.chapterNumber).toBe(8)
    expect(route.confidence).toBe(0.8)
  })

  it("extracts an explicit chapter number from an analyze-then-write request", async () => {
    const route = await routeTask("分析大纲内容去生成第3章", model("write_chapter"))

    expect(route.intent).toBe("write_chapter")
    expect(route.chapterNumber).toBe(3)
  })

  it("does not treat incidental 第一章 mentions in next-chapter requests as the target chapter (issue #9)", async () => {
    const route = await routeTask(
      "请根据当前小说上下文、记忆库、最新章节结尾、下一章推进建议和章纲，继续生成下一章正文。只输出可直接保存到章节库的小说正文，不要解释，不要列提纲。正文必须是完整章节，内容要吸引读者，留住读者，目标约 3000 字，建议 2800-3400 字，低于 2600 字视为未完成，开篇200字内必须制造'钩子'。",
      model("continue_chapter"),
    )

    expect(route.intent).toBe("continue_chapter")
    expect(route.chapterNumber).toBeUndefined()
  })

  it("does not treat incidental 第一章 mentions as chapter 1", async () => {
    const route = await routeTask("继续生成下一章正文，不要重复第一章的内容。", model("continue_chapter"))

    expect(route.chapterNumber).toBeUndefined()
  })

  it("keeps an explicit later chapter number when the prompt also says 开篇", async () => {
    const route = await routeTask("写第5章，开篇要有钩子", model("write_chapter"))

    expect(route.intent).toBe("write_chapter")
    expect(route.chapterNumber).toBe(5)
  })

  it("parses Chinese-numeral chapter numbers and keeps the model confidence", async () => {
    for (const text of ["编写第五章", "写第五章", "生成第五章", "编写第 5 章"]) {
      const route = await routeTask(text, model("write_chapter", 0.64))

      expect(route.intent).toBe("write_chapter")
      expect(route.chapterNumber).toBe(5)
      expect(route.confidence).toBe(0.64)
    }
  })

  it("parses bare chapter numbers above 10 and explicit 第N章", async () => {
    for (const [text, chapterNumber] of [["编写 11 章", 11], ["编写 229 章", 229], ["编写第 5 章", 5]] as const) {
      const route = await routeTask(text, model("write_chapter"))

      expect(route.chapterNumber).toBe(chapterNumber)
    }
  })

  it("does not treat small bare numerals as chapter sequence numbers", async () => {
    for (const text of ["写三章", "编写 5 章", "编写 10 章"]) {
      const route = await routeTask(text, model("write_chapter", 0.99))

      expect(route.intent).toBe("write_chapter")
      expect(route.chapterNumber).toBeUndefined()
    }
  })

  it("keeps Chinese later chapter numbers when the prompt mentions 开篇", async () => {
    const route = await routeTask("写第五章，开篇要有钩子", model("write_chapter"))

    expect(route.chapterNumber).toBe(5)
  })

  it("fails soft to general_chat when the model classification is unusable", async () => {
    vi.mocked(classifyTaskIntent).mockResolvedValueOnce({ intent: "not_an_intent", confidence: 0.99 })

    const route = await routeTask("续写下去")

    expect(route.intent).toBe("general_chat")
    expect(route.confidence).toBe(TASK_ROUTE_FALLBACK_CONFIDENCE)
  })

  it("does not promote 写第10章 to write_chapter when classification fails", async () => {
    const route = await routeTask("写第10章", { classification: null })

    expect(classifyTaskIntent).not.toHaveBeenCalled()
    expect(route.intent).toBe("general_chat")
    expect(route.confidence).toBe(TASK_ROUTE_FALLBACK_CONFIDENCE)
    expect(route.chapterNumber).toBe(10)
  })

  it("does not call the model for empty input", async () => {
    const route = await routeTask("  ")

    expect(classifyTaskIntent).not.toHaveBeenCalled()
    expect(route.intent).toBe("general_chat")
    expect(route.confidence).toBe(1)
  })

  it("marks modify-family intents from the model label", async () => {
    const route = await routeTask("把这一段改得更紧", model("polish_chapter", 0.7))

    expect(route.modifyFamily).toBe(true)
  })

  it("asks the classifier for every supported intent and not for a weight formula", () => {
    for (const intent of Object.keys(NOVEL_TASK_INTENT_LABELS)) {
      expect(TASK_INTENT_CLASSIFIER_SYSTEM).toContain(intent)
    }
    expect(TASK_INTENT_CLASSIFIER_SYSTEM).not.toContain("/16")
    expect(TASK_INTENT_CLASSIFIER_SYSTEM).toContain("不是公网搜索")
  })

  it("identifies chapter writing intents", () => {
    expect(isChapterWritingIntent("write_chapter")).toBe(true)
    expect(isChapterWritingIntent("continue_chapter")).toBe(true)
    expect(isChapterWritingIntent("rewrite_chapter")).toBe(true)
    expect(isChapterWritingIntent("polish_chapter")).toBe(true)
    expect(isChapterWritingIntent("generate_outline")).toBe(false)
    expect(isChapterWritingIntent("general_chat")).toBe(false)
    expect(isChapterWritingIntent(null)).toBe(false)
  })
})
