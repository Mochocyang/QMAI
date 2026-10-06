import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
export async function mountModel(node: ReactNode) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement("div"); document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(node))
  return { host, async unmount() { await act(async () => root.unmount()); host.remove() } }
}
export async function changeInput(host: HTMLElement, label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`) ?? host.querySelector<HTMLInputElement>(`[placeholder="${label}"]`) ?? host.querySelector<HTMLInputElement>(`[id="${label}"]`)
  if (!input) throw new Error(`没有找到字段：${label}`)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
export async function choose(host: HTMLElement, label: string, value: string) {
  const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)
  if (!select) throw new Error(`没有找到选择项：${label}`)
  await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })) })
}
export function button(host: HTMLElement, label: string) {
  const element = [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.getAttribute("aria-label") === label || item.textContent?.trim() === label)
  if (!element) throw new Error(`没有找到按钮：${label}`)
  return element
}
export async function click(host: HTMLElement, label: string) { await act(async () => button(host, label).click()) }
export async function answerModelDraft(label: "离开" | "保存配置" | "关闭") {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  if (!dialog) throw new Error("没有找到模型草稿确认框")
  await click(dialog, label)
}
export function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((a,b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
