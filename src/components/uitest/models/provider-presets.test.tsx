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
  await click(host, "配置示例")
})
afterEach(async () => { await unmount(); vi.restoreAllMocks() })
function openai() { return [...host.querySelectorAll<HTMLElement>(".model-preset-card")].find(item => item.textContent?.includes("OpenAI (GPT)"))! }
async function expand() { await act(async () => openai().querySelectorAll<HTMLButtonElement>("button")[1].click()) }
it("旧的无enabled字段的可用提供方不会被新表单默认为停用", async () => {
  await expand()
  expect(openai().querySelector('[aria-label="停用"]')).not.toBeNull()
})
it("预设密钥也可遮蔽/显示，保存仅改自己的配置", async () => {
  await expand()
  await click(openai(), "显示密钥")
  await changeInput(openai(), "API 密钥", "mock-new-key")
  expect(saveProviderConfigs).not.toHaveBeenCalled()
  await click(openai(), "保存配置")
  expect(useWikiStore.getState().providerConfigs.openai.apiKey).toBe("mock-new-key")
  expect(useWikiStore.getState().providerConfigs.openai.enabled).not.toBe(false)
})
it("预设拉取请求不会在密钥更换后回填旧目录", async () => {
  const pending = deferred<{ models: string[] }>()
  vi.mocked(fetchLlmModelList).mockReturnValueOnce(pending.promise)
  await expand(); await click(openai(), "拉取模型")
  await changeInput(openai(), "API 密钥", "mock-changed")
  await act(async () => pending.resolve({ models: ["obsolete-preset-model"] }))
  expect(openai().textContent).not.toContain("obsolete-preset-model")
})
