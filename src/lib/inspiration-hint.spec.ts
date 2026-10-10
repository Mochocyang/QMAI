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
    draftHintVisible: false,
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

  it("草稿气泡挂着时不挂（`draftHintVisible` 是互斥本身，不是从 wordCount 推出来的）", () => {
    /*
     * ⚠️ 这一条钉的是**显式互斥**。
     *
     * 修复批 F1 之前，这里没有 `draftHintVisible` 这个入参，互斥被写成
     * 「草稿提示要 `wordCount > 0`、灵感提示要 `wordCount === 0`，两者互补」
     * —— 那个论证只在两条链喂**同一个** `wordCount` 时成立，而真实接线里
     * 草稿链喂 `session.persistedWords`（快照）、灵感链喂实时字数。
     * 「有正文的草稿章 + 清空编辑框」于是让两条气泡一起挂出、精确重叠。
     *
     * 所以这里刻意给一个 `wordCount === 0`（灵感链自己看不出问题）的输入，
     * 只让 `draftHintVisible` 拦住它：删掉那道门，这条立刻红。
     * 接线的证明在 `ui-test-editor.spec.tsx` 的
     * 「草稿章有正文时清空编辑器」那条用例里（纯函数层覆盖不到接线）。
     */
    expect(resolveInspirationHint({ ...base, draftHintVisible: true })).toBe(false)
    expect(
      resolveInspirationHint({ ...base, wordCount: 0, draftHintVisible: false }),
      "反向控制：draftHintVisible 为假时同一个输入必须仍然挂出 —— 否则上面那条会退化成恒真",
    ).toBe(true)
  })
})

describe("同一份 wordCount 喂给两个纯函数时，两条气泡互斥（**不覆盖接线**）", () => {
  /*
   * ⚠️ **这条穷举证明的范围必须说清**（修复批 F1 的教训）：
   * 它把**同一个** `wordCount` 喂给 `resolveDraftMemoryHint` 与
   * `resolveInspirationHint`，因此它证明的命题是
   * 「给定同一个 wordCount，两条气泡不会同时为真」——
   * 命题本身为真、也仍然承重（谁放宽 `wordCount` 这一维就会被抓住），
   * 但它**不是**「接线后两条气泡不会同时出现」的证明：真实接线里
   * 草稿链喂的是 `session.persistedWords` 快照、灵感链喂的是实时字数，
   * 两者可以不同，而当时正是因为把这条穷举当成了互斥的全部依据，
   * 才漏掉了「有正文的草稿章 + 清空编辑框」这个可达序列。
   *
   * 接线的证明在 `ui-test-editor.spec.tsx` 的
   * 「草稿章有正文时清空编辑器」那条用例里；互斥的**显式**来源是
   * `resolveInspirationHint` 的 `draftHintVisible` 入参（本文件上面那条用例钉住）。
   *
   * 两条气泡共用 `.ui-test-editor-hint-anchor`，定位属性也是逐字照抄的
   * （同一个 top/left/width），一旦同时挂着就会**精确重叠**在同一坐标上。
   */
  const arrivals: DraftMemoryHintArrival[] = ["select", "first-save", "stay"]
  const statuses: Array<ChapterStatus | null> = ["outline", "draft", "revised", "final", "archived", null]

  it("同一份 wordCount 下，草稿提示与灵感提示在任意输入组合下都不同时为真", () => {
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
                  /*
                   * 这一维**故意**置假：本组命题是「同一个 wordCount 下互斥」，
                   * 而 `draftHintVisible` 是接线才知道的量。把它置真会让
                   * 灵感提示恒假、整组退化成恒真 —— 那样就什么也证明不了了。
                   */
                  draftHintVisible: false,
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

  it("wordCount 这一维是「同一份输入」下互斥的承重来源：草稿提示要 >0，灵感提示要 ===0", () => {
    // 上面的穷举只证明「给定同一个 wordCount 时不会同时为真」；这一条把承重的那一维
    // 单独钉住，让「放宽草稿提示门槛」的改动直接指向这里。
    // ⚠️ 它同样**不覆盖接线** —— 接线里两条链的 wordCount 可以不同。
    expect(resolveInspirationHint({
      isChapter: true, wordCount: 1, enabled: true, dismissed: false, bookHintSeen: false, currentlyVisible: false, draftHintVisible: false,
    })).toBe(false)
    expect(resolveInspirationHint({
      isChapter: true, wordCount: 0, enabled: true, dismissed: false, bookHintSeen: false, currentlyVisible: false, draftHintVisible: false,
    })).toBe(true)
  })
})
