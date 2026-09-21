// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatMessage, StreamCallbacks } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import type { RecognizedCharacter } from "@/lib/novel/book-analysis/types"

const mocks = vi.hoisted(() => ({
  streamChat: vi.fn<(config: LlmConfig, messages: ChatMessage[], callbacks: StreamCallbacks, signal?: AbortSignal) => Promise<void>>(),
  readFile: vi.fn<(path: string) => Promise<string>>(),
  resolveDefaultModel: vi.fn(),
  persistCharacterToDisk: vi.fn(),
  generateSkillsForCharacters: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("@/lib/llm-client", () => ({ streamChat: mocks.streamChat }))
vi.mock("@/commands/fs", () => ({ readFile: mocks.readFile }))
vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: { getState: () => ({ llmConfig: {}, providerConfigs: [] }) },
}))
vi.mock("@/lib/novel/model-resolver", () => ({ resolveDefaultModel: mocks.resolveDefaultModel }))
vi.mock("@/lib/has-usable-llm", () => ({ hasUsableLlm: () => true }))
vi.mock("@/lib/novel/book-analysis/character-disk-store", () => ({
  persistCharacterToDisk: mocks.persistCharacterToDisk,
}))
vi.mock("@/lib/novel/book-analysis/skill-generator", () => ({
  generateSkillsForCharacters: mocks.generateSkillsForCharacters,
}))
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }))

import { useBookAnalysisStore } from "@/stores/book-analysis-store"
import { buildSimpleExtractionPrompt } from "@/lib/novel/book-analysis/simple-extraction-prompts"
import { useCharacterExtraction, type ChapterSelectionData } from "./use-character-extraction"

const llmConfig: LlmConfig = {
  provider: "openai", apiKey: "测试占位值", model: "测试模型",
  ollamaUrl: "", customEndpoint: "", maxContextSize: 64000,
}
const bookPath = "E:/测试作品/book-analysis/book-1"
const chapterBody = "共同章节材料。".repeat(3000)
const recognizedCharacters: RecognizedCharacter[] = ["Actor_A", "Actor_B", "Actor_C"].map((name, index) => ({
  id: `actor-${index}`, name, aliases: [], appearances: 2, chapterIndices: [0, 1],
  importanceScore: 90 - index, category: "主角", sourceBook: bookPath,
}))
const profile = {
  personality: "冷静", motivation: "守护", speechStyle: "简短", behaviorPatterns: "克制",
  quotes: ["台词1", "台词2", "台词3"],
}

let host: HTMLDivElement
let root: Root
let selection: ChapterSelectionData
let extraction: ReturnType<typeof useCharacterExtraction>
const reloadLibraryState = vi.fn(async () => {})
const setChapterSelectionData = vi.fn()

function Harness() {
  extraction = useCharacterExtraction({
    chapterSelectionData: selection, setChapterSelectionData, recognizedCharacters,
    selectedCharacterIds: ["actor-0", "actor-1"], reloadLibraryState,
  })
  return null
}

async function mountExtraction(chapterCount: number, selectedIds?: string[]) {
  const chapters = Array.from({ length: chapterCount }, (_, index) => ({
    id: String(index + 1), title: `第 ${index + 1} 章`, order: index + 1,
    wordCount: chapterBody.length, path: `${bookPath}/chapters/${index + 1}.md`,
  }))
  const metadata = {
    title: "测试作品", sourceType: "file" as const, sourceBook: bookPath,
    totalChapters: chapterCount, totalWords: chapterBody.length * chapterCount, createdAt: 1, updatedAt: 1,
  }
  const abortController = new AbortController()
  const taskId = useBookAnalysisStore.getState().startTask("E:/测试作品", {
    sourceType: "file", sourcePath: bookPath, selectedChapters: chapters.map((chapter) => chapter.id),
  }, abortController)
  useBookAnalysisStore.getState().updateTaskMetadata(taskId, metadata)
  selection = {
    taskId, bookPath, chapters, metadata, abortController,
    selectedChapterIds: selectedIds ?? chapters.map((chapter) => chapter.id), depth: "fast",
  }
  await act(async () => { root.render(<Harness />) })
  return chapters.map((_, index) => `【第 ${index + 1} 章】\n${chapterBody.slice(0, 1500)}`).join("\n\n")
}

function queueProfile(name: string) {
  mocks.streamChat.mockImplementationOnce(async (_config, _messages, callbacks) => {
    callbacks.onToken(JSON.stringify([{ name, ...profile }]))
    callbacks.onDone()
  })
}

function expectCachedRequest(callIndex: number, chapterSamples: string, name: string) {
  const call = mocks.streamChat.mock.calls[callIndex]
  expect(call).toHaveLength(4)
  expect(call[0]).toBe(llmConfig)
  expect(call[1]).toHaveLength(1)
  expect(call[1][0].role).toBe("user")
  const content = call[1][0].content
  expect(Array.isArray(content)).toBe(true)
  if (typeof content === "string") throw new Error("请求缺少显式缓存内容块")
  expect(content).toHaveLength(2)
  const [prefix, suffix] = content
  expect(prefix.type).toBe("text")
  expect(suffix.type).toBe("text")
  if (prefix.type !== "text" || suffix.type !== "text") throw new Error("缓存内容块必须是文本")
  expect(prefix.cacheControl).toBe(true)
  expect(prefix).not.toHaveProperty("cache_control")
  expect(prefix.text.includes(chapterSamples)).toBe(true)
  expect(prefix.text.endsWith(chapterSamples)).toBe(true)
  expect(prefix.text).not.toContain("# 角色列表")
  expect(prefix.text).not.toContain("Actor_A")
  expect(prefix.text).not.toContain("Actor_B")
  expect(suffix).toEqual({ type: "text", text: `\n\n# 角色列表\n- ${name}` })
  expect(prefix.text + suffix.text).toBe(buildSimpleExtractionPrompt({ characterNames: [name], chapterSamples }))
  return prefix.text
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  mocks.streamChat.mockReset()
  mocks.streamChat.mockRejectedValue(new Error("意外的模型请求"))
  mocks.readFile.mockResolvedValue(`---\ntitle: 测试章节\n---\n${chapterBody}`)
  mocks.resolveDefaultModel.mockReturnValue(llmConfig)
  mocks.persistCharacterToDisk.mockResolvedValue(undefined)
  mocks.generateSkillsForCharacters.mockResolvedValue([])
  useBookAnalysisStore.setState(useBookAnalysisStore.getInitialState(), true)
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  useBookAnalysisStore.setState(useBookAnalysisStore.getInitialState(), true)
  vi.restoreAllMocks()
})

describe("useCharacterExtraction 简单提取缓存请求", () => {
  it("每个选中人物请求共享全部章节材料缓存块，保留模型、取消信号及提取结果", async () => {
    const chapterSamples = await mountExtraction(14)
    queueProfile("Actor_A")
    queueProfile("Actor_B")

    await act(async () => { await extraction.handleSimpleExtract() })

    expect(mocks.streamChat).toHaveBeenCalledTimes(2)
    const firstPrefix = expectCachedRequest(0, chapterSamples, "Actor_A")
    expect(firstPrefix).toBe(expectCachedRequest(1, chapterSamples, "Actor_B"))
    expect(firstPrefix.length).toBeGreaterThan(21000)
    for (const call of mocks.streamChat.mock.calls) expect(call[3]).toBe(selection.abortController.signal)
    expect(mocks.readFile).toHaveBeenCalledTimes(14)
    expect(mocks.persistCharacterToDisk).toHaveBeenCalledTimes(2)
    expect(useBookAnalysisStore.getState().tasks[0].characters?.map((character) => character.name)).toEqual(["Actor_A", "Actor_B"])
    expect(useBookAnalysisStore.getState().tasks[0].characters?.[0].personalityProfile).toEqual(profile)
    expect(reloadLibraryState).toHaveBeenCalledTimes(1)
    expect(mocks.toastSuccess).toHaveBeenCalledWith("简单提取完成")
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it("单人网络失败及再次失败后仅重试失败人物，仍发送显式缓存块且最终恢复原有结果", async () => {
    const chapterSamples = await mountExtraction(1)
    queueProfile("Actor_A")
    mocks.streamChat.mockRejectedValueOnce(new Error("network timeout"))
    await act(async () => { await extraction.handleSimpleExtract() })
    const completedCharacter = useBookAnalysisStore.getState().tasks[0].characters![0]
    expect(useBookAnalysisStore.getState().tasks[0].metadata).toMatchObject({
      failedCharacterNames: ["Actor_B"], networkFailure: true,
    })
    expect(mocks.streamChat).toHaveBeenCalledTimes(2)

    mocks.streamChat.mockRejectedValueOnce(new Error("network timeout"))
    await act(async () => { await extraction.handleResumeFailedExtraction(selection.taskId) })
    expect(useBookAnalysisStore.getState().tasks[0].metadata).toMatchObject({ failedCharacterNames: ["Actor_B"] })
    expect(useBookAnalysisStore.getState().tasks[0].progress.simpleExtractionStatus).toBe("partial")
    expect(mocks.streamChat).toHaveBeenCalledTimes(3)

    queueProfile("Actor_B")
    await act(async () => { await extraction.handleResumeFailedExtraction(selection.taskId) })

    expect(mocks.streamChat).toHaveBeenCalledTimes(4)
    const prefix = expectCachedRequest(2, chapterSamples, "Actor_B")
    expect(expectCachedRequest(0, chapterSamples, "Actor_A")).toBe(prefix)
    for (const index of [1, 3]) expect(expectCachedRequest(index, chapterSamples, "Actor_B")).toBe(prefix)
    expect(mocks.streamChat.mock.calls[2][3]).not.toBe(selection.abortController.signal)
    expect(mocks.streamChat.mock.calls[2][3]?.aborted).toBe(false)
    expect(mocks.readFile).toHaveBeenCalledTimes(3)
    expect(mocks.readFile.mock.calls[2][0]).toBe(`${bookPath}/chapters/1.md`)
    const task = useBookAnalysisStore.getState().tasks[0]
    expect(task.metadata).toMatchObject({ failedCharacterNames: [] })
    expect(task.progress.simpleExtractionStatus).toBe("done")
    expect(task.characters![0]).toBe(completedCharacter)
    expect(task.characters![1].personalityProfile).toEqual(profile)
    expect(mocks.generateSkillsForCharacters).toHaveBeenCalledTimes(2)
  })

  it.each([["4", "2"], ["3"]])("失败重试沿用首次选定的章节材料：%j", async (...selectedIds) => {
    await mountExtraction(4, selectedIds)
    mocks.readFile.mockImplementation(async (path) => `---\ntitle: 原章节\n---\n材料来自${path.endsWith("2.md") ? "第二章" : path.endsWith("4.md") ? "第四章" : path.endsWith("3.md") ? "第三章" : "不应读取的第一章"}`)
    queueProfile("Actor_A")
    mocks.streamChat.mockRejectedValueOnce(new Error("network timeout"))
    await act(async () => { await extraction.handleSimpleExtract() })
    const firstPrefix = (mocks.streamChat.mock.calls[0][1][0].content as Array<{ text: string }>)[0].text
    queueProfile("Actor_B")
    await act(async () => { await extraction.handleResumeFailedExtraction(selection.taskId) })
    const retryPrefix = (mocks.streamChat.mock.calls[2][1][0].content as Array<{ text: string }>)[0].text
    expect(retryPrefix).toBe(firstPrefix)
    expect(retryPrefix).not.toContain("不应读取的第一章")
    const sorted = [...selectedIds].sort((a, b) => Number(a) - Number(b))
    expect(mocks.readFile.mock.calls.map(([path]) => path)).toEqual([...sorted, ...sorted].map((id) => `${bookPath}/chapters/${id}.md`))
    expect(useBookAnalysisStore.getState().tasks[0].config.selectedChapters).toEqual(sorted)
  })

  it("没有可确认的历史章节范围时提示重选，禁止猜测第一章并产生付费请求", async () => {
    await mountExtraction(3, ["3"])
    queueProfile("Actor_A")
    mocks.streamChat.mockRejectedValueOnce(new Error("network timeout"))
    await act(async () => { await extraction.handleSimpleExtract() })
    useBookAnalysisStore.setState((state) => ({ tasks: state.tasks.map((task) => ({ ...task, config: { ...task.config, selectedChapters: [] } })) }))
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {})
    await act(async () => { await extraction.handleResumeFailedExtraction(selection.taskId) })
    expect(alert).toHaveBeenCalledWith(expect.stringContaining("章节范围"))
    expect(mocks.streamChat).toHaveBeenCalledTimes(2)
    expect(mocks.readFile).toHaveBeenCalledTimes(1)
  })

})
