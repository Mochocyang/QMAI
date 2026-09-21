import { describe, it, expect, beforeEach, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import type { FileNode } from "@/types/wiki"

vi.mock("./llm-client", () => ({
  streamChat: vi.fn(),
}))
vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listDirectory: vi.fn(),
}))
vi.mock("@/lib/novel/context-engine", () => ({
  buildContextPack: vi.fn(),
  contextPackToPrompt: vi.fn(),
}))

import { runSemanticLint } from "./lint"
import { streamChat } from "./llm-client"
import { readFile, listDirectory } from "@/commands/fs"
import { useWikiStore } from "@/stores/wiki-store"
import { useActivityStore } from "@/stores/activity-store"
import { buildContextPack, contextPackToPrompt } from "@/lib/novel/context-engine"

const mockStreamChat = vi.mocked(streamChat)
const mockReadFile = vi.mocked(readFile)
const mockListDirectory = vi.mocked(listDirectory)
const mockBuildContextPack = vi.mocked(buildContextPack)
const mockContextPackToPrompt = vi.mocked(contextPackToPrompt)

function fakeLlmConfig(): LlmConfig {
  return {
    provider: "openai",
    apiKey: "k",
    model: "m",
    ollamaUrl: "",
    customEndpoint: "",
    maxContextSize: 128000,
  }
}

function makeFileNode(name: string, content: string): { node: FileNode; content: string } {
  return {
    node: {
      name,
      path: `/project/wiki/${name}`,
      is_dir: false,
      children: [],
    } as FileNode,
    content,
  }
}

beforeEach(() => {
  mockStreamChat.mockReset()
  mockReadFile.mockReset()
  mockListDirectory.mockReset()
  mockBuildContextPack.mockReset()
  mockContextPackToPrompt.mockReset()
  mockBuildContextPack.mockResolvedValue({
    task: "审稿第12章",
    chapterGoal: "潜入密牢",
    outline: "第12章大纲",
    recentSummaries: ["第11章摘要"],
    previousChapterEnding: "锁链声传来",
    characterStates: "林烬：潜入中",
    soulDoc: "",
    characterAuras: "",
    cognitionStates: "",
    foreshadowingStates: "黑玉令：未回收",
    timeline: "冬月初七深夜",
    relatedSettings: "密牢",
    canonRules: "主角尚不知皇帝身份",
    writingStyle: "紧张",
    searchResults: "黑玉令",
    graphSearchResults: "",
    mustDo: "确认师兄是否活着",
    mustAvoid: "不要暴露皇帝真实身份",
    nextChapterAdvice: "先延续锁链声悬念",
    revisionDirectives: "最近检查待修正项：补足锁链声承接",
  })
  mockContextPackToPrompt.mockReturnValue("## 小说上下文包\n\n## 本章必须完成\n确认师兄是否活着")
  useWikiStore.getState().setOutputLanguage("auto")
  useWikiStore.getState().setNovelMode(false)
  useActivityStore.setState({ items: [] })
})

describe("runSemanticLint — language directive", () => {
  it("uses explicit user setting", async () => {
    const pages = [
      makeFileNode("a.md", "Page A content here"),
      makeFileNode("b.md", "Page B content here"),
    ]
    mockListDirectory.mockResolvedValue(pages.map((p) => p.node))
    mockReadFile.mockImplementation(async (path) => {
      const match = pages.find((p) => p.node.path === path)
      return match?.content ?? ""
    })
    mockStreamChat.mockImplementation(async (_c, _m, cb) => {
      cb.onToken("")
      cb.onDone()
    })

    useWikiStore.getState().setOutputLanguage("Korean")
    await runSemanticLint("/project", fakeLlmConfig())

    const prompt = mockStreamChat.mock.calls[0][1][0].content
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: Korean")
  })

  it("auto mode detects from the concatenated page summaries", async () => {
    const cjkContent = "这是一篇关于注意力机制和神经网络的长中文页面"
    const pages = [
      makeFileNode("attention.md", cjkContent),
      makeFileNode("transformer.md", cjkContent),
    ]
    mockListDirectory.mockResolvedValue(pages.map((p) => p.node))
    mockReadFile.mockImplementation(async (path) => {
      const match = pages.find((p) => p.node.path === path)
      return match?.content ?? ""
    })
    mockStreamChat.mockImplementation(async (_c, _m, cb) => {
      cb.onToken("")
      cb.onDone()
    })

    useWikiStore.getState().setOutputLanguage("auto")
    await runSemanticLint("/project", fakeLlmConfig())

    const prompt = mockStreamChat.mock.calls[0][1][0].content
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: Chinese")
  })

  it("explicit setting wins over source language", async () => {
    const pages = [makeFileNode("x.md", "これは日本語の内容です")]
    mockListDirectory.mockResolvedValue(pages.map((p) => p.node))
    mockReadFile.mockResolvedValue(pages[0].content)
    mockStreamChat.mockImplementation(async (_c, _m, cb) => {
      cb.onToken("")
      cb.onDone()
    })

    useWikiStore.getState().setOutputLanguage("English")
    await runSemanticLint("/project", fakeLlmConfig())

    const prompt = mockStreamChat.mock.calls[0][1][0].content
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: English")
    expect(prompt).not.toContain("MANDATORY OUTPUT LANGUAGE: Japanese")
  })
})

describe("runSemanticLint — activity & early returns", () => {
  it("uses Chinese activity text when semantic lint completes", async () => {
    mockListDirectory.mockResolvedValue([makeFileNode("a.md", "content").node])
    mockReadFile.mockResolvedValue("content")
    mockStreamChat.mockImplementation(async (_c, _m, cb) => {
      cb.onDone()
    })

    await runSemanticLint("/project", fakeLlmConfig())
    const items = useActivityStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].type).toBe("lint")
    expect(items[0].title).toBe("语义连贯性检查")
    expect(items[0].detail).toBe("发现 0 个语义问题。")
    expect(`${items[0].title}${items[0].detail}`).not.toMatch(/[A-Za-z]/)
  })

  it("returns empty and marks done when wiki has no pages", async () => {
    mockListDirectory.mockResolvedValue([])

    const result = await runSemanticLint("/project", fakeLlmConfig())
    expect(result).toEqual([])
    expect(mockStreamChat).not.toHaveBeenCalled()

    const items = useActivityStore.getState().items
    expect(items[0].detail).toBe("没有可检查的资料页。")
  })

  it("marks error status when wiki directory read fails", async () => {
    mockListDirectory.mockRejectedValue(new Error("ENOENT"))
    await runSemanticLint("/project", fakeLlmConfig())
    const items = useActivityStore.getState().items
    expect(items[0].status).toBe("error")
  })
})

describe("runSemanticLint — novel mode", () => {
  it("builds a novel consistency prompt from context pack and current chapter", async () => {
    mockListDirectory.mockResolvedValue([makeFileNode("chapter-12.md", "章节摘要").node])
    mockReadFile.mockResolvedValue("章节摘要")
    mockStreamChat.mockImplementation(async (_c, _m, cb) => {
      cb.onToken("")
      cb.onDone()
    })

    useWikiStore.getState().setNovelMode(true)
    await runSemanticLint("/project", fakeLlmConfig(), {
      chapterContent: "林烬潜入密牢，听见锁链声。",
      chapterNumber: 12,
    })

    expect(mockBuildContextPack).toHaveBeenCalledWith("/project", "检查第12章", 12)
    const prompt = mockStreamChat.mock.calls[0][1][0].content
    expect(prompt).toContain("小说连贯性检查编辑")
    expect(prompt).toContain("本章必须完成")
    expect(prompt).toContain("本章避免违背")
    expect(prompt).toContain("下一章推进建议")
    expect(prompt).toContain("林烬潜入密牢，听见锁链声。")
  })
})
