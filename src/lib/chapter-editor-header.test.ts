import { describe, expect, it } from "vitest"
import { buildChapterEditorHeader } from "./chapter-editor-header"

describe("buildChapterEditorHeader", () => {
  it("returns heading text, status label, word count label, and title input width", () => {
    const markdown = [
      "---",
      'title: "你好呀！"',
      "type: chapter",
      "chapter_status: draft",
      "---",
      "",
      "# 你好呀！",
      "",
      "这是正文。",
      "第二句。",
    ].join("\n")

    expect(buildChapterEditorHeader(markdown)).toEqual({
      heading: "你好呀！",
      status: "draft",
      statusLabel: "草稿",
      statusBadge: "草稿",
      wordCountLabel: `${"这是正文。第二句。".length}字`,
      titleInputWidthCh: 8,
    })
  })

  it("falls back to the frontmatter title when the chapter body has no heading yet", () => {
    const markdown = [
      "---",
      'title: "第2章"',
      "type: chapter",
      "chapter_status: draft",
      "---",
      "",
    ].join("\n")

    expect(buildChapterEditorHeader(markdown)).toEqual({
      heading: "第2章",
      status: "draft",
      statusLabel: "草稿",
      statusBadge: "草稿",
      wordCountLabel: "0字",
      titleInputWidthCh: 5,
    })
  })

  /*
   * 徽章是**两个字**且与长文案不同 —— 这是用户对徽章的核心要求
   * （「里面就两个字，比如"正式草稿"」）。
   *
   * 为什么单独列一条而不是只看 draft：`statusBadge` 最容易出的错
   * 就是"两个分支返回了同一个值"（复制粘贴时忘改），
   * 而 draft 分支单看是发现不了的。这条把 final 也钉上，
   * 两个分支各自的值就都被冻结了。
   */
  it("正式章节的徽章是「正式」两个字，与长文案「正式章节」不同", () => {
    const markdown = [
      "---",
      'title: "第3章"',
      "type: chapter",
      "chapter_status: final",
      "---",
      "",
      "# 第3章",
      "",
      "正文。",
    ].join("\n")

    const header = buildChapterEditorHeader(markdown)
    expect(header.status).toBe("final")
    expect(header.statusLabel).toBe("正式章节")
    expect(header.statusBadge).toBe("正式")
    // 徽章恰好两个字：多了就和标题一样长，少了信息不足以区分状态
    expect([...header.statusBadge]).toHaveLength(2)
  })

  it("磁盘上的老状态值（revised / archived / outline）按草稿读，不会被当成正式", () => {
    for (const legacy of ["revised", "archived", "outline"]) {
      const markdown = [
        "---",
        'title: "第4章"',
        "type: chapter",
        `chapter_status: ${legacy}`,
        "---",
        "",
        "# 第4章",
        "",
        "正文。",
      ].join("\n")

      const header = buildChapterEditorHeader(markdown)
      expect(header.status, `${legacy} 必须归成 draft`).toBe("draft")
      expect(header.statusBadge, `${legacy} 的徽章必须是草稿`).toBe("草稿")
    }
  })
})

/**
 * ── 记忆口径：用户要求「正式 = 已提取记忆」──
 *
 * 缺陷现场：第 6、15 章的文件里写着 `chapter_status: final`（09-30 批量导入时
 * 落下的），但 `.novel/snapshots/` 里没有它们的快照 —— 批量提取只跑到第 5 章。
 * 侧栏那一行因此没有绿点，而标题行徽章却显示绿色「正式」。
 *
 * 修法：由调用方声明口径。传了 `memoryExtracted` 就**完全**由它决定，
 * frontmatter 的 `chapter_status` 不再参与显示。
 *
 * ⚠️ 这组用例必须双向都钉：只钉「final + 未提取 → 草稿」的话，
 * 一个"永远返回草稿"的实现也能全绿。
 */
describe("buildChapterEditorHeader 的记忆口径", () => {
  const finalMarkdown = [
    "---",
    'title: "第6章-把她叫回来"',
    "type: chapter",
    "chapter_status: final",
    "---",
    "",
    "# 第6章-把她叫回来",
    "",
    "正文。",
  ].join("\n")

  const draftMarkdown = [
    "---",
    'title: "第19章 归元箓里的残灯"',
    "type: chapter",
    "chapter_status: draft",
    "---",
    "",
    "# 第19章 归元箓里的残灯",
    "",
    "正文。",
  ].join("\n")

  it("文件写着 final 但没有快照 → 显示草稿（用户报的第 6 章）", () => {
    const header = buildChapterEditorHeader(finalMarkdown, { memoryExtracted: false })
    expect(header.status).toBe("draft")
    expect(header.statusBadge).toBe("草稿")
    // 长文案也必须跟着走：否则徽章说草稿、悬停提示说「正式章节」，自相矛盾。
    expect(header.statusLabel).toBe("草稿")
  })

  it("文件写着 draft 但快照在 → 显示正式（反方向同样要成立）", () => {
    const header = buildChapterEditorHeader(draftMarkdown, { memoryExtracted: true })
    expect(header.status).toBe("final")
    expect(header.statusBadge).toBe("正式")
    expect(header.statusLabel).toBe("正式章节")
  })

  it("不传 memoryExtracted 时仍按 chapter_status（其它调用方与既有测试的口径不变）", () => {
    expect(buildChapterEditorHeader(finalMarkdown).status).toBe("final")
    expect(buildChapterEditorHeader(draftMarkdown).status).toBe("draft")
  })
})
