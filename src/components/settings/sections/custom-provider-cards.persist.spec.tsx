// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProviderConfigs } from "@/stores/wiki-store"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const persistMocks = vi.hoisted(() => ({
  saveProviderConfigs: vi.fn(async () => {}),
  saveActivePresetId: vi.fn(async () => {}),
}))

vi.mock("@/lib/project-store", () => persistMocks)

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
    expect(host.textContent).toContain("暂未添加任何模型配置")

    await act(async () => {
      useWikiStore.getState().setProviderConfigs(SAVED_CONFIGS)
    })

    expect(host.textContent).toContain("自建 DeepSeek")
    expect(host.textContent).not.toContain("暂未添加任何模型配置")
  })

  it("keeps a newly added model in the store so a remount can restore it", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1710000000123)
    await act(async () => root.render(<CustomProviderCards />))

    const add = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("添加模型"))
    expect(add).toBeTruthy()
    await act(async () => add!.click())

    expect(useWikiStore.getState().providerConfigs["custom-1710000000123"]).toMatchObject({
      label: "自定义模型",
      enabled: true,
    })
    expect(persistMocks.saveProviderConfigs).toHaveBeenCalled()
    expect(persistMocks.saveProviderConfigs.mock.calls.at(-1)?.[0]).toMatchObject({
      "custom-1710000000123": { label: "自定义模型", enabled: true },
    })

    await act(async () => root.unmount())
    root = createRoot(host)
    await act(async () => root.render(<CustomProviderCards />))
    expect(host.textContent).toContain("自定义模型")
    expect(host.textContent).not.toContain("暂未添加任何模型配置")
    vi.restoreAllMocks()
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
    expect(rustMain).toContain("persist_app_state_before_exit")
  })

  it("derives custom cards from the store instead of a one-shot local snapshot", () => {
    const source = readFileSync(resolve(__dirname, "custom-provider-cards.tsx"), "utf8")
    expect(source).toContain("listCustomProviderCards(providerConfigs)")
    expect(source).not.toContain("useState<CustomProviderCard[]>(")
  })
})
