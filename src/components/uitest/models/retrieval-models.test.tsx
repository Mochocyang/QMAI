// @vitest-environment jsdom
import { act } from "react"
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { UiTestEmbeddingModels, UiTestRerankModels } from "./retrieval-models"
import { saveEmbeddingConfig, saveRerankConfig } from "@/lib/project-store"
import { flushAppState } from "@/lib/web-store"
import { fetchEmbeddingModelList, fetchRerankModelList } from "@/lib/settings-model-list"
import { testSettingsEmbeddingModel, testSettingsRerankModel } from "@/lib/settings-model-test"
import { embedAllPages } from "@/lib/embedding"
import { mountModel, changeInput, click, button, deferred } from "./model-test-utils"
vi.mock("@/lib/project-store", () => ({ saveEmbeddingConfig: vi.fn(), saveRerankConfig: vi.fn() }))
vi.mock("@/lib/web-store", () => ({ flushAppState: vi.fn() }))
vi.mock("@/lib/settings-model-list", () => ({ fetchEmbeddingModelList: vi.fn(), fetchRerankModelList: vi.fn() }))
vi.mock("@/lib/settings-model-test", () => ({ testSettingsEmbeddingModel: vi.fn(), testSettingsRerankModel: vi.fn() }))
vi.mock("@/lib/embedding", () => ({ getEmbeddingCount: vi.fn().mockResolvedValue(4), legacyVectorRowCount: vi.fn().mockResolvedValue(0), getLastEmbeddingError: vi.fn().mockReturnValue(null), embedAllPages: vi.fn(), dropLegacyVectorTable: vi.fn() }))
const initial = useWikiStore.getState()
let host: HTMLDivElement, unmount: () => Promise<void>
async function render(rerank = false) { ({ host, unmount } = await mountModel(rerank ? <UiTestRerankModels /> : <UiTestEmbeddingModels />)) }
beforeEach(() => {
  vi.clearAllMocks(); vi.spyOn(window, "confirm").mockReturnValue(true)
  useWikiStore.setState({ ...initial, project: { id: "mock-book", name: "模拟小说", path: "/mock/book" },
    embeddingConfig: { enabled: true, endpoint: "https://embedding.invalid/v1", model: "embed-a", apiKey: "fake-vector-key", maxChunkChars: 1000, overlapChunkChars: 200 },
    rerankConfig: { ...initial.rerankConfig, enabled: true, useMainLlm: false, provider: "custom", customEndpoint: "https://rerank.invalid/v1/rerank", model: "rank-a", apiKey: "fake-rank-key", maxCandidates: 12 },
  })
})
afterEach(async () => { if (unmount) await unmount(); vi.restoreAllMocks() })
it("向量配置独立保存，重叠校验失败不写入也不能重建索引", async () => {
  await render()
  const previous = useWikiStore.getState().embeddingConfig
  await changeInput(host, "重叠字符数", "1000"); await click(host, "保存配置")
  expect(host.textContent).toContain("小于每块字符数")
  expect(saveEmbeddingConfig).not.toHaveBeenCalled()
  expect(button(host, "重建索引").disabled).toBe(true)
  expect(useWikiStore.getState().embeddingConfig).toBe(previous)
  await changeInput(host, "重叠字符数", "100"); await click(host, "保存配置")
  expect(saveEmbeddingConfig).toHaveBeenCalledWith(expect.objectContaining({ overlapChunkChars: 100 }))
  expect(saveRerankConfig).not.toHaveBeenCalled()
  expect(host.textContent).toContain("配置已保存")
})
it("向量模型选择不清空刚拉取的目录，修改接口才清空", async () => {
  vi.mocked(fetchEmbeddingModelList).mockResolvedValue({ models: ["embed-a", "embed-b"] })
  await render(); await click(host, "拉取模型")
  expect(host.querySelectorAll("select option")).toHaveLength(3)
  await changeInput(host, "输入向量模型 ID", "embed-b")
  expect(host.querySelectorAll("select option")).toHaveLength(3)
  await changeInput(host, "向量接口地址", "https://new.invalid/v1")
  expect(host.querySelectorAll("select option")).toHaveLength(0)
})
it("向量测试失败脱敏、不保存，旧请求不能覆盖新输入", async () => {
  const pending = deferred<{ model: string; dimensions: number }>()
  vi.mocked(testSettingsEmbeddingModel).mockReturnValueOnce(pending.promise)
  await render(); await click(host, "测试向量模型")
  await changeInput(host, "向量接口地址", "https://new.invalid/v1")
  await act(async () => pending.reject(new Error("fake-vector-key OLD_FAILED")))
  expect(host.textContent).not.toContain("OLD_FAILED")
  vi.mocked(testSettingsEmbeddingModel).mockRejectedValueOnce(new Error("认证失败 fake-vector-key"))
  await click(host, "测试向量模型")
  expect(host.textContent).toContain("认证失败")
  expect(host.textContent).not.toContain("fake-vector-key")
  expect(saveEmbeddingConfig).not.toHaveBeenCalled()
})
it("索引运行时不能更改启用状态或保存新配置", async () => {
  const pending = deferred<number>()
  vi.mocked(embedAllPages).mockReturnValueOnce(pending.promise)
  await render(); await click(host, "重建索引")
  const disabled = button(host, "启用向量检索").disabled
  await act(async () => pending.resolve(4))
  expect(disabled).toBe(true)
  expect(saveEmbeddingConfig).not.toHaveBeenCalled()
})
it("重排TOPN边界校验与独立保存，不会更新向量或聊天模型", async () => {
  await render(true)
  const oldLlm = useWikiStore.getState().llmConfig
  await changeInput(host, "候选 TOPN", "31"); await click(host, "保存配置")
  expect(saveRerankConfig).not.toHaveBeenCalled()
  await changeInput(host, "候选 TOPN", "20"); await click(host, "保存配置")
  expect(saveRerankConfig).toHaveBeenCalledWith(expect.objectContaining({ maxCandidates: 20 }), "mock-book", "/mock/book")
  expect(saveEmbeddingConfig).not.toHaveBeenCalled()
  expect(useWikiStore.getState().llmConfig).toBe(oldLlm)
})
it("重排拉取目录保留，测试用草稿但不保存，保存失败仍可重试", async () => {
  vi.mocked(fetchRerankModelList).mockResolvedValue({ models: ["rank-a", "rank-b"] })
  vi.mocked(testSettingsRerankModel).mockResolvedValue({ model: "rank-b", content: "模拟排序", usedMainLlm: false })
  await render(true); await click(host, "拉取模型")
  await changeInput(host, "输入重排模型 ID", "rank-b")
  expect(host.querySelector('option[value="rank-a"]')).not.toBeNull()
  await click(host, "测试重排模型")
  expect(testSettingsRerankModel).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ model: "rank-b" }))
  expect(saveRerankConfig).not.toHaveBeenCalled()
  vi.mocked(flushAppState).mockRejectedValueOnce(new Error("磁盘失败 fake-rank-key"))
  await click(host, "保存配置")
  expect(host.textContent).toContain("保存失败")
  expect(host.textContent).not.toContain("fake-rank-key")
  expect(useWikiStore.getState().rerankConfig.model).toBe("rank-a")
  await click(host, "保存配置")
  expect(useWikiStore.getState().rerankConfig.model).toBe("rank-b")
})
