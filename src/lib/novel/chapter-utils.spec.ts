import { describe, expect, it, vi } from "vitest"
import { resolveChapterMemoryDotState } from "./chapter-memory-dot"
import { detectLastGeneratedChapterNumber, pickChapterLibraryFiles, resolveChapterDotNumbers, resolveNextChapterNumber, resolveTargetChapterNumberForChat } from "./chapter-utils"

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

describe("pickChapterLibraryFiles", () => {
  // 面板传给 resolveNextChapterNumber 的是 listDirectory(project.path) 的整棵项目树，
  // 而项目树里还有「章纲-第046章-….md」「事件细纲-第012章.md」「2026-10-10-灵感记录.md」。
  // 本组用例固化「必须只看章节库」这条约束：不筛就会从章纲与笔记里读出章号/日期。
  const wholeProjectFiles = [
    { name: "第001章.md", path: "/b/wiki/chapters/第001章.md" },
    { name: "第012章.md", path: "/b/wiki/chapters/第012章.md" },
    { name: "章纲-第046章-第一次冷处理.md", path: "/b/wiki/outlines/章纲/章纲-第046章-第一次冷处理.md" },
    { name: "事件细纲-第012章.md", path: "/b/wiki/outlines/事件细纲/事件细纲-第012章.md" },
    { name: "2026-10-10-灵感记录.md", path: "/b/wiki/notes/2026-10-10-灵感记录.md" },
    { name: "卷纲-第一卷.md", path: "/b/wiki/outlines/卷纲/卷纲-第一卷.md" },
  ]

  it("整棵项目树直接喂进探测会把默认章号顶到 2027（缺陷现场）", () => {
    expect(resolveNextChapterNumber(wholeProjectFiles)).toBe(2027)
  })

  it("先挑出章节库再探测，章纲与笔记不再参与", () => {
    const picked = pickChapterLibraryFiles(wholeProjectFiles)
    expect(picked.map((file) => file.name)).toEqual(["第001章.md", "第012章.md"])
    expect(resolveNextChapterNumber(picked)).toBe(13)
  })

  it("章节库子目录是递归的，末级目录下的文件照样算", () => {
    expect(pickChapterLibraryFiles([
      { name: "第003章.md", path: "/b/wiki/chapters/nested/第003章.md" },
    ])).toEqual([{ name: "第003章.md", path: "/b/wiki/chapters/nested/第003章.md" }])
  })

  it("相邻的相似目录名不算章节库", () => {
    // 正则必须靠结尾的斜杠锚住 chapters 这一段：
    //   /wiki/chapters-archive/…   → chapters 后面紧跟 '-'，不匹配
    //   /wiki/outline-chapters-notes/… → wiki/ 后面不是 chapters，不匹配
    expect(pickChapterLibraryFiles([
      { name: "第004章.md", path: "/b/wiki/chapters-archive/第004章.md" },
      { name: "第009章.md", path: "/b/wiki/outline-chapters-notes/第009章.md" },
    ])).toEqual([])
  })

  it("反斜杠分隔符的 Windows 路径同样匹配", () => {
    const picked = pickChapterLibraryFiles([
      { name: "第005章.md", path: "C:\\b\\wiki\\chapters\\第005章.md" },
    ])
    expect(picked).toHaveLength(1)
    expect(resolveNextChapterNumber(picked)).toBe(6)
  })
})

/**
 * ── 绿点与徽章共用的取号规则 ──
 *
 * 这组用例的来历是一个真实缺陷：编辑器标题行的「正式/草稿」徽章原先用
 * frontmatter 的 `chapter_number` 取号，而侧栏绿点用「内容 → 标题 → 文件名」
 * 三级回退。两套规则只在恰好同号时一致，于是出现
 * 「第 6、15 章没有绿点却显示正式」。
 *
 * 现在两者都走 `resolveChapterDotNumbers`，所以这组用例钉的**不是**某个函数，
 * 而是「两个消费方必然算出同一个号」这条不变量。
 */
describe("resolveChapterDotNumbers", () => {
  it("内容里不加引号的 chapter_number 优先，压过标题里的号", () => {
    // 真实文件 chapter-013.md：frontmatter 是 13、标题写着第12章。
    // 先认内容，所以绿点亮的是「第13章」那枚快照。
    expect(resolveChapterDotNumbers({
      content: "---\ntitle: \"第12章 墙缝里的字\"\nchapter_number: 13\n---\n\n# 第12章 墙缝里的字\n",
      filePath: "C:/p/wiki/chapters/chapter-013.md",
    })).toEqual({ chapterNumber: 13, fileChapterNumber: 13 })
  })

  it("加引号的 chapter_number 取不到号，回退到标题（这是既有口径，不是缺陷）", () => {
    expect(resolveChapterDotNumbers({
      content: "---\ntitle: \"第12章 墙缝里的字\"\nchapter_number: '13'\n---\n\n# 第12章 墙缝里的字\n",
      filePath: "C:/p/wiki/chapters/chapter-013.md",
    })).toEqual({ chapterNumber: 12, fileChapterNumber: 13 })
  })

  it("标题里的中文数字也能取号", () => {
    expect(resolveChapterDotNumbers({
      content: "---\ntitle: \"第十章 归途\"\n---\n\n# 第十章 归途\n",
      filePath: "C:/p/wiki/chapters/第十章-归途.md",
    }).chapterNumber).toBe(10)
  })

  it("内容与标题都没有号时回退到文件名（chapter-003.md 这类）", () => {
    expect(resolveChapterDotNumbers({
      content: "正文，没有任何章号标记。\n",
      filePath: "C:/p/wiki/chapters/chapter-003.md",
    })).toEqual({ chapterNumber: 3, fileChapterNumber: 3 })
  })

  it("标题优先于文件名（第8章 写在标题、文件名是 015）", () => {
    // 仓库里 chapter-memory-dot.ts 的注释记过这种三处不一致的真实文件。
    expect(resolveChapterDotNumbers({
      content: "---\ntitle: \"第8章 编号\"\n---\n\n# 第8章 编号\n",
      filePath: "C:/p/wiki/chapters/chapter-015.md",
    })).toEqual({ chapterNumber: 8, fileChapterNumber: 15 })
  })

  it("Windows 反斜杠路径也能取出文件名", () => {
    expect(resolveChapterDotNumbers({
      content: "---\nchapter_number: 6\n---\n\n# 第6章\n",
      filePath: "C:\\QM-BOOK\\书\\wiki\\chapters\\第6章-把她叫回来.md",
    }).chapterNumber).toBe(6)
  })

  /**
   * 用户报的现场，逐步复现。
   *
   * 数据（黑雨之下）：快照只有 001–005、012；
   * 而第 6、15 章的文件里写着 `chapter_status: final`。
   * 徽章读 `chapter_status` 就会显示「正式」，读快照才是「草稿」。
   */
  it("第6章：文件写着 final，但没有快照 → 按记忆口径必须是「未提取」", () => {
    const snapshotChapterNumbers = new Set([1, 2, 3, 4, 5, 12])
    const numbers = resolveChapterDotNumbers({
      content: "---\ntitle: \"第6章-把她叫回来\"\nchapter_number: '6'\nchapter_status: final\n---\n\n# 第6章-把她叫回来\n",
      filePath: "C:/QM-BOOK/书/wiki/chapters/1/第6章-把她叫回来.md",
    })
    expect(resolveChapterMemoryDotState({ snapshotChapterNumbers, ...numbers, running: false })).toBe("none")
  })

  it("第4章：同样写着 final，但快照在 → 「已提取」，与侧栏绿点一致", () => {
    const snapshotChapterNumbers = new Set([1, 2, 3, 4, 5, 12])
    const numbers = resolveChapterDotNumbers({
      content: "---\ntitle: 第4章\nchapter_number: '4'\nchapter_status: final\n---\n\n# 第4章\n",
      filePath: "C:/QM-BOOK/书/wiki/chapters/1/第4章.md",
    })
    expect(resolveChapterMemoryDotState({ snapshotChapterNumbers, ...numbers, running: false })).toBe("done")
  })
})
