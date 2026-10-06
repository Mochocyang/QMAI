// @vitest-environment jsdom
import { act } from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import "@/i18n"
import { LlmProviderSection } from "@/components/settings/sections/llm-provider-section"
import { DefaultModelSettingsPanel } from "@/components/settings/sections/default-model-settings-panel"
import type { SettingsDraft } from "@/components/settings/settings-types"
import { useWikiStore, type ProviderOverride, type ReasoningMode } from "@/stores/wiki-store"
import { saveProviderConfigs, saveLlmConfig } from "@/lib/project-store"
import { flushAppState } from "@/lib/web-store"
import { testLlmConnection } from "@/lib/connection-tests"
import { UiTestProviderCard } from "./provider-custom"
import { mountModel, click, changeInput, button } from "./model-test-utils"

vi.mock("@/lib/platform", () => ({ isTauri: () => false }))
vi.mock("@/lib/project-store", () => ({ saveProviderConfigs: vi.fn(), saveActivePresetId: vi.fn(), saveLlmConfig: vi.fn(), saveNovelConfig: vi.fn(), saveDefaultLlmModel: vi.fn() }))
vi.mock("@/lib/web-store", () => ({ flushAppState: vi.fn() }))
vi.mock("@/lib/settings-model-list", () => ({ fetchLlmModelList: vi.fn() }))
vi.mock("@/lib/connection-tests", () => ({ testLlmConnection: vi.fn(), testLlmFunction: vi.fn() }))
vi.mock("@/components/settings/resource-link", () => ({ ResourceLink: () => null }))

const initial = useWikiStore.getState()
const original: ProviderOverride = { enabled: true, label: "思考配置", model: "test-model", apiKey: "saved-key", baseUrl: "https://saved.invalid/v1", maxContextSize: 204800, maxOutputTokens: 1024, reasoning: { mode: "off" } }
let host: HTMLDivElement, unmount: (() => Promise<void>) | undefined
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(window, "confirm").mockReturnValue(true)
  useWikiStore.setState({ ...initial, project: null, activePresetId: null, providerConfigs: { openai: original, "custom-test": original } })
})
afterEach(async () => { if (unmount) await unmount(); unmount = undefined; vi.restoreAllMocks() })
async function renderProvider(custom: boolean) {
  ;({ host, unmount } = await mountModel(custom
    ? <UiTestProviderCard id="custom-test" expanded isNew={false} onToggle={() => {}} onRemoved={() => {}} />
    : <LlmProviderSection />))
  if (custom) return host
  const card = host.querySelector<HTMLElement>('[data-model-provider="openai"]')!
  await act(async () => card.querySelector<HTMLButtonElement>(".model-provider-title")!.click())
  return card
}
it.each([false, true])("思考开启与必要输出预算一起保存，不提交也不丢失密钥和输出草稿，自定义=%s", async custom => {
  const card = await renderProvider(custom), id = custom ? "custom-test" : "openai"
  await changeInput(card, "API 密钥", "draft-key")
  // 输出上限已由数字输入框改为预设选择器，两种卡片都通过同一个 48K 预设写入草稿。
  await click(card, "48K")
  await click(card, "高")
  expect(saveProviderConfigs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ [id]: { ...original, reasoning: { mode: "high" }, maxOutputTokens: 16384 } }))
  expect(useWikiStore.getState().providerConfigs[id]).toEqual({ ...original, reasoning: { mode: "high" }, maxOutputTokens: 16384 })
  expect(card.querySelector<HTMLInputElement>('[aria-label="API 密钥"]')!.value).toBe("draft-key")
  if (custom) expect(card.textContent).toContain("48K tokens")
  await click(card, "保存配置")
  expect(useWikiStore.getState().providerConfigs[id]).toMatchObject({ apiKey: "draft-key", maxOutputTokens: 49152, reasoning: { mode: "high" } })
})
it.each([false, true])("全部思考模式按钮即时生效，关闭和自动不缩减已保存输出预算，自定义=%s", async custom => {
  const card = await renderProvider(custom), id = custom ? "custom-test" : "openai"
  const modes: [string, ReasoningMode, number][] = [["低", "low", 4096], ["中", "medium", 8192], ["高", "high", 16384], ["最大", "max", 16384], ["关闭", "off", 16384], ["自动", "auto", 16384], ["自定义", "custom", 16384]]
  for (const [label, mode, maxOutputTokens] of modes) {
    await click(card, label)
    expect(useWikiStore.getState().providerConfigs[id]).toEqual({ ...original, reasoning: { mode }, maxOutputTokens })
    expect(button(card, "保存配置").disabled).toBe(true)
  }
})
it.each([false, true])("思考模式联动落盘失败时配置与输出预算一起回滚，其他草稿保留，自定义=%s", async custom => {
  const id = custom ? "custom-test" : "openai"
  useWikiStore.setState({ activePresetId: id })
  const oldLlm = useWikiStore.getState().llmConfig
  const card = await renderProvider(custom)
  await changeInput(card, "API 密钥", "draft-key")
  vi.mocked(flushAppState).mockRejectedValueOnce(new Error("失败 saved-key draft-key"))
  await click(card, "高")
  expect(saveLlmConfig).toHaveBeenCalled()
  expect(useWikiStore.getState().providerConfigs[id]).toEqual(original)
  expect(useWikiStore.getState().llmConfig).toBe(oldLlm)
  expect(card.textContent).toContain("保存失败")
  expect(card.textContent).not.toContain("saved-key"); expect(card.textContent).not.toContain("draft-key")
  expect(card.querySelector<HTMLInputElement>('[aria-label="API 密钥"]')!.value).toBe("draft-key")
  await click(card, "高")
  expect(useWikiStore.getState().llmConfig).toMatchObject({ reasoning: { mode: "high" }, maxOutputTokens: 16384, apiKey: "saved-key" })
})
it.each([false, true])("关闭或重开思考不提交未保存的自定义thinking预算，自定义=%s", async custom => {
  const id = custom ? "custom-test" : "openai"
  const saved = { ...original, reasoning: { mode: "custom" as const, budgetTokens: 2048 }, maxOutputTokens: 8192 }
  useWikiStore.setState({ providerConfigs: { [id]: saved } })
  const card = await renderProvider(custom)
  await changeInput(card, "1024", "40000")
  expect(saveProviderConfigs).not.toHaveBeenCalled()
  await click(card, "关闭")
  expect(useWikiStore.getState().providerConfigs[id]).toEqual({ ...saved, reasoning: { ...saved.reasoning, mode: "off" } })
  await click(card, "自定义")
  expect(useWikiStore.getState().providerConfigs[id]).toEqual(saved)
  expect(card.querySelector<HTMLInputElement>('[placeholder="1024"]')!.value).toBe("40000")
  expect(button(card, "保存配置").disabled).toBe(false)
})
it("实际DefaultModelSettingsPanel使用所选提供方的即时思考配置，没有第二个独立思考开关", async () => {
  const setDraft = vi.fn()
  useWikiStore.setState({ novelConfig: { ...initial.novelConfig, defaultLlmModel: "custom-test/test-model" }, defaultLlmModel: "custom-test/test-model" })
  ;({ host, unmount } = await mountModel(<>
    <UiTestProviderCard id="custom-test" expanded isNew={false} onToggle={() => {}} onRemoved={() => {}} />
    <DefaultModelSettingsPanel draft={{} as SettingsDraft} setDraft={setDraft} />
  </>))
  const defaults = host.querySelector<HTMLElement>(".model-defaults")!
  expect(defaults.querySelectorAll("select")).toHaveLength(5)
  expect(defaults.querySelector('[role="switch"]')).toBeNull()
  await click(host, "高")
  vi.mocked(testLlmConnection).mockResolvedValue({ ok: true, message: "成功" })
  await click(defaults, "测试模型")
  expect(testLlmConnection).toHaveBeenCalledWith(expect.objectContaining({ model: "test-model", reasoning: { mode: "high" }, maxOutputTokens: 16384 }))
  expect(setDraft).not.toHaveBeenCalled()
})
