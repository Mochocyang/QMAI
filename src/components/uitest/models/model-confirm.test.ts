// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest"
import { confirm as nativeConfirm } from "@tauri-apps/plugin-dialog"
import { confirmModelAction } from "./model-confirm"
import { isTauri } from "@/lib/platform"
vi.mock("@/lib/platform", () => ({ isTauri: vi.fn(() => true) }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }))
afterEach(() => { vi.restoreAllMocks(); vi.mocked(isTauri).mockReturnValue(true); vi.mocked(nativeConfirm).mockReset() })
it("桌面确认使用受支持的异步dialog API和中文按钮，取消返回false", async () => {
 vi.mocked(nativeConfirm).mockResolvedValueOnce(false)
 const unsupported=vi.spyOn(window,"confirm")
 expect(await confirmModelAction("是否测试模型？")).toBe(false)
 expect(nativeConfirm).toHaveBeenCalledWith("是否测试模型？", { title: "模型配置确认", kind: "warning", okLabel: "继续", cancelLabel: "取消" })
 expect(unsupported).not.toHaveBeenCalled()
})
it("确认未决时重复点击不能启动第二个确认或把Promise当true", async () => {
 let answer!: (value: boolean) => void
 vi.mocked(nativeConfirm).mockImplementationOnce(() => new Promise(resolve => { answer=resolve }))
 const first=confirmModelAction("测试一")
 await vi.waitFor(() => expect(typeof answer).toBe("function"))
 expect(await confirmModelAction("测试二")).toBe(false)
 answer(false); expect(await first).toBe(false)
 expect(nativeConfirm).toHaveBeenCalledOnce()
})
it("确认接口失败必须拒绝执行，不能绕过安全确认", async () => {
 vi.mocked(nativeConfirm).mockRejectedValueOnce(new Error("permission denied"))
 expect(await confirmModelAction("删除配置？")).toBe(false)
})
