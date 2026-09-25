// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { UiTestDefaultModels } from "./default-models"
import { saveNovelConfig, saveDefaultLlmModel } from "@/lib/project-store"
import { flushAppState } from "@/lib/web-store"
import { testLlmConnection } from "@/lib/connection-tests"
import { mountModel, choose, click } from "./model-test-utils"
vi.mock("@/lib/project-store", () => ({ saveNovelConfig: vi.fn(), saveDefaultLlmModel: vi.fn() }))
vi.mock("@/lib/web-store", () => ({ flushAppState: vi.fn() }))
vi.mock("@/lib/connection-tests", () => ({ testLlmConnection: vi.fn() }))
const initial = useWikiStore.getState()
let host: HTMLDivElement, unmount: () => Promise<void>
beforeEach(async () => {
  vi.clearAllMocks(); vi.spyOn(window, "confirm").mockReturnValue(true)
  useWikiStore.setState({ ...initial, project: { id: "mock-book", path: "/mock/book", name: "模拟小说" }, aiChatModel: "custom-a/chat", novelConfig: { ...initial.novelConfig, defaultLlmModel: "custom-a/chat", reviewModel: "", summaryModel: "", extractModel: "", deAiModel: "" },
    providerConfigs: { "custom-a": { enabled: true, label: "模拟聊天", model: "chat", baseUrl: "https://chat.invalid/v1", apiKey: "mock-chat" }, "custom-b": { enabled: true, label: "模拟审稿", model: "review", baseUrl: "https://review.invalid/v1", apiKey: "mock-review" } },
  })
  ;({ host, unmount } = await mountModel(<UiTestDefaultModels />))
})
afterEach(async () => { await unmount(); vi.restoreAllMocks() })
it("草稿显示真正生效模型，环节测试不修改聊天或自动保存", async () => {
  const llm = useWikiStore.getState().llmConfig
  vi.mocked(testLlmConnection).mockResolvedValue({ ok: true, message: "OK" })
  await choose(host, "审稿模型", "custom-b/review")
  const row = host.querySelector('[aria-label="审稿模型"]')!.closest('.model-default-row') as HTMLElement
  expect((row.querySelector("select") as HTMLSelectElement).disabled).toBe(false)
  expect(row.textContent).not.toContain("实际使用")
  expect(row.textContent).not.toContain("打开小说后可配置此项")
  await click(row, "测试模型")
  expect(testLlmConnection).toHaveBeenCalledWith(expect.objectContaining({ model: "review", apiKey: "mock-review", customEndpoint: "https://review.invalid/v1" }))
  expect(useWikiStore.getState().aiChatModel).toBe("custom-a/chat")
  expect(useWikiStore.getState().llmConfig).toBe(llm)
  expect(saveNovelConfig).not.toHaveBeenCalled()
  expect(useWikiStore.getState().novelConfig.reviewModel).toBe("")
})
it("显式保存默认选择且保留小说其他参数，失败可重试", async () => {
  const oldNovel = useWikiStore.getState().novelConfig
  await choose(host, "默认模型（通用）", "custom-b/review")
  vi.mocked(flushAppState).mockRejectedValueOnce(new Error("模拟保存失败"))
  await click(host, "保存设置")
  expect(host.textContent).toContain("保存失败")
  expect(useWikiStore.getState().novelConfig).toBe(oldNovel)
  await click(host, "保存设置")
  expect(saveNovelConfig).toHaveBeenLastCalledWith({ ...oldNovel, defaultLlmModel: "custom-b/review" }, "mock-book", "/mock/book")
  expect(saveDefaultLlmModel).toHaveBeenLastCalledWith("custom-b/review")
  expect(useWikiStore.getState().novelConfig.defaultLlmModel).toBe("custom-b/review")
  expect(useWikiStore.getState().aiChatModel).toBe("custom-a/chat")
})
it("清空是真正跟随而非空格占位，并能被保存", async () => {
  await choose(host, "默认模型（通用）", "")
  expect(host.textContent).toContain("跟随聊天模型")
  await click(host, "保存设置")
  expect(useWikiStore.getState().novelConfig.defaultLlmModel).toBe("")
})
