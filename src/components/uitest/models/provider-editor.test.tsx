// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import "@/i18n"
import { useWikiStore, type SavedModel } from "@/stores/wiki-store"
import { SavedModelsManager } from "@/components/settings/sections/saved-models-manager"
import { testSettingsLlmModel } from "@/lib/settings-model-test"
import { fetchLlmModelList } from "@/lib/settings-model-list"
import { toast } from "@/lib/toast"
import { mountModel, click, changeInput } from "./model-test-utils"
vi.mock("@/lib/ui-test", () => ({ IS_UI_TEST_BUILD: true }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/settings-model-test", () => ({ testSettingsLlmModel: vi.fn(), normalizeModelTestError: (error: Error) => error }))
vi.mock("@/lib/settings-model-list", () => ({ fetchLlmModelList: vi.fn() }))
vi.mock("@/components/ui/dialog", () => ({ Dialog: ({ open, children }: any) => open ? children : null, DialogContent: ({ children }: any) => <div>{children}</div>, DialogDescription: ({ children }: any) => <p>{children}</p>, DialogHeader: ({ children }: any) => <header>{children}</header>, DialogTitle: ({ children }: any) => <h2>{children}</h2>, DialogFooter: ({ children }: any) => <footer>{children}</footer> }))
const sample: SavedModel = { id: "mock-id", name: "模拟显示名", model: "demo-model", apiKey: "mock-model-secret", customEndpoint: "https://example.invalid/v1", description: "原备注", createdAt: 1 }
let host: HTMLDivElement, unmount: () => Promise<void>
const onChange = vi.fn()
beforeEach(async () => {
  vi.resetAllMocks(); vi.spyOn(window, "confirm").mockReturnValue(true)
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "demo-from-list" }] }) }))
  ;({ host, unmount } = await mountModel(<SavedModelsManager savedModels={[sample]} onChange={onChange} buildTestConfig={model => ({ ...useWikiStore.getState().llmConfig, provider: "custom", model: model.model, customEndpoint: model.customEndpoint ?? "https://example.invalid/v1", apiKey: model.apiKey ?? "mock-model-secret" })} />))
})
afterEach(async () => { await unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it("单模型测试也要费用确认、错误脱敏且不会保存模型", async () => {
  vi.mocked(testSettingsLlmModel).mockRejectedValue(new Error("认证失败 mock-model-secret"))
  await click(host, "测试模型")
  expect(window.confirm).toHaveBeenCalledOnce()
  expect(toast.error).toHaveBeenCalledWith(expect.not.stringContaining("mock-model-secret"))
  expect(onChange).not.toHaveBeenCalled()
})
it("弹窗拉取到的模型可以实际选择，不只打印日志", async () => {
  vi.mocked(fetchLlmModelList).mockResolvedValue({ models: ["demo-from-list"] })
  await click(host, "添加模型")
  await changeInput(host, "model-endpoint", "https://example.invalid/v1")
  await click(host, "拉取模型")
  expect(host.querySelector('option[value="demo-from-list"]')).not.toBeNull()
  expect(onChange).not.toHaveBeenCalled()
})
