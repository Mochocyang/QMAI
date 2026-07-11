// @vitest-environment jsdom
import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { toast, ToastProvider, useToast, type ToastApi } from "./toast"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: Root
let api: ToastApi
function Capture() { api = useToast(); return null }
beforeEach(async () => {
  vi.useFakeTimers()
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<ToastProvider><Capture /></ToastProvider>))
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
const persistentError = (message: string, key: string) => api.error(message, { title: "自动保存失败", persistent: true, dedupeKey: key })

describe("ToastProvider", () => {
  it("deduplicates persistent errors and keeps them until manual dismissal", async () => {
    await act(async () => { persistentError("不支持的写入模式：new", "outline-save:new"); persistentError("不支持的写入模式：new", "outline-save:new") })
    expect(document.body.textContent?.match(/自动保存失败/g)).toHaveLength(1)
    const region = document.querySelector('[data-toast-region="true"]')
    expect(region?.className).toContain("bottom-4")
    expect(region?.className).toContain("right-4")
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(document.body.textContent).toContain("不支持的写入模式：new")
  })

  it("shows three items and reveals the queued fourth item after dismissal", async () => {
    await act(async () => { persistentError("错误一", "one"); persistentError("错误二", "two"); persistentError("错误三", "three"); persistentError("错误四", "four") })
    expect(document.querySelectorAll('[data-toast-card="true"]')).toHaveLength(3)
    expect(document.body.textContent).not.toContain("错误四")
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭提示"]')?.click())
    expect(document.body.textContent).toContain("错误四")
  })

  it("starts auto-dismiss timing only after a queued item becomes visible", async () => {
    await act(async () => { api.info("普通一"); api.info("普通二"); api.info("普通三"); api.info("普通四") })
    expect(document.body.textContent).not.toContain("普通四")
    await act(async () => { vi.advanceTimersByTime(4_001) })
    expect(document.body.textContent).toContain("普通四")
    await act(async () => { vi.advanceTimersByTime(3_999) })
    expect(document.body.textContent).toContain("普通四")
    await act(async () => { vi.advanceTimersByTime(2) })
    expect(document.body.textContent).not.toContain("普通四")
  })

  it("flushes global toast calls made by descendant mount effects", async () => {
    function OnMount() {
      useEffect(() => { toast.error("挂载错误", { persistent: true, dedupeKey: "mount-error" }) }, [])
      return null
    }
    await act(async () => root.render(<ToastProvider><OnMount /></ToastProvider>))
    expect(document.body.textContent).toContain("挂载错误")
  })
})