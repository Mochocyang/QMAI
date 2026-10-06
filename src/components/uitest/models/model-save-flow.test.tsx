// @vitest-environment jsdom
import { act } from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import "@/i18n"
import { LlmProviderSection } from "@/components/settings/sections/llm-provider-section"
import { useWikiStore } from "@/stores/wiki-store"
import { saveProviderConfigs, saveEmbeddingConfig, saveRerankConfig } from "@/lib/project-store"
import { flushAppState } from "@/lib/web-store"
import { confirmModelDraftLeave } from "./model-draft-guard"
import { UiTestEmbeddingModels, UiTestRerankModels } from "./retrieval-models"
import { UiTestCustomProviders, UiTestProviderCard } from "./provider-custom"
import { UiTestDefaultModels } from "./default-models"
import { button, changeInput, click, mountModel, deferred, choose } from "./model-test-utils"
vi.mock("@/lib/platform", () => ({ isTauri: () => false }))
vi.mock("@/lib/project-store", () => ({ saveProviderConfigs: vi.fn(), saveActivePresetId: vi.fn(), saveLlmConfig: vi.fn(), saveEmbeddingConfig: vi.fn(), saveRerankConfig: vi.fn(), saveNovelConfig: vi.fn(), saveDefaultLlmModel: vi.fn() }))
vi.mock("@/lib/web-store", () => ({ flushAppState: vi.fn() }))
vi.mock("@/lib/embedding", () => ({ getEmbeddingCount: vi.fn(), legacyVectorRowCount: vi.fn(), getLastEmbeddingError: vi.fn(), embedAllPages: vi.fn(), dropLegacyVectorTable: vi.fn() }))
vi.mock("@/lib/settings-model-list", () => ({ fetchLlmModelList: vi.fn(), fetchEmbeddingModelList: vi.fn(), fetchRerankModelList: vi.fn() }))
vi.mock("@/lib/connection-tests", () => ({ testLlmConnection: vi.fn(), testLlmFunction: vi.fn() }))
vi.mock("@/components/settings/resource-link", () => ({ ResourceLink: () => null }))
const initial = useWikiStore.getState()
const provider = { enabled: true, label: "测试配置", apiKey: "saved-key", baseUrl: "https://saved.invalid/v1", model: "test-model", maxContextSize: 204800, maxOutputTokens: 16384 }
let host: HTMLDivElement, unmount: (() => Promise<void>) | undefined
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(window, "confirm").mockReturnValue(false)
  useWikiStore.setState({ ...initial, project: null, activePresetId: null, providerConfigs: { openai: provider, "custom-test": provider }, embeddingConfig: { ...initial.embeddingConfig, enabled: true, endpoint: "https://saved.invalid/v1", model: "embed", apiKey: "saved-key" }, rerankConfig: { ...initial.rerankConfig, enabled: true, useMainLlm: false, customEndpoint: "https://saved.invalid/v1", apiKey: "saved-key", model: "rank" } })
})
afterEach(async () => { if (unmount) await unmount(); unmount = undefined; vi.restoreAllMocks() })
async function render(node: Parameters<typeof mountModel>[0]) { ({ host, unmount } = await mountModel(node)) }
async function leave(choice: string) {
  let result!: Promise<boolean>
  await act(async () => { result = confirmModelDraftLeave() })
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  expect(dialog, "应显示可区分关闭、离开和保存的弹窗").not.toBeNull()
  await click(dialog!, choice)
  return result
}
it("自定义启用开关单独落盘，未保存地址密钥不被提交，重置不撤销开关", async () => {
  await render(<UiTestCustomProviders />)
  await changeInput(host, "接口地址", "https://draft.invalid/v1"); await changeInput(host, "API 密钥", "draft-key")
  await click(host, "启用此模型配置")
  expect(saveProviderConfigs).toHaveBeenCalledWith(expect.objectContaining({ "custom-test": { ...provider, enabled: false } }))
  expect(useWikiStore.getState().providerConfigs["custom-test"]).toEqual({ ...provider, enabled: false })
  expect(host.querySelector<HTMLInputElement>('[aria-label="API 密钥"]')!.value).toBe("draft-key")
  vi.mocked(window.confirm).mockReturnValue(true); await click(host, "放弃修改")
  expect(button(host, "启用此模型配置").getAttribute("aria-checked")).toBe("false")
  expect(await confirmModelDraftLeave()).toBe(true)
})
it("开关落盘失败保留旧状态和其他草稿，不能显示成功", async () => {
  await render(<UiTestCustomProviders />); await changeInput(host, "API 密钥", "draft-key")
  vi.mocked(flushAppState).mockRejectedValueOnce(new Error("磁盘失败 saved-key draft-key")); await click(host, "启用此模型配置")
  expect(useWikiStore.getState().providerConfigs["custom-test"]).toEqual(provider)
  expect(button(host, "启用此模型配置").getAttribute("aria-checked")).toBe("true")
  expect(host.textContent).toContain("保存失败"); expect(host.textContent).not.toContain("saved-key"); expect(host.textContent).not.toContain("draft-key")
})
it.each([false, true])("检索开关只持久化开关，重排=%s", async rerank => {
  await render(rerank ? <UiTestRerankModels /> : <UiTestEmbeddingModels />)
  const saved = rerank ? useWikiStore.getState().rerankConfig : useWikiStore.getState().embeddingConfig
  await changeInput(host, rerank ? "重排 API 密钥" : "向量 API 密钥", "draft-key"); await click(host, rerank ? "启用检索重排" : "启用向量检索")
  expect(rerank ? useWikiStore.getState().rerankConfig : useWikiStore.getState().embeddingConfig).toEqual({ ...saved, enabled: false })
  expect(rerank ? saveRerankConfig : saveEmbeddingConfig).toHaveBeenCalled()
})
it("复用主模型开关立即持久化但不保存TOPN草稿", async () => {
  await render(<UiTestRerankModels />); await changeInput(host, "候选 TOPN", "25")
  const saved = useWikiStore.getState().rerankConfig
  await click(host, "复用主模型")
  expect(useWikiStore.getState().rerankConfig).toEqual({ ...saved, useMainLlm: true })
  expect(host.querySelector<HTMLInputElement>('[aria-label="候选 TOPN"]')!.value).toBe("25")
})
it("内置提供方开关立即持久化，已保存配置可删除且目录可重新添加", async () => {
  await render(<LlmProviderSection />)
  const card = host.querySelector<HTMLElement>('[data-model-provider="openai"]')!
  await click(card, "停用")
  expect(useWikiStore.getState().providerConfigs.openai).toEqual({ ...provider, enabled: false })
  await act(async () => card.querySelector<HTMLButtonElement>(".model-provider-title")!.click())
  vi.mocked(window.confirm).mockReturnValue(true); await click(card, "删除配置")
  expect(useWikiStore.getState().providerConfigs.openai).toBeUndefined()
  await click(host, "＋ 添加提供方")
  expect(host.querySelector(".model-provider-grid")?.textContent).toContain("OpenAI")
})
it("保存配置成功才允许原目标导航，失败保留草稿", async () => {
  await render(<UiTestCustomProviders />); await changeInput(host, "配置名称", "待保存名称")
  vi.mocked(flushAppState).mockRejectedValueOnce(new Error("磁盘失败"))
  expect(await leave("保存配置")).toBe(false)
  expect(host.querySelector<HTMLInputElement>('[aria-label="配置名称"]')!.value).toBe("待保存名称")
  expect(await leave("保存配置")).toBe(true)
  expect(useWikiStore.getState().providerConfigs["custom-test"].label).toBe("待保存名称")
})
it("关闭弹窗不离开，离开不保存草稿", async () => {
  await render(<UiTestCustomProviders />); await changeInput(host, "配置名称", "未保存")
  expect(await leave("关闭")).toBe(false); expect(await leave("离开")).toBe(true)
  expect(saveProviderConfigs).not.toHaveBeenCalled()
})
it("未加入列表的模型ID和校验失败都阻止保存离开", async () => {
  await render(<UiTestCustomProviders />); await changeInput(host, "模型", "pending-model")
  expect(await leave("保存配置")).toBe(false); expect(saveProviderConfigs).not.toHaveBeenCalled()
  await changeInput(host, "模型", ""); await changeInput(host, "接口地址", "invalid")
  expect(await leave("保存配置")).toBe(false); expect(saveProviderConfigs).not.toHaveBeenCalled()
})
it("内置删除失败保留配置和草稿，取消删除不写入", async () => {
  await render(<LlmProviderSection />)
  const card = host.querySelector<HTMLElement>('[data-model-provider="openai"]')!
  await act(async () => card.querySelector<HTMLButtonElement>(".model-provider-title")!.click())
  await changeInput(card, "API 密钥", "draft-key")
  await click(card, "删除配置")
  expect(saveProviderConfigs).not.toHaveBeenCalled()
  vi.mocked(window.confirm).mockReturnValue(true)
  vi.mocked(flushAppState).mockRejectedValueOnce(new Error("磁盘失败"))
  await click(card, "删除配置")
  expect(useWikiStore.getState().providerConfigs.openai).toEqual(provider)
  expect(card.querySelector<HTMLInputElement>('[aria-label="API 密钥"]')!.value).toBe("draft-key")
  expect(card.textContent).toContain("删除失败")
  expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining("未保存"))
})
it("内置模型ID草稿必须先添加，不能通过离开时保存绕过", async () => {
  await render(<LlmProviderSection />)
  const card = host.querySelector<HTMLElement>('[data-model-provider="openai"]')!
  await act(async () => card.querySelector<HTMLButtonElement>(".model-provider-title")!.click())
  await changeInput(card, "模型", "pending-model")
  expect(await leave("保存配置")).toBe(false)
  expect(saveProviderConfigs).not.toHaveBeenCalled()
})
it("添加目录中已保存提供方不会挂载两个独立草稿", async () => {
  await render(<LlmProviderSection />); await click(host, "＋ 添加提供方")
  const select = [...host.querySelectorAll<HTMLButtonElement>(".model-provider-grid button")].find(item => item.textContent?.includes("OpenAI"))!
  await act(async () => select.click())
  expect(host.querySelectorAll('[data-model-provider="openai"]')).toHaveLength(1)
})
it.each(["openai", "claude-code-cli", "codex-cli"])("提供方%s内的启用类开关只提交自身", async id => {
  useWikiStore.setState({ providerConfigs: { [id]: provider } })
  await render(<LlmProviderSection />)
  const card = host.querySelector<HTMLElement>(`[data-model-provider="${id}"]`)!
  await act(async () => card.querySelector<HTMLButtonElement>(".model-provider-title")!.click())
  const output = card.querySelector<HTMLInputElement>('input[type="number"]')
  if (output) await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(output, "240"); output.dispatchEvent(new Event("input", { bubbles: true })) })
  const key = id === "openai" ? "functionCallingEnabled" : id === "codex-cli" ? "codexSpeedMode" : "localCliIsolation"
  const label = id === "openai" ? "启用 Function Calling" : id === "codex-cli" ? "Codex 速度" : "隔离本地 CLI 配置"
  const toggle = [...card.querySelectorAll<HTMLButtonElement>("button")].find(item => item.getAttribute("aria-label")?.includes(label))
  expect(toggle, label).toBeDefined()
  await act(async () => toggle!.click())
  expect(useWikiStore.getState().providerConfigs[id]).toEqual({ ...provider, [key]: id === "openai" ? false : id === "codex-cli" ? "fast" : true })
})
it("新提供方填写密钥不改变启用状态，点开关只保存开关且保留草稿", async () => {
  useWikiStore.setState({ providerConfigs: {} })
  await render(<LlmProviderSection />); await click(host, "＋ 添加提供方")
  const card = host.querySelector<HTMLElement>('[data-model-provider="anthropic"]')!
  await changeInput(card, "API 密钥", "draft-key")
  expect(card.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false")
  await click(card, "启用")
  expect(useWikiStore.getState().providerConfigs.anthropic).toEqual({ enabled: true })
  expect(host.querySelectorAll('[data-model-provider="anthropic"]')).toHaveLength(1)
  expect(card.querySelector<HTMLInputElement>('[aria-label="API 密钥"]')!.value).toBe("draft-key")
  expect(await leave("保存配置")).toBe(true)
  expect(useWikiStore.getState().providerConfigs.anthropic.apiKey).toBe("draft-key")
})
it("开关保存待决时不能再次切换或离开，成功后不产生额外脏状态", async () => {
  await render(<UiTestCustomProviders />)
  const pending = deferred<void>()
  vi.mocked(flushAppState).mockReturnValueOnce(pending.promise)
  await click(host, "启用此模型配置")
  expect(button(host, "启用此模型配置").disabled).toBe(true)
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {})
  expect(await confirmModelDraftLeave()).toBe(false); expect(alert).toHaveBeenCalledOnce()
  await act(async () => pending.resolve())
  expect(await confirmModelDraftLeave()).toBe(true)
})
it.each([false, true])("检索配置通过离开弹窗保存，失败保留输入，重排=%s", async rerank => {
  await render(rerank ? <UiTestRerankModels /> : <UiTestEmbeddingModels />)
  await changeInput(host, rerank ? "重排 API 密钥" : "向量 API 密钥", "draft-key")
  vi.mocked(flushAppState).mockRejectedValueOnce(new Error("保存失败"))
  expect(await leave("保存配置")).toBe(false)
  expect(await leave("保存配置")).toBe(true)
  expect((rerank ? useWikiStore.getState().rerankConfig : useWikiStore.getState().embeddingConfig).apiKey).toBe("draft-key")
})
it("默认模型也参与统一保存离开，失败不修改运行默认值", async () => {
  await render(<UiTestDefaultModels />)
  await choose(host, "默认模型（通用）", "openai/test-model")
  vi.mocked(flushAppState).mockRejectedValueOnce(new Error("保存失败"))
  expect(await leave("保存配置")).toBe(false)
  expect(useWikiStore.getState().defaultLlmModel).toBe(initial.defaultLlmModel)
  expect(await leave("保存配置")).toBe(true)
  expect(useWikiStore.getState().defaultLlmModel).toBe("openai/test-model")
})
it("收起的自定义配置切换失败时错误提示仍可见", async () => {
  await render(<UiTestProviderCard id="custom-test" expanded={false} isNew={false} onToggle={() => {}} onRemoved={() => {}} />)
  vi.mocked(flushAppState).mockRejectedValueOnce(new Error("保存失败"))
  await click(host, "启用此模型配置")
  const visibleErrors = [...host.querySelectorAll('[role="status"]')].filter(item => !item.closest("[hidden]"))
  expect(visibleErrors.some(item => item.textContent?.includes("保存失败"))).toBe(true)
})
it("自定义工具调用开关不保存密钥草稿，未保存的新配置只落盘开关", async () => {
  await render(<UiTestCustomProviders />)
  await changeInput(host, "API 密钥", "draft-key")
  await click(host, "启用 Function Calling")
  expect(useWikiStore.getState().providerConfigs["custom-test"]).toEqual({ ...provider, functionCallingEnabled: false })
  await unmount!(); unmount = undefined
  useWikiStore.setState({ providerConfigs: {} })
  await render(<UiTestCustomProviders />); await click(host, "添加模型")
  await changeInput(host, "API 密钥", "new-draft-key")
  await click(host, "启用此模型配置")
  expect(Object.values(useWikiStore.getState().providerConfigs)).toEqual([{ enabled: false }])
  expect(host.querySelector<HTMLInputElement>('[aria-label="API 密钥"]')!.value).toBe("new-draft-key")
})
