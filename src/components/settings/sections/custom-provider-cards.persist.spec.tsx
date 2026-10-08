// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProviderConfigs } from "@/stores/wiki-store"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const persistMocks = vi.hoisted(() => ({
  saveProviderConfigs: vi.fn<(configs: ProviderConfigs) => Promise<void>>(async () => {}),
  saveActivePresetId: vi.fn<(id: string | null) => Promise<void>>(async () => {}),
}))

vi.mock("@/lib/project-store", () => persistMocks)

vi.mock("@/lib/web-store", () => ({
  flushAppState: vi.fn(async () => {}),
}))

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: () => {},
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

import { CustomProviderCards, listCustomProviderCards } from "./custom-provider-cards"
import { useWikiStore } from "@/stores/wiki-store"

const SAVED_CONFIGS: ProviderConfigs = {
  openai: { apiKey: "sk-openai", enabled: true, model: "gpt-5.5" },
  "custom-1710000000000": {
    label: "自建 DeepSeek",
    apiKey: "sk-custom",
    model: "deepseek-v4",
    baseUrl: "https://api.deepseek.com/v1",
    apiMode: "chat_completions",
    enabled: true,
    savedModels: [{ id: "m1", name: "v4", model: "deepseek-v4", createdAt: 1 }],
  },
}

describe("listCustomProviderCards restart mapping", () => {
  it("reloads custom-* configs after a simulated app restart", () => {
    const cards = listCustomProviderCards(SAVED_CONFIGS)
    expect(cards).toHaveLength(1)
    expect(cards[0]?.id).toBe("custom-1710000000000")
    expect(cards[0]?.label).toBe("自建 DeepSeek")
    expect(cards[0]?.model).toBe("deepseek-v4")
    expect(cards[0]?.savedModels[0]?.model).toBe("deepseek-v4")
  })

  it("does not treat the built-in custom preset as a user-created card", () => {
    expect(listCustomProviderCards({
      custom: { label: "自定义模型", model: "legacy" },
    })).toEqual([])
  })

  it("preserves an empty label while the user is editing it", () => {
    expect(listCustomProviderCards({
      "custom-1710000000000": { label: "" },
    })[0]?.label).toBe("")
  })
})

describe("CustomProviderCards persistence UI", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    persistMocks.saveProviderConfigs.mockClear()
    persistMocks.saveActivePresetId.mockClear()
    useWikiStore.setState({ providerConfigs: {}, activePresetId: null })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    useWikiStore.setState({ providerConfigs: {}, activePresetId: null })
  })

  it("shows custom models that arrive after the panel has already mounted", async () => {
    await act(async () => root.render(<CustomProviderCards />))
    expect(host.textContent).toContain("添加你的第一个写作模型")

    await act(async () => {
      useWikiStore.getState().setProviderConfigs(SAVED_CONFIGS)
    })

    expect(host.textContent).toContain("自建 DeepSeek")
    expect(host.textContent).not.toContain("添加你的第一个写作模型")
  })

  it("keeps a newly added model in the store after save so a remount can restore it", async () => {
    await act(async () => root.render(<CustomProviderCards />))

    const add = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("添加模型"))
    expect(add).toBeTruthy()
    await act(async () => add!.click())

    const card = host.querySelector<HTMLElement>('[data-model-provider^="custom-"]')
    expect(card).toBeTruthy()
    const id = card!.dataset.modelProvider!
    expect(id).toMatch(/^custom-/)

    const setInput = (selector: string, value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          card!.querySelector<HTMLInputElement>(selector),
          value,
        )
        card!.querySelector<HTMLInputElement>(selector)!.dispatchEvent(new Event("input", { bubbles: true }))
      })
    await setInput('input[aria-label="接口地址"]', "https://api.example.com/v1")
    await setInput('input[aria-label="模型"]', "mymodel")

    const addModel = [...card!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "添加")
    expect(addModel).toBeTruthy()
    await act(async () => addModel!.click())

    const saveButton = [...card!.querySelectorAll("button")].find((b) => b.textContent?.includes("保存配置"))
    expect(saveButton).toBeTruthy()
    await act(async () => saveButton!.click())

    expect(useWikiStore.getState().providerConfigs[id]).toMatchObject({
      label: "我的写作模型",
      enabled: true,
    })
    expect(persistMocks.saveProviderConfigs).toHaveBeenCalled()
    expect(persistMocks.saveProviderConfigs.mock.calls.at(-1)?.[0]).toMatchObject({
      [id]: { label: "我的写作模型", enabled: true },
    })

    await act(async () => root.unmount())
    root = createRoot(host)
    await act(async () => root.render(<CustomProviderCards />))
    expect(host.textContent).toContain("我的写作模型")
    expect(host.textContent).not.toContain("添加你的第一个写作模型")
  })

  it("blocks saving a newly emptied config name and preserves the saved label", async () => {
    useWikiStore.setState({
      providerConfigs: {
        "custom-1710000000000": { label: "自定义模型", enabled: true },
      },
    })
    await act(async () => root.render(<CustomProviderCards />))

    const input = host.querySelector<HTMLInputElement>('input[aria-label="配置名称"]')
    expect(input).toBeTruthy()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "")
      input!.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(input!.value).toBe("")

    const saveButton = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("保存配置"))
    expect(saveButton).toBeTruthy()
    await act(async () => saveButton!.click())

    expect(host.textContent).toContain("请填写配置名称")
    expect(useWikiStore.getState().providerConfigs["custom-1710000000000"]?.label).toBe("自定义模型")
    expect(persistMocks.saveProviderConfigs).not.toHaveBeenCalled()
  })
})

describe("close-path wiring", () => {
  it("flushes app-state on window close and before native destroy", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8")
    expect(appSource).toContain("flushAppState")
    expect(appSource).toContain("关闭前保存应用配置失败")

    const rustLib = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8")
    const rustMain = readFileSync(resolve(process.cwd(), "src-tauri/src/main.rs"), "utf8")
    expect(rustLib).toContain("persist_app_state_before_exit")
    expect(rustMain).toContain("qmai::run()")
    expect(rustMain).not.toContain("persist_app_state_before_exit")
  })

  it("derives custom cards from the store instead of a one-shot local snapshot", () => {
    const source = readFileSync(resolve(__dirname, "custom-provider-cards.tsx"), "utf8")
    expect(source).toContain("return <UiTestCustomProviders />")
    expect(source).not.toContain("useState<CustomProviderCard[]>(")

    const providerCustomSource = readFileSync(resolve(__dirname, "../../uitest/models/provider-custom.tsx"), "utf8")
    expect(providerCustomSource).toContain("useWikiStore(s => s.providerConfigs)")
  })
})
