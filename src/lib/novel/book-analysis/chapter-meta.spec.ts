import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildChapterMetaEntry,
  computeDialogueRatio,
  estimateSceneCount,
  excerptChapterBody,
  formatChapterMetaForMarkdown,
  loadChapterMeta,
  scoreChapterMeta,
  selectRelevantChapters,
  upsertChapterMeta,
  type ChapterMetaEntry,
  type ChapterMetaStoreIo,
} from "./chapter-meta"

const BOOK_PATH = "E:/Novel/book-analysis/book-1"

function memoryIo(): { io: ChapterMetaStoreIo; mem: Map<string, string> } {
  const mem = new Map<string, string>()
  return {
    mem,
    io: {
      createDirectory: vi.fn(async () => {}),
      fileExists: vi.fn(async (path: string) => mem.has(path)),
      readFile: vi.fn(async (path: string) => {
        if (!mem.has(path)) throw new Error("ENOENT")
        return mem.get(path)!
      }),
      writeFileAtomic: vi.fn(async (path: string, content: string) => { mem.set(path, content) }),
    },
  }
}

function entry(overrides: Partial<ChapterMetaEntry> = {}): ChapterMetaEntry {
  return {
    chapterId: "ch-0001",
    order: 1,
    title: "宗门试炼",
    wordCount: 1200,
    hookType: "冲突式",
    structurePattern: "冲突章",
    sceneCount: 2,
    topicTags: ["宗门试炼"],
    dialogueRatio: 0.4,
    updatedAt: 1,
    ...overrides,
  }
}

describe("estimateSceneCount", () => {
  it("按连续空行切场景", () => {
    expect(estimateSceneCount("场景一。\n\n\n场景二。")).toBe(2)
  })

  it("按分隔符行切场景", () => {
    expect(estimateSceneCount("场景一。\n***\n场景二。")).toBe(2)
  })

  it("单场景返回 1", () => {
    expect(estimateSceneCount("只有一段。\n紧接着一段。")).toBe(1)
  })

  it("空正文返回 0", () => {
    expect(estimateSceneCount("   ")).toBe(0)
  })
})

describe("computeDialogueRatio", () => {
  it("统计含引号段落的占比", () => {
    expect(computeDialogueRatio("“你来了。”\n他点头。")).toBe(0.5)
  })

  it("无段落时返回 0", () => {
    expect(computeDialogueRatio("")).toBe(0)
  })

  it("识别直角引号", () => {
    expect(computeDialogueRatio("「你来了。」")).toBe(1)
  })
})

describe("buildChapterMetaEntry", () => {
  it("脚本字段现算，模型字段取标注", () => {
    const result = buildChapterMetaEntry({
      chapterId: "ch-0001",
      order: 3,
      title: "试炼",
      body: "“来了。”\n他点头。\n\n\n第二天。",
      annotation: { chapterId: "ch-0001", hookType: "对白式", structurePattern: "推进章", topicTags: ["试炼"] },
      now: 99,
    })

    expect(result.hookType).toBe("对白式")
    expect(result.topicTags).toEqual(["试炼"])
    expect(result.sceneCount).toBe(2)
    expect(result.dialogueRatio).toBeGreaterThan(0)
    expect(result.wordCount).toBeGreaterThan(0)
    expect(result.updatedAt).toBe(99)
  })

  it("没有标注时模型字段留空而不是瞎猜", () => {
    const result = buildChapterMetaEntry({
      chapterId: "ch-0001", order: 1, title: "", body: "他走了。", now: 1,
    })
    expect(result.hookType).toBe("")
    expect(result.structurePattern).toBe("")
    expect(result.topicTags).toEqual([])
    expect(result.sceneCount).toBe(1)
  })
})

describe("chapter meta 存储", () => {
  let ctx = memoryIo()
  beforeEach(() => { ctx = memoryIo() })

  it("文件不存在时返回空集合", async () => {
    const collection = await loadChapterMeta(BOOK_PATH, ctx.io)
    expect(collection.entries).toEqual([])
    expect(collection.bookId).toBe("book-1")
  })

  it("写入后可读回，并按 order 排序", async () => {
    await upsertChapterMeta(BOOK_PATH, [entry({ chapterId: "ch-0002", order: 2 }), entry()], ctx.io)
    const collection = await loadChapterMeta(BOOK_PATH, ctx.io)
    expect(collection.entries.map((item) => item.chapterId)).toEqual(["ch-0001", "ch-0002"])
  })

  it("按 chapterId 覆盖，不影响其他章", async () => {
    await upsertChapterMeta(BOOK_PATH, [entry(), entry({ chapterId: "ch-0002", order: 2 })], ctx.io)
    await upsertChapterMeta(BOOK_PATH, [entry({ hookType: "悬念式" })], ctx.io)

    const collection = await loadChapterMeta(BOOK_PATH, ctx.io)
    expect(collection.entries).toHaveLength(2)
    expect(collection.entries[0].hookType).toBe("悬念式")
    expect(collection.entries[1].hookType).toBe("冲突式")
  })

  it("文件内容损坏时返回空集合而不抛错", async () => {
    ctx.mem.set(`${BOOK_PATH}/analysis/chapter-meta.json`, "{ 不是 JSON")
    expect((await loadChapterMeta(BOOK_PATH, ctx.io)).entries).toEqual([])
  })

  it("版本号不符时返回空集合", async () => {
    ctx.mem.set(`${BOOK_PATH}/analysis/chapter-meta.json`, JSON.stringify({ version: 99, bookId: "b", entries: [{}] }))
    expect((await loadChapterMeta(BOOK_PATH, ctx.io)).entries).toEqual([])
  })
})

describe("scoreChapterMeta", () => {
  it("题材标签命中权重最高", () => {
    const tagHit = scoreChapterMeta(entry({ title: "无关", hookType: "", structurePattern: "" }), ["宗门试炼"])
    const titleHit = scoreChapterMeta(entry({ topicTags: [], hookType: "", structurePattern: "" }), ["宗门试炼"])
    expect(tagHit).toBeGreaterThan(titleHit)
  })

  it("完全不命中得 0", () => {
    expect(scoreChapterMeta(entry(), ["炼丹炉"])).toBe(0)
  })

  it("空查询得 0", () => {
    expect(scoreChapterMeta(entry(), [])).toBe(0)
  })
})

describe("selectRelevantChapters", () => {
  const entries = [
    entry({ chapterId: "ch-0001", order: 1, topicTags: ["宗门试炼"], title: "试炼开始" }),
    entry({ chapterId: "ch-0002", order: 2, topicTags: ["赶路"], title: "山路" }),
    entry({ chapterId: "ch-0003", order: 3, topicTags: ["宗门试炼"], title: "试炼决胜" }),
    entry({ chapterId: "ch-0004", order: 4, topicTags: ["炼丹"], title: "炉火" }),
  ]

  it("优先返回题材命中的章节", () => {
    const picked = selectRelevantChapters(entries, "写一场宗门试炼的对决", 2)
    expect(picked.map((item) => item.chapterId).sort()).toEqual(["ch-0001", "ch-0003"])
  })

  it("命中超额时取 order 更大的（更近的）", () => {
    const picked = selectRelevantChapters(entries, "宗门试炼", 1)
    expect(picked[0].chapterId).toBe("ch-0003")
  })

  it("命中不足时补齐到 limit", () => {
    const picked = selectRelevantChapters(entries, "炼丹", 3)
    expect(picked).toHaveLength(3)
    expect(picked[0].chapterId).toBe("ch-0004")
  })

  it("完全不命中时也返回 limit 条", () => {
    const picked = selectRelevantChapters(entries, "外星人入侵", 2)
    expect(picked).toHaveLength(2)
  })

  it("章节数少于 limit 时返回全部且不重复", () => {
    const picked = selectRelevantChapters(entries.slice(0, 2), "宗门试炼", 5)
    expect(picked).toHaveLength(2)
    expect(new Set(picked.map((item) => item.chapterId)).size).toBe(2)
  })

  it("空输入或 limit 为 0 时返回空", () => {
    expect(selectRelevantChapters([], "试炼", 5)).toEqual([])
    expect(selectRelevantChapters(entries, "试炼", 0)).toEqual([])
  })
})

describe("excerptChapterBody", () => {
  it("跳过 markdown 标题行", () => {
    expect(excerptChapterBody("# 第一章\n他走了。", 100)).toBe("他走了。")
  })

  it("按句截断而不是切在句中", () => {
    const excerpt = excerptChapterBody("他走了。她没动。真的吗？", 10)
    expect(excerpt).toBe("他走了。她没动。")
  })

  it("正文短于上限时全量返回", () => {
    expect(excerptChapterBody("他走了。", 100)).toBe("他走了。")
  })

  it("首句就超限时硬截断而不是返回空", () => {
    const excerpt = excerptChapterBody(`${"很长".repeat(50)}。`, 10)
    expect(excerpt).toHaveLength(10)
  })

  it("空正文返回空串", () => {
    expect(excerptChapterBody("   ", 100)).toBe("")
  })
})

describe("formatChapterMetaForMarkdown", () => {
  it("渲染表格", () => {
    const markdown = formatChapterMetaForMarkdown([entry()])
    expect(markdown).toContain("| 章节 | 标题 |")
    expect(markdown).toContain("ch-0001")
    expect(markdown).toContain("宗门试炼")
    expect(markdown).toContain("40.0%")
  })

  it("空标注给出占位说明", () => {
    expect(formatChapterMetaForMarkdown([])).toBe("（无章节标注）")
  })

  it("缺字段时用占位符而不是留空单元格", () => {
    const markdown = formatChapterMetaForMarkdown([entry({ title: "", hookType: "", topicTags: [] })])
    expect(markdown).toContain("—")
  })
})
