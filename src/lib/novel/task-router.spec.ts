import { describe, expect, it } from "vitest"
import { routeTask } from "./task-router"

describe("routeTask chapter generation", () => {
  it("routes continue-next-chapter requests into chapter generation flow", () => {
    const route = routeTask("继续生成下一章")

    expect(route.intent).toBe("continue_chapter")
  })

  it("routes the continue-next-chapter button prompt into chapter generation flow", () => {
    const route = routeTask("请根据当前小说上下文、记忆库、最新章节结尾、下一章推进建议和章纲，继续生成下一章正文。")

    expect(route.intent).toBe("continue_chapter")
  })

  it("routes outline-based chapter requests and extracts Chinese chapter numbers", () => {
    const route = routeTask("请根据第八章章纲生成正文")

    expect(route.intent).toBe("write_chapter")
    expect(route.chapterNumber).toBe(8)
  })

  it("routes analyze-outline-then-generate-chapter requests into chapter writing", () => {
    const route = routeTask("分析大纲内容去生成第3章")

    expect(route.intent).toBe("write_chapter")
    expect(route.chapterNumber).toBe(3)
  })

  it("does not hijack a customized next-chapter prompt that mentions 开篇 writing requirements (issue #9)", () => {
    const route = routeTask(
      "请根据当前小说上下文、记忆库、最新章节结尾、下一章推进建议和章纲，继续生成下一章正文。只输出可直接保存到章节库的小说正文，不要解释，不要列提纲。正文必须是完整章节，内容要吸引读者，留住读者，目标约 3000 字，建议 2800-3400 字，低于 2600 字视为未完成，开篇200字内必须制造'钩子'。",
    )

    expect(route.intent).toBe("continue_chapter")
    expect(route.chapterNumber).toBeUndefined()
  })

  it("does not treat incidental 第一章 mentions in next-chapter requests as opening requests", () => {
    const route = routeTask("继续生成下一章正文，不要重复第一章的内容。")

    expect(route.intent).toBe("continue_chapter")
    expect(route.chapterNumber).toBeUndefined()
  })

  it("keeps explicit later chapter numbers even when the prompt mentions 开篇 hooks", () => {
    const route = routeTask("写第5章，开篇要有钩子")

    expect(route.intent).toBe("write_chapter")
    expect(route.chapterNumber).toBe(5)
  })
})
