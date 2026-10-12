import { describe, expect, it, vi } from "vitest"

import {
  SCENARIO_REFERENCE_MAX_CHARS,
  SCENARIO_REFERENCE_PER_SOURCE_CHARS,
  SCENARIO_REFERENCE_TOP_K,
  collectScenarioReferenceMaterial,
} from "./scenario-reference"

function result(path: string, title: string, snippet = "片段") {
  return { path, title, snippet, titleMatch: false, score: 1, images: [] }
}

/** 只关心「搜到哪些、读到什么」，把 IO 全部注入掉。 */
function deps(
  results: ReturnType<typeof result>[],
  files: Record<string, string> = {},
) {
  return {
    search: vi.fn(async () => results),
    read: vi.fn(async (path: string) => {
      if (path in files) return files[path]
      throw new Error(`ENOENT ${path}`)
    }),
  }
}

describe("collectScenarioReferenceMaterial", () => {
  it("没填参考点时完全不检索", async () => {
    const d = deps([result("/p/wiki/a.md", "A")])
    const out = await collectScenarioReferenceMaterial("/p", "   ", d)

    expect(d.search).not.toHaveBeenCalled()
    expect(out).toEqual({ text: "", sources: [], truncated: false })
  })

  it("把命中的资料页内容拼成注入文本，并回报来源", async () => {
    const d = deps(
      [result("/p/wiki/zhongyong.md", "中庸"), result("/p/wiki/lunyu.md", "论语")],
      {
        "/p/wiki/zhongyong.md": "天命之谓性，率性之谓道。",
        "/p/wiki/lunyu.md": "学而时习之。",
      },
    )
    const out = await collectScenarioReferenceMaterial("/p", "中庸", d)

    expect(out.text).toContain("中庸")
    expect(out.text).toContain("天命之谓性")
    expect(out.text).toContain("学而时习之")
    expect(out.sources).toEqual(["/p/wiki/zhongyong.md", "/p/wiki/lunyu.md"])
    expect(out.truncated).toBe(false)
  })

  it("只取前 TOP_K 条，不把整库灌进去", async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      result(`/p/wiki/${i}.md`, `第${i}篇`),
    )
    const d = deps(many, Object.fromEntries(many.map((r) => [r.path, "内容"])))
    const out = await collectScenarioReferenceMaterial("/p", "甲", d)

    expect(SCENARIO_REFERENCE_TOP_K).toBe(5)
    expect(out.sources).toHaveLength(5)
    expect(d.read).toHaveBeenCalledTimes(5)
  })

  it("单页超长时截断，并标记 truncated", async () => {
    const long = "字".repeat(SCENARIO_REFERENCE_PER_SOURCE_CHARS + 500)
    const d = deps([result("/p/wiki/long.md", "长文")], {
      "/p/wiki/long.md": long,
    })
    const out = await collectScenarioReferenceMaterial("/p", "长", d)

    expect(out.truncated).toBe(true)
    expect(out.text).toContain("（已截断）")
    // 单页正文不超过预算（标题与提示语另算，所以给一点余量）
    expect(out.text.length).toBeLessThan(SCENARIO_REFERENCE_PER_SOURCE_CHARS + 200)
  })

  it("总量超过上限时按上限截住", async () => {
    const files: Record<string, string> = {}
    const results = Array.from({ length: 5 }, (_, i) => {
      const p = `/p/wiki/${i}.md`
      files[p] = "字".repeat(SCENARIO_REFERENCE_PER_SOURCE_CHARS)
      return result(p, `第${i}篇`)
    })
    const out = await collectScenarioReferenceMaterial("/p", "甲", deps(results, files))

    expect(out.text.length).toBeLessThanOrEqual(SCENARIO_REFERENCE_MAX_CHARS + 200)
    expect(out.truncated).toBe(true)
  })

  it("读不到正文时退回搜索片段，而不是丢掉这条命中", async () => {
    const d = deps([result("/p/wiki/x.md", "X", "这是片段内容")])
    const out = await collectScenarioReferenceMaterial("/p", "X", d)

    expect(out.text).toContain("这是片段内容")
    expect(out.sources).toEqual(["/p/wiki/x.md"])
  })

  it("检索炸掉时不抛出，让情景照常开演", async () => {
    const d = {
      search: vi.fn(async () => {
        throw new Error("wiki 目录不存在")
      }),
      read: vi.fn(),
    }
    const out = await collectScenarioReferenceMaterial("/p", "中庸", d)

    expect(out).toEqual({ text: "", sources: [], truncated: false })
  })

  it("一条都没搜到时给出空结果", async () => {
    const out = await collectScenarioReferenceMaterial("/p", "查无此书", deps([]))
    expect(out.text).toBe("")
    expect(out.sources).toEqual([])
  })
})
