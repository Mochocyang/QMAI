import { describe, expect, it } from "vitest"
import { renderStoryMapHtml } from "./story-map-renderer"
import { normalizeStoryMap, isStoryMapUsable, type StoryMap } from "./story-map-types"
import { parseStoryMapResult } from "./story-map-prompts"

function makeMap(): StoryMap {
  return normalizeStoryMap({
    bookId: "book-1",
    bookTitle: "测试书",
    createdAt: 1700000000000,
    raw: {
      mainLineLabel: "主角成长主线",
      mainSummary: "主角一路升级打怪",
      chapters: [
        {
          id: "ch-0001",
          order: 1,
          title: "第一章 起点",
          summary: "主角获得金手指",
          mainEvents: [
            { label: "获得传承 <b>意外</b>", beats: ["被追杀", "掉入洞穴"], characters: ["主角"], spinoff: "传承来历成谜" },
          ],
          branches: [
            { id: "b1", kind: "task", label: "寻宝任务", triggeredBy: "获得传承", events: [{ label: "接取任务", beats: [], characters: [] }] },
          ],
        },
        {
          id: "ch-0002",
          order: 2,
          title: "第二章 风波",
          summary: "主角初次显威",
          mainEvents: [{ label: "击败挑衅者", beats: ["被打压", "反杀"], characters: ["主角", "反派"] }],
          branches: [],
        },
      ],
    },
  })
}

describe("normalizeStoryMap", () => {
  it("正常结构完整保留并按 order 排序", () => {
    const map = makeMap()
    expect(map.chapters).toHaveLength(2)
    expect(map.chapters[0].mainEvents[0].label).toBe("获得传承 <b>意外</b>")
    expect(map.chapters[0].branches[0].kind).toBe("task")
    expect(map.chapters[0].branches[0].triggeredBy).toBe("获得传承")
  })

  it("脏数据兜底：无效章节被剔除、字段补默认值", () => {
    const map = normalizeStoryMap({
      bookId: "b",
      bookTitle: "t",
      raw: {
        chapters: [
          { summary: "", mainEvents: [] }, // 无内容 → 剔除
          { id: "ch-0001", summary: "有摘要", mainEvents: [{ label: "事件" }] },
          "garbage",
        ],
      },
    })
    expect(map.chapters).toHaveLength(1)
    expect(map.mainLineLabel).toBe("主线")
    expect(map.chapters[0].branches).toEqual([])
  })

  it("isStoryMapUsable 判定", () => {
    expect(isStoryMapUsable(makeMap())).toBe(true)
    expect(isStoryMapUsable(normalizeStoryMap({ bookId: "b", bookTitle: "t", raw: {} }))).toBe(false)
    expect(isStoryMapUsable(null)).toBe(false)
  })
})

describe("parseStoryMapResult", () => {
  it("解析带围栏 JSON 输出", () => {
    const raw = "```json\n{\"mainLineLabel\":\"主线A\",\"chapters\":[{\"id\":\"ch-0001\",\"order\":1,\"summary\":\"s\",\"mainEvents\":[{\"label\":\"e1\"}]}]}\n```"
    const map = parseStoryMapResult(raw, { bookId: "b", bookTitle: "t", chapterIds: ["ch-0001"] })
    expect(map).not.toBeNull()
    expect(map!.mainLineLabel).toBe("主线A")
    expect(map!.chapters[0].mainEvents[0].label).toBe("e1")
  })

  it("非 JSON 输出返回 null", () => {
    expect(parseStoryMapResult("抱歉我无法输出", { bookId: "b", bookTitle: "t", chapterIds: [] })).toBeNull()
  })
})

describe("renderStoryMapHtml", () => {
  it("渲染书名、主线、章节事件与分支标签", () => {
    const html = renderStoryMapHtml(makeMap())
    expect(html).toContain("《测试书》故事导图")
    expect(html).toContain("主角成长主线")
    expect(html).toContain("第 1 章")
    expect(html).toContain("击败挑衅者")
    expect(html).toContain("寻宝任务")
    expect(html).toContain("任务")
    expect(html).toContain("触发环节：获得传承")
    expect(html).toContain("<details")
  })

  it("HTML 转义原文中的标签，防注入", () => {
    const html = renderStoryMapHtml(makeMap())
    expect(html).not.toContain("<b>意外</b>")
    expect(html).toContain("&lt;b&gt;意外&lt;/b&gt;")
  })

  it("空导图渲染占位而不抛错", () => {
    const empty = normalizeStoryMap({ bookId: "b", bookTitle: "空书", raw: { chapters: [] } })
    const html = renderStoryMapHtml(empty)
    expect(html).toContain("未提取到章节内容")
  })
})
