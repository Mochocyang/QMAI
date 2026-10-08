import { describe, it, expect, vi } from "vitest"
import {
  contextPackToPrompt,
  selectLookbackChapterNumbers,
  type ContextPack,
} from "./context-engine"
import { listSnapshots, loadSnapshot, type ChapterSnapshot } from "./chapter-ingest"
import { routeTask, buildTaskDirective, type TaskRouteResult } from "./task-router"
import { isFinalChapter, isChapterPage } from "./chapter-meta"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  writeFileAtomic: vi.fn(),
  createDirectory: vi.fn(),
  fileExists: vi.fn(),
  listDirectory: vi.fn(),
}))

import { readFile, listDirectory } from "@/commands/fs"
const mockReadFile = vi.mocked(readFile)
const mockListDirectory = vi.mocked(listDirectory)

// ─── 稳定性测试：大规模章节场景 ───

describe("长篇稳定性测试", () => {
  describe("章节快照读写性能", () => {
    it("能正确列出 1000 个快照文件", async () => {
      const snapshotFiles = Array.from({ length: 1000 }, (_, i) => ({
        name: `${String(i + 1).padStart(3, "0")}.snapshot.json`,
        path: `/project/.novel/snapshots/${String(i + 1).padStart(3, "0")}.snapshot.json`,
        is_dir: false,
      }))

      mockListDirectory.mockResolvedValue(snapshotFiles)

      const nums = await listSnapshots("/project")
      expect(nums).toHaveLength(1000)
      expect(nums[0]).toBe(1)
      expect(nums[999]).toBe(1000)
    })

    it("快照序号排序正确", async () => {
      const snapshotFiles = [50, 3, 999, 1, 100, 500].map(n => ({
        name: `${String(n).padStart(3, "0")}.snapshot.json`,
        path: `/project/.novel/snapshots/${String(n).padStart(3, "0")}.snapshot.json`,
        is_dir: false,
      }))

      mockListDirectory.mockResolvedValue(snapshotFiles)

      const nums = await listSnapshots("/project")
      expect(nums).toEqual([1, 3, 50, 100, 500, 999])
    })

    it("能正确加载单个快照", async () => {
      const snapshot: ChapterSnapshot = {
        chapterId: "chapter-500",
        chapterNumber: 500,
        summary: "第500章摘要",
        characters: ["林烬", "陆沉舟", "太子"],
        locations: ["皇城"],
        organizations: ["暗卫"],
        items: ["黑玉令"],
        events: ["林烬发现真相"],
        characterStateChanges: ["林烬：震惊"],
        relationshipChanges: ["林烬-太子：敌对"],
        knowledgeChanges: ["林烬知道了太子的秘密"],
        foreshadowingChanges: ["推进伏笔：黑玉令"],
        newCanonFacts: ["黑玉令可以控制意识"],
        timelineEvents: ["冬月十五：真相揭露"],
        conflicts: ["主线冲突升级"],
        endingHook: "太子的刺客已到门外",
        graphNodes: ["character:林烬", "character:太子"],
        graphEdges: ["林烬->ENEMY_OF->太子"],
      }

      mockReadFile.mockResolvedValue(JSON.stringify(snapshot))

      const result = await loadSnapshot("/project", 500)
      expect(result).not.toBeNull()
      expect(result!.chapterNumber).toBe(500)
      expect(result!.characters).toContain("林烬")
      expect(result!.summary).toBe("第500章摘要")
    })
  })

  describe("上下文包 Token 控制", () => {
    it("contextPackToPrompt 在无预算时输出完整内容", () => {
      const pack = buildLargeContextPack(50)
      const prompt = contextPackToPrompt(pack)
      expect(prompt.length).toBeGreaterThan(0)
      expect(prompt).toContain("小说上下文包")
      expect(prompt).toContain("续写第50章")
    })

    it("contextPackToPrompt 在有 Token 预算时会裁剪", () => {
      const pack = buildLargeContextPack(50)
      const fullPrompt = contextPackToPrompt(pack)
      // 设置一个很小的预算（字符数）
      const budget = 500
      const trimmed = contextPackToPrompt(pack, budget)
      // 裁剪后应该小于全文
      expect(trimmed.length).toBeLessThanOrEqual(fullPrompt.length)
    })

    it("Token 预算为 0 时不裁剪", () => {
      const pack = buildLargeContextPack(50)
      const full = contextPackToPrompt(pack)
      const noBudget = contextPackToPrompt(pack, 0)
      expect(noBudget).toBe(full)
    })

    it("回看窗口不超出章节边界", () => {
      // 第1章不应往前回看
      expect(selectLookbackChapterNumbers(1, 3)).toEqual([])
      // 第2章只能看到第1章
      expect(selectLookbackChapterNumbers(2, 3)).toEqual([1])
      // 第1000章看最近3章
      expect(selectLookbackChapterNumbers(1000, 3)).toEqual([999, 998, 997])
    })

    it("大量摘要的上下文包不超过合理长度", () => {
      const pack = buildLargeContextPack(200)
      const prompt = contextPackToPrompt(pack)
      // 没有预算限制时也不应爆炸性增长
      // 因为 recentSummaries 是 string[]，content 受章节摘要长度控制
      expect(prompt.length).toBeLessThan(100000)
    })
  })

  describe("草稿不污染 Canon 保护", () => {
    it("非 final 状态的章节不应被摄取", () => {
      expect(isFinalChapter({ chapter_status: "draft" })).toBe(false)
      expect(isFinalChapter({ chapter_status: "revised" })).toBe(false)
      expect(isFinalChapter({ chapter_status: "archived" })).toBe(false)
      expect(isFinalChapter({ chapter_status: "final" })).toBe(true)
      expect(isFinalChapter({})).toBe(false)
    })

    it("状态为 outline 的页面不被当作章节", () => {
      expect(isChapterPage({ type: "outline" })).toBe(false)
      expect(isChapterPage({ type: "chapter" })).toBe(true)
      expect(isChapterPage({ chapter_number: 5 })).toBe(true)
    })
  })
})

// ─── 任务路由测试 ───

describe("任务路由 task-router", () => {
  describe("章节生成意图识别", () => {
    it("识别「写第10章」", () => {
      const result = routeTask("写第10章")
      expect(result.intent).toBe("write_chapter")
      expect(result.chapterNumber).toBe(10)
      expect(result.confidence).toBeGreaterThan(0.5)
    })

    it("识别「生成第128章」", () => {
      const result = routeTask("生成第128章")
      expect(result.intent).toBe("write_chapter")
      expect(result.chapterNumber).toBe(128)
    })

    it("识别「帮我写新章节」", () => {
      const result = routeTask("帮我写新章节")
      expect(result.intent).toBe("write_chapter")
    })
  })

  describe("续写意图识别", () => {
    it("识别「继续写第30章」", () => {
      const result = routeTask("继续写第30章")
      expect(result.intent).toBe("continue_chapter")
      expect(result.chapterNumber).toBe(30)
    })

    it("识别「续写下去」", () => {
      const result = routeTask("续写下去")
      expect(result.intent).toBe("continue_chapter")
    })

    it("识别「接着写」", () => {
      const result = routeTask("接着写")
      expect(result.intent).toBe("continue_chapter")
    })
  })

  describe("改写/润色意图识别", () => {
    it("识别「改写这一段」", () => {
      const result = routeTask("改写这一段")
      expect(result.intent).toBe("rewrite_chapter")
    })

    it("识别「润色一下」", () => {
      const result = routeTask("润色一下")
      expect(result.intent).toBe("polish_chapter")
    })

    it("识别「让节奏更紧」", () => {
      const result = routeTask("让这一段节奏更紧")
      expect(result.intent).toBe("polish_chapter")
    })
  })

  describe("审稿/检查意图识别", () => {
    it("识别「审稿第15章」", () => {
      const result = routeTask("审稿第15章")
      expect(result.intent).toBe("review_chapter")
      expect(result.chapterNumber).toBe(15)
    })

    it("识别「检查有没有人设崩坏」", () => {
      const result = routeTask("检查有没有人设崩坏")
      expect(result.intent).toBe("review_chapter")
    })

    it("识别「连贯性检查」", () => {
      const result = routeTask("连贯性检查")
      expect(result.intent).toBe("lint_chapter")
    })
  })

  describe("大纲生成意图识别", () => {
    it("识别「生成大纲」", () => {
      const result = routeTask("生成大纲")
      expect(result.intent).toBe("generate_outline")
    })

    it("识别「帮我写分卷大纲」", () => {
      const result = routeTask("帮我写分卷大纲")
      expect(result.intent).toBe("generate_outline")
    })
  })

  describe("查询意图识别", () => {
    it("识别「还有哪些伏笔没回收」", () => {
      const result = routeTask("还有哪些伏笔没回收")
      expect(result.intent).toBe("foreshadowing_query")
    })

    it("识别「林烬现在在哪」", () => {
      const result = routeTask("林烬现在在哪")
      expect(result.intent).toBe("character_query")
    })

    it("识别「时间线到哪了」", () => {
      const result = routeTask("时间线到哪了")
      expect(result.intent).toBe("timeline_query")
    })

    it("识别「搜索黑玉令」", () => {
      const result = routeTask("搜索黑玉令")
      expect(result.intent).toBe("search_plot")
    })
  })

  describe("一般对话降级", () => {
    it("识别普通对话", () => {
      const result = routeTask("你好，今天天气怎么样")
      expect(result.intent).toBe("general_chat")
    })

    it("空输入为一般对话", () => {
      const result = routeTask("")
      expect(result.intent).toBe("general_chat")
    })
  })

  describe("任务指令构建", () => {
    it("为写作意图生成指令", () => {
      const route: TaskRouteResult = {
        intent: "write_chapter",
        confidence: 0.9,
        chapterNumber: 10,
        extractedParams: { chapterNumber: "10" },
      }
      const directive = buildTaskDirective(route)
      expect(directive).toContain("章节生成")
      expect(directive).toContain("生成完整的章节正文")
    })

    it("一般对话不生成指令", () => {
      const route: TaskRouteResult = {
        intent: "general_chat",
        confidence: 0.5,
        extractedParams: {},
      }
      const directive = buildTaskDirective(route)
      expect(directive).toBe("")
    })
  })
})

// ─── Phase 8: 长篇吞吐量压力测试 ───

describe("Phase 8 长篇吞吐量压力测试", () => {
  describe("1000 章模拟数据构建", () => {
    it("生成 1000 章的上下文包不会内存溢出", () => {
      const pack = buildLargeContextPack(1000)
      expect(pack.recentSummaries.length).toBeGreaterThan(0)
      expect(pack.task).toContain("1000")
      const prompt = contextPackToPrompt(pack)
      expect(prompt.length).toBeGreaterThan(0)
    })

    it("300 万字总量模拟：上下文 prompt 不超 200KB", () => {
      // 300万字 = 3,000,000 字符。正常小说每章 3000 字 × 1000 章
      // 上下文包只包含摘要和关键状态，不应随总字数线性膨胀
      const pack = buildLargeContextPack(1000)
      const prompt = contextPackToPrompt(pack)
      expect(prompt.length).toBeLessThan(200000)
    })

    it("极端上下文包：500 条角色状态 + 200 条伏笔", () => {
      const pack = buildLargeContextPack(500)
      pack.characterStates = Array.from({ length: 500 }, (_, i) =>
        `角色${i}：状态描述-${i}-关于这个角色的详细当前状态信息用来填充上下文包以便测试极限场景`
      ).join("\n")
      pack.foreshadowingStates = Array.from({ length: 200 }, (_, i) =>
        `伏笔${i}：状态-${i}-推进中需要关注的伏笔状态详情`
      ).join("\n")
      const prompt = contextPackToPrompt(pack)
      expect(prompt.length).toBeGreaterThan(0)
      // 即使有大量状态也不应该崩溃
      expect(typeof prompt).toBe("string")
    })
  })

  describe("大规模快照操作", () => {
    it("模拟 1000 章快照文件列表", async () => {
      const snapshotFiles = Array.from({ length: 1000 }, (_, i) => ({
        name: `${String(i + 1).padStart(3, "0")}.snapshot.json`,
        path: `/project/.novel/snapshots/${String(i + 1).padStart(3, "0")}.snapshot.json`,
        is_dir: false,
      }))
      mockListDirectory.mockResolvedValue(snapshotFiles)
      const nums = await listSnapshots("/project")
      expect(nums).toHaveLength(1000)
      expect(nums[0]).toBe(1)
      expect(nums[nums.length - 1]).toBe(1000)
    })

    it("超长章节摘要（3000 字摘要）能正常加载", async () => {
      const longSummary = "长篇小说章节内容摘要".repeat(200)
      const snapshot: ChapterSnapshot = {
        chapterId: "chapter-500",
        chapterNumber: 500,
        summary: longSummary,
        characters: Array.from({ length: 30 }, (_, i) => `角色${i}`),
        locations: Array.from({ length: 10 }, (_, i) => `地点${i}`),
        organizations: Array.from({ length: 5 }, (_, i) => `组织${i}`),
        items: [],
        events: [],
        characterStateChanges: [],
        relationshipChanges: [],
        knowledgeChanges: [],
        foreshadowingChanges: [],
        newCanonFacts: [],
        timelineEvents: [],
        conflicts: [],
        endingHook: "章末钩子",
        graphNodes: [],
        graphEdges: [],
      }
      mockReadFile.mockResolvedValue(JSON.stringify(snapshot))
      const result = await loadSnapshot("/project", 500)
      expect(result).not.toBeNull()
      expect(result!.chapterNumber).toBe(500)
      expect(result!.summary.length).toBeGreaterThan(500)
      expect(result!.characters.length).toBe(30)
    })
  })

  describe("大规模前 100 章连续回看", () => {
    it("回看窗口在 1000 章场景中渐进正确", () => {
      // 第1章回看0章
      expect(selectLookbackChapterNumbers(1, 3)).toEqual([])
      // 第500章回看3章
      expect(selectLookbackChapterNumbers(500, 3)).toEqual([499, 498, 497])
      // 第1000章回看3章
      expect(selectLookbackChapterNumbers(1000, 3)).toEqual([999, 998, 997])
    })

    it("回看窗口数量可扩展到 10 章", () => {
      expect(selectLookbackChapterNumbers(1000, 10)).toEqual([
        999, 998, 997, 996, 995, 994, 993, 992, 991, 990,
      ])
    })

    it("回看窗口不返回负数章节号", () => {
      expect(selectLookbackChapterNumbers(1, 10)).toEqual([])
      expect(selectLookbackChapterNumbers(5, 10)).toEqual([4, 3, 2, 1])
    })
  })

  describe("1000 章场景下的草稿/正史边界", () => {
    it("大量章节中 non-final 状态全部被过滤", () => {
      const statuses = ["draft", "revised", "archived", "final"] as const
      const results = statuses.map((s) => isFinalChapter({ chapter_status: s }))
      expect(results).toEqual([false, false, false, true])
    })

    it("outline 类型在大量章节中也被排除", () => {
      expect(isChapterPage({ type: "outline" })).toBe(false)
      expect(isChapterPage({ type: "chapter" })).toBe(true)
      expect(isChapterPage({ chapter_number: 999 })).toBe(true)
    })
  })

  describe("1000 章场景下的任务路由", () => {
    it("识别「写第999章」", () => {
      const result = routeTask("写第999章")
      expect(result.intent).toBe("write_chapter")
      expect(result.chapterNumber).toBe(999)
    })

    it("识别「继续写第998章」需要了解前文", () => {
      const result = routeTask("继续写第998章，前文说林烬刚逃出密牢")
      expect(result.intent).toBe("continue_chapter")
      expect(result.chapterNumber).toBe(998)
    })

    it("长篇后期审稿不被误判为写新章", () => {
      const result = routeTask("审稿第800章角色弧光完整度")
      expect(result.intent).toBe("review_chapter")
      expect(result.chapterNumber).toBe(800)
    })

    it("长篇更新元数据类指令正确路由", () => {
      const result = routeTask("把总章数更新到 950 章")
      expect(result.intent).not.toBe("write_chapter")
    })
  })
})

// ─── 辅助函数 ───

function buildLargeContextPack(chapterCount: number): ContextPack {
  const recentSummaries = Array.from({ length: Math.min(chapterCount, 10) }, (_, i) =>
    `第${chapterCount - 10 + i}章：这是第${chapterCount - 10 + i}章的摘要内容，包含关键事件和人物状态变化。`
  )

  return {
    task: `续写第${chapterCount}章`,
    chapterGoal: "主角揭开黑玉令的真相",
    outline: "总大纲：第一卷入门、第二卷入世、第三卷争霸、第四卷真相、第五卷结局。当前处于第三卷。",
    recentSummaries,
    previousChapterEnding: "太子的刺客到达密牢入口，林烬在黑暗中屏住呼吸。",
    characterStates: "林烬：右臂受伤，潜入密牢中\n陆沉舟：被黑玉令控制\n太子：在宫中等待消息",
    soulDoc: "",
    characterAuras: "",
    // 未绑定故事框架：按 ContextPack.storyFrameworkBinding 的契约填空字符串
    storyFrameworkBinding: "",
    cognitionStates: "林烬知道：师兄还活着\n林烬不知道：黑玉令的真正来源\n读者知道：太子是幕后黑手",
    foreshadowingStates: "黑玉令：推进中\n地下哭声：未回收\n旧名阿烬：已回收",
    timeline: "冬月初七深夜，距离入城已三天",
    relatedSettings: "皇城密牢：位于内城地下三层，由暗卫把守",
    canonRules: "主角此时不知道皇帝身份\n黑玉令每次使用后需要七天恢复",
    writingStyle: "紧凑节奏，短句为主，悬疑氛围",
    searchResults: "搜索命中：黑玉令第32章首次出现，第78章推进",
    graphSearchResults: "【林烬】出场于第1-49章\n【黑玉令】关联：林烬、陆沉舟、太子",
    mustDo: "- 确认师兄是否还有自我意识\n- 从密牢中安全撤离",
    mustAvoid: "- 不要让林烬知道皇帝身份\n- 不要改变时间线",
    nextChapterAdvice: "- 延续刺客到达的紧张感\n- 推进黑玉令伏笔",
    revisionDirectives: "",
  }
}
