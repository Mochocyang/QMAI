/**
 * 内容包测试（设计第 4 章 / 决策 D4）。
 *
 * 内容包是"安装时装好、之后一直可用"的东西，所以校验必须发生在**加载时**：
 * 一个坏包若放进内存，之后每次搜索/筛选都在半残数据上跑，用户只会觉得
 * "这个灵感库是坏的"，而作者永远收不到可行动的报错。
 */
import { describe, expect, it } from "vitest"
import {
  DEFAULT_MAX_CONTENT_ITEMS,
  collectTags,
  filterContentItems,
  parseContentPack,
} from "./content-pack"
import type { ContentPackItem } from "./types"

const decl = { id: "scifi", title: "科幻灵感包" }

function item(overrides: Partial<ContentPackItem> = {}): ContentPackItem {
  return {
    id: "i001",
    title: "最后一班地铁",
    body: "末班车只有七个人，其中六个没有影子。",
    tags: ["都市", "悬疑"],
    ...overrides,
  }
}

describe("parseContentPack", () => {
  it("合法内容包原样收下，id / title 取自声明", () => {
    const result = parseContentPack(
      { version: 1, items: [item(), item({ id: "i002", title: "第二" })] },
      decl,
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.pack.id).toBe("scifi")
      expect(result.pack.title).toBe("科幻灵感包")
      expect(result.pack.items).toHaveLength(2)
      expect(result.pack.items[0]).toEqual(item())
    }
  })

  it("没有 tags 的条目也合法", () => {
    const result = parseContentPack(
      { version: 1, items: [{ id: "a", title: "t", body: "b" }] },
      decl,
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.pack.items[0]).not.toHaveProperty("tags")
  })

  it("不是对象直接拒绝", () => {
    for (const raw of [null, undefined, "字符串", 42, [1, 2]]) {
      const result = parseContentPack(raw, decl)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.join()).toContain("内容包必须是 JSON 对象")
    }
  })

  it("version 必须为数字 1：字符串 \"1\" 也拒绝", () => {
    const withVersion2 = parseContentPack({ version: 2, items: [] }, decl)
    expect(withVersion2.ok).toBe(false)
    if (!withVersion2.ok) expect(withVersion2.errors.join()).toContain("version 必须为 1")

    const stringVersion = parseContentPack({ version: "1", items: [] }, decl)
    expect(stringVersion.ok).toBe(false)
    if (!stringVersion.ok) expect(stringVersion.errors.join()).toContain("version 必须为 1")
  })

  it("items 必须是数组", () => {
    const result = parseContentPack({ version: 1, items: {} }, decl)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join()).toContain("items 必须是数组")
  })

  it("缺 id / title / body 报错，并指出条目位置", () => {
    const result = parseContentPack(
      { version: 1, items: [{ id: "a", title: "标题" }, item({ body: "   " })] },
      decl,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      const message = result.errors.join("\n")
      expect(message).toContain("第 1 条")
      expect(message).toContain("body")
      expect(message).toContain("第 2 条")
      expect(message).toContain("body")
    }
  })

  it("重复 id 报错，且错误里带上重复的那个值", () => {
    const result = parseContentPack(
      { version: 1, items: [item({ id: "dup-1" }), item({ id: "dup-1" })] },
      decl,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      const message = result.errors.join("\n")
      expect(message).toContain("重复")
      // 几万条里只说"有重复"等于没说，必须点名是哪个 id
      expect(message).toContain("dup-1")
      expect(message).toContain("第 2 条")
    }
  })

  it("id 去空白后再判重：\" i001 \" 与 \"i001\" 算重复", () => {
    const result = parseContentPack(
      { version: 1, items: [item({ id: "i001" }), item({ id: " i001 " })] },
      decl,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join("\n")).toContain("i001")
  })

  it("tags 必须是字符串数组", () => {
    // 故意塞一个数字：内容包是第三方 JSON，运行时什么都可能进来，类型只是声明面
    const dirtyTags = ["都市", 7] as unknown as string[]
    const result = parseContentPack(
      { version: 1, items: [item(), item({ id: "i002", tags: dirtyTags })] },
      decl,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join()).toContain("tags 必须是字符串数组")
  })

  it("超过声明上限时报错", () => {
    const result = parseContentPack(
      {
        version: 1,
        items: [item({ id: "a" }), item({ id: "b" }), item({ id: "c" })],
      },
      { ...decl, maxItems: 2 },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join()).toContain("超过上限 2")
  })

  it("未声明 maxItems 时用默认 5000 条", () => {
    const atLimit = Array.from({ length: DEFAULT_MAX_CONTENT_ITEMS }, (_, index) =>
      item({ id: `i${index}` }),
    )
    expect(parseContentPack({ version: 1, items: atLimit }, decl).ok).toBe(true)

    const overLimit = [...atLimit, item({ id: "overflow" })]
    const result = parseContentPack({ version: 1, items: overLimit }, decl)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join()).toContain(String(DEFAULT_MAX_CONTENT_ITEMS))
  })

  it("错误一次性列出全部，而不是遇到第一个就返回", () => {
    const result = parseContentPack(
      { version: 2, items: [{ id: "" }, "不是对象"] },
      decl,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3)
  })
})

describe("filterContentItems", () => {
  const items: ContentPackItem[] = [
    item({ id: "a", title: "Cyber City", body: "霓虹与雨", tags: ["科幻", "赛博"] }),
    item({ id: "b", title: "末日余晖", body: "最后一个人关掉了灯", tags: ["科幻", "末世"] }),
    item({ id: "c", title: "地铁末班", body: "六个没有影子的人", tags: ["悬疑"] }),
  ]

  it("无条件时原样返回（连数组都不复制）", () => {
    expect(filterContentItems(items, "", [])).toBe(items)
    expect(filterContentItems(items, "   ", [])).toBe(items)
  })

  it("按标题命中，大小写不敏感", () => {
    expect(filterContentItems(items, "cyber", []).map((it) => it.id)).toEqual(["a"])
    expect(filterContentItems(items, "CYBER", []).map((it) => it.id)).toEqual(["a"])
  })

  it("按正文命中", () => {
    expect(filterContentItems(items, "没有影子", []).map((it) => it.id)).toEqual(["c"])
  })

  it("按标签命中正文里没有的词", () => {
    expect(filterContentItems(items, "末世", []).map((it) => it.id)).toEqual(["b"])
  })

  it("多个标签是 AND：同时具备才算命中", () => {
    expect(filterContentItems(items, "", ["科幻"]).map((it) => it.id)).toEqual(["a", "b"])
    expect(filterContentItems(items, "", ["科幻", "末世"]).map((it) => it.id)).toEqual(["b"])
    expect(filterContentItems(items, "", ["科幻", "悬疑"]).map((it) => it.id)).toEqual([])
  })

  it("关键词与标签同时生效", () => {
    expect(filterContentItems(items, "最后", ["科幻"]).map((it) => it.id)).toEqual(["b"])
    expect(filterContentItems(items, "最后", ["悬疑"]).map((it) => it.id)).toEqual([])
  })
})

describe("collectTags", () => {
  it("按出现条数降序", () => {
    const tags = collectTags([
      item({ tags: ["科幻", "末世"] }),
      item({ id: "b", tags: ["科幻", "alpha"] }),
      item({ id: "c", tags: ["末世"] }),
    ])

    expect(tags.map((entry) => entry.count)).toEqual([2, 2, 1])
    // 同数两条的顺序交给字典序，这里只要求它们排在一起（拼音序在断言里写死会绑死 ICU）
    expect(tags.slice(0, 2).map((entry) => entry.tag).sort()).toEqual(["末世", "科幻"].sort())
  })

  it("同数时按字典序，保证渲染顺序稳定", () => {
    const tags = collectTags([
      item({ tags: ["beta"] }),
      item({ id: "b", tags: ["alpha"] }),
      item({ id: "c", tags: ["gamma"] }),
    ])

    expect(tags).toEqual([
      { tag: "alpha", count: 1 },
      { tag: "beta", count: 1 },
      { tag: "gamma", count: 1 },
    ])
  })

  it("同一条里重复的标签只算一次", () => {
    expect(collectTags([item({ tags: ["科幻", "科幻"] })])).toEqual([{ tag: "科幻", count: 1 }])
  })

  it("没有标签的条目被忽略", () => {
    expect(collectTags([item({ tags: undefined }), item({ id: "b", tags: [] })])).toEqual([])
  })
})
