// @vitest-environment jsdom
import { act } from "react"
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { useWikiStore, type ProviderOverride } from "@/stores/wiki-store"
import { testSettingsLlmModel } from "@/lib/settings-model-test"
import { useUiTestProviderBatch } from "./provider-batch"
import { mountModel, deferred } from "./model-test-utils"
vi.mock("@/lib/settings-model-test", () => ({ testSettingsLlmModel: vi.fn() }))
let value: ReturnType<typeof useUiTestProviderBatch>, unmount: () => Promise<void>
const config = useWikiStore.getState().llmConfig
const build = (model: string) => ({ ...config, model, apiKey: "mock-batch-key" })
function Harness({ draft = {} }: { draft?: ProviderOverride }) { value = useUiTestProviderBatch(draft, true); return null }
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(window, "confirm").mockReturnValue(true) })
afterEach(async () => { if (unmount) await unmount(); vi.restoreAllMocks() })
it("批测异常逐项反馈，重试仅请求失败项并脱敏", async () => {
  ;({ unmount } = await mountModel(<Harness />))
  vi.mocked(testSettingsLlmModel).mockResolvedValueOnce({ model: "a", content: "OK" }).mockRejectedValueOnce(new Error("失败 mock-batch-key"))
  await act(async () => value.runBatchTest(["a", "b"], build))
  expect(value.modelTestState.failedModels).toEqual(["b"])
  expect(value.modelTestState.message).not.toContain("mock-batch-key")
  vi.mocked(testSettingsLlmModel).mockResolvedValueOnce({ model: "b", content: "OK" })
  await act(async () => value.retryFailed(build))
  expect(vi.mocked(testSettingsLlmModel).mock.calls.map(([c]) => c.model)).toEqual(["a", "b", "b"])
  expect(value.modelTestState.success).toBe(true)
  expect(window.confirm).toHaveBeenCalledTimes(2)
})
it("离开组件后不继续批次，也不回填过期结果", async () => {
  ;({ unmount } = await mountModel(<Harness />))
  const pending = deferred<{ model: string; content: string }>()
  vi.mocked(testSettingsLlmModel).mockReturnValueOnce(pending.promise)
  let request: Promise<void>
  await act(async () => { request = value.runBatchTest(["a", "b"], build) })
  await unmount(); unmount = async () => {}
  await act(async () => { pending.resolve({ model: "a", content: "OK" }); await request })
  expect(testSettingsLlmModel).toHaveBeenCalledOnce()
})
