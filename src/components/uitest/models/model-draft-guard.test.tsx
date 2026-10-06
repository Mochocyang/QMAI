// @vitest-environment jsdom
import { act } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { confirmAppQuit, confirmModelDraftLeave, useModelDraftGuard } from "./model-draft-guard"
import { mountModel, answerModelDraft, deferred } from "./model-test-utils"
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); vi.restoreAllMocks() })
async function mount(dirty: boolean, saving = false, save?: () => Promise<boolean>) {
  function Draft() { useModelDraftGuard("unit-provider", "模型配置", dirty, saving, save); return null }
  cleanup.push((await mountModel(<Draft />)).unmount)
}
async function prompt() { let result!: Promise<boolean>; await act(async () => { result = confirmModelDraftLeave() }); return { result } }
it("干净配置不弹确认，脏配置关闭后保留", async () => {
  await mount(false)
  expect(await confirmModelDraftLeave()).toBe(true)
  await mount(true)
  const { result } = await prompt()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("未保存")
  await answerModelDraft("关闭")
  expect(await result).toBe(false)
})
it("保存中不能离开，避免重复请求", async () => {
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {})
  await mount(true, true)
  expect(await confirmModelDraftLeave()).toBe(false)
  expect(alert).toHaveBeenCalledWith(expect.stringContaining("保存"))
})
it("组件卸载即清理登记，不保留过期拦截", async () => {
  await mount(true); await cleanup.pop()!()
  expect(await confirmModelDraftLeave()).toBe(true)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
it("回调仅驻留内存，保存失败阻止离开，重复导航不能绕过待决保存", async () => {
  const storage = vi.spyOn(Storage.prototype, "setItem")
  const pending = deferred<boolean>()
  const save = vi.fn(() => pending.promise)
  await mount(true, false, save)
  const { result } = await prompt()
  expect(await confirmModelDraftLeave()).toBe(false)
  await answerModelDraft("保存配置")
  expect(await confirmModelDraftLeave()).toBe(false)
  pending.resolve(false)
  expect(await result).toBe(false)
  expect(save).toHaveBeenCalledOnce()
  expect(storage).not.toHaveBeenCalled()
})
it("相同标识的两个挂载不会互相覆盖，逐项保存且失败阻止离开", async () => {
  const first = vi.fn().mockResolvedValue(true), second = vi.fn().mockResolvedValue(false)
  await mount(true, false, first); await mount(true, false, second)
  const { result } = await prompt(); await answerModelDraft("保存配置")
  expect(await result).toBe(false)
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce()
})
it("退出软件仍保留原单次退出确认，不触发草稿保存", async () => {
  const save = vi.fn().mockResolvedValue(true)
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
  await mount(true, false, save)
  expect(await confirmAppQuit()).toBe(true)
  expect(confirm).toHaveBeenCalledOnce()
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("退出会放弃"))
  expect(save).not.toHaveBeenCalled()
})
