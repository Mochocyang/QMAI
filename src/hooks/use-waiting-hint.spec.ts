import { describe, expect, it } from "vitest"
import { WAITING_HINTS } from "@/lib/novel/waiting-hints"
import { waitingHintDurationMs } from "./use-waiting-hint"

describe("等待期文案", () => {
  it("原表 102 条 + 写作心得 199 条，共 301 条，没有重复", () => {
    expect(WAITING_HINTS.length).toBe(301)
    expect(new Set(WAITING_HINTS).size).toBe(WAITING_HINTS.length)
  })

  it("只保留后一句，不带前缀或分隔符", () => {
    for (const hint of WAITING_HINTS) {
      expect(hint).not.toContain("——")
      expect(hint).not.toContain("|")
      expect(hint.startsWith("正在")).toBe(false)
    }
  })

  it("每条都是单行短句，没有首尾空白", () => {
    for (const hint of WAITING_HINTS) {
      expect(hint).toBe(hint.trim())
      expect(hint).not.toContain("\n")
      expect(hint.length).toBeGreaterThan(0)
      expect(hint.length).toBeLessThanOrEqual(40)
    }
  })

  it("写作心得覆盖面够广，对写小说有帮助", () => {
    for (const keyword of ["冲突", "伏笔", "台词", "视角", "节奏", "人物"]) {
      expect(WAITING_HINTS.some((hint) => hint.includes(keyword))).toBe(true)
    }
  })

  it("每句都留够阅读时间，长句不会比短句短", () => {
    const shortest = Math.min(...WAITING_HINTS.map(waitingHintDurationMs))
    const longest = Math.max(...WAITING_HINTS.map(waitingHintDurationMs))
    expect(shortest).toBeGreaterThan(5000)
    expect(waitingHintDurationMs("短句。")).toBeLessThan(waitingHintDurationMs("这一句明显要长很多很多，得多看一会儿。"))
    expect(longest).toBeGreaterThan(shortest)
  })

  it("原《0001》文案仍留在池子里，首尾对得上", () => {
    expect(WAITING_HINTS[0]).toBe("别催，我已经有点着急了。")
    expect(WAITING_HINTS).toContain("这一下，真的到头了。")
    expect(WAITING_HINTS).toContain("最后这一段，最让人期待。")
  })
})