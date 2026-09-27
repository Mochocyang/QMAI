// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { OutlineDualPreview } from "./outline-dual-preview"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

function findButton(host: HTMLElement, text: string): HTMLButtonElement {
  const buttons = Array.from(host.querySelectorAll("button")) as HTMLButtonElement[]
  const button = buttons.find(
    (item) => item.textContent?.replace(/\s+/g, " ").trim() === text,
  )
  if (!button) throw new Error(`未找到按钮：${text}`)
  return button
}

describe("OutlineDualPreview", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    delete document.documentElement.dataset.uiTestSkin
  })

  const render = async (htmlContent: string, mdEditor: React.ReactNode) => {
    await act(async () => {
      root.render(
        <OutlineDualPreview htmlContent={htmlContent} mdEditor={mdEditor} />,
      )
    })
  }

  it("默认以 HTML 模式渲染（iframe srcDoc）", async () => {
    const html = "<!DOCTYPE html><html><body><h1>折叠树</h1></body></html>"
    await render(html, <div data-testid="md-editor">MD 编辑器</div>)

    const iframe = host.querySelector("iframe") as HTMLIFrameElement
    expect(iframe).not.toBeNull()
    expect(iframe.title).toBe("卷纲 HTML 预览")
    expect(iframe.srcdoc).toContain("折叠树")
    expect(host.textContent).not.toContain("MD 编辑器")
  })

  it("点击 MD 切换到编辑模式，再切回 HTML", async () => {
    const html = "<!DOCTYPE html><html><body><h1>折叠树</h1></body></html>"
    await render(html, <div data-testid="md-editor">MD 编辑器</div>)

    await act(async () => {
      findButton(host, "MD").click()
    })
    expect(host.querySelector('[data-testid="md-editor"]')).not.toBeNull()
    expect(host.textContent).toContain("MD 编辑器")

    await act(async () => {
      findButton(host, "HTML").click()
    })
    const iframe = host.querySelector("iframe") as HTMLIFrameElement
    expect(iframe).not.toBeNull()
    expect(iframe.srcdoc).toContain("折叠树")
  })

  it("预览跟随当前外观，切换皮肤后换成对应配色", async () => {
    document.documentElement.dataset.uiTestSkin = "xing"
    const html = "<!DOCTYPE html><html><head></head><body><h1>折叠树</h1></body></html>"
    await render(html, <div data-testid="md-editor">MD 编辑器</div>)

    const iframe = () => host.querySelector("iframe") as HTMLIFrameElement
    expect(iframe().srcdoc).toContain("折叠树")
    expect(iframe().srcdoc).toContain("#222f2a")
    expect(iframe().srcdoc).toContain("#e6eee7")
    expect(iframe().srcdoc).toContain("#b0c9ae")
    expect(iframe().className).toContain("bg-transparent")

    await act(async () => {
      window.dispatchEvent(new CustomEvent("qmai-ui-test-skin-change", { detail: "zhi" }))
    })

    expect(iframe().srcdoc).toContain("折叠树")
    expect(iframe().srcdoc).toContain("#fffcf7")
    expect(iframe().srcdoc).toContain("#423d31")
    expect(iframe().srcdoc).toContain("#655a42")
    expect(iframe().srcdoc).not.toContain("#222f2a")
    expect((iframe().srcdoc.match(/id="qmai-document-appearance"/g) ?? []).length).toBe(1)
  })
})
