import { describe, expect, it } from "vitest"
import {
  applyReviewRewriteEditsToMarkdown,
  parseReviewRewritePlan,
} from "./review-rewrite-plan"

describe("review rewrite plan", () => {
  it("parses multiple original/replacement pairs from model JSON", () => {
    const raw = `\`\`\`json
[
  {
    "original_text": "手机由杨栋持有",
    "replacement_text": "手机已从杨栋转移到黑玉残镜手中",
    "note": "补足物品转移"
  },
  {
    "original_text": "黑玉残镜并未说明手机来源",
    "replacement_text": "黑玉残镜说明手机来自杨栋，并保留持有者痕迹"
  }
]
\`\`\``

    const edits = parseReviewRewritePlan(raw)

    expect(edits).toHaveLength(2)
    expect(edits[0]).toMatchObject({
      originalText: "手机由杨栋持有",
      replacementText: "手机已从杨栋转移到黑玉残镜手中",
      note: "补足物品转移",
    })
  })

  it("applies multiple edits only when each original text can be located", () => {
    const markdown = [
      "---",
      "type: chapter",
      "---",
      "",
      "# 第1章",
      "",
      "杨栋把手机塞进口袋，黑玉残镜没有解释它从何而来。",
      "孙小晴的病症显得异常。",
    ].join("\n")

    const result = applyReviewRewriteEditsToMarkdown(markdown, [
      {
        id: "a",
        originalText: "杨栋把手机塞进口袋",
        replacementText: "杨栋把手机交给黑玉残镜",
      },
      {
        id: "b",
        originalText: "孙小晴的病症显得异常",
        replacementText: "孙小晴的病症被补充为普通遗传病线索",
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.markdown).toContain("杨栋把手机交给黑玉残镜")
    expect(result.markdown).toContain("孙小晴的病症被补充为普通遗传病线索")
    expect(result.applied).toHaveLength(2)
  })

  it("reports unapplied edits instead of silently changing the wrong text", () => {
    const result = applyReviewRewriteEditsToMarkdown("# 第1章\n\n正文没有目标片段。", [
      {
        id: "a",
        originalText: "不存在的原文",
        replacementText: "不应该写入",
      },
    ])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failed[0].originalText).toBe("不存在的原文")
  })

  it("does not replace a partial evidence fragment when the full original text is missing", () => {
    const markdown = "# 第1章\n\n灶火就在不远处烧着，可她还是冷。她说话时，唇边透出白气。"

    const result = applyReviewRewriteEditsToMarkdown(markdown, [
      {
        id: "a",
        originalText: "灶火就在不远处烧着，可她还是冷。她说话时，缺少的半句并不在正文里。",
        replacementText: "灶火就在不远处烧着，可她还是冷。她说话时，唇边透出一线极淡的白气。",
      },
    ])

    expect(result.ok).toBe(false)
    expect(result.markdown).toBe(markdown)
  })

  it("locates original text when line breaks or spacing differ between the model output and markdown", () => {
    const markdown = [
      "# 第1章",
      "",
      "杨栋把手机塞进口袋，",
      "黑玉残镜没有解释它从何而来。",
      "",
      "孙小晴的病症显得异常。",
    ].join("\r\n")

    const result = applyReviewRewriteEditsToMarkdown(markdown, [
      {
        id: "a",
        originalText: "杨栋把手机塞进口袋， 黑玉残镜没有解释它从何而来。",
        replacementText: "杨栋把手机交给黑玉残镜，黑玉残镜低声说明它来自上一章的失踪现场。",
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.markdown).toContain("杨栋把手机交给黑玉残镜")
    expect(result.markdown).not.toContain("杨栋把手机塞进口袋")
  })

  it("does not guess when the same original text appears more than once", () => {
    const markdown = "# 第1章\n\n杨栋瑞碗的手顿了顿。\n杨栋瑞碗的手顿了顿。"

    const result = applyReviewRewriteEditsToMarkdown(markdown, [
      {
        id: "a",
        originalText: "杨栋瑞碗的手顿了顿。",
        replacementText: "杨栋瑞端碗的手微微一停。",
      },
    ])

    expect(result.ok).toBe(false)
    expect(result.markdown).toBe(markdown)
  })
})
