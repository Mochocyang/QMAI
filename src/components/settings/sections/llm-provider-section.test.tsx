// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "@/i18n"
import { useWikiStore } from "@/stores/wiki-store"
import { LlmProviderSection } from "./llm-provider-section"

const modelTestMocks = vi.hoisted(() => ({
  testSettingsLlmModel: vi.fn(),
}))

// 新版模型设置界面（「我的模型配置」）只保留一个入口：预设卡片的「测试模型」
// 会调用 testSettingsLlmModel。旧界面的 testLlmConnection / testLlmFunction
// 两个按钮已随旧界面一并移除，因此这里改为 mock 新的测试入口。
vi.mock("@/lib/settings-model-test", () => ({
  testSettingsLlmModel: modelTestMocks.testSettingsLlmModel,
  normalizeModelTestError: (error: Error) => error,
}))

let host: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function findButton(label: string, scope: ParentNode = host) {
  const button = Array.from(scope.querySelectorAll("button")).find((node) =>
    node.textContent?.includes(label),
  )
  if (!(button instanceof HTMLButtonElement)) {
    const labels = Array.from(scope.querySelectorAll("button")).map((node) => node.textContent?.trim() || "(icon)")
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

  it("tests the configured preset with its fully resolved model config", async () => {
    modelTestMocks.testSettingsLlmModel.mockResolvedValue({
      model: "deepseek-ai/DeepSeek-V3",
      content: "模型测试成功",
    })

    await act(async () => {
      root.render(<LlmProviderSection />)
    })
    await flush()

    const card = host.querySelector<HTMLElement>("[data-model-provider='deepseek']")
    if (!card) {
      throw new Error("deepseek provider card not found")
    }

    await act(async () => {
      findButton("DeepSeek", card).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })
    await flush()

    await act(async () => {
      findButton("测试模型", card).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await flush()

    // 该期望于 26f80ee 随「新版模型设置界面」变更：预设卡片改为单个「测试模型」，
    // 由 testSettingsLlmModel 发送一次真实对话测试；旧界面的「测试连接 / 测试功能」
    // 两个按钮已随旧界面一并移除（详见 GenxinLOG/20260927-1322-更新日志.md「旧版界面已移除，只保留新版」）。
    expect(modelTestMocks.testSettingsLlmModel).toHaveBeenCalledTimes(1)
    expect(modelTestMocks.testSettingsLlmModel).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "sk-test",
      customEndpoint: "https://api.siliconflow.cn/v1",
      model: "deepseek-ai/DeepSeek-V3",
      provider: "custom",
    }))
    expect(host.textContent).toContain("测试通过（1/1）。本次测试没有保存配置。")
  })
})
