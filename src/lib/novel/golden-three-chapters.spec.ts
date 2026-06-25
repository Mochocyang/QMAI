import { describe, expect, it } from "vitest"
import {
  buildGoldenThreeChapterDirective,
  detectGoldenThreeChapterRequest,
} from "./golden-three-chapters"

describe("golden three chapter constraints", () => {
  it("treats first-three and opening requests as first chapter plus chapter two and three directions", () => {
    const result = detectGoldenThreeChapterRequest("生成前三章")

    expect(result.enabled).toBe(true)
    expect(result.targetChapter).toBe(1)
    expect(result.outputMode).toBe("first_chapter_with_directions")

    const directive = buildGoldenThreeChapterDirective(result)
    expect(directive).toContain("只生成第一章正文")
    expect(directive).toContain("第二章写作方向")
    expect(directive).toContain("第三章写作方向")
    expect(directive).toContain("300-500 字")
    expect(directive).toContain("穿越、前世、背景、设定只一笔带过")
  })

  it("treats first chapter and opening synonyms as golden opening requests", () => {
    for (const text of ["写首章", "开篇章节", "小说开头", "写开局"]) {
      const result = detectGoldenThreeChapterRequest(text)

      expect(result.enabled).toBe(true)
      expect(result.targetChapter).toBe(1)
      expect(result.outputMode).toBe("first_chapter_with_directions")
    }
  })

  it("keeps explicit second and third chapter requests chapter-only", () => {
    for (const [text, chapter] of [["生成第二章", 2], ["生成第三章", 3]] as const) {
      const result = detectGoldenThreeChapterRequest(text)

      expect(result.enabled).toBe(true)
      expect(result.targetChapter).toBe(chapter)
      expect(result.outputMode).toBe("chapter_only")

      const directive = buildGoldenThreeChapterDirective(result)
      expect(directive).toContain(`只生成第${chapter}章正文`)
      expect(directive).not.toContain("第二章写作方向")
      expect(directive).not.toContain("第三章写作方向")
      expect(directive).toContain("每段必须推动故事、冲突、人物关系、行动或期待")
    }
  })

  it("does not enable golden constraints for ordinary chapter continuation", () => {
    const result = detectGoldenThreeChapterRequest("继续生成下一章")

    expect(result.enabled).toBe(false)
    expect(buildGoldenThreeChapterDirective(result)).toBe("")
  })

  it("prefers the resolved chapter number over incidental 开篇/第一章 wording (issue #9)", () => {
    const customizedNextChapterPrompt =
      "请根据当前小说上下文、记忆库、最新章节结尾、下一章推进建议和章纲，继续生成下一章正文。开篇200字内必须制造'钩子'。"

    const chapterFour = detectGoldenThreeChapterRequest(customizedNextChapterPrompt, 4)
    expect(chapterFour.enabled).toBe(false)

    const chapterTwo = detectGoldenThreeChapterRequest(customizedNextChapterPrompt, 2)
    expect(chapterTwo.enabled).toBe(true)
    expect(chapterTwo.targetChapter).toBe(2)
    expect(chapterTwo.outputMode).toBe("chapter_only")
  })

  it("does not enable golden constraints from 开篇 writing requirements inside a longer prompt", () => {
    const result = detectGoldenThreeChapterRequest("继续生成下一章正文，开篇200字内必须制造'钩子'。")

    expect(result.enabled).toBe(false)
  })

  it("does not enable golden constraints when polishing mentions 开篇", () => {
    const result = detectGoldenThreeChapterRequest("帮我润色当前章节，开篇要更抓人一些，节奏不要拖。")

    expect(result.enabled).toBe(false)
  })
})
