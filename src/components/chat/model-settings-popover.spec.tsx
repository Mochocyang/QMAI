// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "@/i18n"
import {
  ModelSettingsPopover,
  MODEL_SETTINGS_PANEL_WIDTH,
  getModelSettingsPanelStyle,
} from "./model-settings-popover"
import { useWikiStore, type ProviderOverride } from "@/stores/wiki-store"
import { saveProviderConfigs } from "@/lib/project-store"

vi.mock("@/lib/project-store", () => ({
  saveProviderConfigs: vi.fn(async () => {}),
}))

const providerOverride: ProviderOverride = {
  enabled: true,
  apiKey: "secret-key",
  baseUrl: "https://api.deepseek.com/v1",
  maxContextSize: 307200,
  maxOutputTokens: 131072,
  reasoning: { mode: "high" },
  savedModels: [{ id: "kimi", name: "Kimi-K2.8-Preview", model: "deepseek-v4-flash", createdAt: 1 }],
}

describe("getModelSettingsPanelStyle", () => {
  it("把面板放在触发按钮左侧，底边对齐", () => {
    const style = getModelSettingsPanelStyle(
      { top: 700, bottom: 732, left: 900 },
      { width: 1200, height: 800 },
    )
    expect(style.width).toBe(MODEL_SETTINGS_PANEL_WIDTH)
    expect(style.right).toBe(1200 - 900 + 8)
    expect(style.bottom).toBe(800 - 732)
  })

  it("左侧空间不够时把面板夹进窗口，不让它被切掉", () => {
    const style = getModelSettingsPanelStyle(
      { top: 700, bottom: 732, left: 120 },
      { width: 1200, height: 800 },
    )
    expect(style.right).toBeGreaterThanOrEqual(4)
    expect(style.right + style.width).toBeLessThanOrEqual(1200 - 4)
  })

  it("窗口很矮时限制高度，避免面板顶出屏幕", () => {
    const style = getModelSettingsPanelStyle(
      { top: 200, bottom: 232, left: 900 },
      { width: 1200, height: 800 },
    )
    expect(style.maxHeight).toBe(220)
  })
})

describe("ModelSettingsPopover", () => {
  let container: HTMLDivElement
  let root: Root

  const style = { right: 8, bottom: 8, width: MODEL_SETTINGS_PANEL_WIDTH, maxHeight: 400 }

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    useWikiStore.setState({
      providerConfigs: { deepseek: providerOverride },
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
    vi.clearAllMocks()
  })

  function render() {
    act(() => {
      root.render(
        <ModelSettingsPopover
          providerId="deepseek"
          modelId="deepseek-v4-flash"
          modelTitle="Kimi-K2.8-Preview"
          style={style}
          onPointerEnter={() => {}}
          onPointerLeave={() => {}}
          onPointerDown={() => {}}
        />,
      )
    })
    return container
  }

  it("四项都在，推理程度只有五档且没有「默认」", () => {
    const host = render()
    expect(host.textContent).toContain("推理程度")
    expect(host.textContent).toContain("上下文窗口")
    expect(host.textContent).toContain("输出上限")
    expect(host.textContent).toContain("开启工具调用")
    expect(host.textContent).not.toContain("默认")

    const reasoning = host.querySelector("section")
    const labels = Array.from(reasoning!.querySelectorAll("button")).map((b) => b.textContent)
    expect(labels).toEqual(["关闭", "低", "中", "高", "最大"])
    expect(reasoning!.querySelector('[aria-pressed="true"]')?.textContent).toBe("高")
  })

  it("点推理档位即时写回供应商配置", async () => {
    const host = render()
    const medium = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "中")
    await act(async () => medium!.click())

    expect(saveProviderConfigs).toHaveBeenCalledTimes(1)
    expect(useWikiStore.getState().providerConfigs.deepseek.reasoning).toEqual({ mode: "medium" })
  })

  it("点上下文窗口与输出上限写回同一份供应商配置", async () => {
    const host = render()
    // 「256K」在上下文与输出两组里都有，必须按区块取，不能全局按文字找。
    const sections = Array.from(host.querySelectorAll("section"))
    const pillIn = (index: number, label: string) =>
      Array.from(sections[index].querySelectorAll("button")).find((b) => b.textContent === label)!

    await act(async () => pillIn(1, "400K").click())
    await act(async () => pillIn(2, "256K").click())

    const saved = useWikiStore.getState().providerConfigs.deepseek
    expect(saved.maxContextSize).toBe(409600)
    expect(saved.maxOutputTokens).toBe(262144)
  })

  it("Function Calling 开关写回 false", async () => {
    const host = render()
    const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!
    await act(async () => toggle.click())

    expect(useWikiStore.getState().providerConfigs.deepseek.functionCallingEnabled).toBe(false)
  })

  it("模型不能被控制思考时，这一块灰掉并写明原因", () => {
    useWikiStore.setState({
      // openai + gpt-4o 不在推理控制白名单里
      providerConfigs: {
        openai: { ...providerOverride, savedModels: [{ id: "gpt", name: "GPT-4o", model: "gpt-4o", createdAt: 1 }] },
      },
      llmConfig: {
        provider: "openai",
        apiKey: "key",
        model: "gpt-4o",
        ollamaUrl: "",
        customEndpoint: "",
        maxContextSize: 204800,
      },
    })
    act(() => {
      root.render(
        <ModelSettingsPopover
          providerId="openai"
          modelId="gpt-4o"
          modelTitle="GPT-4o"
          style={style}
          onPointerEnter={() => {}}
          onPointerLeave={() => {}}
          onPointerDown={() => {}}
        />,
      )
    })
    const host = container
    expect(host.textContent).toContain("该模型不支持")
    const disabled = Array.from(host.querySelectorAll("button")).filter(
      (b) => b.textContent === "高" && b.disabled,
    )
    expect(disabled).toHaveLength(1)
  })

  it("落盘失败时给出中文报错，且不改动运行配置", async () => {
    vi.mocked(saveProviderConfigs).mockRejectedValueOnce(new Error("磁盘写入失败"))
    const host = render()
    const low = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "低")
    await act(async () => low!.click())

    expect(host.textContent).toContain("保存失败")
    expect(useWikiStore.getState().providerConfigs.deepseek.reasoning).toEqual({ mode: "high" })
  })
})
