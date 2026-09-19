import { expect, it, vi } from "vitest"
import { flushAppState } from "@/lib/web-store"
import { persistModelChange } from "./model-persistence"
vi.mock("@/lib/web-store", () => ({ flushAppState: vi.fn() }))
it("落盘失败时恢复暂存配置，防止防抖保存后来写入失败的草稿", async () => {
  vi.mocked(flushAppState).mockRejectedValueOnce(new Error("模拟磁盘失败")).mockResolvedValueOnce(undefined)
  let staged = "原值"
  const write = vi.fn(async () => { staged = "草稿" })
  const restore = vi.fn(async () => { staged = "原值" })
  await expect(persistModelChange(write, restore)).rejects.toThrow("模拟磁盘失败")
  expect(staged).toBe("原值")
  expect(restore).toHaveBeenCalledOnce()
})
it("恢复也失败时明确说明状态不确定，不能显示保存成功", async () => {
  const write = vi.fn().mockRejectedValue(new Error("写入失败"))
  const restore = vi.fn().mockRejectedValue(new Error("恢复失败"))
  await expect(persistModelChange(write, restore)).rejects.toThrow("请重试保存并重新核对配置")
})
