import { describe, expect, it } from "vitest"
import { buildLineDiff, summarizeDiff } from "./version-diff"

describe("行级差异", () => {
  it("相同内容没有任何增删行", () => {
    const diff = buildLineDiff("第一行\n第二行", "第一行\n第二行")
    expect(diff.every((line) => line.kind === "same")).toBe(true)
    expect(summarizeDiff(diff)).toEqual({ added: 0, removed: 0 })
  })

  it("能分辨出被改写的那一行", () => {
    const diff = buildLineDiff("他推开门。\n雨很大。", "他推开门，雨水顺着衣角滴下来。\n雨很大。")
    const summary = summarizeDiff(diff)
    expect(summary.added).toBe(1)
    expect(summary.removed).toBe(1)
  })

  it("新增的行只带 newLine 行号", () => {
    const diff = buildLineDiff("a\nb", "a\n新插入\nb")
    const added = diff.find((line) => line.kind === "added")!
    expect(added.text).toBe("新插入")
    expect(added.newLine).toBe(2)
    expect(added.oldLine).toBeUndefined()
  })

  it("删除的行只带 oldLine 行号", () => {
    const diff = buildLineDiff("a\nb\nc", "a\nc")
    const removed = diff.find((line) => line.kind === "removed")!
    expect(removed.text).toBe("b")
    expect(removed.oldLine).toBe(2)
    expect(removed.newLine).toBeUndefined()
  })

  it("相同行同时带两侧行号", () => {
    const diff = buildLineDiff("a\nb", "x\na\nb")
    const same = diff.find((line) => line.kind === "same")!
    expect(same.text).toBe("a")
    expect(same.oldLine).toBe(1)
    expect(same.newLine).toBe(2)
  })

  it("空对空不炸", () => {
    expect(buildLineDiff("", "")).toEqual([])
    expect(summarizeDiff([])).toEqual({ added: 0, removed: 0 })
  })

  it("空对非空：整段算新增", () => {
    const diff = buildLineDiff("", "第一行\n第二行")
    expect(summarizeDiff(diff)).toEqual({ added: 2, removed: 0 })
  })

  it("不会把结尾换行多算成一行", () => {
    // 文本以换行结尾时 split 会多出一个空串，它不是真实的一行
    const diff = buildLineDiff("a\n", "a\n")
    expect(diff).toHaveLength(1)
    expect(diff[0].text).toBe("a")
  })
})
