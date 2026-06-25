import { describe, expect, it } from "vitest"
import { routeTask } from "./task-router"

describe("routeTask golden opening requests", () => {
  it("routes opening and first-three requests into chapter writing", () => {
    for (const text of ["生成前三章", "写首章", "开篇章节", "小说开头", "写开局"]) {
      const route = routeTask(text)

      expect(route.intent).toBe("write_chapter")
    }
  })

  it("routes explicit second and third chapter requests into chapter writing with chapter numbers", () => {
    const second = routeTask("生成第二章")
    const third = routeTask("生成第三章")

    expect(second.intent).toBe("write_chapter")
    expect(second.chapterNumber).toBe(2)
    expect(third.intent).toBe("write_chapter")
    expect(third.chapterNumber).toBe(3)
  })
})
