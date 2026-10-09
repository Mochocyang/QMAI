import { describe, expect, it, vi } from "vitest"
import { CHAPTER_AUTOSAVE_INTERVAL_MS, flushPendingChapterSave, registerChapterSaveFlush } from "@/lib/chapter-save-flush"

describe("章节正文落盘兜底", () => {
  it("自动保存间隔是 3 分钟", () => {
    expect(CHAPTER_AUTOSAVE_INTERVAL_MS).toBe(180_000)
  })

  it("登记后 flush 会调用处理器", async () => {
    const handler = vi.fn(async () => {})
    const dispose = registerChapterSaveFlush(handler)
    await flushPendingChapterSave()
    expect(handler).toHaveBeenCalledTimes(1)
    dispose()
  })

  it("反登记后 flush 是空操作，关窗路径不会因此抛错", async () => {
    const handler = vi.fn(async () => {})
    const dispose = registerChapterSaveFlush(handler)
    dispose()
    await expect(flushPendingChapterSave()).resolves.toBeUndefined()
    expect(handler).not.toHaveBeenCalled()
  })

  it("旧处理器反登记不会顶掉新处理器", async () => {
    // 切章节会重新登记（新回调闭包）。旧 effect 的清理函数可能在之后才跑，
    // 若它无条件把 activeHandler 置空，关窗时就再也不会落盘。
    const first = vi.fn(async () => {})
    const second = vi.fn(async () => {})
    const disposeFirst = registerChapterSaveFlush(first)
    const disposeSecond = registerChapterSaveFlush(second)
    disposeFirst()
    await flushPendingChapterSave()
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    disposeSecond()
  })
})
