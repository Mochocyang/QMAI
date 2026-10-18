import { describe, expect, it } from "vitest"
import {
  EVENT_OUTLINE_DEFAULT_EVENTS,
  EVENT_OUTLINE_MAX_EVENTS,
  EVENT_OUTLINE_MAX_POINTS,
  EVENT_OUTLINE_MIN_EVENTS,
  EVENT_OUTLINE_MIN_POINTS,
  EVENT_OUTLINE_TITLE_MAX_CHARS,
  buildEventOutlinePrompt,
  eventOutlineToProsePrompt,
  extractEventOutlineData,
  looksLikeEventOutlineDeliveryNote,
  normalizeEventOutlineData,
  renderEventOutlineMarkdown,
  splitEventPointLabel,
  stripEventOutlineDataFence,
  validateEventOutlineData,
  type EventOutlineData,
  type EventOutlineEvent,
} from "./event-outline"
import { DE_AI_GENERATION_RULES } from "./de-ai-generation-rules"

function event(id: number, title = `事件${id}`) {
  return { id, title, points: ["台词：你来啦", "神情：她手一抖"] }
}

function data(overrides: Partial<EventOutlineData> = {}): EventOutlineData {
  return {
    version: 1,
    chapterNumber: 12,
    title: "第12章 · 令牌初现",
    targetWords: 3000,
    events: [1, 2, 3, 4, 5, 6].map((id) => event(id)),
    endingHook: "令牌上的四个字亮起时，院外传来脚步声。",
    ...overrides,
  }
}

/** 提示词里的 ```json 例子的类型：只需断言用到的字段。 */
interface PromptJsonFence {
  eventOutlineData?: { events: Array<{ points?: string[] }>; requirement?: string }
  outlineSaveRequest?: Record<string, unknown>
}

/**
 * 抽出提示词里所有 ```json 围栏并逐个 JSON.parse。
 * 解析本身就是断言的一部分：示例一旦不是合法 JSON，模型就会照着output坏数据。
 */
function promptJsonFences(prompt: string): PromptJsonFence[] {
  return [...prompt.matchAll(/```json[ \t]*\r?\n([\s\S]*?)```/g)].map(
    (match) => JSON.parse(match[1]) as PromptJsonFence,
  )
}

describe("normalizeEventOutlineData", () => {
  it("接受标准的 eventOutlineData 信封", () => {
    const result = normalizeEventOutlineData({ eventOutlineData: data() })
    expect(result?.chapterNumber).toBe(12)
    expect(result?.events).toHaveLength(6)
  })

  it("接受裸对象", () => {
    expect(normalizeEventOutlineData(data())?.title).toBe("第12章 · 令牌初现")
  })

  it("把 id 重排为从 1 起的连续序号", () => {
    const raw = { ...data(), events: [event(7), event(9), event(11), event(13)] }
    expect(normalizeEventOutlineData(raw)?.events.map((item) => item.id)).toEqual([1, 2, 3, 4])
  })

  it("剔除空抓手并去空白", () => {
    const raw = { ...data(), events: [{ id: 1, title: " 开场 ", points: ["   ", "有内容"] }] }
    const result = normalizeEventOutlineData(raw)
    expect(result?.events[0].title).toBe("开场")
    expect(result?.events[0].points).toEqual(["有内容"])
  })

  it("没有任何事件时返回 null", () => {
    expect(normalizeEventOutlineData({ chapterNumber: 3, events: [] })).toBeNull()
  })

  it("空事件槽与有效事件混排时只保留有效事件", () => {
    const result = normalizeEventOutlineData({
      ...data(),
      events: [{ title: "a", points: ["p", "q"] }, {}, null],
    })
    expect(result?.events).toHaveLength(1)
    expect(result?.events[0].id).toBe(1)
    expect(result?.events[0].points).toEqual(["p", "q"])
  })

  it("不吞 chapterOutlineData 这类章节细纲 JSON", () => {
    expect(
      normalizeEventOutlineData({
        chapterOutlineData: { story: {}, chapters: [{ n: 1, events: [{ what: "a", cause: "b" }] }] },
      }),
    ).toBeNull()
  })

  it("能从「约3000字」「第12章」这类带字的文本里读出数字", () => {
    const result = normalizeEventOutlineData({ ...data(), chapterNumber: "第12章", targetWords: "约3000字" })
    expect(result?.chapterNumber).toBe(12)
    expect(result?.targetWords).toBe(3000)
  })

  it("非对象输入返回 null", () => {
    expect(normalizeEventOutlineData("不是对象")).toBeNull()
    expect(normalizeEventOutlineData(null)).toBeNull()
  })
})

describe("validateEventOutlineData", () => {
  it("标准数据通过", () => {
    expect(validateEventOutlineData(data()).ok).toBe(true)
  })

  it("事件数下边界 4 通过，3 拒绝", () => {
    // targetWords 固定在单事件合理区间内，让这条用例只考察事件数这一个边界。
    const boundary = Array.from({ length: EVENT_OUTLINE_MIN_EVENTS }, (_, i) => event(i + 1))
    expect(validateEventOutlineData(data({ targetWords: 1200, events: boundary })).ok).toBe(true)
    const tooFew = validateEventOutlineData(
      data({ targetWords: 1200, events: boundary.slice(0, EVENT_OUTLINE_MIN_EVENTS - 1) }),
    )
    expect(tooFew.ok).toBe(false)
    expect(tooFew.problems.join("\n")).toContain(`事件数为 ${EVENT_OUTLINE_MIN_EVENTS - 1}`)
  })

  it("事件数上边界 8 通过，9 拒绝", () => {
    const eight = Array.from({ length: EVENT_OUTLINE_MAX_EVENTS }, (_, i) => event(i + 1))
    expect(validateEventOutlineData(data({ events: eight })).ok).toBe(true)
    const nine = Array.from({ length: 9 }, (_, i) => event(i + 1))
    expect(validateEventOutlineData(data({ events: nine })).ok).toBe(false)
  })

  it("id 不连续时报错", () => {
    const broken = data({ events: [event(1), event(3), event(4), event(5)] })
    expect(validateEventOutlineData(broken).problems.join("\n")).toContain("序号")
  })

  it("缺结尾钩子报错", () => {
    expect(validateEventOutlineData(data({ endingHook: "   " })).problems.join("\n")).toContain("结尾钩子")
  })

  it("整份缺 endingHook 时不抛异常，仍给出缺钩子的问题", () => {
    const raw: Record<string, unknown> = { ...data() }
    delete raw.endingHook
    const result = validateEventOutlineData(raw as unknown as EventOutlineData)
    expect(result.problems.join("\n")).toContain("结尾钩子")
  })

  it("缺目标字数或目标字数为 0 时报错", () => {
    const zero = validateEventOutlineData(data({ targetWords: 0 }))
    expect(zero.ok).toBe(false)
    expect(zero.problems.join("\n")).toContain("targetWords")
    const missing = validateEventOutlineData({ ...data(), targetWords: undefined } as unknown as EventOutlineData)
    expect(missing.ok).toBe(false)
    expect(missing.problems.join("\n")).toContain("targetWords")
  })

  it("缺目标章号时报错而不抛异常", () => {
    // 与 targetWords 同一口径：整份缺字段（undefined）也要算缺章号。
    const raw: Record<string, unknown> = { ...data() }
    delete raw.chapterNumber
    const result = validateEventOutlineData(raw as unknown as EventOutlineData)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("章号")
  })

  it("抓手少于 2 条报错", () => {
    const thin = data({ events: [{ id: 1, title: "开场", points: ["只有一条"] }, event(2), event(3), event(4)] })
    expect(validateEventOutlineData(thin).problems.join("\n")).toContain("抓手")
  })

  it("抓手超过 5 条报错", () => {
    const fat = {
      id: 1,
      title: "开场",
      points: ["一", "二", "三", "四", "五", "六"],
    }
    const result = validateEventOutlineData(data({ events: [fat, event(2), event(3), event(4)] }))
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("细节抓手为 6 条")
  })

  it("抓手不是列表时给出真实问题且不抛异常", () => {
    const stringPoints = { id: 1, title: "开场", points: "x" } as unknown as EventOutlineEvent
    const result = validateEventOutlineData(data({ events: [stringPoints, event(2), event(3), event(4)] }))
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("细节抓手不是列表")
    // 不能说成「1 条，应有 2~5 条」——那会让人以为只要再加一条。
    expect(result.problems.join("\n")).not.toContain("1 条，应有")
  })

  it("标题过长只给压缩提示，不算结构错误", () => {
    // 设计文档口径：标题超 24 字是「超出提示压缩，不算错」。
    // 当成硬错误会让 ok === false，卡片随即隐藏「用这份细纲写这一章」——
    // 一个排版级别的超标逼用户多跑一整轮 LLM。
    const long = data({ events: [event(1, "这是一个被写得太长以至于超过了二十四个字上限的事件标题用来触发校验"), event(2), event(3), event(4)] })
    const result = validateEventOutlineData(long)
    expect(result.problems).toEqual([])
    expect(result.advisories.join("\n")).toContain("超过 24 字")
    expect(result.ok).toBe(true)
  })

  it("标题恰好 24 字通过", () => {
    const exact = "甲".repeat(24)
    expect(exact.length).toBe(24)
    const result = validateEventOutlineData(data({ events: [event(1, exact), event(2), event(3), event(4)] }))
    expect(result.ok).toBe(true)
  })

  it("字数分配超出参考区间时只给提示，不阻断（targetWords 4000 / 4 个事件）", () => {
    const result = validateEventOutlineData(
      data({ targetWords: 4000, events: [1, 2, 3, 4].map((id) => event(id)) }),
    )
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
    expect(result.advisories.join("\n")).toContain("每个事件约 1000 字")
  })

  it("单事件字数过低时只给提示，不阻断（300 字 8 个事件）", () => {
    const eight = Array.from({ length: 8 }, (_, i) => event(i + 1))
    const result = validateEventOutlineData(data({ targetWords: 300, events: eight }))
    expect(result.advisories.join("\n")).toContain("每个事件")
    expect(result.ok).toBe(true)
  })

  it("数据为 null 时报错而不抛异常", () => {
    const result = validateEventOutlineData(null)
    expect(result.ok).toBe(false)
    expect(result.problems).toHaveLength(1)
    expect(result.advisories).toEqual([])
  })

  it("结构不完整的对象不抛异常，只返回问题清单", () => {
    const empty = validateEventOutlineData({} as EventOutlineData)
    expect(empty.ok).toBe(false)
    expect(empty.advisories).toEqual([])
    const brokenEvent = validateEventOutlineData({ events: [null] } as unknown as EventOutlineData)
    expect(brokenEvent.ok).toBe(false)
    expect(brokenEvent.problems.join("\n")).toContain("不是对象")
  })
})

describe("extractEventOutlineData", () => {
  const payload = JSON.stringify({
    eventOutlineData: {
      version: 1,
      chapterNumber: 12,
      title: "第12章 · 令牌初现",
      targetWords: 3000,
      events: [1, 2, 3, 4].map((id) => event(id)),
      endingHook: "院外传来脚步声。",
    },
  })
  // 保存请求常被模型排在数据前面，而且它本身往往是「规整」的那个（有闭合围栏）。
  const savePayload = JSON.stringify({
    outlineSaveRequest: {
      targetFolder: "事件细纲",
      fileName: "事件细纲-第012章.md",
      fileType: "event-outline",
      writeMode: "create",
    },
  })

  it("从 ```json 围栏里取出数据", () => {
    const content = `## 第12章事件细纲\n\n正文说明\n\n\`\`\`json\n${payload}\n\`\`\``
    expect(extractEventOutlineData(content)?.events).toHaveLength(4)
  })

  it("从没有语言标记的围栏里取出数据", () => {
    const content = `说明\n\n\`\`\`\n${payload}\n\`\`\``
    expect(extractEventOutlineData(content)?.chapterNumber).toBe(12)
  })

  it("从裸对象里取出数据", () => {
    expect(extractEventOutlineData(`前文\n${payload}\n后文`)?.title).toBe("第12章 · 令牌初现")
  })

  it("跳过不是事件细纲的 JSON 围栏", () => {
    const other = JSON.stringify({ outlineSaveRequest: { fileName: "x.md" } })
    const content = `\`\`\`json\n${other}\n\`\`\`\n\`\`\`json\n${payload}\n\`\`\``
    expect(extractEventOutlineData(content)?.events).toHaveLength(4)
  })

  it("没有数据时返回 null", () => {
    expect(extractEventOutlineData("只有正文，没有结构化数据")).toBeNull()
  })

  it("不把章纲（chapterOutlineData）误当事件细纲", () => {
    const chapterOutline = JSON.stringify({
      chapterOutlineData: { title: "章纲", story: {}, chapters: [{ n: 1, events: [{ what: "a", cause: "b" }] }] },
    })
    expect(extractEventOutlineData(`\`\`\`json\n${chapterOutline}\n\`\`\``)).toBeNull()
  })

  it("围栏内 JSON 非法时继续尝试下一个围栏", () => {
    const content = `\`\`\`json\n{ 这不是合法 JSON\n\`\`\`\n\`\`\`json\n${payload}\n\`\`\``
    expect(extractEventOutlineData(content)?.events).toHaveLength(4)
  })

  it("JSON 字符串里的花括号不会提前截断对象", () => {
    const tricky = JSON.stringify({
      eventOutlineData: {
        version: 1, chapterNumber: 3, title: "第3章 · 带 } 的标题", targetWords: 3000,
        events: [{ id: 1, title: '引号"与}与反斜杠\\', points: ["a", "b"] }],
        endingHook: "钩子 }\\",
      },
    })
    expect(extractEventOutlineData(`\`\`\`json\n${tricky}\n\`\`\``)?.events).toHaveLength(1)
  })

  it("同一个围栏里保存请求在前、数据在后时仍能取到数据", () => {
    const content = `\`\`\`json\n${savePayload}\n${payload}\n\`\`\``
    expect(extractEventOutlineData(content)?.chapterNumber).toBe(12)
  })

  it("同一个围栏里有多个 JSON 对象时只认后面那个事件细纲", () => {
    const content = `\`\`\`json\n${JSON.stringify({ status: "ok", note: "先说明一下" })}\n${payload}\n\`\`\``
    expect(extractEventOutlineData(content)?.events).toHaveLength(4)
  })

  it("围栏正文里出现说明用花括号（{name:value}）时不会漏掉后面的数据", () => {
    const content = `\`\`\`json\n格式：字段用 {name:value} 表示\n${payload}\n\`\`\``
    expect(extractEventOutlineData(content)?.events).toHaveLength(4)
  })

  it("保存请求围栏排在最前面时，仍会回头扫围栏外的整段回复", () => {
    const content = `\`\`\`json\n${savePayload}\n\`\`\`\n\n模型漏了数据围栏，数据写在外面：\n\n${payload}`
    expect(extractEventOutlineData(content)?.events).toHaveLength(4)
  })

  it("已闭合的保存围栏后面跟着未闭合的数据围栏时也能取到数据", () => {
    const content = `\`\`\`json\n${savePayload}\n\`\`\`\n\`\`\`json\n${payload}`
    expect(extractEventOutlineData(content)?.events).toHaveLength(4)
  })

  it("配平但非法的 JSON（尾随逗号）不会中断查找", () => {
    // 分开两个围栏：覆盖 JSON.parse 抛错后继续找下一个围栏的分支。
    const separate = `\`\`\`json\n{"a":1,}\n\`\`\`\n\`\`\`json\n${payload}\n\`\`\``
    expect(extractEventOutlineData(separate)?.events).toHaveLength(4)
    // 同一个围栏里先坏后好：覆盖抛错之后从下一个 `{` 重扫的分支。
    const sameFence = `\`\`\`json\n{"a":1,}\n${payload}\n\`\`\``
    expect(extractEventOutlineData(sameFence)?.events).toHaveLength(4)
  })
})

describe("buildEventOutlinePrompt", () => {
  const request = { chapterNumber: 12, eventCount: 6, targetWords: 3000, requirement: "让楚白第一次动用令牌" }

  it("带上章号、事件数与目标字数", () => {
    const prompt = buildEventOutlinePrompt(request)
    expect(prompt).toContain("第 12 章")
    expect(prompt).toContain("6 个")
    expect(prompt).toContain("3000")
  })

  it("带上用户对本章的要求", () => {
    expect(buildEventOutlinePrompt(request)).toContain("让楚白第一次动用令牌")
  })

  it("要求产出 eventOutlineData，且不再要求保存请求", () => {
    const prompt = buildEventOutlinePrompt(request)
    expect(prompt).toContain("eventOutlineData")
    // 事件细纲不再写进 wiki/outlines/事件细纲/：提示词里留着保存请求示例
    // 会诱导模型照抄出一份，用户就会把它当大纲归档。
    expect(prompt).not.toContain("outlineSaveRequest")
    expect(prompt).not.toContain("event-outline")
  })

  it("明令禁止写正文", () => {
    expect(buildEventOutlinePrompt(request)).toContain("不要写正文")
  })

  it("不再要求模型手写 Markdown，形状契约转由软件反推承担", () => {
    /*
     * 2026-10-18：同一份内容原来要模型写两遍（Markdown 细纲 + JSON 围栏），
     * 用户要为重复的正文付双份输出费。现在提示词只要 JSON，正文由
     * `renderEventOutlineMarkdown` 从数据反推 —— 但那套「# 事件细纲 / ## 事件N」
     * 的形状不能丢：卡片标题、磁盘上已有的旧文件都靠它自我识别。
     * 所以断言一分为二：**提示词不再要 MD**，**反推函数仍产出旧形状**。
     */
    const prompt = buildEventOutlinePrompt(request)
    expect(prompt).not.toContain("## 事件1")
    expect(prompt).toContain("不要手写 Markdown 细纲")

    const markdown = renderEventOutlineMarkdown(data({
      events: [{ id: 1, title: "楚白翻出令牌", points: ["故事推进：他摸到令牌", "关键台词：『别回头。』"] }],
    }))
    // 章号后的那个「·」被换成空格，与旧提示词要求的「# 事件细纲 · 第N章 章名」一致
    expect(markdown).toContain("# 事件细纲 · 第12章 令牌初现")
    expect(markdown).toContain("## 事件1 楚白翻出令牌")
    expect(markdown).toContain("- 故事推进：他摸到令牌")
    expect(markdown).toContain("- 关键台词：『别回头。』")
    expect(markdown).toContain("## 本章结尾钩子")
    expect(markdown).toContain("目标字数：约 3000 字")
    // 用户拿到的是文档，不是数据：任何 JSON 符号都不许漏出来
    expect(markdown).not.toMatch(/[{}]/)
    expect(markdown).not.toContain("```")
    expect(markdown).not.toMatch(/"\s*:/)
    expect(markdown).not.toContain("eventOutlineData")
    // 事件按 id 逐条导出，且不会把同一条重复成两条
    expect(markdown).toContain("## 事件1 楚白翻出令牌")
    expect(markdown).not.toContain("## 事件2")
  })

  it("没有额外要求时不留下空标题", () => {
    const prompt = buildEventOutlinePrompt({ ...request, requirement: "  " })
    expect(prompt).not.toContain("用户对本章的要求：\n")
  })

  it("提示词里不再出现任何落盘文件名", () => {
    // 原先这条断言的是「保存建议里的章号补零」（事件细纲-第007章.md）。保存请求示例
    // 已按用户要求删除，补零命名随之失去载体，所以改成反向守卫：提示词不许再夹带文件名，
    // 那正是「诱导模型输出保存请求」的同一批文本。
    const prompt = buildEventOutlinePrompt({ ...request, chapterNumber: 7 })
    expect(prompt).not.toContain("事件细纲-第007章.md")
    expect(prompt).not.toContain(".md")
  })

  it("每个事件的建议字数按目标字数与事件数四舍五入推算", () => {
    // 3000 / 7 = 428.57…：把取整写成 floor 会得到 428，这条用例才会挂。
    const prompt = buildEventOutlinePrompt({ ...request, targetWords: 3000, eventCount: 7 })
    expect(prompt).toContain("429")
    expect(prompt).not.toContain("每个事件约 428 字")
  })

  it("标题字数与抓手条数取自常量，不会与校验器脱钩", () => {
    const prompt = buildEventOutlinePrompt(request)
    expect(prompt).toContain(`不超过 ${EVENT_OUTLINE_TITLE_MAX_CHARS} 字`)
    expect(prompt).toContain(`${EVENT_OUTLINE_MIN_POINTS}~${EVENT_OUTLINE_MAX_POINTS} 条`)
  })

  /*
   * 用户 2026-10-13 第二轮反馈（四条）：
   * 1) 减少神情/动作描写；2) 关键台词不是每个角色都有；3) 4 个事件必须连续；
   * 4) 要突出「故事方向」的描写，而原口径只有环境/神情/台词。
   * 提示词的口径改动全部钉在下面这几条上。
   */
  it("抓手以「故事推进」为首，其余按需取用", () => {
    const prompt = buildEventOutlinePrompt(request)
    expect(prompt).toContain("第一条固定是「故事推进」")
    expect(prompt).toContain("故事推进（必写）")
    expect(prompt).toContain("冲突与转折")
    expect(prompt).toContain("环境与物件（有用才写）")
    expect(prompt).toContain("伏笔或钩子")
  })

  it("关键台词改成「有才写」，不是每个事件、每个角色都有", () => {
    const prompt = buildEventOutlinePrompt(request)
    expect(prompt).toContain("关键台词（有才写）")
    expect(prompt).toContain("不是每个事件都有台词")
    expect(prompt).toContain("也不是每个出场角色都有关键台词")
    // 旧口径把「关键台词」当成默认抓手之一，已删干净
    expect(prompt).not.toContain("例如关键台词、人物神情与动作")
  })

  it("不再要求人物神情/动作，只要求故事推进", () => {
    const prompt = buildEventOutlinePrompt(request)
    expect(prompt).toContain("不要写人物神情、表情、神态和细微小动作")
    expect(prompt).toContain("不要只写氛围、环境或人物状态")
    // 抓手示例里不能再出现「神情动作」，否则等于继续教模型写神态
    expect(prompt).not.toContain("神情动作")
  })

  it("强调事件连续性与整章故事主线", () => {
    const prompt = buildEventOutlinePrompt(request)
    expect(prompt).toContain("先说清它承接上一个事件的什么结果")
    expect(prompt).toContain("起因 → 发展 → 转折 → 收束")
    expect(prompt).toContain("不是几个互不相干的片段")
  })

  it("示例 JSON 的抓手按故事向口径给出", () => {
    const fences = promptJsonFences(buildEventOutlinePrompt(request))
    const points = fences[0].eventOutlineData?.events[0]?.points ?? []
    expect(points[0]).toContain("故事推进")
    expect(points.join("")).not.toContain("神情动作")
  })

  it("事件数为 0 时回落到默认事件数，不产生 Infinity", () => {
    const prompt = buildEventOutlinePrompt({ ...request, eventCount: 0 })
    expect(prompt).not.toContain("Infinity")
    expect(prompt).toContain(`${EVENT_OUTLINE_DEFAULT_EVENTS} 个`)
  })

  it("目标字数为 0 时不产生 NaN，并省略每个事件的字数", () => {
    const prompt = buildEventOutlinePrompt({ ...request, targetWords: 0 })
    expect(prompt).not.toContain("NaN")
    expect(prompt).not.toContain("每个事件约")
  })

  it("JSON 示例后说明它只演示单个事件的字段格式", () => {
    // 否则照抄示例的模型只会输出 1 个事件，正好被 4~8 的校验拦下。
    expect(buildEventOutlinePrompt(request)).toContain("只演示单个事件的字段格式")
  })

  it("唯一的 json 示例是 eventOutlineData，而且是合法 JSON", () => {
    // 只留一份围栏：保存请求那份已经按用户要求移除（事件细纲不再进大纲列表）。
    // 「只有一份围栏」是**可失败**的判据（多回一份 outlineSaveRequest 示例就会变 2）。
    // 原先还跟着两条 `outlineSaveRequest === undefined` 的断言：它们并非恒真
    // （往示例里加回该键或该字面量就会红），只是**冗余** ——
    // 「没有 outlineSaveRequest」已由上面「要求产出 eventOutlineData，且不再要求保存请求」
    // 那两条断言钉住，而「围栏里只有 eventOutlineData」由下面的长度断言钉住，
    // 故删除以免同一事实被钉三遍。
    const fences = promptJsonFences(buildEventOutlinePrompt({ ...request, chapterNumber: 7 }))
    expect(fences).toHaveLength(1)
    expect(fences[0].eventOutlineData?.events).toHaveLength(1)
  })

  it("输出格式只要一个 JSON 围栏，并明确禁止手写 Markdown", () => {
    const prompt = buildEventOutlinePrompt(request)
    expect(prompt).toContain("只输出一个 ```json 围栏")
    expect(prompt).not.toContain("一份可直接保存的 Markdown 细纲内容")
    expect(prompt).not.toContain("一份可直接保存的 Markdown 正文")
    // title 仍要写清章号与章名：反推的一级标题靠它拼
    expect(prompt).toContain("第N章 · 一句话章名")
  })

  /*
   * hasFileTools=false 是给**章节区**那条链路用的：那里没有工具循环
   * （资料由 buildContextPack 事先装配进 user 消息），系统提示词也明确说了
   * 「你没有读取文件的工具」。此时若还要求模型「先读资料（list_chapters / …）」，
   * user 与 system 直接互相矛盾，模型可能输出工具调用旁白而不是细纲。
   */
  it("无工具链路上不再要求模型调用 list_chapters 等工具", () => {
    const prompt = buildEventOutlinePrompt(request, { hasFileTools: false })
    expect(prompt).not.toContain("list_chapters")
    expect(prompt).not.toContain("read_chapter")
    expect(prompt).not.toContain("list_outlines")
    expect(prompt).not.toContain("read_outline")
    // 除那一条外，其余硬要求与输出格式一字不动
    expect(prompt).toContain("不要输出工具调用报告和分析过程")
    expect(prompt).toContain("不要写正文")
    expect(prompt).toContain("不要手写 Markdown 细纲")
  })

  it("默认（有大纲面板的工具循环）仍然要求先读资料，行为与改动前一致", () => {
    const prompt = buildEventOutlinePrompt(request)
    expect(prompt).toContain("先读资料（list_chapters / read_chapter / list_outlines / read_outline）确认前文与已有章纲，再动笔；")
    // 显式传 true 与不传必须完全一致
    expect(buildEventOutlinePrompt(request, { hasFileTools: true })).toBe(prompt)
  })
})

describe("eventOutlineToProsePrompt", () => {
  it("把事件流写成按顺序覆盖的硬要求", () => {
    const prompt = eventOutlineToProsePrompt(data())
    expect(prompt).toContain("第 12 章")
    expect(prompt).toContain("1. 事件1")
    expect(prompt).toContain("台词：你来啦")
    expect(prompt).toContain("令牌上的四个字亮起时")
  })

  it("带上目标字数与只输出正文的要求", () => {
    const prompt = eventOutlineToProsePrompt(data())
    expect(prompt).toContain("3000")
    expect(prompt).toContain("只输出")
  })

  it("明令不得调换事件顺序", () => {
    expect(eventOutlineToProsePrompt(data())).toContain("顺序")
  })

  it("每个事件的抓手逐条列出并缩进挂在事件下面", () => {
    const prompt = eventOutlineToProsePrompt(data())
    // 只输出 points[0] 的实现会漏掉第二条抓手。
    expect(prompt).toContain("神情：她手一抖")
    expect(prompt).toContain("   - 台词：你来啦")
    expect(prompt).toContain("2. 事件2")
  })

  it("没有结尾钩子时不留下空标题", () => {
    const prompt = eventOutlineToProsePrompt(data({ endingHook: "" }))
    expect(prompt).not.toContain("## 本章结尾钩子\n")
    // 只有空白的钩子与空字符串同待遇，否则会留下一个空标题。
    expect(eventOutlineToProsePrompt(data({ endingHook: "   " }))).not.toContain("## 本章结尾钩子")
  })

  it("带上反 AI 腔硬约束", () => {
    // 这条路是另一条直达正文的入口，不经过 deep-chapter 的四个 builder。
    expect(eventOutlineToProsePrompt(data())).toContain(DE_AI_GENERATION_RULES)
  })

  it("有用户要求时单独成节，为空时整节不出现", () => {
    const withRequirement = eventOutlineToProsePrompt(data({ requirement: "让楚白第一次动用令牌" }))
    expect(withRequirement).toContain("## 用户对本章的要求")
    expect(withRequirement).toContain("让楚白第一次动用令牌")

    for (const empty of [undefined, "", "   "]) {
      const prompt = eventOutlineToProsePrompt(data({ requirement: empty }))
      expect(prompt).not.toContain("## 用户对本章的要求")
    }
  })
})

describe("事件细纲的 requirement 不再丢失", () => {
  it("readEventOutline / normalizeEventOutlineData 能读回该字段", () => {
    const parsed = normalizeEventOutlineData({ ...data(), requirement: "  让楚白第一次动用令牌  " })
    expect(parsed?.requirement).toBe("让楚白第一次动用令牌")
  })

  it("旧数据没有该字段时是 undefined，行为等同现状", () => {
    expect(normalizeEventOutlineData(data())?.requirement).toBeUndefined()
    expect(normalizeEventOutlineData({ ...data(), requirement: "   " })?.requirement).toBeUndefined()
  })

  it("extractEventOutlineData 用向导里的要求补齐（模型没写也拿得到）", () => {
    const payload = `\`\`\`json\n${JSON.stringify({ eventOutlineData: data() })}\n\`\`\``
    expect(extractEventOutlineData(payload, "让楚白第一次动用令牌")?.requirement).toBe("让楚白第一次动用令牌")
    // 不传第二个参数时，仍是模型自己写的那份（或没有）。
    expect(extractEventOutlineData(payload)?.requirement).toBeUndefined()
  })

  it("生成细纲的示例 JSON 里带上用户要求，否则扩写那一步无从取回", () => {
    const request = { chapterNumber: 12, eventCount: 6, targetWords: 3000, requirement: "让楚白第一次动用令牌" }
    const fences = promptJsonFences(buildEventOutlinePrompt(request))
    expect(fences[0].eventOutlineData).toMatchObject({ requirement: "让楚白第一次动用令牌" })

    // 没有要求时不塞空字段，避免教模型输出 requirement: ""。
    const blank = promptJsonFences(buildEventOutlinePrompt({ ...request, requirement: "  " }))
    expect(blank[0].eventOutlineData).not.toHaveProperty("requirement")
  })

  it("从细纲 JSON 一路带到扩写提示词（端到端）", () => {
    const payload = `\`\`\`json\n${JSON.stringify({ eventOutlineData: data() })}\n\`\`\``
    const dataWithRequirement = extractEventOutlineData(payload, "让楚白第一次动用令牌")
    expect(eventOutlineToProsePrompt(dataWithRequirement!)).toContain("## 用户对本章的要求")
  })
})

/*
 * 展示层的剥离函数：卡片已经把 eventOutlineData 渲染成可读结构，
 * 裸 JSON 在气泡里就是纯噪声（气泡是 Markdown 渲染，围栏会变成一个代码块）。
 */
describe("looksLikeEventOutlineDeliveryNote", () => {
  it("空串与一句「已生成」都算交代语（应当改用反推正文）", () => {
    expect(looksLikeEventOutlineDeliveryNote("")).toBe(true)
    expect(looksLikeEventOutlineDeliveryNote("已生成第12章事件细纲。")).toBe(true)
    expect(looksLikeEventOutlineDeliveryNote("  好的，\n已完成。 ")).toBe(true)
  })
  it("带标题的手写细纲不算交代语（原样保留）", () => {
    const handwritten = [
      "# 事件细纲 · 第12章 令牌初现",
      "",
      "## 事件1 楚白翻出令牌",
      "- 关键台词：你来啦",
    ].join("\n")
    expect(looksLikeEventOutlineDeliveryNote(handwritten)).toBe(false)
  })
  it("较长但没标题的正文也不当成交代语（宁可多显示，不要吞内容）", () => {
    const long = "这是一段没有标题但内容很长的细纲说明。".repeat(8)
    expect(looksLikeEventOutlineDeliveryNote(long)).toBe(false)
  })
})

describe("stripEventOutlineDataFence", () => {
  it("摘下能解析成事件细纲的 json 围栏，留下人看的 Markdown 正文", () => {
    const withFence = [
      "# 事件细纲 · 第12章 令牌初现",
      "",
      "## 事件1 楚白翻出令牌",
      "- 关键台词：你来啦",
      "",
      "```json",
      JSON.stringify({ eventOutlineData: data() }, null, 2),
      "```",
    ].join("\n")

    const stripped = stripEventOutlineDataFence(withFence)
    expect(stripped).toContain("## 事件1 楚白翻出令牌")
    expect(stripped).not.toContain("eventOutlineData")
    expect(stripped).not.toContain("```")
  })

  it("非 json 的围栏、以及别的 json 围栏都原样保留", () => {
    const content = [
      "正文如下。",
      "",
      "```ts",
      "const a = 1",
      "```",
      "",
      "```json",
      JSON.stringify({ outlineSaveRequest: { content: "别的请求" } }),
      "```",
    ].join("\n")

    const stripped = stripEventOutlineDataFence(content)
    expect(stripped).toContain("const a = 1")
    expect(stripped).toContain("outlineSaveRequest")
  })

  it("没有围栏时原样返回（不做任何猜测式剥离）", () => {
    expect(stripEventOutlineDataFence("只有正文。")).toBe("只有正文。")
  })

  /*
   * 用户 2026-10-13 实测：气泡里直接铺着一段**没有围栏**的 eventOutlineData JSON
   * （连代码块都不是）。提示词要求了围栏，但模型确实会漏写，所以剥围栏之外还要能
   * 认出裸 JSON —— 否则那一段会永远露在气泡里。
   */
  it("模型漏写围栏时，裸的 eventOutlineData JSON 一样摘掉", () => {
    const content = [
      "# 事件细纲 · 第20章 活着的那个",
      "",
      "## 事件1 废车场雨夜伏击",
      "- 环境物件：翻倒的货车残骸",
      "",
      JSON.stringify({ eventOutlineData: data() }, null, 2),
    ].join("\n")

    const stripped = stripEventOutlineDataFence(content)
    expect(stripped).toContain("## 事件1 废车场雨夜伏击")
    expect(stripped).not.toContain("eventOutlineData")
    expect(stripped).not.toContain("{")
  })

  it("正文里提到花括号、但没有可解析的细纲对象时不误删", () => {
    const content = "判断如下：结构可以写成 {\"a\": 1} 这样，但这一步不给数据。"
    expect(stripEventOutlineDataFence(content)).toBe(content)
  })
})

/*
 * 空事件不留空壳。
 *
 * 结构化-only 之后正文**完全**由数据拼出，没有模型手写的 Markdown 兜底：数据里只要
 * 出现一个「有 id、没内容」的事件（模型截断、或只填了 half 个字段），拼出来就是
 * `## 事件2 ` 后面跟两行空白 —— 气泡里看着像渲染坏了，用户会以为细纲生成失败。
 * 正常事件仍按旧形状导出（id 逐条、抓手逐条），空事件整条跳过且不占用后续排版。
 */
describe("renderEventOutlineMarkdown：空事件不留空壳", () => {
  it("标题与抓手都为空的事件整条不导出", () => {
    const markdown = renderEventOutlineMarkdown(
      data({
        events: [
          { id: 1, title: "楚白翻出令牌", points: ["  故事推进：他摸到令牌  "] },
          { id: 2, title: "", points: [] },
          // 全是空白也算空：模型写空串/空格，比缺字段更常见
          { id: 3, title: "   ", points: ["", "   "] },
        ],
      }),
    )
    expect(markdown).toContain("## 事件1 楚白翻出令牌")
    expect(markdown).not.toContain("## 事件2")
    expect(markdown).not.toContain("## 事件3")
    // 抓手逐条 trim：前后空白不许带进正文，也不许留下空的列表项
    expect(markdown).toContain("- 故事推进：他摸到令牌")
    expect(markdown).not.toMatch(/^## 事件\d+\s*$/m)
    expect(markdown).not.toMatch(/^-\s*$/m)
  })

  it("只有标题没有抓手时保留标题，且不追加空行", () => {
    const markdown = renderEventOutlineMarkdown(
      data({
        events: [
          { id: 1, title: "楚白翻出令牌", points: [] },
          { id: 2, title: "守卫追来", points: ["故事推进：他只能往井边跑"] },
        ],
        endingHook: "",
      }),
    )
    expect(markdown).toContain("## 事件1 楚白翻出令牌")
    expect(markdown).toContain("## 事件2 守卫追来")
    // 标题后面先推了一个空行，若无抓手还补空行就成了两个连续空行（形似坏档）
    expect(markdown).not.toMatch(/\n{3,}/)
  })

  it("事件全为空时只剩文档标题与目标字数", () => {
    const markdown = renderEventOutlineMarkdown(
      data({ events: [{ id: 1, title: "", points: [] }], endingHook: "" }),
    )
    expect(markdown).toContain("# 事件细纲 · 第12章 令牌初现")
    expect(markdown).toContain("目标字数：约 3000 字")
    expect(markdown).not.toContain("## 事件")
    expect(markdown).not.toMatch(/\n{3,}/)
  })
})

/*
 * 抓手的两列排版：模型把每条抓手写成「类别：一长段话」，类别词是有限的那几个
 * （故事推进 / 冲突与转折 / 关键台词 / 环境与物件 / 伏笔或钩子，以及 2026-10-13
 * 之前的旧口径 环境物件 / 神情动作 / 推进与收束）。卡片据此分成两列 ——
 * 白名单之外的前缀**不拆**，整行原样显示，避免把一个正常句子误拆成两列。
 */
describe("splitEventPointLabel", () => {
  it("认得出当前故事向口径的类别词", () => {
    expect(splitEventPointLabel("故事推进：楚白用令牌脱身，惊动了城门口的守卫。")).toEqual({
      label: "故事推进",
      text: "楚白用令牌脱身，惊动了城门口的守卫。",
    })
    expect(splitEventPointLabel("冲突与转折：追兵撞见了他藏在袖中的手。")).toEqual({
      label: "冲突与转折",
      text: "追兵撞见了他藏在袖中的手。",
    })
    expect(splitEventPointLabel("伏笔或钩子：那枚令牌背面还刻着半个名字。")).toEqual({
      label: "伏笔或钩子",
      text: "那枚令牌背面还刻着半个名字。",
    })
  })

  it("旧口径的类别词仍认（历史细纲照旧排两列）", () => {
    expect(splitEventPointLabel("环境物件：翻倒货车残骸、重油烧灼泥地。")).toEqual({
      label: "环境物件",
      text: "翻倒货车残骸、重油烧灼泥地。",
    })
    expect(splitEventPointLabel("关键台词：杨震神色阴冷如冰：「找了我十年。」")).toEqual({
      label: "关键台词",
      text: "杨震神色阴冷如冰：「找了我十年。」",
    })
    expect(splitEventPointLabel("推进与收束：全歼前哨追捕小队。")).toEqual({
      label: "推进与收束",
      text: "全歼前哨追捕小队。",
    })
  })

  it("半角冒号与冒号后的空格都认", () => {
    expect(splitEventPointLabel("神情动作: 她手一抖")).toEqual({ label: "神情动作", text: "她手一抖" })
  })

  /*
   * 「杨震的神色：阴冷如冰」的冒号前是 5 个字、也全是中文 ——
   * 若按「冒号前不超过 8 个字就算类别」来拆，这种正常句子会被误拆出一列类别。
   */
  it("白名单之外的冒号不拆（不把正常句子误当成类别）", () => {
    expect(splitEventPointLabel("杨震的神色：阴冷如冰")).toEqual({
      label: "",
      text: "杨震的神色：阴冷如冰",
    })
  })

  it("没有冒号时整条当正文，且一个字都不改", () => {
    expect(splitEventPointLabel(" 令牌亮起，院外传来脚步声。 ")).toEqual({
      label: "",
      text: "令牌亮起，院外传来脚步声。",
    })
  })

  it("只有类别没有正文时不拆（不留一个空正文列）", () => {
    expect(splitEventPointLabel("环境物件：")).toEqual({ label: "", text: "环境物件：" })
  })
})
