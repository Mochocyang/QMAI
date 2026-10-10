import { describe, expect, it } from "vitest"
import {
  INSPIRATION_HINT_MESSAGE,
  resolveInspirationHint,
} from "@/lib/inspiration-hint"
import type { ChapterStatus } from "@/lib/novel/chapter-meta"
import {
  DRAFT_MEMORY_HINT_MESSAGE,
  resolveDraftMemoryHint,
  type DraftMemoryHintArrival,
} from "@/lib/draft-memory-hint"

describe("新章节灵感提示的文案", () => {
  it("把用户要的「点击这里生成新章节故事灵感」原样给出来", () => {
    /*
     * 用户原话就是这个短句（丙-4 需求 1）。它是**硬编码常量**，
     * 与 `DRAFT_MEMORY_HINT_MESSAGE` 同一种归属 —— 参见
     * `hardcoded-ui-chinese-i18n.test.ts` 的口径：那不是通用的
     * 「禁止硬编码中文」规则，只是一份具体字符串的黑名单。
     */
    expect(INSPIRATION_HINT_MESSAGE).toContain("点击这里生成新章节故事灵感")
    expect(INSPIRATION_HINT_MESSAGE).not.toBe(DRAFT_MEMORY_HINT_MESSAGE)
  })
})

describe("resolveInspirationHint —— 决定 A 的判据是章节自身状态", () => {
  const base = {
    isChapter: true,
    wordCount: 0,
    enabled: true,
    dismissed: false,
    bookHintSeen: false,
    currentlyVisible: false,
  }

  it("空章节、开关开、没关过、这本书没提示过 → 显示", () => {
    expect(resolveInspirationHint(base)).toBe(true)
  })

  it("正文字数不是 0 就不显示（用的是实时内容，不是磁盘）", () => {
    expect(resolveInspirationHint({ ...base, wordCount: 1 })).toBe(false)
    expect(resolveInspirationHint({ ...base, wordCount: 4000 })).toBe(false)
  })

  it("不是章节（大纲/其它 markdown）不显示", () => {
    expect(resolveInspirationHint({ ...base, isChapter: false })).toBe(false)
  })

  it("设置里关掉（不再提醒写盘的那一项）不显示", () => {
    expect(resolveInspirationHint({ ...base, enabled: false })).toBe(false)
  })

  it("本次会话点过「知道了」不显示，且不落盘", () => {
    expect(resolveInspirationHint({ ...base, dismissed: true })).toBe(false)
  })

  it("这本书已经提示过一次就不再显示", () => {
    expect(resolveInspirationHint({ ...base, bookHintSeen: true })).toBe(false)
  })

  it("刚记下「本书已提示」时不要把正在挂着的气泡收掉", () => {
    /*
     * 与草稿提示同款竞态：显示即记 seen（preview-panel 的既有先例），
     * 记完 seen 会触发重算，此时 `bookHintSeen` 已经是 true。
     * 若没有 `currentlyVisible` 这一路，气泡会在自己出现的同一帧消失。
     */
    expect(resolveInspirationHint({ ...base, bookHintSeen: true, currentlyVisible: true })).toBe(true)
  })
})

describe("两条气泡互斥 —— 不是「碰巧没同时出现」", () => {
  /*
   * 依据：`draft-memory-hint.ts:23` 的草稿提示第一道门就要求 `wordCount > 0`，
   * 而灵感提示要求 `wordCount === 0`。两者是**互补**的，所以无论其余输入怎么组合，
   * 都不可能同时为真。
   *
   * 为什么要把这条写成穷举断言而不是留一句注释：两条气泡共用
   * `.ui-test-editor-hint-anchor`，定位属性也是逐字照抄的（同一个 top/left/width）。
   * 一旦有人放宽草稿提示那道门，两条气泡会**精确重叠**在同一坐标上 ——
   * 视觉上是一个盖住另一个，而所有既有断言仍然全绿。
   */
  const arrivals: DraftMemoryHintArrival[] = ["select", "first-save", "stay"]
  const statuses: Array<ChapterStatus | null> = ["outline", "draft", "revised", "final", "archived", null]

  it("草稿提示与灵感提示在任意输入组合下都不同时为真", () => {
    let checked = 0
    for (const wordCount of [0, 1, 7]) {
      for (const isChapter of [true, false]) {
        for (const arrival of arrivals) {
          for (const status of statuses) {
            for (const enabled of [true, false]) {
              for (const bookHintSeen of [true, false]) {
                const shared = {
                  isChapter,
                  wordCount,
                  enabled,
                  bookHintSeen,
                }
                const draft = resolveDraftMemoryHint({
                  ...shared,
                  status,
                  arrival,
                  dismissed: false,
                  extracting: false,
                  hasLaterChapter: false,
                  currentlyVisible: false,
                })
                const inspiration = resolveInspirationHint({
                  ...shared,
                  dismissed: false,
                  currentlyVisible: false,
                })
                checked += 1
                expect(
                  draft && inspiration,
                  `wordCount=${wordCount} isChapter=${isChapter} arrival=${arrival} status=${status} 时两条气泡同时为真`,
                ).toBe(false)
              }
            }
          }
        }
      }
    }
    expect(checked, "穷举必须真的跑过组合，不能因为循环写错而空转").toBe(3 * 2 * 3 * 6 * 2 * 2)
  })

  it("wordCount 这一维是互斥的承重来源：草稿提示要 >0，灵感提示要 ===0", () => {
    // 上面的穷举只证明「给定实现下不会同时为真」；这一条把承重的那一维单独钉住，
    // 让「放宽草稿提示门槛」的改动直接指向这里。
    expect(resolveInspirationHint({
      isChapter: true, wordCount: 1, enabled: true, dismissed: false, bookHintSeen: false, currentlyVisible: false,
    })).toBe(false)
    expect(resolveInspirationHint({
      isChapter: true, wordCount: 0, enabled: true, dismissed: false, bookHintSeen: false, currentlyVisible: false,
    })).toBe(true)
  })
})
