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
  readFile: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({
  listDirectory: mocks.listDirectory,
  readFile: mocks.readFile,
}))

type MockNode = {
  name: string
  path: string
  is_dir: boolean
  children?: MockNode[]
}

function file(name: string, path = name): MockNode {
  return { name, path, is_dir: false }
}

function dir(name: string, path = name, children: MockNode[] = []): MockNode {
  return { name, path, is_dir: true, children }
}

describe("reference providers", () => {
  beforeEach(() => {
    mocks.listDirectory.mockReset()
    mocks.readFile.mockReset()
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

  it("uses markdown frontmatter and headings as Chinese display titles", async () => {
    mocks.listDirectory
      .mockResolvedValueOnce([
        dir("1", "C:/Novel/wiki/chapters/1", [
          file("chapter-010.md", "C:/Novel/wiki/chapters/1/chapter-010.md"),
        ]),
      ])
      .mockResolvedValueOnce([
        file("canon-facts.md", "C:/Novel/wiki/memory/canon-facts.md"),
      ])
    mocks.readFile
      .mockResolvedValueOnce("---\ntitle: \"第10章-灯下旧影\"\n---\n\n正文")
      .mockResolvedValueOnce("# 事实记忆\n\n人物与规则")

    await expect(chapterProvider.fetchItems("C:/Novel")).resolves.toMatchObject([
      {
        category: "chapter",
        title: "第10章-灯下旧影",
        displayTitle: "第10章-灯下旧影",
        path: "C:/Novel/wiki/chapters/1/chapter-010.md",
      },
    ])
    await expect(memoryProvider.fetchItems("C:/Novel")).resolves.toMatchObject([
      {
        category: "memory",
        title: "事实记忆",
        displayTitle: "事实记忆",
        path: "C:/Novel/wiki/memory/canon-facts.md",
      },
    ])
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

  it("loads nested chapter and memory markdown files instead of hiding folder contents", async () => {
    mocks.listDirectory
      .mockResolvedValueOnce([
        dir("第一卷", "C:/Novel/wiki/chapters/第一卷", [
          file("第1章.md", "C:/Novel/wiki/chapters/第一卷/第1章.md"),
        ]),
      ])
      .mockResolvedValueOnce([
        dir("角色", "C:/Novel/wiki/memory/角色", [
          file("主角.md", "C:/Novel/wiki/memory/角色/主角.md"),
        ]),
        file("canon-facts.md", "C:/Novel/wiki/memory/canon-facts.md"),
      ])

    await expect(chapterProvider.fetchItems("C:/Novel")).resolves.toMatchObject([
      { category: "chapter", title: "第一卷/第1章", path: "C:/Novel/wiki/chapters/第一卷/第1章.md" },
    ])
    await expect(memoryProvider.fetchItems("C:/Novel")).resolves.toMatchObject([
      { category: "memory", title: "角色/主角", path: "C:/Novel/wiki/memory/角色/主角.md" },
      { category: "memory", title: "记忆条目", path: "C:/Novel/wiki/memory/canon-facts.md" },
    ])
  })

  it("loads deduction room frameworks and nested simulation results", async () => {
    mocks.listDirectory.mockResolvedValue([
      dir("frameworks", "C:/Novel/.qmai/simulations/frameworks", [
        file("主线框架.md", "C:/Novel/.qmai/simulations/frameworks/主线框架.md"),
      ]),
      dir("results", "C:/Novel/.qmai/simulations/results", [
        dir("framework-1", "C:/Novel/.qmai/simulations/results/framework-1", [
          file("result-1.json", "C:/Novel/.qmai/simulations/results/framework-1/result-1.json"),
        ]),
      ]),
    ])
    mocks.readFile
      .mockResolvedValueOnce("---\ntitle: \"旧城坠星框架\"\nshortTitle: \"坠星框架\"\n---\n\n# 旧城坠星框架")
      .mockResolvedValueOnce(JSON.stringify({
        report: {
          createdAt: "2026-07-01T10:00:00.000Z",
          branches: [{ title: "桥下追逃", recommendation: true }],
        },
      }))

    await expect(deductionProvider.fetchItems("C:/Novel")).resolves.toMatchObject([
      { category: "deduction", title: "旧城坠星框架", path: "C:/Novel/.qmai/simulations/frameworks/主线框架.md" },
      { category: "deduction", title: "推演结果：桥下追逃", path: "C:/Novel/.qmai/simulations/results/framework-1/result-1.json" },
    ])
  })

  it("returns an empty list when a file source cannot be read", async () => {
    mocks.listDirectory.mockRejectedValue(new Error("missing"))

    await expect(chapterProvider.fetchItems("C:/Novel")).resolves.toEqual([])
  })

  it("creates skill and conversation history providers", async () => {
    const skills = createSkillProvider(() => [{
      id: "s1",
      name: "长标题".repeat(12),
      kind: ["structure", "planning"],
      stages: ["planning", "review"],
      modes: ["standard", "strict"],
    }])
    const chats = createChatHistoryProvider(() => [{ id: "c1", title: "对话一" }])
    const outlines = createOutlineHistoryProvider(() => [{ id: "o1", title: "大纲一" }])

    await expect(skills.fetchItems("")).resolves.toMatchObject([
      {
        category: "skill",
        title: "长标题".repeat(12),
        skillId: "s1",
        skillKinds: ["structure", "planning"],
        skillStages: ["planning", "review"],
        skillModes: ["standard", "strict"],
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
