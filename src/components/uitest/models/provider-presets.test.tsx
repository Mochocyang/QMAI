// @vitest-environment jsdom
import { act } from "react"
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import "@/i18n"
import { useWikiStore } from "@/stores/wiki-store"
import { LlmProviderSection } from "@/components/settings/sections/llm-provider-section"
import { saveProviderConfigs } from "@/lib/project-store"
import { fetchLlmModelList } from "@/lib/settings-model-list"
import { mountModel, click, changeInput, deferred } from "./model-test-utils"
vi.mock("@/lib/ui-test", () => ({ IS_UI_TEST_BUILD: true }))
vi.mock("@/lib/platform", () => ({ isTauri: () => false }))
vi.mock("@/lib/project-store", () => ({ saveProviderConfigs: vi.fn(), saveActivePresetId: vi.fn(), saveLlmConfig: vi.fn() }))
vi.mock("@/lib/web-store", () => ({ flushAppState: vi.fn() }))
vi.mock("@/lib/settings-model-list", () => ({ fetchLlmModelList: vi.fn() }))
vi.mock("@/lib/connection-tests", () => ({ testLlmConnection: vi.fn(), testLlmFunction: vi.fn() }))
vi.mock("@/lib/settings-model-test", () => ({ testSettingsLlmModel: vi.fn(), normalizeModelTestError: (error: Error) => error }))
vi.mock("@/components/settings/resource-link", () => ({ ResourceLink: () => null }))
let host: HTMLDivElement, unmount: () => Promise<void>
beforeEach(async () => {
  vi.resetAllMocks(); vi.spyOn(window, "confirm").mockReturnValue(true)
  useWikiStore.setState({ providerConfigs: { openai: { apiKey: "mock-preset-key", model: "gpt-5.5" } }, activePresetId: null })
  ;({ host, unmount } = await mountModel(<LlmProviderSection />))
})
afterEach(async () => { await unmount(); vi.restoreAllMocks() })
it("已有提供方直接出现在我的模型配置中", async () => {
  expect(host.textContent).toContain("我的模型配置")
  expect(host.textContent).toContain("OpenAI")
  expect(host.textContent).toContain("官方 OpenAI API")
  const card = host.querySelector<HTMLElement>("[data-model-provider='openai']")!
  const title = Array.from(card.querySelectorAll("button")).find((button) => button.textContent?.includes("OpenAI"))!
  await act(async () => { title.click() })
  expect(card.textContent).toContain("API 密钥")
  expect(card.textContent).toContain("拉取模型")
  expect(card.textContent).toContain("测试模型")
  expect(card.querySelector("[aria-label='停用']")).not.toBeNull()
})
it("添加提供方后进入我的模型配置", async () => {
  await click(host, "＋ 添加提供方")
  const provider = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Anthropic"))!
  await act(async () => { provider.click() })
  const card = host.querySelector<HTMLElement>("[data-model-provider='anthropic']")!
  await act(async () => { card.querySelector<HTMLButtonElement>("button")?.click() })
  expect(card.querySelector("[aria-label='模型']")).not.toBeNull()
})
