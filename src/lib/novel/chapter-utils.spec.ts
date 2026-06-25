import { describe, expect, it, vi } from "vitest"
import { detectLastGeneratedChapterNumber, resolveTargetChapterNumberForChat } from "./chapter-utils"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(async () => [
    { name: "chapter-006.md", path: "E:/Novel/wiki/chapters/chapter-006.md", is_dir: false },
  ]),
  readFile: vi.fn(async () => "---\nchapter_number: 6\n---\n# 第6章\n"),
}))

describe("resolveTargetChapterNumberForChat", () => {
  it("uses the selected chapter plus one for continue-next-chapter requests", async () => {
    await expect(resolveTargetChapterNumberForChat({
      projectPath: "E:/Novel",
      userRequest: "继续生成下一章",
      routeIntent: "continue_chapter",
      selectedFile: "E:/Novel/wiki/chapters/chapter-007.md",
    })).resolves.toBe(8)
  })

  it("uses the next available chapter when no chapter is selected", async () => {
    await expect(resolveTargetChapterNumberForChat({
      projectPath: "E:/Novel",
      userRequest: "请根据当前小说上下文继续生成下一章正文",
      routeIntent: "continue_chapter",
    })).resolves.toBe(7)
  })

  it("keeps an explicit chapter number instead of advancing it", async () => {
    await expect(resolveTargetChapterNumberForChat({
      projectPath: "E:/Novel",
      userRequest: "继续生成第7章",
      routeIntent: "continue_chapter",
      routeChapterNumber: 7,
      selectedFile: "E:/Novel/wiki/chapters/chapter-007.md",
    })).resolves.toBe(7)
  })

  it("does not force a target chapter for ordinary current-chapter continuation", async () => {
    await expect(resolveTargetChapterNumberForChat({
      projectPath: "E:/Novel",
      userRequest: "继续写当前这一章",
      routeIntent: "continue_chapter",
      selectedFile: "E:/Novel/wiki/chapters/chapter-007.md",
    })).resolves.toBeUndefined()
  })

  it("advances past the chapter generated in this conversation even when it is not saved yet (issue #6)", async () => {
    await expect(resolveTargetChapterNumberForChat({
      projectPath: "E:/Novel",
      userRequest: "继续生成下一章",
      routeIntent: "continue_chapter",
      lastGeneratedChapterNumber: 8,
    })).resolves.toBe(9)
  })

  it("keeps the library-derived next chapter when it is already ahead of the conversation", async () => {
    await expect(resolveTargetChapterNumberForChat({
      projectPath: "E:/Novel",
      userRequest: "继续生成下一章",
      routeIntent: "continue_chapter",
      lastGeneratedChapterNumber: 3,
    })).resolves.toBe(7)
  })
})

describe("detectLastGeneratedChapterNumber", () => {
  it("reads the deep-generation target chapter marker from the latest assistant message", () => {
    expect(detectLastGeneratedChapterNumber([
      "## 阶段1：上下文分析\n目标章节：第1章\n章节目标：开局",
      "## 阶段1：上下文分析\n目标章节：第2章\n章节目标：冲突升级",
    ])).toBe(2)
  })

  it("reads chapter heading lines from generated chapter content", () => {
    expect(detectLastGeneratedChapterNumber([
      "# 第3章\n\n夜色像一块浸了水的布。",
    ])).toBe(3)
  })

  it("ignores ordinary answers that merely mention chapter numbers", () => {
    expect(detectLastGeneratedChapterNumber([
      "主角在第3章的时候已经拿到了钥匙，所以这里不冲突。",
    ])).toBeUndefined()
  })
})
