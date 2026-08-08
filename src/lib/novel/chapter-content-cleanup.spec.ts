import { describe, expect, it } from "vitest"

import {
  cleanGeneratedChapterContentForSave,
  cleanGeneratedChapterContentWithTitle,
  isPlausibleChapterTitleLine,
} from "./chapter-content-cleanup"

describe("isPlausibleChapterTitleLine", () => {
  it("接受真实章名", () => {
    expect(isPlausibleChapterTitleLine("# 第32章 查分夜")).toBe(true)
    expect(isPlausibleChapterTitleLine("第13章 风雪来客")).toBe(true)
  })

  it("拒绝完成通知伪标题", () => {
    expect(isPlausibleChapterTitleLine("第 32 章正文已按章纲重写完成。")).toBe(false)
    expect(isPlausibleChapterTitleLine("# 第32章正文已重写完成")).toBe(false)
  })
})

describe("cleanGeneratedChapterContentWithTitle", () => {
  it("提取 Markdown 章节标题，但不把标题重复保存在正文中", () => {
    expect(cleanGeneratedChapterContentWithTitle("# 第12章 夜雨归人\n\n雨落在旧宅门前。\n\n他推门而入。"))
      .toEqual({
        title: "第12章 夜雨归人",
        content: "雨落在旧宅门前。\n\n他推门而入。",
      })
  })

  it("提取纯文本章节标题，但不把标题重复保存在正文中", () => {
    expect(cleanGeneratedChapterContentWithTitle("第13章 风雪来客\n\n风雪压住了脚步声。"))
      .toEqual({
        title: "第13章 风雪来客",
        content: "风雪压住了脚步声。",
      })
  })

  it("没有章节标题时保留正文首行", () => {
    expect(cleanGeneratedChapterContentWithTitle("雨落在旧宅门前。\n\n他推门而入。"))
      .toEqual({
        title: null,
        content: "雨落在旧宅门前。\n\n他推门而入。",
      })
  })

  it("不把完成通知当作章节标题提取", () => {
    expect(cleanGeneratedChapterContentWithTitle("第 32 章正文已按章纲重写完成。"))
      .toEqual({
        title: null,
        content: "第 32 章正文已按章纲重写完成。",
      })
  })
})

describe("cleanGeneratedChapterContentForSave", () => {
  it.each([
    "# 第12章 夜雨归人\n\n正文内容。",
    "第12章 夜雨归人\n\n正文内容。",
  ])("保存时移除章节标题：%s", (content) => {
    expect(cleanGeneratedChapterContentForSave(content)).toBe("正文内容。")
  })
})
