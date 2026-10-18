import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))

import { listDirectory, readFile } from "@/commands/fs"
import {
  buildOutlineContext,
  buildOutlineContextLayers,
  buildRelevantCharacterBriefs,
  buildRelevantForeshadowing,
  buildVolumeContext,
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

  it("范围命名的章纲（章纲-第01–12章）按章切片，只取本章那一节", async () => {
    const chapterPath = `${root}/章纲/章纲-第01–12章.md`
    vi.mocked(listDirectory).mockResolvedValue([
      directory(`${root}/章纲`, [file(chapterPath)]),
    ])
    vi.mocked(readFile).mockResolvedValue([
      "# 章纲-第01–12章：雨夜无我",
      "",
      "## 第4章 竹哨",
      "第四章的完整执行单元",
      "",
      "## 第5章 无我",
      "第五章的完整执行单元",
      "",
      "## 第6章 断线",
      "第六章的完整执行单元",
    ].join("\n"))

    const result = resolveChapterOutline(await loadOutlineDocumentIndex("/book"), 5)

    expect(result.sourceKind).toBe("standalone")
    expect(result.sourcePaths).toEqual(["章纲/章纲-第01–12章.md"])
    expect(result.content).toContain("第五章的完整执行单元")
    expect(result.content).not.toContain("第四章的完整执行单元")
    expect(result.content).not.toContain("第六章的完整执行单元")
  })

  it("范围命名的章纲在区间外不命中（不误选整份文档）", async () => {
    const chapterPath = `${root}/章纲/章纲-第01–12章.md`
    vi.mocked(listDirectory).mockResolvedValue([
      directory(`${root}/章纲`, [file(chapterPath)]),
    ])
    vi.mocked(readFile).mockResolvedValue([
      "# 章纲-第01–12章：雨夜无我",
      "",
      "## 第5章 无我",
      "第五章的完整执行单元",
    ].join("\n"))

    const result = resolveChapterOutline(await loadOutlineDocumentIndex("/book"), 15)

    expect(result.sourceKind).toBe("none")
    expect(result.content).not.toContain("第五章的完整执行单元")
  })

  it("单章命名（第239章.md）仍返回整份文档，不被范围切片影响", async () => {
    const chapterPath = `${root}/章纲/第239章.md`
    vi.mocked(listDirectory).mockResolvedValue([
      directory(`${root}/章纲`, [file(chapterPath)]),
    ])
    vi.mocked(readFile).mockResolvedValue("# 第239章：钢铁来潮\n\n## 场景一\n完整场景要求")

    const result = resolveChapterOutline(await loadOutlineDocumentIndex("/book"), 239)

    expect(result.sourceKind).toBe("standalone")
    expect(result.content).toContain("完整场景要求")
  })

  it("相邻范围章纲各归其章（第13–24章只命中第15章）", async () => {
    const firstPath = `${root}/章纲/章纲-第01–12章.md`
    const secondPath = `${root}/章纲/章纲-第13–24章.md`
    vi.mocked(listDirectory).mockResolvedValue([
      directory(`${root}/章纲`, [file(firstPath), file(secondPath)]),
    ])
    vi.mocked(readFile).mockImplementation(async (path) => String(path) === firstPath
      ? "# 章纲-第01–12章：雨夜无我\n\n## 第5章 无我\n第一份文档的第五章"
      : "# 章纲-第13–24章：钢铁来潮\n\n## 第15章 接收链\n第二份文档的第十五章")

    const result = resolveChapterOutline(await loadOutlineDocumentIndex("/book"), 15)

    expect(result.sourceKind).toBe("standalone")
    expect(result.sourcePaths).toEqual(["章纲/章纲-第13–24章.md"])
    expect(result.content).toContain("第二份文档的第十五章")
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


describe("大纲缓存分层", () => {
  it("稳定层只含总纲和设定，分卷选择只改变任务层，完整旧接口不变", async () => {
    const paths = {
      master: `${root}/大纲/总纲.md`,
      volume1: `${root}/卷纲/第一卷.md`,
      volume2: `${root}/卷纲/第二卷.md`,
      setting: `${root}/设定/世界观.md`,
    }
    vi.mocked(listDirectory).mockResolvedValue([
      directory(`${root}/大纲`, [file(paths.master)]),
      directory(`${root}/卷纲`, [file(paths.volume1), file(paths.volume2)]),
      directory(`${root}/设定`, [file(paths.setting)]),
    ])
    const contents: Record<string, string> = {
      [paths.master]: "# 总纲\n全书寻找真相",
      [paths.volume1]: "# 第一卷\n旧城寻人\n\n| 章节 | 事件 |\n| --- | --- |\n| 第1章 | 起点 |",
      [paths.volume2]: "# 第二卷\n新城追踪\n\n| 章节 | 事件 |\n| --- | --- |\n| 第20章 | 追踪 |",
      [paths.setting]: "# 世界观设定\n没有超自然力量",
    }
    vi.mocked(readFile).mockImplementation(async (path) => contents[String(path)] ?? "")
    const index = await loadOutlineDocumentIndex("/book")
    const first = buildOutlineContextLayers(index, 1)
    const second = buildOutlineContextLayers(index, 20)
    expect(first.project).toBe(second.project)
    expect(first.project).toContain("全书寻找真相")
    expect(first.project).toContain("没有超自然力量")
    expect(first.project).not.toContain("旧城寻人")
    expect(first.task).toContain("旧城寻人")
    expect(second.task).toContain("新城追踪")
    expect(second.task).not.toContain("旧城寻人")
    expect(second.task).not.toContain("全书寻找真相")
    expect(first.full).toBe(buildOutlineContext(index, 1))
    expect(second.full).toBe(buildOutlineContext(index, 20))
  })

  /*
   * 结构化-only 之后的卷纲由 `renderVolumeOutlineMarkdown` 生成，一个章号都不出现
   * （只有「## 故事N：标题 / 章号范围 / 环节」）。这两条用例把「新格式卷纲还能不能
   * 兜底」钉死：修复前 `resolveChapterOutline` 返回 `sourceKind: "none"` + 空串，
   * 用户只生成卷纲就开写正文时，上下文里一份大纲都没有。
   */
  const structuredVolumeMarkdown = [
    "# 第四卷 千碑之城",
    "",
    "> 楚白夺回碑林控制权",
    "",
    "## 故事1：雨夜无我",
    "",
    "- **章号范围：** 第 1–12 章",
    "- **章情节拍：** 平升平起紧落缓升紧顶缓顶悬",
    "",
    "### 起① 常态与破口",
    "",
    "- **人物：** 楚白",
    "- 雨夜中被追杀",
    "- 第一次听见碑鸣",
    "",
    "## 故事2：断线",
    "",
    "- **章号范围：** 第 13–24 章",
    "",
    "### 起① 常态与破口",
    "",
    "- **人物：** 楚白、沈砚",
    "- 线索断在城南",
  ].join("\n")

  it("结构化-only 卷纲没有逐章信息时，兜底到本章所属故事的环节", async () => {
    const volumePath = `${root}/卷纲/第四卷.md`
    vi.mocked(listDirectory).mockResolvedValue([directory(`${root}/卷纲`, [file(volumePath)])])
    vi.mocked(readFile).mockResolvedValue(structuredVolumeMarkdown)

    const index = await loadOutlineDocumentIndex("/book")
    const story1 = resolveChapterOutline(index, 5)
    const story2 = resolveChapterOutline(index, 20)

    expect(story1.sourceKind).toBe("volume")
    expect(story1.content).toContain("卷纲兜底")
    expect(story1.content).toContain("雨夜无我")
    expect(story1.content).toContain("第一次听见碑鸣")
    // 关键：只给本章所属的那个故事，不能把整卷（含另一个故事）倒进上下文
    expect(story1.content).not.toContain("断线")
    expect(story1.content).not.toContain("线索断在城南")

    expect(story2.sourceKind).toBe("volume")
    expect(story2.content).toContain("断线")
    expect(story2.content).toContain("线索断在城南")
    expect(story2.content).not.toContain("第一次听见碑鸣")

    // 卷上下文同一条链路，不能只剩「所属卷纲 / 来源」两行空标题
    expect(buildVolumeContext(index, 5)).toContain("第一次听见碑鸣")
    expect(buildVolumeContext(index, 5)).not.toContain("线索断在城南")
  })

  it("章纲按章切片时章标题只出现一次（不重复追加）", async () => {
    const chapterPath = `${root}/章纲/章纲-第13–24章.md`
    vi.mocked(listDirectory).mockResolvedValue([directory(`${root}/章纲`, [file(chapterPath)])])
    vi.mocked(readFile).mockResolvedValue([
      "# 章纲-第13–24章",
      "",
      "## 第 13 章 断线",
      "",
      "- 第十三章的执行单元",
      "",
      "## 第 14 章 第二个名字",
      "",
      "- 第十四章的执行单元",
    ].join("\n"))

    const result = resolveChapterOutline(await loadOutlineDocumentIndex("/book"), 13)

    expect(result.sourceKind).toBe("standalone")
    expect(result.content).toContain("第十三章的执行单元")
    expect(result.content).not.toContain("第十四章的执行单元")
    // 旧实现会把「## 第 13 章 断线」在摘录末尾再追加一遍
    expect(result.content.match(/## 第 13 章 断线/g)).toHaveLength(1)
  })
})

describe("多章章纲缺本章", () => {
  it("文件名覆盖本章、正文没有本章 → 回退卷纲兜底，不得拿别的章顶替", async () => {
    const chapterPath = `${root}/章纲/章纲-第01–12章.md`
    const volumePath = `${root}/卷纲/卷纲-第一卷.md`
    vi.mocked(listDirectory).mockResolvedValue([
      directory(`${root}/章纲`, [file(chapterPath)]),
      directory(`${root}/卷纲`, [file(volumePath)]),
    ])
    // 真实形态：模型被要求写 1–12 章，只写出第 1 章，但文件名按故事区间命名
    vi.mocked(readFile).mockImplementation(async (path: string) => {
      if (path === chapterPath) {
        return ["# 故事一 章纲", "", "## 第 1 章 竹哨与雨夜", "", "- **一句话目标：** 记住竹哨"].join("\n")
      }
      return [
        "# 卷一 雨夜无我",
        "",
        "## 故事1：雨夜无我",
        "",
        "- **章号范围：** 第 1–12 章",
        "",
        "### 起① 常态与破口",
        "",
        "- 第一次听见碑鸣",
      ].join("\n")
    })

    const index = await loadOutlineDocumentIndex("/book")

    const ch1 = resolveChapterOutline(index, 1)
    expect(ch1.sourceKind).toBe("standalone")
    expect(ch1.content).toContain("竹哨与雨夜")

    // 第 5 章不在文件里：绝不能把第 1 章当成第 5 章喂给写作
    const ch5 = resolveChapterOutline(index, 5)
    expect(ch5.sourceKind).toBe("volume")
    expect(ch5.content).toContain("第一次听见碑鸣")
    expect(ch5.content).not.toContain("竹哨与雨夜")
  })

  it("正文没有逐章标题时保留「退回整份」的旧行为", async () => {
    const chapterPath = `${root}/章纲/章纲-第01–12章.md`
    vi.mocked(listDirectory).mockResolvedValue([directory(`${root}/章纲`, [file(chapterPath)])])
    // 非标准格式：整篇一段说明，没有任何「第N章」标题，切片本来就切不出来
    vi.mocked(readFile).mockResolvedValue("# 章纲总览\n\n第1到12章围绕竹哨展开，暂无分章细节。")

    const result = resolveChapterOutline(await loadOutlineDocumentIndex("/book"), 5)
    expect(result.sourceKind).toBe("standalone")
    expect(result.content).toContain("围绕竹哨展开")
  })
})
