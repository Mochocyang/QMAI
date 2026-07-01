import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  chapterProvider,
  createChatHistoryProvider,
  createOutlineHistoryProvider,
  createSkillProvider,
  deductionProvider,
  memoryProvider,
  outlineProvider,
} from "./providers"

const mocks = vi.hoisted(() => ({
  listDirectory: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({
  listDirectory: mocks.listDirectory,
}))

function file(name: string) {
  return { name, path: name, is_dir: false }
}

function dir(name: string) {
  return { name, path: name, is_dir: true }
}

describe("reference providers", () => {
  beforeEach(() => {
    mocks.listDirectory.mockReset()
  })

  it("loads chapter markdown files as reference tokens", async () => {
    mocks.listDirectory.mockResolvedValue([
      file("第一章.md"),
      file("notes.txt"),
      dir("nested"),
    ])

    const result = await chapterProvider.fetchItems("C:\\Novel")

    expect(mocks.listDirectory).toHaveBeenCalledWith("C:/Novel/wiki/chapters")
    expect(result).toMatchObject([
      {
        category: "chapter",
        title: "第一章",
        path: "C:/Novel/wiki/chapters/第一章.md",
        displayTitle: "第一章",
      },
    ])
    expect(result[0].id).toEqual(expect.any(String))
  })

  it("loads memory, outline, and deduction files from their project folders", async () => {
    mocks.listDirectory
      .mockResolvedValueOnce([file("人物.md")])
      .mockResolvedValueOnce([file("主线.md")])
      .mockResolvedValueOnce([file("推演.json")])

    await expect(memoryProvider.fetchItems("C:/Novel")).resolves.toMatchObject([
      { category: "memory", title: "人物", path: "C:/Novel/wiki/memory/人物.md" },
    ])
    await expect(outlineProvider.fetchItems("C:/Novel")).resolves.toMatchObject([
      { category: "outline", title: "主线", path: "C:/Novel/wiki/outlines/主线.md" },
    ])
    await expect(deductionProvider.fetchItems("C:/Novel")).resolves.toMatchObject([
      { category: "deduction", title: "推演", path: "C:/Novel/.qmai/simulations/推演.json" },
    ])
  })

  it("returns an empty list when a file source cannot be read", async () => {
    mocks.listDirectory.mockRejectedValue(new Error("missing"))

    await expect(chapterProvider.fetchItems("C:/Novel")).resolves.toEqual([])
  })

  it("creates skill and conversation history providers", async () => {
    const skills = createSkillProvider(() => [{ id: "s1", name: "长标题".repeat(12) }])
    const chats = createChatHistoryProvider(() => [{ id: "c1", title: "对话一" }])
    const outlines = createOutlineHistoryProvider(() => [{ id: "o1", title: "大纲一" }])

    await expect(skills.fetchItems("")).resolves.toMatchObject([
      {
        category: "skill",
        title: "长标题".repeat(12),
        skillId: "s1",
        displayTitle: "长标题长标题长标题长标题长标题长标题长标...",
      },
    ])
    await expect(chats.fetchItems("")).resolves.toMatchObject([
      { category: "chat_history", title: "对话一", conversationId: "c1" },
    ])
    await expect(outlines.fetchItems("")).resolves.toMatchObject([
      { category: "outline_history", title: "大纲一", conversationId: "o1" },
    ])
  })
})
