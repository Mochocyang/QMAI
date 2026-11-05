import { describe, expect, it } from "vitest"
import { routeTask } from "./task-router"

describe("routeTask golden opening requests", () => {
  it("does not force write_chapter for ambient opening phrases", async () => {
    for (const text of ["生成前三章", "写首章", "开篇章节", "小说开头", "写开局", "黄金三章"]) {
      const route = await routeTask(text, {
        classification: { intent: "general_chat", confidence: 0.4 },
      })

      expect(route.intent).toBe("general_chat")
      expect(route.confidence).toBe(0.4)
      expect(route.chapterNumber).toBeUndefined()
    }
  })

  it("parses explicit second and third chapter numbers while keeping the model intent", async () => {
    const second = await routeTask("生成第二章", {
      classification: { intent: "write_chapter", confidence: 0.88 },
    })
    const third = await routeTask("生成第三章", {
      classification: { intent: "write_chapter", confidence: 0.81 },
    })

    expect(second.intent).toBe("write_chapter")
    expect(second.chapterNumber).toBe(2)
    expect(second.confidence).toBe(0.88)
    expect(third.intent).toBe("write_chapter")
    expect(third.chapterNumber).toBe(3)
    expect(third.confidence).toBe(0.81)
  })
})
