import { describe, expect, it } from "vitest"
import {
  SIGHTING_PREVIEW_MAX_CHAPTERS,
  extractMentionExcerpts,
  loadSightingExcerpts,
  selectExcerptChapters,
} from "./persona-sighting-preview"

/**
 * 候选预览的取句策略：**首次 1 章 + 最近 2 章，最多读 3 个文件**。
 *
 * 这条策略是性能与信息量的折中：出场 20 章就逐个读，等于每点一个候选
 * 读 20 个文件；而中间章节对「要不要建档」几乎没有增量信息 ——
 * 首次出场回答「他是谁」，最近两章回答「他还在不在」。
 */
describe("selectExcerptChapters", () => {
  it("出场 ≤ 3 章：全取", () => {
    expect(selectExcerptChapters([5, 6, 7])).toEqual([5, 6, 7])
    expect(selectExcerptChapters([12])).toEqual([12])
    expect(selectExcerptChapters([])).toEqual([])
  })

  it("出场 > 3 章：首次 1 章 + 最近 2 章", () => {
    const chapters = [1, 3, 5, 8, 12, 15, 19]
    const picked = selectExcerptChapters(chapters)
    expect(picked).toEqual([1, 15, 19])
    expect(picked).toHaveLength(SIGHTING_PREVIEW_MAX_CHAPTERS)
  })

  it("去重并升序；非法章号被丢掉", () => {
    expect(selectExcerptChapters([9, 9, 2, 0, -1, Number.NaN, 20, 21])).toEqual([2, 20, 21])
  })
})

describe("extractMentionExcerpts", () => {
  const body = [
    "雨还在下。地下铁门边上那个守卫伸手拦了一下，又缩了回去。",
    "杨寒没有理他，径直走进通道。",
    "铁门被撞开时，那个守卫第一个扔了棍子！",
    "他喊了一句什么，没人听清。",
  ].join("")

  it("只摘提到该名字的句子", () => {
    const hits = extractMentionExcerpts(body, ["守卫"])
    expect(hits).toHaveLength(2)
    expect(hits[0]).toContain("守卫伸手拦了一下")
    expect(hits[1]).toContain("第一个扔了棍子")
  })

  it("每章最多两句", () => {
    const hits = extractMentionExcerpts(body, ["守卫"])
    expect(hits.length).toBeLessThanOrEqual(2)
  })

  it("别名也能命中", () => {
    const hits = extractMentionExcerpts(body, ["铁门守卫", "守卫"])
    expect(hits.length).toBeGreaterThan(0)
  })

  it("没有命中时返回空数组", () => {
    expect(extractMentionExcerpts(body, ["张三"])).toEqual([])
    expect(extractMentionExcerpts(body, [])).toEqual([])
  })
})

describe("loadSightingExcerpts", () => {
  it("按策略只读最多 3 章，且单章失败不影响其它章", async () => {
    const read: number[] = []
    const result = await loadSightingExcerpts({
      projectPath: "/tmp/p",
      names: ["守卫"],
      chapters: [1, 2, 3, 4, 5, 6],
      resolveChapterPath: async (n) => (n === 6 ? null : `ch-${n}.md`),
      readChapterBody: async (path) => {
        read.push(Number(path.replace(/\D/g, "")))
        if (path === "ch-5.md") throw new Error("读不到")
        return "守卫站在门口。"
      },
    })
    // 策略选出 1、5、6；6 无文件、5 读失败 ⇒ 只剩 1
    expect(result.map((item) => item.chapter)).toEqual([1])
    expect(read).toEqual([1, 5])
  })

  it("没有章节时直接返回空，不读任何文件", async () => {
    let called = 0
    const result = await loadSightingExcerpts({
      projectPath: "/tmp/p",
      names: ["守卫"],
      chapters: [],
      resolveChapterPath: async () => {
        called += 1
        return "x.md"
      },
      readChapterBody: async () => "",
    })
    expect(result).toEqual([])
    expect(called).toBe(0)
  })
})
