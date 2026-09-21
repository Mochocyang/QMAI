// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReferenceInput as InputComponent } from "@/components/reference/ReferenceInput"

let ReferenceInput: typeof InputComponent
let host: HTMLDivElement
let root: Root
const formalKey = "qmai-reference-input-height"
const testKey = "qm-uitest-reference-input-height"

async function renderInput(enabled: boolean) {
  vi.stubEnv("VITE_QMAI_UI_TEST", enabled ? "1" : "0")
  vi.resetModules()
  ;({ ReferenceInput } = await import("@/components/reference/ReferenceInput"))
  await act(async () => root.render(<ReferenceInput tokens={[]} onSubmit={() => {}} />))
  return host.querySelector("textarea") as HTMLTextAreaElement
}

async function dragInput(startY: number, endY: number) {
  const handle = host.querySelector('[role="separator"]') as HTMLDivElement
  await act(async () => handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientY: startY })))
  await act(async () => window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientY: endY })))
  await act(async () => window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientY: endY })))
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllEnvs()
})

describe("测试版 AI 模型选择布局", () => {
  it("模型选择固定 220px 并贴近输入框右侧，不随模型名称长短变化", () => {
    const css = readFileSync(resolve(__dirname, "ui-test-ai.css"), "utf8")
    expect(css).toMatch(/\[data-ui-ai-composer\] \[data-reference-input-footer\] > div:last-child \{[^}]*justify-content: flex-end;/s)
    expect(css).toMatch(/\[data-ui-ai-composer\] \[data-reference-input-footer\] > div:last-child > \.ui-test-ai-model \{[^}]*flex: 0 0 220px;[^}]*width: 220px;/s)
  })
})

describe("测试版引用输入框真实高度逻辑", () => {
  it("默认 128px，测试版不读取或覆盖正式版保存的输入高度", async () => {
    localStorage.setItem(formalKey, "260")
    const input = await renderInput(true)
    expect(input.style.height).toBe("128px")
    await dragInput(400, 368)
    expect(input.style.height).toBe("160px")
    expect(localStorage.getItem(formalKey)).toBe("260")
  })

  it("实际拖动可以缩到 48px、拉到 300px，并在抬起时保存", async () => {
    const input = await renderInput(true)
    await dragInput(400, 800)
    expect(input.style.height).toBe("112px")
    await dragInput(400, 0)
    expect(input.style.height).toBe("300px")
    expect(input.style.maxHeight).toBe("300px")
    expect(localStorage.getItem(testKey)).toBe("300")
  })

  it.each([["12", "112px"], ["180", "180px"], ["600", "300px"], ["invalid", "128px"]])("保存值 %s 按测试版边界恢复为 %s", async (saved, expected) => {
    localStorage.setItem(testKey, saved)
    const input = await renderInput(true)
    expect(input.style.height).toBe(expected)
  })

  it("双击拖柄恢复测试版默认 128px，而不是 CSS 固定高度", async () => {
    localStorage.setItem(testKey, "230")
    const input = await renderInput(true)
    await act(async () => host.querySelector('[role="separator"]')?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })))
    expect(input.style.height).toBe("128px")
  })

  it("面板 CSS 不再覆盖拖动逻辑设置的 textarea 最大高度", () => {
    const css = readFileSync(resolve(__dirname, "ui-test-ai.css"), "utf8")
    const rule = css.match(/\[data-ui-ai-composer\]\s+textarea\s*\{([^}]+)\}/)?.[1]
    expect(rule).toBeTruthy()
    expect(rule).not.toMatch(/(?:height|max-height|min-height)\s*:/)
  })
})

describe("正式版引用输入框不回退", () => {
  it("仍默认 192px，忽略测试版的 96px 偏好", async () => {
    localStorage.setItem(testKey, "96")
    const input = await renderInput(false)
    expect(input.style.height).toBe("192px")
  })

  it("仍读取正式偏好，最低 192px、最高 300px；双击仍恢复 192px", async () => {
    localStorage.setItem(formalKey, "240")
    const input = await renderInput(false)
    expect(input.style.height).toBe("240px")
    await dragInput(400, 800)
    expect(input.style.height).toBe("192px")
    await dragInput(400, 0)
    expect(input.style.height).toBe("300px")
    await act(async () => host.querySelector('[role="separator"]')?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })))
    expect(input.style.height).toBe("192px")
    expect(localStorage.getItem(formalKey)).toBe("192")
    expect(localStorage.getItem(testKey)).toBeNull()
  })
})