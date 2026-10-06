import { beforeEach, expect, it, vi } from "vitest"
import { useWikiStore, type ProviderOverride } from "@/stores/wiki-store"
import { saveProviderConfigs, saveLlmConfig, saveActivePresetId, saveNovelConfig, saveDefaultLlmModel } from "@/lib/project-store"
import { flushAppState } from "@/lib/web-store"
import { saveUiTestProvider } from "./provider-save"
vi.mock("@/lib/project-store", () => ({ saveProviderConfigs: vi.fn(), saveLlmConfig: vi.fn(), saveActivePresetId: vi.fn(), saveNovelConfig: vi.fn(), saveDefaultLlmModel: vi.fn() }))
vi.mock("@/lib/web-store", () => ({ flushAppState: vi.fn() }))
const first: ProviderOverride = { label: "模拟甲", enabled: true, baseUrl: "https://example.invalid/v1", apiKey: "mock-only-key", model: "model-a", savedModels: [{ id: "legacy-id", model: "model-a", name: "原显示名", description: "原备注", createdAt: 10 }] }
beforeEach(() => { vi.resetAllMocks(); useWikiStore.setState({ providerConfigs: { "custom-a": first }, activePresetId: null }) })
it("并发保存合并不同卡片，而不是覆盖整个旧快照", async () => {
  await Promise.all([saveUiTestProvider("custom-a", { ...first, label: "甲修改" }, first), saveUiTestProvider("custom-b", { ...first, label: "乙" }, undefined)])
  expect(Object.keys(useWikiStore.getState().providerConfigs)).toEqual(["custom-a", "custom-b"])
  expect(useWikiStore.getState().providerConfigs["custom-a"].savedModels).toEqual(first.savedModels)
  expect(flushAppState).toHaveBeenCalledTimes(2)
})
it("落盘失败不更新运行配置，保留原模型并可重试", async () => {
  vi.mocked(flushAppState).mockRejectedValueOnce(new Error("模拟磁盘失败"))
  await expect(saveUiTestProvider("custom-a", { ...first, label: "待保存" }, first)).rejects.toThrow("模拟磁盘失败")
  expect(useWikiStore.getState().providerConfigs["custom-a"]).toBe(first)
  await saveUiTestProvider("custom-a", { ...first, label: "待保存" }, first)
  expect(useWikiStore.getState().providerConfigs["custom-a"].label).toBe("待保存")
})
it("拒绝覆盖其他位置的新配置", async () => {
  useWikiStore.setState({ providerConfigs: { "custom-a": { ...first, label: "外部新值" } } })
  await expect(saveUiTestProvider("custom-a", first, first)).rejects.toThrow("其他位置")
  expect(saveProviderConfigs).not.toHaveBeenCalled()
})
it("删除当前提供方会清理活动引用，但不重置聊天和正文", async () => {
  useWikiStore.setState({ activePresetId: "custom-a" })
  const oldLlm = useWikiStore.getState().llmConfig
  await saveUiTestProvider("custom-a", null, first)
  expect(saveActivePresetId).toHaveBeenCalledWith(null)
  expect(useWikiStore.getState().activePresetId).toBeNull()
  expect(useWikiStore.getState().llmConfig).toBe(oldLlm)
  expect(saveLlmConfig).not.toHaveBeenCalled()
})
it("删除配置清理指向它的默认模型引用，其他模型引用不变", async () => {
  const novel = { ...useWikiStore.getState().novelConfig, defaultLlmModel: "custom-a/model-a", reviewModel: "custom-a/model-a", summaryModel: "other/model-b", extractModel: "", deAiModel: "" }
  useWikiStore.setState({ novelConfig: novel, defaultLlmModel: "custom-a/model-a", project: null })
  await saveUiTestProvider("custom-a", null, first)
  expect(saveNovelConfig).toHaveBeenCalledWith({ ...novel, defaultLlmModel: "", reviewModel: "" }, undefined, undefined)
  expect(saveDefaultLlmModel).toHaveBeenCalledWith("")
  expect(useWikiStore.getState().novelConfig).toMatchObject({ defaultLlmModel: "", reviewModel: "", summaryModel: "other/model-b" })
})
it("删除过程中引用清理落盘失败时，提供方和引用都保持原值", async () => {
  useWikiStore.setState({ defaultLlmModel: "custom-a/model-a", novelConfig: { ...useWikiStore.getState().novelConfig, defaultLlmModel: "custom-a/model-a" } })
  vi.mocked(saveDefaultLlmModel).mockRejectedValueOnce(new Error("引用保存失败"))
  await expect(saveUiTestProvider("custom-a", null, first)).rejects.toThrow("引用保存失败")
  expect(useWikiStore.getState().providerConfigs["custom-a"]).toBe(first)
  expect(useWikiStore.getState().defaultLlmModel).toBe("custom-a/model-a")
})
