import { describe, expect, it } from "vitest"

import {
  cleanGeneratedChapterContentForDisplay,
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

  it.each([
    "正文：\n\n雨落在旧宅门前。",
    "正文:\n雨落在旧宅门前。",
    "【正文】\n\n雨落在旧宅门前。",
    "**正文**\n\n雨落在旧宅门前。",
    "以下是正文：\n\n雨落在旧宅门前。",
    "以下为本章正文\n\n雨落在旧宅门前。",
    "正文如下：\n\n雨落在旧宅门前。",
  ])("剥掉开头的正文标签：%s", (content) => {
    expect(cleanGeneratedChapterContentForSave(content)).toBe("雨落在旧宅门前。")
  })

  it("标签挡在章节标题前时仍能提取标题", () => {
    expect(cleanGeneratedChapterContentWithTitle("正文：\n第12章 夜雨归人\n\n雨落在旧宅门前。"))
      .toEqual({
        title: "第12章 夜雨归人",
        content: "雨落在旧宅门前。",
      })
  })

  it("不误删以「正文」开头的叙述句", () => {
    expect(cleanGeneratedChapterContentForSave("正文里写着他的名字。\n\n他合上书。"))
      .toBe("正文里写着他的名字。\n\n他合上书。")
  })
})

describe("cleanGeneratedChapterContentForDisplay", () => {
  it("保留章节标题行的 Markdown 形态并剥掉正文标签", () => {
    expect(cleanGeneratedChapterContentForDisplay("正文：\n# 第12章 夜雨归人\n\n雨落在旧宅门前。"))
      .toBe("# 第12章 夜雨归人\n\n雨落在旧宅门前。")
  })

  it("标题原本是纯文本时不添加 Markdown 标记", () => {
    expect(cleanGeneratedChapterContentForDisplay("第12章 夜雨归人\n\n雨落在旧宅门前。"))
      .toBe("第12章 夜雨归人\n\n雨落在旧宅门前。")
  })

  it("不裁剪正文结尾的对白，避免把台词当成助手话术", () => {
    const body = "他抬起头。\n\n「如果你愿意，我也可以继续等下一章的答案。」\n\n门外脚步声停了。"
    expect(cleanGeneratedChapterContentForDisplay(body)).toBe(body)
    expect(cleanGeneratedChapterContentForSave(body)).toBe("他抬起头。")
  })

  it("清洗后为空时退回原文，避免出现空气泡", () => {
    expect(cleanGeneratedChapterContentForDisplay("正文：")).toBe("正文：")
  })
})
