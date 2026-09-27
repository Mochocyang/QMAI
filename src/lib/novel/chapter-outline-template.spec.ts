import { beforeEach, describe, expect, it, vi } from "vitest"

const fsMock = {
  fileExists: vi.fn(async () => false),
  readFile: vi.fn(async () => ""),
  getExecutableDir: vi.fn(async () => "C:/App"),
  getResourceDir: vi.fn(async () => "C:/App/_up_"),
}

vi.mock("@/commands/fs", () => ({
  fileExists: (...args: unknown[]) => fsMock.fileExists(...(args as [])),
  readFile: (...args: unknown[]) => fsMock.readFile(...(args as [])),
  getExecutableDir: (...args: unknown[]) => fsMock.getExecutableDir(...(args as [])),
  getResourceDir: (...args: unknown[]) => fsMock.getResourceDir(...(args as [])),
}))

import {
  CHAPTER_OUTLINE_TEMPLATE_READY,
  attachChapterOutlineHtml,
  buildChapterBatchPrompt,
  buildChapterOutlineSaveRequest,
  collectProblemChapterNumbers,
  crossCheckChapterAgainstVolume,
  extractChapterOutlineBatch,
  extractChapterOutlineData,
  getChapterOutlineTemplate,
  mergeChapterBatches,
  nextChapterBatchRange,
  normalizeChapterOutlineData,
  parseChapterCount,
  primeChapterOutlineTemplate,
  renderChapterOutlineHtml,
  resetChapterOutlineTemplateForTest,
  validateChapterOutlineData,
  type ChapterOutlineChapter,
  type ChapterOutlineData,
} from "./chapter-outline-template"
import type { VolumeOutlineData } from "./volume-outline-template"

/** 12 章对应的 10 环节映射（单调前进）。 */
const STAGE_FOR_CHAPTER = [
  "起①", "起②", "起③", "承①", "承①", "承②", "承②", "承③", "承③", "转①", "转②", "合②",
]

const SKELETON_BEATS = "平升起紧落缓升紧顶缓顶悬"

function buildChapter(n: number): ChapterOutlineChapter {
  return {
    n,
    title: `第${n}章标题`,
    stage: STAGE_FOR_CHAPTER[n - 1] ?? "起①",
    beat: SKELETON_BEATS[n - 1] ?? "平",
    expect: "好奇",
    time: `第 ${n} 日 傍晚`,
    place: `地点${n}`,
    seedFores: n === 1 ? "竹哨" : "",
    payFores: n === 5 ? "竹哨" : "",
    info: { attr: "冲突章", mood: "紧张", words: "约 2500 字", goal: `第${n}章一句话目标` },
    carry: { hook: `第${n}章承接钩子`, left: "遗留问题", heroState: "主角状态", castState: "角色状态", fores: "未回收伏笔", expect: "承接的期待" },
    position: { main: "主线承接", advance: "主线推进", charArc: "人物变化", relation: "关系变化", whyRead: "追读目的", newExpect: "新期待" },
    digest: `角色因为入场条件进入场景${n}，在触发事件中完成变化，并留下钩子。`,
    events: Array.from({ length: 6 }, (_, i) => ({
      what: `事件${i + 1}`,
      cause: `起因${i + 1}`,
      action: `行动${i + 1}`,
      result: `结果${i + 1}`,
      use: `作用${i + 1}`,
    })),
    keywords: { scene: "场景词", mood: "情绪词", props: "道具词", relation: "关系词", sell: "爽点词" },
    conditions: { enter: "入场条件", trigger: "触发条件", interact: "互动条件", result: "结果条件" },
    fourBeat: { open: "开篇入戏", clash: "中段冲突", burst: "核心爆点", close: "强钩收尾" },
    moodCurve: [
      { node: "开局", state: "暖", trigger: "触发", feel: "感受" },
      { node: "中段", state: "冷", trigger: "触发", feel: "感受" },
      { node: "峰值", state: "紧", trigger: "触发", feel: "感受" },
      { node: "结尾", state: "落", trigger: "触发", feel: "感受" },
    ],
    sell: { first: "章首看点", main: "主要爽点", build: "铺垫", release: "释放", react: "反应层", after: "新期待", fit: "一致" },
    expand: [{ info: "关键信息", how: "扩写方式", skill: "对话", effect: "情绪作用" }],
    visual: { env: "环境", micro: "微细节", hint: "暗线", replace: "替代心理", memory: "记忆点" },
    foreshadow: {
      payFrom: "来源", payHow: "如何回收", payLevel: "部分回收",
      seedNew: "新伏笔", seedAt: "埋设位置", seedUse: "后续用途",
      hookType: "悬念", readerAsk: "读者会问", nextMust: "下章必须回应",
    },
    castChanges: [{ who: "杨寒", role: "主角", inState: "入场态", outState: "结束态", relation: "关系变化" }],
    worldUpdate: { setting: "新设定", place: "新地点", faction: "新势力", item: "新道具", writeBack: "写回内容" },
    rules: { must: "必须写", forbid: "禁止写", secret: "不能泄露", pace: "节奏", style: "文风", sellPoint: "卖点" },
    handover: { nextStart: "下章须承接", nextSolve: "下章须解决", nextDelay: "可延迟", nextMood: "推荐情绪", nextHook: "推荐钩子" },
    checks: [
      "三行内入戏",
      "有明确变化",
      "事件链有因果",
      "有核心记忆点",
      "有动作微细节",
      "有爽点",
      "回收旧信息",
      "埋新信息",
      "有追读钩子",
      "已写明下一章交接",
    ],
  }
}

function buildData(chapterCount = 12): ChapterOutlineData {
  return {
    title: "故事一 雨夜无我 · 章纲",
    story: { index: 1, name: "雨夜无我", range: `第 1–${chapterCount} 章`, beats: SKELETON_BEATS },
    chapters: Array.from({ length: chapterCount }, (_, i) => buildChapter(i + 1)),
    words: chapterCount * 2500,
  }
}

describe("chapter-outline-template", () => {
  it("模板文件加载成功且含全部占位符", () => {
    expect(CHAPTER_OUTLINE_TEMPLATE_READY).toBe(true)
  })

  it("渲染出的 HTML 是静态卡片流：含 style、details，且不依赖脚本", () => {
    const html = renderChapterOutlineHtml(buildData())
    expect(html).toContain("<html")
    expect(html).toContain("<style")
    expect(html).toContain("<details")
    expect(html).not.toContain("<script")
    expect(html).not.toContain("__CHAPTER_")
  })

  it("每章渲染一张卡片，摘要行含章号、标题、属性、期待与节拍", () => {
    const html = renderChapterOutlineHtml(buildData())
    expect((html.match(/class="cc"/g) ?? []).length).toBe(12)
    expect(html).toContain("第 3 章")
    expect(html).toContain("第3章标题")
    expect(html).toContain("冲突章")
    expect(html).toContain("期待 · 好奇")
  })

  it("每章渲染 17 节（12 章 = 204 个节块）", () => {
    const html = renderChapterOutlineHtml(buildData())
    expect((html.match(/class="csec"/g) ?? []).length).toBe(204)
    expect(html).toContain("§1 基础信息")
    expect(html).toContain("§17 写作检查清单")
  })

  it("渲染六类对齐面板与锚点导航", () => {
    const html = renderChapterOutlineHtml(buildData())
    expect(html).toContain("章 × 环节 × 节拍 对照")
    expect(html).toContain("期待与钩子链")
    expect(html).toContain("伏笔账本")
    expect(html).toContain("人物出场与状态变化")
    expect(html).toContain("地点与时间切换")
    expect(html).toContain("情绪曲线")
    expect(html).toContain("一致性体检")
    expect((html.match(/class="navlink"/g) ?? []).length).toBe(12)
    expect(html).toContain('href="#ch-7"')
    expect(html).toContain('id="ch-7"')
  })

  it("情绪曲线用静态 SVG 绘制并标出峰值", () => {
    const html = renderChapterOutlineHtml(buildData())
    expect(html).toContain("<svg")
    expect(html).toContain("<polyline")
    // 骨架 12 拍里有 2 个「顶」
    expect((html.match(/class="cp"/g) ?? []).length).toBe(2)
  })

  it("完整数据校验通过", () => {
    const result = validateChapterOutlineData(buildData())
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it("章节数与骨架不一致时校验失败", () => {
    const data = buildData()
    data.chapters = data.chapters.slice(0, 10)
    const result = validateChapterOutlineData(data)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("章节数与故事骨架不一致：骨架 12 章，实际 10 章")
  })

  it("10 章故事配 12 拍骨架时仍通过校验（真实卷纲口径）", () => {
    const data: ChapterOutlineData = {
      title: "故事一 雨夜无我 · 章纲",
      story: { index: 1, name: "雨夜无我", range: "第 1–10 章", beats: SKELETON_BEATS },
      chapters: Array.from({ length: 10 }, (_, i) => buildChapter(i + 1)),
      words: 25000,
    }
    const result = validateChapterOutlineData(data)
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
    // 骨架节拍数与章节数不等时，只在体检面板给非阻断提示
    const html = renderChapterOutlineHtml(data)
    expect(html).toContain("骨架节拍 12 拍与章纲 10 章数量不等")
  })

  it("章号跳号时校验失败", () => {
    const data = buildData()
    data.chapters[3].n = 99
    const result = validateChapterOutlineData(data)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("章号不连续")
  })

  it("节拍与骨架不一致时校验失败", () => {
    const data = buildData()
    data.chapters[2].beat = "顶"
    const result = validateChapterOutlineData(data)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("与骨架节拍")
  })

  it("环节回退或超出体系时校验失败", () => {
    const data = buildData()
    data.chapters[4].stage = "起①"
    data.chapters[6].stage = "未知环节"
    const result = validateChapterOutlineData(data)
    expect(result.ok).toBe(false)
    const text = result.problems.join("\n")
    expect(text).toContain("出现回退")
    expect(text).toContain("不在 10 环节体系内")
  })

  it("伏笔回收没有更早埋点时校验失败", () => {
    const data = buildData()
    data.chapters[3].payFores = "没有埋过的伏笔"
    const result = validateChapterOutlineData(data)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("没有更早的埋点")
  })

  it("事件链不足或缺少因果时校验失败", () => {
    const data = buildData()
    data.chapters[0].events = data.chapters[0].events.slice(0, 3)
    data.chapters[1].events[0].cause = ""
    const result = validateChapterOutlineData(data)
    expect(result.ok).toBe(false)
    const text = result.problems.join("\n")
    expect(text).toContain("核心事件链不足 6 条")
    expect(text).toContain("缺少起因")
  })

  it("必要条件缺项时校验失败", () => {
    const data = buildData()
    data.chapters[0].conditions.trigger = ""
    const result = validateChapterOutlineData(data)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("缺少必要条件：触发条件")
  })

  it("章间交接缺失时校验失败", () => {
    const data = buildData()
    data.chapters[0].handover.nextStart = ""
    data.chapters[1].carry.hook = ""
    const result = validateChapterOutlineData(data)
    expect(result.ok).toBe(false)
    const text = result.problems.join("\n")
    expect(text).toContain("缺少「下一章交接」")
    expect(text).toContain("缺少「上章结尾钩子」")
  })

  it("日常章落在「紧」拍时校验失败", () => {
    const data = buildData()
    data.chapters[3].position.advance = "日常：村里闲谈"
    const result = validateChapterOutlineData(data)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("日常只能落在")
  })

  it("逐章字数与目标偏差过大时校验失败", () => {
    const data = buildData()
    data.words = 60000
    const result = validateChapterOutlineData(data)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("偏差超过")
  })

  it("写作约束或检查清单缺失时校验失败", () => {
    const data = buildData()
    data.chapters[0].rules.must = ""
    data.chapters[0].rules.forbid = ""
    data.chapters[0].checks = []
    const result = validateChapterOutlineData(data)
    expect(result.ok).toBe(false)
    const text = result.problems.join("\n")
    expect(text).toContain("缺少写作约束")
    expect(text).toContain("缺少写作检查清单")
  })

  it("§17 检查清单缺少固定项时校验失败", () => {
    const data = buildData()
    data.chapters[0].checks = ["三行内入戏", "有明确变化"]
    const result = validateChapterOutlineData(data)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("写作检查清单（§17）缺少固定项")
  })

  it("§8/§10/§11/§13/§14 关键节为空时校验失败", () => {
    const data = buildData()
    data.chapters[0].moodCurve = []
    data.chapters[0].expand = []
    data.chapters[0].visual.env = ""
    data.chapters[0].castChanges = []
    data.chapters[0].worldUpdate = { setting: "", place: "", faction: "", item: "", writeBack: "" }
    const result = validateChapterOutlineData(data)
    expect(result.ok).toBe(false)
    const text = result.problems.join("\n")
    expect(text).toContain("情绪曲线（§8）不足 4 个节点")
    expect(text).toContain("关键信息与扩写方式（§10）")
    expect(text).toContain("画面细节（§11）缺少环境或记忆点")
    expect(text).toContain("缺少出场角色与状态变化（§13）")
    expect(text).toContain("缺少设定 / 世界观 / 道具更新（§14）")
  })

  it("数据为空时校验失败并提示", () => {
    const result = validateChapterOutlineData(null)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("未解析到章纲结构化数据")
  })

  it("parseChapterCount 解析章号区间", () => {
    expect(parseChapterCount("第 11–20 章")).toBe(10)
    expect(parseChapterCount("第 3 章")).toBe(1)
    expect(parseChapterCount("")).toBeNull()
  })

  it("从 AI 回复中提取 chapterOutlineData", () => {
    const reply = ["正文", "```json", JSON.stringify({ chapterOutlineData: buildData() }), "```"].join("\n")
    const data = extractChapterOutlineData(reply)
    expect(data).not.toBeNull()
    expect(data?.chapters).toHaveLength(12)
    expect(data?.chapters[0].events).toHaveLength(6)
  })

  it("提取兼容任意信封名（未知字段名也能解出数据）", () => {
    const reply = ["正文", "```json", JSON.stringify({ zhanggangShuJu: buildData() }), "```"].join("\n")
    const data = extractChapterOutlineData(reply)
    expect(data).not.toBeNull()
    expect(data?.chapters).toHaveLength(12)
  })

  it("提取兼容裸 payload（不带信封，直接是章纲数据本身）", () => {
    const reply = ["正文", "```json", JSON.stringify(buildData()), "```"].join("\n")
    const data = extractChapterOutlineData(reply)
    expect(data).not.toBeNull()
    expect(data?.chapters).toHaveLength(12)
  })

  it("回复中没有数据块时返回 null", () => {
    expect(extractChapterOutlineData("只有一段普通正文")).toBeNull()
  })

  it("normalizeChapterOutlineData 容错缺失字段", () => {
    const normalized = normalizeChapterOutlineData({ chapters: [{ n: 1, title: "第一章" }] })
    expect(normalized).not.toBeNull()
    expect(normalized?.chapters[0].stage).toBe("")
    expect(normalized?.chapters[0].events).toEqual([])
    expect(normalized?.words).toBe(0)
  })

  it("attachChapterOutlineHtml 给章纲请求补上渲染后的静态 HTML", () => {
    const reply = ["正文", "```json", JSON.stringify({ chapterOutlineData: buildData() }), "```"].join("\n")
    const enriched = attachChapterOutlineHtml(
      { fileType: "chapter-outline", content: "# 章纲\n核心事件", htmlContent: undefined as string | undefined },
      reply,
    )
    expect(enriched.htmlContent).toContain("<html")
    expect(enriched.htmlContent).toContain("<details")
  })

  it("attachChapterOutlineHtml 兼容 chapterOutlineBatch 信封（单发降级路径也能补 HTML）", () => {
    const reply = ["正文", "```json", JSON.stringify({ chapterOutlineBatch: buildData() }), "```"].join("\n")
    const enriched = attachChapterOutlineHtml(
      { fileType: "chapter-outline", content: "# 章纲\n核心事件", htmlContent: undefined as string | undefined },
      reply,
    )
    expect(enriched.htmlContent).toContain("<html")
    expect(enriched.htmlContent).toContain("<details")
  })

  it("attachChapterOutlineHtml 不处理非章纲请求", () => {
    const reply = ["正文", "```json", JSON.stringify({ chapterOutlineData: buildData() }), "```"].join("\n")
    expect(attachChapterOutlineHtml({ fileType: "volume-outline", content: "x" }, reply).htmlContent).toBeUndefined()
  })

  it("attachChapterOutlineHtml 不覆盖真正的 HTML 文档", () => {
    const reply = ["正文", "```json", JSON.stringify({ chapterOutlineData: buildData() }), "```"].join("\n")
    const existing = "<!DOCTYPE html><html><body>已有</body></html>"
    expect(attachChapterOutlineHtml({ fileType: "chapter-outline", content: "x", htmlContent: existing }, reply).htmlContent).toBe(existing)
  })

  it("attachChapterOutlineHtml 无数据时清掉非 HTML 内容", () => {
    const enriched = attachChapterOutlineHtml(
      { fileType: "chapter-outline", content: "x", htmlContent: 'json {"chapterOutlineData":{}}' },
      "没有任何数据块的回复",
    )
    expect(enriched.htmlContent).toBeUndefined()
  })
})

describe("chapter-outline-template 分批", () => {
  function batchReply(from: number, to: number, range: string) {
    const chapters = Array.from({ length: to - from + 1 }, (_, i) => buildChapter(from + i))
    const md = `# 章纲 · 第${from}–${to}章\n\n## 第${from}章 标题\n\n- 核心事件：关键事件`
    return [
      md,
      "```json",
      JSON.stringify({
        chapterOutlineBatch: {
          title: "故事一 雨夜无我 · 章纲",
          story: { index: 1, name: "雨夜无我", range, beats: SKELETON_BEATS },
          words: 30000,
          chapters,
        },
      }),
      "```",
    ].join("\n")
  }

  it("提取一批 chapterOutlineBatch 并保留本批 MD", () => {
    const batch = extractChapterOutlineBatch(batchReply(1, 3, "第 1–12 章"))
    expect(batch).not.toBeNull()
    expect(batch?.data.chapters).toHaveLength(3)
    expect(batch?.data.story.range).toBe("第 1–12 章")
    expect(batch?.md).toContain("核心事件")
    expect(batch?.md).not.toContain("chapterOutlineBatch")
  })

  it("不误抓 chapterOutlineData（非分批回复）", () => {
    const reply = ["正文", "```json", JSON.stringify({ chapterOutlineData: buildData() }), "```"].join("\n")
    expect(extractChapterOutlineBatch(reply)).toBeNull()
  })

  it("按骨架区间计算下一批（每批 3 章）", () => {
    const first = mergeChapterBatches([extractChapterOutlineBatch(batchReply(1, 3, "第 1–12 章"))!.data])
    expect(nextChapterBatchRange(first)).toEqual({ from: 4, to: 6 })

    const second = mergeChapterBatches([
      extractChapterOutlineBatch(batchReply(1, 3, "第 1–12 章"))!.data,
      extractChapterOutlineBatch(batchReply(4, 6, "第 1–12 章"))!.data,
    ])
    expect(nextChapterBatchRange(second)).toEqual({ from: 7, to: 9 })

    const last = mergeChapterBatches([
      extractChapterOutlineBatch(batchReply(10, 12, "第 1–12 章"))!.data,
    ])
    expect(nextChapterBatchRange(last)).toBeNull()
  })

  it("第二卷故事用绝对章号计算批次", () => {
    const merged = mergeChapterBatches([
      extractChapterOutlineBatch(batchReply(11, 13, "第 11–20 章"))!.data,
    ])
    expect(nextChapterBatchRange(merged)).toEqual({ from: 14, to: 16 })
  })

  it("按总章数均分批次：10 章拆成 3/3/2/2（末批不过小）", () => {
    const range = "第 1–10 章"
    const collected = [extractChapterOutlineBatch(batchReply(1, 3, range))!.data]
    const ranges: Array<{ from: number; to: number }> = []
    let next = nextChapterBatchRange(mergeChapterBatches(collected))
    while (next) {
      ranges.push(next)
      collected.push(extractChapterOutlineBatch(batchReply(next.from, next.to, range))!.data)
      next = nextChapterBatchRange(mergeChapterBatches(collected))
    }
    expect(ranges).toEqual([
      { from: 4, to: 6 },
      { from: 7, to: 8 },
      { from: 9, to: 10 },
    ])
  })

  it("合并多批时按章号排序去重并合计字数", () => {
    const merged = mergeChapterBatches([
      extractChapterOutlineBatch(batchReply(4, 6, "第 1–12 章"))!.data,
      extractChapterOutlineBatch(batchReply(1, 3, "第 1–12 章"))!.data,
      extractChapterOutlineBatch(batchReply(4, 6, "第 1–12 章"))!.data,
    ])
    expect(merged.chapters.map((chapter) => chapter.n)).toEqual([1, 2, 3, 4, 5, 6])
    expect(merged.story.range).toBe("第 1–12 章")
  })

  it("合并后合成保存请求：文件名用绝对章号区间，HTML 是静态卡片流", () => {
    const merged = mergeChapterBatches([
      extractChapterOutlineBatch(batchReply(1, 3, "第 1–12 章"))!.data,
    ])
    const request = buildChapterOutlineSaveRequest(merged, "# 章纲-第01–03章")
    expect(request.fileName).toBe("章纲-第01–03章.md")
    expect(request.fileType).toBe("chapter-outline")
    expect(request.targetFolder).toBe("章纲")
    expect(request.htmlContent).toContain("<html")
    expect(request.htmlContent).not.toContain("<script")
  })

  it("下一批提示词里带骨架与已完成章节摘要，保证跨批连续", () => {
    const merged = mergeChapterBatches([
      extractChapterOutlineBatch(batchReply(1, 3, "第 1–12 章"))!.data,
    ])
    const prompt = buildChapterBatchPrompt({ data: merged, batch: { from: 4, to: 6 } })
    expect(prompt).toContain("第 4–6 章")
    expect(prompt).toContain("第 1–12 章")
    expect(prompt).toContain("已完成章节摘要")
    expect(prompt).toContain("下一章须承接：下章须承接")
    expect(prompt).toContain("outlineSaveRequest")
    expect(prompt).toContain("软件会在最后一批之后合并并统一保存")
  })

  it("带问题时提示词逐条列出待修项", () => {
    const merged = mergeChapterBatches([
      extractChapterOutlineBatch(batchReply(1, 3, "第 1–12 章"))!.data,
    ])
    const prompt = buildChapterBatchPrompt({
      data: merged,
      batch: { from: 1, to: 3 },
      problems: ["第 2 章节拍「顶」与骨架节拍「升」不一致。"],
    })
    expect(prompt).toContain("上一轮校验发现的问题")
    expect(prompt).toContain("第 2 章节拍「顶」与骨架节拍「升」不一致。")
  })

  it("从问题文本提取涉及章号，用于只重写有问题的批次", () => {
    expect(collectProblemChapterNumbers([
      "第 2 章节拍不一致。",
      "第 5 章核心事件链不足 6 条。",
      "整体字数偏差超过 20%。",
      "第 2 章缺少写作约束。",
    ])).toEqual([2, 5])
  })
})

describe("chapter-outline-template 卷纲交叉校验", () => {
  function volumeData(range = "第 1–12 章", beats = SKELETON_BEATS): VolumeOutlineData {
    return {
      title: "卷一 无我绝响",
      goal: "查明真相",
      stories: [{
        id: 1,
        range,
        title: "雨夜无我",
        deliver: "",
        gift: "",
        mid: "",
        twist: "",
        hook: "",
        climax: "",
        beats,
        line: { main: "", sub: [], daily: { v: "", u: "" } },
        st: [],
      }],
    }
  }

  it("骨架一致时无问题", () => {
    const problems = crossCheckChapterAgainstVolume(buildData(), volumeData())
    expect(problems).toEqual([])
  })

  it("章号区间不一致时报告", () => {
    const problems = crossCheckChapterAgainstVolume(buildData(), volumeData("第 1–10 章"))
    expect(problems?.join("\n")).toContain("章号区间")
  })

  it("骨架节拍错位时报告第几位不同", () => {
    const problems = crossCheckChapterAgainstVolume(buildData(), volumeData("第 1–12 章", "平升紧起落缓升紧顶缓顶悬"))
    expect(problems?.join("\n")).toContain("第 3 位是「起」，卷纲是「紧」")
  })

  it("章号越出卷纲范围时报告", () => {
    const data = buildData()
    data.chapters[11].n = 99
    const problems = crossCheckChapterAgainstVolume(data, volumeData("第 1–12 章"))
    expect(problems?.join("\n")).toContain("超出卷纲该故事的范围")
  })

  it("卷纲里没有对应故事时返回 null（调用方继续试下一份）", () => {
    const data = buildData()
    data.story.index = 7
    data.story.range = "第 61–72 章"
    expect(crossCheckChapterAgainstVolume(data, volumeData())).toBeNull()
  })

  it("章内时间倒退时报告", () => {
    const data = buildData()
    data.chapters[3].time = "第 1 日 清晨"
    const problems = crossCheckChapterAgainstVolume(data, volumeData())
    expect(problems?.join("\n")).toContain("章节时间线倒退：第 4 章")
  })

  it("卷纲人物出场表里的人物在章纲里找不到时报告", () => {
    const volume = volumeData()
    volume.cast = [{ n: "林小满", role: "镜子", stories: "1–5、7", u: "映照主题" }]
    const problems = crossCheckChapterAgainstVolume(buildData(), volume)
    expect(problems?.join("\n")).toContain("卷纲人物出场表写明「林小满」在故事1出场")
  })

  it("卷纲人物已在章纲出现、或不在本故事出场时不报告", () => {
    const inText = volumeData()
    inText.cast = [{ n: "杨寒", role: "主角", stories: "1", u: "主角" }]
    expect(crossCheckChapterAgainstVolume(buildData(), inText)).toEqual([])

    const otherStory = volumeData()
    otherStory.cast = [{ n: "林小满", role: "镜子", stories: "2–5", u: "映照主题" }]
    expect(crossCheckChapterAgainstVolume(buildData(), otherStory)).toEqual([])
  })

  it("卷纲安排对手在本故事出手、章纲却完全没有阻力角色时报告", () => {
    const volume = volumeData()
    volume.rivals = [{ n: "白塔外站", moves: [{ id: 1, v: "派回收者上门" }] }]
    const problems = crossCheckChapterAgainstVolume(buildData(), volume)
    expect(problems?.join("\n")).toContain("安排了对手出手（白塔外站）")
  })

  it("卷纲对手出手、章纲已有阻力角色时不报告", () => {
    const volume = volumeData()
    volume.rivals = [{ n: "白塔外站", moves: [{ id: 1, v: "派回收者上门" }] }]
    const data = buildData()
    data.chapters[1].castChanges = [{ who: "回收者", role: "阻力", inState: "入场", outState: "退场", relation: "敌对" }]
    expect(crossCheckChapterAgainstVolume(data, volume)).toEqual([])
  })

  it("卷纲伏笔标注在本故事埋下/回收而章纲缺失时报告", () => {
    const volume = volumeData()
    volume.foreshadows = [
      { v: "铜铃（旧物）", seed: "故事一 起①", pay: "故事二 承②" },
      { v: "竹哨", seed: "故事一 起①", pay: "故事一 合①" },
    ]
    const text = crossCheckChapterAgainstVolume(buildData(), volume)?.join("\n") ?? ""
    expect(text).toContain("卷纲伏笔「铜铃」计划在故事1埋下")
    expect(text).not.toContain("「竹哨」计划在故事1埋下")
    expect(text).not.toContain("「竹哨」计划在故事1回收")
  })
})

describe("chapter-outline-template 运行时加载", () => {
  const CUSTOM_TEMPLATE = [
    "<!DOCTYPE html><html><head><style>.custom{}</style></head><body>",
    "<h1>__CHAPTER_TITLE__</h1><div>__CHAPTER_SUMMARY__</div><div>__CHAPTER_CHIPS__</div>",
    "<section>__CHAPTER_ALIGN__ __CHAPTER_EXPECT__ __CHAPTER_FORES__ __CHAPTER_SCENE__</section>",
    "<section>__CHAPTER_CURVE__ __CHAPTER_CHECK__</section>",
    "__CHAPTER_NAV__",
    "<main>__CHAPTER_CARDS__</main>",
    "</body></html>",
  ].join("")

  beforeEach(() => {
    resetChapterOutlineTemplateForTest()
    fsMock.fileExists.mockReset().mockResolvedValue(false)
    fsMock.readFile.mockReset().mockResolvedValue("")
    fsMock.getExecutableDir.mockReset().mockResolvedValue("C:/App")
    fsMock.getResourceDir.mockReset().mockResolvedValue("C:/App/_up_")
  })

  it("默认使用内置模板", () => {
    expect(getChapterOutlineTemplate()).toContain("#B8551D")
  })

  it("项目目录存在覆盖模板时优先使用", async () => {
    fsMock.fileExists.mockImplementation(async (path: unknown) =>
      String(path).endsWith(".qmai/章纲模板.html"))
    fsMock.readFile.mockResolvedValue(CUSTOM_TEMPLATE)

    await primeChapterOutlineTemplate("E:/Novel")

    expect(getChapterOutlineTemplate()).toBe(CUSTOM_TEMPLATE)
    expect(renderChapterOutlineHtml(buildData())).toContain(".custom{}")
  })

  it("项目无覆盖时回退到程序 skills 目录", async () => {
    fsMock.fileExists.mockImplementation(async (path: unknown) =>
      String(path).includes("C:/App/skills/SkillHub/ZhanggangSkill/zhanggangjiegouhua/template.html"))
    fsMock.readFile.mockResolvedValue(CUSTOM_TEMPLATE)

    await primeChapterOutlineTemplate("E:/Novel")

    expect(getChapterOutlineTemplate()).toBe(CUSTOM_TEMPLATE)
  })

  it("项目与程序目录都没有时回退内置模板", async () => {
    await primeChapterOutlineTemplate("E:/Novel")
    expect(getChapterOutlineTemplate()).toContain("#B8551D")
  })

  it("覆盖模板缺少占位符时忽略并回退内置", async () => {
    fsMock.fileExists.mockResolvedValue(true)
    fsMock.readFile.mockResolvedValue("<html>no placeholder</html>")

    await primeChapterOutlineTemplate("E:/Novel")

    expect(getChapterOutlineTemplate()).toContain("#B8551D")
  })

  it("运行目录探测抛错时不影响回退", async () => {
    fsMock.getExecutableDir.mockRejectedValue(new Error("no exe dir"))
    fsMock.getResourceDir.mockRejectedValue(new Error("no resource dir"))

    await primeChapterOutlineTemplate("E:/Novel")

    expect(getChapterOutlineTemplate()).toContain("#B8551D")
  })
})