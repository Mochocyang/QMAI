import { describe, expect, it } from "vitest"
import {
  buildBookStoryFrameworkPrompt,
  buildPlotFrameworkDraftFromBookStoryOutput,
} from "./story-framework-extraction"

describe("book-analysis story framework extraction", () => {
  it("builds a selected-chapter prompt that requires the four story beats", () => {
    const prompt = buildBookStoryFrameworkPrompt({
      bookTitle: "测试作品",
      chapters: [
        {
          id: "ch-0001",
          title: "第一章",
          order: 1,
          content: "主角遇到危机。",
        },
      ],
    })

    expect(prompt).toContain("拆书作品：测试作品")
    expect(prompt).toContain("## 开局钩子")
    expect(prompt).toContain("## 铺垫")
    expect(prompt).toContain("## 爽点")
    expect(prompt).toContain("## 结尾钩子")
    expect(prompt).toContain("不得复用原作人物、设定、剧情和具体表达")
  })

  it("builds a plot framework draft from complete story framework output", () => {
    const markdown = [
      "## 框架归属与衔接",
      "属于：主线",
      "一句话可复用模板：先压后扬的误解反转",
      "",
      "## 开局钩子",
      "主角被误判，读者期待真相反转。",
      "## 铺垫",
      "用旁人轻视和规则压力持续加深期待。",
      "## 爽点",
      "主角用结果打破误判，释放压抑情绪。",
      "## 结尾钩子",
      "新的更高层误会出现，推动下一轮。",
    ].join("\n")

    const draft = buildPlotFrameworkDraftFromBookStoryOutput({
      bookId: "book-1",
      bookTitle: "测试作品",
      markdown,
      rangeChapterIds: ["ch-0001", "ch-0002"],
      createdAt: 123,
    })

    expect(draft?.id).toBe("framework-book-1-123")
    expect(draft?.title).toBe("先压后扬的误解反转")
    expect(draft?.sourceDismantlingProjectTitle).toBe("测试作品")
    expect(draft?.beats.hook).toContain("误判")
    expect(draft?.rangeChapterIds).toEqual(["ch-0001", "ch-0002"])
    expect(draft?.handcraftHints).toContain("作者手搓留白")
  })
})
