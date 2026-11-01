/**
 * 插槽注册表的测试。
 *
 * 三个观察点都来自设计契约而不是实现细节：
 *   - 没写 slot 的 action 必须还能被用户看到（落 plugin-center）；
 *   - 写错 slot 的必须消失（否则作者永远发现不了拼写错误）；
 *   - 顺序必须稳定（不同输入顺序 → 相同渲染顺序）。
 */
import { describe, expect, it, vi } from "vitest"
import {
  DEFAULT_SLOT_ID,
  SLOT_IDS,
  buildSlotIndex,
  emptySlotIndex,
  isSlotId,
  slotBucket,
  type SlotActionEntry,
  type SlotPackEntry,
} from "./slots"
import type { ContentPack, DeclarativeAction } from "./declarative/types"

function action(overrides: Partial<DeclarativeAction> = {}): DeclarativeAction {
  return {
    id: "generate-titles",
    title: "生成书名",
    prompt: { system: "sys", user: "user" },
    output: { mode: "list", targets: [] },
    ...overrides,
  }
}

function actionEntry(
  pluginId: string,
  pluginName: string,
  overrides: Partial<DeclarativeAction> = {},
  grantedPermissions: string[] = [],
): SlotActionEntry {
  return { pluginId, pluginName, action: action(overrides), grantedPermissions }
}

function pack(overrides: Partial<ContentPack> = {}): ContentPack {
  return { id: "scifi", title: "科幻灵感包", items: [], ...overrides }
}

function packEntry(
  pluginId: string,
  pluginName: string,
  overrides: Partial<ContentPack> = {},
  grantedPermissions: string[] = [],
): SlotPackEntry {
  const entryPack = pack(overrides)
  // loadKey 是宿主取条目用的合成键；pack.id 保持包内 id（两者刻意不同，见 slots.ts）
  return { pluginId, pluginName, pack: entryPack, loadKey: `${pluginId}/${entryPack.id}`, grantedPermissions }
}

describe("buildSlotIndex", () => {
  it("每个插槽都有桶，空索引可直接使用", () => {
    const index = emptySlotIndex()
    for (const slot of SLOT_IDS) {
      expect(index[slot]).toEqual({ actions: [], packs: [] })
    }
  })

  it("action 没有 slot 时归到 plugin-center", () => {
    const index = buildSlotIndex([actionEntry("p1", "插件一")], [])

    expect(index[DEFAULT_SLOT_ID].actions).toHaveLength(1)
    expect(index[DEFAULT_SLOT_ID].actions[0].action.id).toBe("generate-titles")
    // 空串与纯空白同等于"没写"，同样落默认插槽
    const blank = buildSlotIndex([actionEntry("p1", "插件一", { slot: "   " })], [])
    expect(blank["plugin-center"].actions).toHaveLength(1)
  })

  it("未知 slot 被丢弃并 warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const index = buildSlotIndex([actionEntry("p1", "插件一", { slot: "chapter-toolbr" })], [])

    for (const slot of SLOT_IDS) expect(index[slot].actions).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain("chapter-toolbr")
    warn.mockRestore()
  })

  it("已知 slot 落到对应桶，内容包同理", () => {
    const index = buildSlotIndex(
      [actionEntry("p1", "插件一", { slot: "outline-toolbar" })],
      [packEntry("p1", "插件一", { slot: "inspiration-browser" })],
    )

    expect(index["outline-toolbar"].actions).toHaveLength(1)
    expect(index["outline-toolbar"].packs).toHaveLength(0)
    expect(index["inspiration-browser"].packs).toHaveLength(1)
  })

  it("同一插槽内按插件名、再按 action 标题排序，且与输入顺序无关", () => {
    const forward = buildSlotIndex(
      [
        actionEntry("pB", "乙插件", { id: "b2", title: "B 动作", slot: "plugin-center" }),
        actionEntry("pA", "甲插件", { id: "a2", title: "第二个", slot: "plugin-center" }),
        actionEntry("pA", "甲插件", { id: "a1", title: "第一个", slot: "plugin-center" }),
      ],
      [],
    )
    const backward = buildSlotIndex(
      [
        actionEntry("pA", "甲插件", { id: "a1", title: "第一个", slot: "plugin-center" }),
        actionEntry("pA", "甲插件", { id: "a2", title: "第二个", slot: "plugin-center" }),
        actionEntry("pB", "乙插件", { id: "b2", title: "B 动作", slot: "plugin-center" }),
      ],
      [],
    )

    const titles = forward["plugin-center"].actions.map((entry) => entry.action.title)
    expect(titles).toEqual(["第二个", "第一个", "B 动作"])
    expect(backward["plugin-center"].actions.map((entry) => entry.action.title)).toEqual(titles)
  })

  it("同名同插件的两项按 id 兜底排序，顺序仍然确定", () => {
    const a = buildSlotIndex(
      [
        actionEntry("p1", "插件一", { id: "z", title: "同名" }),
        actionEntry("p1", "插件一", { id: "a", title: "同名" }),
      ],
      [],
    )
    expect(a["plugin-center"].actions.map((entry) => entry.action.id)).toEqual(["a", "z"])
  })

  it("内容包按包标题排序", () => {
    const index = buildSlotIndex(
      [],
      [
        packEntry("p1", "插件一", { id: "b", title: "乙包" }),
        packEntry("p1", "插件一", { id: "a", title: "甲包" }),
      ],
    )
    expect(index["plugin-center"].packs.map((entry) => entry.pack.title)).toEqual(["甲包", "乙包"])
  })

  it("grantedPermissions 原样透传进桶里的 entry（执行器靠它判 fs:project-read）", () => {
    const index = buildSlotIndex(
      [actionEntry("p1", "插件一", { slot: "chapter-toolbar" }, ["fs:project-read"])],
      [packEntry("p1", "插件一", { slot: "inspiration-browser" }, ["fs:project-read", "net:https"])],
    )

    expect(index["chapter-toolbar"].actions[0].grantedPermissions).toEqual(["fs:project-read"])
    expect(index["inspiration-browser"].packs[0].grantedPermissions).toEqual([
      "fs:project-read",
      "net:https",
    ])
  })

  it("没有权限的 entry 保持空数组（注册表不替它编造权限）", () => {
    const index = buildSlotIndex([actionEntry("p1", "插件一")], [packEntry("p1", "插件一")])

    expect(index["plugin-center"].actions[0].grantedPermissions).toEqual([])
    expect(index["plugin-center"].packs[0].grantedPermissions).toEqual([])
  })
})

describe("isSlotId / slotBucket", () => {
  it("只认 6 个已知插槽", () => {
    expect(isSlotId("chapter-toolbar")).toBe(true)
    expect(isSlotId("plugin-center")).toBe(true)
    expect(isSlotId("chapter-toolbar ")).toBe(false)
    expect(isSlotId(undefined)).toBe(false)
    expect(isSlotId(3)).toBe(false)
  })

  it("取不存在的桶时退回空桶而不是 undefined", () => {
    const empty = { actions: [], packs: [] } as unknown as ReturnType<typeof emptySlotIndex>
    expect(slotBucket(empty, "analysis-toolbar")).toEqual({ actions: [], packs: [] })
  })
})
