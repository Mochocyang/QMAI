import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))

import { listDirectory, readFile } from "@/commands/fs"
import {
  buildOutlineContext,
  buildRelevantCharacterBriefs,
  buildRelevantForeshadowing,
  capOutlineSourcesToBudget,
  loadOutlineDocumentIndex,
  resolveChapterOutline,
} from "./outline-context-index"

function file(path: string) {
  return { name: path.split("/").pop()!, path, is_dir: false }
}

function directory(path: string, children: ReturnType<typeof file>[]) {
  return { name: path.split("/").pop()!, path, is_dir: true, children }
}

const root = "/book/wiki/outlines"

describe("outline context index", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("outline 只包含总纲、目标卷和全部设定", async () => {
    const paths = {
      master: `${root}/大纲/总纲.md`,
      volume1: `${root}/卷纲/第一卷.md`,
      volume4: `${root}/卷纲/第四卷.md`,
      chapter: `${root}/章纲/第237章.md`,
      setting: `${root}/设定/世界观.md`,
      character: `${root}/人物小传/阿明.md`,
      foreshadowing: `${root}/伏笔/暗线.md`,
    }
    vi.mocked(listDirectory).mockResolvedValue([
      directory(`${root}/大纲`, [file(paths.master)]),
      directory(`${root}/卷纲`, [file(paths.volume1), file(paths.volume4)]),
      directory(`${root}/章纲`, [file(paths.chapter)]),
      directory(`${root}/设定`, [file(paths.setting)]),
      directory(`${root}/人物小传`, [file(paths.character)]),
      directory(`${root}/伏笔`, [file(paths.foreshadowing)]),
    ])
    const contents: Record<string, string> = {
      [paths.master]: "# 总纲\n全书主线",
      [paths.volume1]: "# 第一卷\n第一卷概述\n\n| 章节 | 事件 |\n| --- | --- |\n| 第1章 | 开端 |",
      [paths.volume4]: "# 第四卷\n第四卷概述\n\n## 章序表\n| 实际章号 | 事件ID | 事件 |\n| --- | --- | --- |\n| 239 | V4-050 | 钢铁来潮 |",
      [paths.chapter]: "# 第237章：旧账\n正文说明：第239章再回收，不能据此冒充第239章章纲。",
      [paths.setting]: "# 世界观设定\n世界规则",
      [paths.character]: "# 阿明\n人物秘密",
      [paths.foreshadowing]: "# 伏笔表\n暗线内容",
    }
    vi.mocked(readFile).mockImplementation(async (path) => contents[String(path)] ?? "")

    const index = await loadOutlineDocumentIndex("/book")
    const result = buildOutlineContext(index, 239)

    expect(result).toContain("全书主线")
    expect(result).toContain("第四卷概述")
    expect(result).toContain("V4-050")
    expect(result).toContain("世界规则")
    expect(result).not.toContain("第一卷概述")
    expect(result).not.toContain("第237章：旧账")
    expect(result).not.toContain("人物秘密")
    expect(result).not.toContain("暗线内容")
    expect(result).not.toContain("| 第1章 | 开端 |")

    const capped = capOutlineSourcesToBudget(result, 900)
    expect(capped).toContain("大纲/总纲.md")
    expect(capped).toContain("卷纲/第四卷.md")
    expect(capped).toContain("设定/世界观.md")

    const allVolumes = buildOutlineContext(index)
    expect(allVolumes).toContain("第一卷概述")
    expect(allVolumes).toContain("第四卷概述")
  })

  it("第237章章纲正文提到第239章时不误选，并从目标卷纲精确兜底", async () => {
    const chapterPath = `${root}/章纲/第237章.md`
    const volumePath = `${root}/卷纲/第四卷.md`
    vi.mocked(listDirectory).mockResolvedValue([
      directory(`${root}/章纲`, [file(chapterPath)]),
      directory(`${root}/卷纲`, [file(volumePath)]),
    ])
    vi.mocked(readFile).mockImplementation(async (path) => String(path) === chapterPath
      ? "# 第237章：旧账\n本章埋下线索，到第239章回收。\n\n## 第239章\n这里只是后续提示。"
      : [
          "# 第四卷",
          "## 章序表",
          "| 实际章号 | 事件ID | 事件名 |",
          "| --- | --- | --- |",
          "| 237 | V4-048 | 旧账 |",
          "| 239 | V4-050 | 钢铁来潮 |",
          "## V4-050 钢铁来潮",
          "第239章执行目标：完成接收链。",
        ].join("\n"))

    const result = resolveChapterOutline(await loadOutlineDocumentIndex("/book"), 239)

    expect(result.sourceKind).toBe("volume")
    expect(result.content).toContain("卷纲兜底")
    expect(result.content).toContain("V4-050")
    expect(result.content).toContain("完成接收链")
    expect(result.content).not.toContain("本章埋下线索")
  })

  it("独立章纲精确命中后保留整份文档的子标题内容", async () => {
    const chapterPath = `${root}/章纲/第239章.md`
    vi.mocked(listDirectory).mockResolvedValue([
      directory(`${root}/章纲`, [file(chapterPath)]),
    ])
    vi.mocked(readFile).mockResolvedValue("# 第239章：钢铁来潮\n\n## 场景一\n完整场景要求\n\n## 伏笔\n回收暗线")

    const result = resolveChapterOutline(await loadOutlineDocumentIndex("/book"), 239)

    expect(result.sourceKind).toBe("standalone")
    expect(result.content).toContain("完整场景要求")
    expect(result.content).toContain("回收暗线")
  })

  it("旧版根目录 type:outline 文件仍以明确的补零章标题分类", async () => {
    const chapterPath = `${root}/legacy-outline.md`
    vi.mocked(listDirectory).mockResolvedValue([file(chapterPath)])
    vi.mocked(readFile).mockResolvedValue([
      "---",
      "type: outline",
      "---",
      "# 第0239章章纲",
      "旧版章纲完整内容",
    ].join("\n"))

    const result = resolveChapterOutline(await loadOutlineDocumentIndex("/book"), 239)

    expect(result.sourceKind).toBe("standalone")
    expect(result.content).toContain("旧版章纲完整内容")
  })

  it("完整新书规划按语义拆分，人物小传仍只按命中人物加载", async () => {
    const planningPath = `${root}/大纲/完整新书规划.md`
    vi.mocked(listDirectory).mockResolvedValue([
      directory(`${root}/大纲`, [file(planningPath)]),
    ])
    vi.mocked(readFile).mockResolvedValue([
      "# 完整新书规划",
      "## 总纲",
      "总主线",
      "## 第一卷",
      "卷目标",
      "### 章节规划表",
      "| 章节 | 事件 |",
      "| --- | --- |",
      "| 第8章 | 入城 |",
      "## 世界观/设定",
      "法术规则",
      "## 人物小传",
      "### 林岚",
      "林岚人物详情",
      "### 周野",
      "周野人物详情",
      "## 伏笔表",
      "| 回收章节 | 内容 |",
      "| --- | --- |",
      "| 第8章 | 古钥匙 |",
    ].join("\n"))

    const index = await loadOutlineDocumentIndex("/book")
    const outline = buildOutlineContext(index, 8)
    const characters = buildRelevantCharacterBriefs(index, "本章由林岚入城")
    const foreshadowing = buildRelevantForeshadowing(index, 8, "处理古钥匙伏笔")

    expect(outline).toContain("总主线")
    expect(outline).toContain("卷目标")
    expect(outline).toContain("法术规则")
    expect(outline).not.toContain("林岚人物详情")
    expect(outline).not.toContain("古钥匙")
    expect(characters).toContain("林岚人物详情")
    expect(characters).not.toContain("周野人物详情")
    expect(foreshadowing).toContain("古钥匙")
  })
})
