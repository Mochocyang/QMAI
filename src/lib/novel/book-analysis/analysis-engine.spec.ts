import { describe, expect, it } from "vitest"
import { parseNovelChapters } from "./analysis-engine"

describe("parseNovelChapters 章节识别（锚定行首，防幻影章节）", () => {
  it("正文里的“第X章”跨章引用不会被误拆成章节", () => {
    const text = [
      "第一章 山间小村",
      "",
      "他想起前文第三章提到过的那件事。",
      "这一章里他又提到了第四章的内容。",
      "第二章 拜师",
      "",
      "正说话间，第五章的伏笔开始显现。",
      "第三章 下山",
      "",
      "（正文完）",
    ].join("\n")
    const chapters = parseNovelChapters(text)
    expect(chapters).toHaveLength(3)
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "第一章 山间小村",
      "第二章 拜师",
      "第三章 下山",
    ])
    expect(chapters.map((chapter) => chapter.order)).toEqual([1, 2, 3])
  })

  it("兼容“第X卷卷名+第X章标题”同行格式，标题不含卷名", () => {
    const text = [
      "第五卷名震一方第六百四十八章 至木灵婴",
      "",
      "这一卷的正文内容。",
      "第六百四十九章 预兆",
      "",
      "又一章正文。",
    ].join("\n")
    const chapters = parseNovelChapters(text)
    expect(chapters).toHaveLength(2)
    expect(chapters[0].title).toBe("第六百四十八章 至木灵婴")
    expect(chapters[1].title).toBe("第六百四十九章 预兆")
    // 章节正文应从章标题开始截取，行首的卷名前缀不会混入正文
    expect(chapters[0].content).not.toContain("第五卷名震一方")
    expect(chapters[0].content).toContain("这一卷的正文内容")
    expect(chapters[0].order).toBe(1)
    expect(chapters[1].order).toBe(2)
  })

  it("阿拉伯数字与中文数字章节号混合均可识别", () => {
    const text = [
      "第1章 起始",
      "正文一。",
      "第二章 推进",
      "正文二。",
      "第103章 大转折",
      "正文三。",
    ].join("\n")
    const chapters = parseNovelChapters(text)
    expect(chapters).toHaveLength(3)
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "第1章 起始",
      "第二章 推进",
      "第103章 大转折",
    ])
  })

  it("允许章节标题前带缩进（半角/全角空格、制表符）且标题不含缩进", () => {
    const text = [
      "  第一章 穿越",
      "正文一。",
      "　　第二章 觉醒",
      "正文二。",
      "\t第三章 终局",
      "正文三。",
    ].join("\n")
    const chapters = parseNovelChapters(text)
    expect(chapters).toHaveLength(3)
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "第一章 穿越",
      "第二章 觉醒",
      "第三章 终局",
    ])
    // 正文从章标题开始截取，缩进不会混入正文
    expect(chapters[0].content).toContain("第一章 穿越")
    expect(chapters[0].content).not.toMatch(/^[ \t\u3000]+第一章/)
  })

  it("没有章节标记时抛出明确错误", () => {
    expect(() => parseNovelChapters("这是一篇没有章节标题的小说正文。")).toThrow(
      "未能识别到章节标记",
    )
  })
})
