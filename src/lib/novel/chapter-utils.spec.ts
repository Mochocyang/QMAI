import { describe, expect, it, vi } from "vitest"
import { detectLastGeneratedChapterNumber, resolveNextChapterNumber, resolveTargetChapterNumberForChat } from "./chapter-utils"

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

describe("resolveNextChapterNumber", () => {
  it("空章节库返回第 1 章", () => {
    expect(resolveNextChapterNumber([])).toBe(1)
  })

  it("取最大章号加一", () => {
    expect(resolveNextChapterNumber([
      { name: "第3章 令牌.md", path: "/b/chapters/第3章 令牌.md" },
      { name: "第7章 抉择.md", path: "/b/chapters/第7章 抉择.md" },
      { name: "第5章 中间.md", path: "/b/chapters/第5章 中间.md" },
    ])).toBe(8)
  })

  it("乱序文件名不影响结果", () => {
    expect(resolveNextChapterNumber([
      { name: "第12章.md", path: "/b/chapters/第12章.md" },
      { name: "第2章.md", path: "/b/chapters/第2章.md" },
    ])).toBe(13)
  })

  it("非章节文件被忽略", () => {
    expect(resolveNextChapterNumber([
      { name: "序章.md", path: "/b/chapters/序章.md" },
      { name: "第4章.md", path: "/b/chapters/第4章.md" },
    ])).toBe(5)
  })

  it("全部没有章号时返回第 1 章", () => {
    expect(resolveNextChapterNumber([
      { name: "设定.md", path: "/b/chapters/设定.md" },
    ])).toBe(1)
  })

  it("文件名没有章号时回落到路径里的章号", () => {
    expect(resolveNextChapterNumber([
      { name: "设定.md", path: "/b/chapters/第9章 设定.md" },
    ])).toBe(10)
  })

  it("路径兜底不吃目录名里的数字（QMAI-main2）", () => {
    // 面板传的是项目绝对路径：extractChapterNumber 末尾那条纯数字回退会把
    // 目录名里的 2 当成章号，于是「下一章」直接跳到第 3 章。
    expect(resolveNextChapterNumber([
      { name: "设定.md", path: "/QMAI-main2/wiki/chapters/设定.md" },
    ])).toBe(1)
  })

  it("路径兜底不吃目录名里的多位数（scratch-20261010）", () => {
    expect(resolveNextChapterNumber([
      { name: "设定.md", path: "/b/scratch-20261010/wiki/chapters/设定.md" },
    ])).toBe(1)
  })

  it("路径兜底仍认显式的「第N章」目录段", () => {
    expect(resolveNextChapterNumber([
      { name: "设定.md", path: "/b/第9章/设定.md" },
    ])).toBe(10)
  })

  it("文件名沿用宽松的数字回退（chapter-006.md）", () => {
    // 纯数字回退对「文件名」是必要的，只是不能套在项目绝对路径上。
    expect(resolveNextChapterNumber([
      { name: "chapter-006.md", path: "/QMAI-main2/wiki/chapters/chapter-006.md" },
    ])).toBe(7)
  })

  it("文件名与路径章号不一致时以文件名为准", () => {
    expect(resolveNextChapterNumber([
      { name: "第2章.md", path: "/b/chapters/第9章/第2章.md" },
    ])).toBe(3)
  })
})
