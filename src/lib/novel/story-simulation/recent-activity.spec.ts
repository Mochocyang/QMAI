import { describe, expect, it } from "vitest"
import {
  buildRecentActivity,
  RECENT_ACTIVITY_LIMIT,
  type RecentActivityItem,
} from "./recent-activity"
import type { ScenarioSession } from "./scenario-types"
import type { StoryFramework } from "./types"

/*
 * 「最近」区块的核心是**归并排序**：三类历史来自三个各自独立的存储、
 * 排序依据也各不相同（框架按 createdAt、情景按 updatedAt、结果按文件名时间戳），
 * 不能直接拼接。这里逐条钉住归并规则 —— 组件那侧只负责渲染，
 * 这个模块负责「顺序对不对、该带什么字段」。
 */

function framework(id: string, createdAt: string, extra: Partial<StoryFramework> = {}): StoryFramework {
  return {
    id,
    title: `框架 ${id}`,
    premise: "",
    targetWords: 10000,
    simulationMode: "hybrid",
    sourceChapters: 5,
    nodes: [],
    createdAt,
    ...extra,
  }
}

function scenario(id: string, updatedAt: string, extra: Partial<ScenarioSession> = {}): ScenarioSession {
  return {
    id,
    title: `情景 ${id}`,
    setup: {} as ScenarioSession["setup"],
    messages: [],
    status: "completed",
    createdAt: updatedAt,
    updatedAt,
    ...extra,
  }
}

function result(frameworkId: string, resultId: string, createdAt: string) {
  return { frameworkId, resultId, title: `结果 ${resultId}`, createdAt }
}

const kinds = (items: RecentActivityItem[]) => items.map((i) => `${i.kind}:${i.id}`)

describe("buildRecentActivity（最近时间线）", () => {
  it("三类历史按时间混排，而不是各占一段", () => {
    const items = buildRecentActivity({
      frameworks: [
        framework("f-old", "2026-10-01T00:00:00.000Z"),
        framework("f-new", "2026-10-09T00:00:00.000Z"),
      ],
      scenarios: [scenario("s-mid", "2026-10-05T00:00:00.000Z")],
      results: [result("f-old", "r-mid2", "2026-10-07T00:00:00.000Z")],
      limit: 0,
    })

    expect(kinds(items)).toEqual([
      "framework:f-new",
      "result:r-mid2",
      "scenario:s-mid",
      "framework:f-old",
    ])
  })

  it("情景用 updatedAt 排序（续聊过的会话应该排到前面）", () => {
    const items = buildRecentActivity({
      scenarios: [
        scenario("s-early", "2026-10-02T00:00:00.000Z"),
        // createdAt 很早，但 updatedAt 最新 —— 应该排第一
        scenario("s-resumed", "2026-10-09T00:00:00.000Z", {
          createdAt: "2026-09-01T00:00:00.000Z",
        }),
      ],
      limit: 0,
    })

    expect(kinds(items)).toEqual(["scenario:s-resumed", "scenario:s-early"])
  })

  /*
   * 结果条目必须带上所属框架 —— 点击它时要先把那个框架设为当前框架，
   * 报告页才知道自己在看哪份框架下的报告。丢了它就只能跳到报告页但没上下文。
   */
  it("结果条目带出所属框架 id", () => {
    const items = buildRecentActivity({
      results: [result("fw-1", "r-1", "2026-10-05T00:00:00.000Z")],
    })

    expect(items[0]).toMatchObject({ kind: "result", id: "r-1", frameworkId: "fw-1" })
  })

  it("按 limit 截断，默认 5 条", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      framework(`f${i}`, `2026-10-0${(i % 9) + 1}T00:00:00.000Z`),
    )
    const items = buildRecentActivity({ frameworks: many })
    expect(items).toHaveLength(RECENT_ACTIVITY_LIMIT)
    expect(items).toHaveLength(5)
  })

  it("limit 为 0 表示不截断", () => {
    const many = Array.from({ length: 9 }, (_, i) => framework(`f${i}`, "2026-10-01T00:00:00.000Z"))
    expect(buildRecentActivity({ frameworks: many, limit: 0 })).toHaveLength(9)
  })

  it("时间戳坏掉的记录排到最后，而不是被当成 1970 挤掉正常记录", () => {
    const items = buildRecentActivity({
      frameworks: [
        framework("f-broken", "not-a-date"),
        framework("f-ok", "2026-01-01T00:00:00.000Z"),
      ],
      limit: 0,
    })
    expect(kinds(items)).toEqual(["framework:f-ok", "framework:f-broken"])
  })

  it("标题为空时交给 UI 兜底（这里返回空串，不写死中文）", () => {
    const items = buildRecentActivity({
      frameworks: [framework("f", "2026-10-01T00:00:00.000Z", { title: "   " })],
      scenarios: [scenario("s", "2026-10-01T00:00:00.000Z", { title: "" })],
      results: [{ frameworkId: "f", resultId: "r", title: "  ", createdAt: "2026-10-01T00:00:00.000Z" }],
      limit: 0,
    })
    expect(items.map((i) => i.title)).toEqual(["", "", ""])
  })

  it("带出数量信息：框架的节点数、情景的发言条数", () => {
    const items = buildRecentActivity({
      frameworks: [
        framework("f", "2026-10-02T00:00:00.000Z", {
          nodes: [
            { index: 0 } as StoryFramework["nodes"][number],
            { index: 1 } as StoryFramework["nodes"][number],
          ],
        }),
      ],
      scenarios: [
        scenario("s", "2026-10-01T00:00:00.000Z", {
          messages: [{ id: "m1" } as ScenarioSession["messages"][number]],
        }),
      ],
      limit: 0,
    })
    expect(items[0]).toMatchObject({ kind: "framework", nodeCount: 2 })
    expect(items[1]).toMatchObject({ kind: "scenario", messageCount: 1 })
  })

  it("全都为空时返回空数组（落地页据此隐藏整块）", () => {
    expect(buildRecentActivity()).toEqual([])
    expect(buildRecentActivity({ frameworks: [], scenarios: [], results: [] })).toEqual([])
  })
})
