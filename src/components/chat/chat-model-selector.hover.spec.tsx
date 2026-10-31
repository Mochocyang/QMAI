// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "@/i18n"
import { ChatModelSelector } from "./chat-model-selector"
import { useWikiStore } from "@/stores/wiki-store"

vi.mock("@/lib/project-store", () => ({
  saveProviderConfigs: vi.fn(async () => {}),
}))

/**
 * 悬停弹窗是真实渲染验证，不是源码字符串断言：
 * 鼠标进入模型按钮后必须真的在 document.body 里挂出 `[data-model-settings-panel]`。
 */
describe("ChatModelSelector 悬停弹窗", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    useWikiStore.setState({
      aiChatModel: "deepseek/deepseek-v4-flash",
      providerConfigs: {
        deepseek: {
          enabled: true,
          apiKey: "k",
          baseUrl: "https://api.deepseek.com/v1",
          maxContextSize: 307200,
          maxOutputTokens: 131072,
          reasoning: { mode: "medium" },
          savedModels: [{ id: "m", name: "DeepSeek-V4-Flash", model: "deepseek-v4-flash", createdAt: 1 }],
        },
      },
      llmConfig: {
        provider: "openai",
        apiKey: "",
        model: "",
        ollamaUrl: "",
        customEndpoint: "",
        maxContextSize: 204800,
      },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.querySelectorAll("[data-model-settings-panel]").forEach((node) => node.remove())
    vi.useRealTimers()
  })

  function render() {
    act(() => {
      root.render(
        <ChatModelSelector value="deepseek/deepseek-v4-flash" onChange={() => {}} />,
      )
    })
    const wrapper = container.querySelector<HTMLElement>("div.relative")
    expect(wrapper).not.toBeNull()
    return wrapper!
  }

  it("鼠标进入模型按钮后弹出四项设置面板", () => {
    const wrapper = render()
    expect(document.querySelector("[data-model-settings-panel]")).toBeNull()

    act(() => {
      wrapper.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
      vi.advanceTimersByTime(200)
    })

    const panel = document.querySelector<HTMLElement>("[data-model-settings-panel]")
    expect(panel).not.toBeNull()
    expect(panel!.textContent).toContain("推理程度")
    expect(panel!.textContent).toContain("上下文窗口")
    expect(panel!.textContent).toContain("输出上限")
    expect(panel!.textContent).toContain("开启工具调用")
  })

  it("鼠标移开后收起", () => {
    const wrapper = render()
    act(() => {
      wrapper.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
      vi.advanceTimersByTime(200)
    })
    expect(document.querySelector("[data-model-settings-panel]")).not.toBeNull()

    act(() => {
      wrapper.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }))
      vi.advanceTimersByTime(400)
    })
    expect(document.querySelector("[data-model-settings-panel]")).toBeNull()
  })

  /*
   * 用户报过的 bug：点一下「200K」，弹窗就关了，想接着改「输出上限」还得把鼠标移回去。
   * 现在语义是：在面板里点过之后就钉住，只有点外面 / 点模型按钮 / Esc 才关。
   */
  it("点档位后面板保持打开，可以继续改其它项", async () => {
    const wrapper = render()
    act(() => {
      wrapper.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
      vi.advanceTimersByTime(200)
    })

    const panel = document.querySelector<HTMLElement>("[data-model-settings-panel]")!
    const pill = Array.from(panel.querySelectorAll("button")).find((b) => b.textContent === "200K")!
    await act(async () => {
      pill.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
      pill.click()
      await Promise.resolve()
    })
    // 鼠标离开按钮、离开面板都不再自动收起
    act(() => {
      wrapper.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }))
      panel.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }))
      vi.advanceTimersByTime(600)
    })

    const stillOpen = document.querySelector<HTMLElement>("[data-model-settings-panel]")
    expect(stillOpen).not.toBeNull()
    expect(useWikiStore.getState().providerConfigs.deepseek.maxContextSize).toBe(204800)

    // 还能接着改第二项
    const outputPill = Array.from(stillOpen!.querySelectorAll("button")).find((b) => b.textContent === "64K")!
    await act(async () => {
      outputPill.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
      outputPill.click()
      await Promise.resolve()
    })
    expect(useWikiStore.getState().providerConfigs.deepseek.maxOutputTokens).toBe(65536)
    expect(document.querySelector("[data-model-settings-panel]")).not.toBeNull()
  })

  it("点面板外面才关闭", async () => {
    const wrapper = render()
    act(() => {
      wrapper.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
      vi.advanceTimersByTime(200)
    })
    const panel = document.querySelector<HTMLElement>("[data-model-settings-panel]")!
    await act(async () => {
      panel.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
      await Promise.resolve()
    })

    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
      vi.advanceTimersByTime(50)
    })
    expect(document.querySelector("[data-model-settings-panel]")).toBeNull()
  })

  it("点模型按钮也会关闭面板", async () => {
    const wrapper = render()
    act(() => {
      wrapper.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
      vi.advanceTimersByTime(200)
    })
    const panel = document.querySelector<HTMLElement>("[data-model-settings-panel]")!
    await act(async () => {
      panel.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
      await Promise.resolve()
    })

    const trigger = wrapper.querySelector("button")!
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
      trigger.click()
      await Promise.resolve()
    })
    expect(document.querySelector("[data-model-settings-panel]")).toBeNull()
  })
})
