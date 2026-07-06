import { describe, expect, it } from "vitest"
import {
  buildDismantlingAnalysisPrompt,
  buildDismantlingCachePrefix,
  buildDismantlingReferenceDirective,
  buildDismantlingWebResearchPrompt,
  buildPlotFrameworkDraftFromAnalysis,
  extractPlotFrameworkBeatsFromAnalysis,
  extractPlotFrameworkLineageFromAnalysis,
  getDismantlingLibraryPath,
  normalizeDismantlingLibrary,
  selectNextDismantlingBatch,
  shouldReadDismantlingOriginalFile,
  splitDismantlingTextIntoChapters,
  type DismantlingProject,
} from "./dismantling"

describe("dismantling library", () => {
  it("stores dismantling data in an isolated project cache path", () => {
    expect(getDismantlingLibraryPath("E:/Novel")).toBe("E:/Novel/.qmai/dismantling/library.json")
  })

  it("splits imported text into ordered chapters without writing to novel memory", () => {
    const chapters = splitDismantlingTextIntoChapters(`第一章 开局
主角遭遇危机。

第二章 反击
主角开始行动。`)

    expect(chapters).toHaveLength(2)
    expect(chapters[0]).toMatchObject({ chapterNumber: 1, title: "第一章 开局" })
    expect(chapters[1]).toMatchObject({ chapterNumber: 2, title: "第二章 反击" })
    expect(chapters.map((item) => item.content).join("\n")).not.toContain("wiki/chapters")
  })

  it("auto-detects chapter headings from a full imported novel with volumes and full-width digits", () => {
    const chapters = splitDismantlingTextIntoChapters(`大奉打更人

正文卷　第１章　税银案
许七安醒来，发现自己身处牢中。

第一卷 京城风云 第2章 夜审
牢门打开，火光照进来。

  第三章 破局
他终于抓住了第一个破绽。`)

    expect(chapters).toHaveLength(3)
    expect(chapters.map((chapter) => chapter.chapterNumber)).toEqual([1, 2, 3])
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "正文卷 第1章 税银案",
      "第一卷 京城风云 第2章 夜审",
      "第三章 破局",
    ])
  })

  it("auto-detects chapters when imported document extraction keeps headings inside paragraphs", () => {
    const chapters = splitDismantlingTextIntoChapters(
      "书名 大奉打更人  第1章 大奉打更人 许七安睁开眼。  第2章 税银案 夜色压下来。  第3章 打更人 铜锣声响起。",
    )

    expect(chapters).toHaveLength(3)
    expect(chapters.map((chapter) => chapter.chapterNumber)).toEqual([1, 2, 3])
    expect(chapters[0].title).toBe("第1章 大奉打更人")
    expect(chapters[1].content).toContain("夜色压下来")
  })

  it("extracts a reader-style full novel text into its complete chapter catalog", () => {
    const chapters = splitDismantlingTextIntoChapters(`大奉打更人

第一卷 京察风云

第0001章 税银案
许七安睁开眼，发现自己身处牢中。

第0002章 牢中破局
他听见远处传来铜锣声，心里有了判断。

第0003章 打更人
火把照亮甬道，新的危机已经逼近。`)

    expect(chapters).toHaveLength(3)
    expect(chapters.map((chapter) => chapter.chapterNumber)).toEqual([1, 2, 3])
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "第0001章 税银案",
      "第0002章 牢中破局",
      "第0003章 打更人",
    ])
  })

  it("falls back to reading the original imported book when preprocessing skips text files", () => {
    expect(shouldReadDismantlingOriginalFile("no preprocessing needed")).toBe(true)
    expect(shouldReadDismantlingOriginalFile("  NO PREPROCESSING NEEDED  ")).toBe(true)
    expect(shouldReadDismantlingOriginalFile("第1章 正文")).toBe(false)
  })

  it("deduplicates dismantling projects with the same normalized title", () => {
    const library = normalizeDismantlingLibrary({
      projects: [
        makeProject("a", "大奉打更人", 3),
        makeProject("b", " 大奉打更人.txt ", 1),
        makeProject("c", "小说", 7),
      ],
    })

    expect(library.projects.map((item) => item.id)).toEqual(["a", "c"])
    expect(library.selectedProjectId).toBe("a")
  })

  it("selects only the requested pending chapters for one batch", () => {
    const project: DismantlingProject = {
      id: "book-1",
      title: "示例作品",
      createdAt: 1,
      updatedAt: 1,
      chapters: [
        { id: "c1", chapterNumber: 1, title: "第一章", content: "一", status: "pending" },
        { id: "c2", chapterNumber: 2, title: "第二章", content: "二", status: "done" },
        { id: "c3", chapterNumber: 3, title: "第三章", content: "三", status: "pending" },
      ],
      analyses: [],
      structureMemory: [],
    }

    expect(selectNextDismantlingBatch(project, { selectedChapterIds: ["c1", "c3"], batchSize: 1 }).map((item) => item.id)).toEqual(["c1"])
    expect(selectNextDismantlingBatch(project, { selectedChapterIds: ["c1", "c3"], batchSize: 5 }).map((item) => item.id)).toEqual(["c1", "c3"])
  })

  it("builds an analysis prompt that keeps dismantling memory separate from current novel facts", () => {
    const prompt = buildDismantlingAnalysisPrompt({
      projectTitle: "参考作品",
      chapters: [
        { id: "c1", chapterNumber: 1, title: "第一章", content: "主角被追杀，反手设局。", status: "pending" },
      ],
    })

    expect(prompt).toContain("独立拆文记忆库")
    expect(prompt).toContain("不得把原作人物、设定、剧情当成当前小说事实")
    expect(prompt).toContain("只输出结构化写法分析")
    expect(prompt).toContain("章节结构")
    expect(prompt).toContain("爽点")
    expect(prompt).toContain("结尾钩子")
  })

  it("builds an analysis prompt that enforces the four-beat framework (hook/buildup/payoff/endingHook)", () => {
    const prompt = buildDismantlingAnalysisPrompt({
      projectTitle: "参考作品",
      chapters: [
        { id: "c1", chapterNumber: 1, title: "第一章", content: "主角被追杀。", status: "pending" },
      ],
    })

    // 四段必须显式作为段标题出现，不能只是提示词里泛泛提及
    expect(prompt).toContain("## 开局钩子")
    expect(prompt).toContain("## 铺垫")
    expect(prompt).toContain("## 爽点")
    expect(prompt).toContain("## 结尾钩子")
    // 主线/支线归属与衔接约束必须显式要求
    expect(prompt).toContain("## 框架归属与衔接")
    expect(prompt).toContain("主线 / 支线")
    // 一句话可复用模板要求
    expect(prompt).toContain("一句话可复用模板")
    // 节奏字数初判约束
    expect(prompt).toContain("紧凑型")
    expect(prompt).toContain("水型")
    // 心智模型必须被提及，让 AI 理解固定方向模板
    expect(prompt).toContain("固定方向模板")
  })

  it("extracts four-beat framework from analysis markdown", () => {
    const markdown = [
      "## 本批总览",
      "样例",
      "## 开局钩子",
      "主角穿越后觉醒双S职业。",
      "## 铺垫",
      "配角衬托A级即顶点。",
      "## 爽点",
      "男主双S打破规则。",
      "## 结尾钩子",
      "所有人启程新手副本。",
      "## 框架归属与衔接",
      "- 本框架属于：主线",
      "- 本框架覆盖本批章节数：1 章",
      "- 与上一框架衔接点：无",
      "- 与下一框架衔接点：引出新手副本",
      "## 可复用结构记忆",
      "- 一句话可复用模板：先压后扬，规则打破",
    ].join("\n")

    const beats = extractPlotFrameworkBeatsFromAnalysis(markdown)
    expect(beats).not.toBeNull()
    expect(beats!.hook).toContain("双S职业")
    expect(beats!.buildup).toContain("配角")
    expect(beats!.payoff).toContain("打破规则")
    expect(beats!.endingHook).toContain("新手副本")

    const lineage = extractPlotFrameworkLineageFromAnalysis(markdown)
    expect(lineage.line).toBe("main")
    expect(lineage.reusableTemplate).toContain("先压后扬")
    expect(lineage.nextConnector).toContain("新手副本")
    expect(lineage.pacingChapterCount).toBe(1)
  })

  it("returns null beats when any of the four sections is missing in analysis markdown", () => {
    const markdown = [
      "## 开局钩子",
      "只有钩子，其他三段都没写。",
    ].join("\n")
    expect(extractPlotFrameworkBeatsFromAnalysis(markdown)).toBeNull()
  })

  it("builds a basic plot framework draft from complete dismantling analysis", () => {
    const markdown = [
      "## 开局钩子",
      "主角穿越后觉醒双S职业。",
      "## 铺垫",
      "配角衬托A级即顶点。",
      "## 爽点",
      "男主双S打破规则。",
      "## 结尾钩子",
      "所有人启程新手副本。",
      "## 框架归属与衔接",
      "- 本框架属于：主线",
      "- 与上一框架衔接点：承接觉醒仪式",
      "- 与下一框架衔接点：引出新手副本",
      "## 可复用结构记忆",
      "- 一句话可复用模板：先压后扬，规则打破",
    ].join("\n")

    const draft = buildPlotFrameworkDraftFromAnalysis({
      analysisId: "analysis-1",
      markdown,
      rangeChapterIds: ["ch-1", "ch-2"],
      sourceDismantlingProjectId: "project-1",
      sourceDismantlingProjectTitle: "全民转职",
      createdAt: 1000,
    })

    expect(draft).not.toBeNull()
    expect(draft!.id).toBe("framework-analysis-1")
    expect(draft!.line).toBe("main")
    expect(draft!.rangeChapterIds).toEqual(["ch-1", "ch-2"])
    expect(draft!.sourceDismantlingProjectTitle).toBe("全民转职")
    expect(draft!.reusableTemplate).toBe("先压后扬，规则打破")
    expect(draft!.prevConnector).toBe("承接觉醒仪式")
    expect(draft!.nextConnector).toBe("引出新手副本")
    expect(draft!.handcraftHints).toContain("作者手搓")
  })

  it("builds a web research prompt for hot-topic and webpage dismantling without mixing novel memory", () => {
    const prompt = buildDismantlingWebResearchPrompt({
      projectTitle: "参考作品",
      userRequest: "分析这个榜单的热门套路",
      webResearchContext: "## 联网研究资料\n榜单作品都使用强冲突开篇。",
    })

    expect(prompt).toContain("网页热门分析")
    expect(prompt).toContain("参考作品")
    expect(prompt).toContain("分析这个榜单的热门套路")
    expect(prompt).toContain("## 联网研究资料")
    expect(prompt).toContain("只写入独立拆文记忆库")
    expect(prompt).toContain("不要写入当前小说事实")
  })

  it("builds a chat directive that references structure but forbids copying original content", () => {
    const directive = buildDismantlingReferenceDirective({
      title: "参考作品",
      structureMemory: [
        "前三章节奏：开局危机、第二章反击、第三章扩大代价。",
        "结尾钩子：每章末尾留下立即行动压力。",
      ],
    })

    expect(directive).toContain("参考拆文结构")
    expect(directive).toContain("不得复用原作人物")
    expect(directive).toContain("不得复用原作剧情")
    expect(directive).toContain("只学习节奏、冲突推进、爽点安排和章节钩子")
  })
})

describe("buildDismantlingCachePrefix", () => {
  it("输出项目标题 + 章节内容作为稳定前缀", () => {
    const chapters = [
      { id: "ch-1", chapterNumber: 1, title: "第一章 觉醒", content: "男主转职双S。", status: "done" as const },
    ]
    const prefix = buildDismantlingCachePrefix("全民转职", chapters)
    expect(prefix).toContain("全民转职")
    expect(prefix).toContain("第一章 觉醒")
    expect(prefix).toContain("男主转职双S")
  })

  it("buildDismantlingAnalysisPrompt 以 buildDismantlingCachePrefix 的输出开头", () => {
    const chapters = [
      { id: "ch-1", chapterNumber: 1, title: "第一章", content: "正文内容。", status: "done" as const },
    ]
    const prefix = buildDismantlingCachePrefix("作品A", chapters)
    const prompt = buildDismantlingAnalysisPrompt({ projectTitle: "作品A", chapters })
    expect(prompt.startsWith(prefix)).toBe(true)
  })
})

function makeProject(id: string, title: string, chapterCount: number): DismantlingProject {
  return {
    id,
    title,
    createdAt: 1,
    updatedAt: 1,
    chapters: Array.from({ length: chapterCount }, (_, index) => ({
      id: `${id}-${index + 1}`,
      chapterNumber: index + 1,
      title: `第${index + 1}章`,
      content: "内容",
      status: "pending",
    })),
    analyses: [],
    structureMemory: [],
  }
}
