// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "@/i18n"
import { useWikiStore } from "@/stores/wiki-store"
import { LlmProviderSection } from "./llm-provider-section"

const connectionTestMocks = vi.hoisted(() => ({
  testLlmConnection: vi.fn(),
  testLlmFunction: vi.fn(),
}))

vi.mock("@/lib/connection-tests", () => ({
  testLlmConnection: connectionTestMocks.testLlmConnection,
  testLlmFunction: connectionTestMocks.testLlmFunction,
}))

let host: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function findButton(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find((node) =>
    node.textContent?.includes(label),
  )
  if (!(button instanceof HTMLButtonElement)) {
    const labels = Array.from(host.querySelectorAll("button")).map((node) => node.textContent?.trim() || "(icon)")
    throw new Error(`${label} button not found. Available buttons: ${labels.join(", ")}`)
  }
  return button
}

describe("LlmProviderSection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useWikiStore.setState({
      llmConfig: {
        provider: "custom",
        apiKey: "sk-test",
        model: "deepseek-ai/DeepSeek-V3",
        ollamaUrl: "http://localhost:11434",
        customEndpoint: "https://api.siliconflow.cn/v1",
        maxContextSize: 131072,
        apiMode: "chat_completions",
        reasoning: { mode: "auto" },
      },
      providerConfigs: {
        deepseek: {
          apiKey: "sk-test",
          model: "deepseek-ai/DeepSeek-V3",
          baseUrl: "https://api.siliconflow.cn/v1",
          apiMode: "chat_completions",
          maxContextSize: 131072,
          reasoning: { mode: "auto" },
        },
      },
      activePresetId: "deepseek",
    })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  it("runs the copied LLM Wiki connection and function tests for the active preset", async () => {
    connectionTestMocks.testLlmConnection.mockResolvedValue({
      ok: true,
      message: "连接测试通过",
    })
    connectionTestMocks.testLlmFunction.mockResolvedValue({
      ok: true,
      message: "功能测试通过",
    })

    await act(async () => {
      root.render(<LlmProviderSection />)
    })
    await flush()

    const expandButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("DeepSeek")
    )
    if (!(expandButton instanceof HTMLButtonElement)) {
      throw new Error("expand button not found")
    }

    await act(async () => {
      expandButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })
    await flush()

    await act(async () => {
      findButton("测试连接").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await flush()

    expect(connectionTestMocks.testLlmConnection).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "sk-test",
      customEndpoint: "https://api.siliconflow.cn/v1",
      model: "deepseek-ai/DeepSeek-V3",
      provider: "custom",
    }))
    expect(host.textContent).toContain("连接测试通过")

    await act(async () => {
      findButton("测试功能").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await flush()

    expect(connectionTestMocks.testLlmFunction).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "sk-test",
      customEndpoint: "https://api.siliconflow.cn/v1",
      model: "deepseek-ai/DeepSeek-V3",
      provider: "custom",
    }))
    expect(host.textContent).toContain("功能测试通过")
  })
})
