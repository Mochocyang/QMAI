import { describe, expect, it } from "vitest"
import {
  CHAPTER_DISCUSS_MARKER_CLOSE,
  CHAPTER_DISCUSS_MARKER_OPEN,
  buildChapterDiscussExecutionPrompt,
  buildChapterDiscussCustomPrompt,
  buildChapterDiscussPhaseSystemRules,
  buildChapterDiscussPlanBlueprint,
  buildChapterDiscussRegeneratePrompt,
  buildChapterDiscussRepairMessages,
  findLatestChapterDiscussProtocol,
  hasChapterDiscussRepairableContent,
  isChapterDiscussProtocol,
  parseChapterDiscussProtocol,
  stripChapterDiscussMarkers,
  validateChapterDiscussProtocol,
  type ChapterDiscussDirection,
  type ChapterDiscussProtocol,
} from "./chapter-discuss-protocol"
import { OUTLINE_FIND_CHAPTER_INTENTS } from "./outline-find-protocol"
import { routeTask } from "./task-router"

function direction(overrides: Partial<ChapterDiscussDirection> = {}): ChapterDiscussDirection {
  return {
    id: "d1",
    storyType: "复仇线",
    title: "血债血偿",
    summary: "前".repeat(200),
    ...overrides,
  }
}

function protocol(overrides: Partial<ChapterDiscussProtocol> = {}): ChapterDiscussProtocol {
  return {
    status: "needs_choice",
    module: "第3章",
    judgment: "需要在第三章完成一次转折",
    directions: [
      direction({ id: "d1", storyType: "复仇线" }),
      direction({ id: "d2", storyType: "悬念反转", title: "真凶另有其人" }),
      direction({ id: "d3", storyType: "情感升温", title: "并肩之夜" }),
    ],
    preferenceId: "d1",
    preferenceReason: "最贴合前文伏笔",
    ...overrides,
  }
}

function block(payload: object): string {
  return `${CHAPTER_DISCUSS_MARKER_OPEN}\n${JSON.stringify(payload)}\n${CHAPTER_DISCUSS_MARKER_CLOSE}`
}

describe("parseChapterDiscussProtocol", () => {
  it("returns none when there is no marker", () => {
    expect(parseChapterDiscussProtocol("先读前文，再给方向。")).toEqual({ kind: "none" })
  })

  it("parses a complete protocol block and normalizes directions", () => {
    const outcome = parseChapterDiscussProtocol(`关键判断在这里。\n${block({
      status: "needs_choice",
      module: "第3章",
      judgment: "需要转折",
      directions: [
        { id: "d1", storyType: "复仇线", title: "血债血偿", summary: "前".repeat(200) },
        { storyType: "悬念反转", title: "真凶另有其人", summary: "前".repeat(200) },
      ],
      preferenceId: "d1",
      preferenceReason: "贴合伏笔",
    })}`)
    expect(outcome.kind).toBe("valid")
    if (outcome.kind !== "valid") return
    expect(outcome.protocol.module).toBe("第3章")
    expect(outcome.protocol.directions).toHaveLength(2)
    expect(outcome.protocol.directions[1].id).toBe("d2")
    expect(outcome.protocol.preferenceId).toBe("d1")
  })

  it("falls back to an unclosed block (streaming truncation)", () => {
    const outcome = parseChapterDiscussProtocol(
      `${CHAPTER_DISCUSS_MARKER_OPEN}\n{"status":"needs_choice","module":"第3章","judgment":"判断","directions":[],"preferenceId":"","preferenceReason":""}`,
    )
    expect(outcome.kind).toBe("valid")
  })

  it("accepts an unclosed block that still has trailing content", () => {
    const outcome = parseChapterDiscussProtocol(
      `${CHAPTER_DISCUSS_MARKER_OPEN}\n{"status":"needs_choice","module":"第3章","judgment":"判断","directions":[],"preferenceId":"","preferenceReason":""}\n后面还有一段正文`,
    )
    expect(outcome.kind).toBe("valid")
  })

  it("accepts a fenced block without the closing marker", () => {
    const outcome = parseChapterDiscussProtocol(
      `判断。\n${CHAPTER_DISCUSS_MARKER_OPEN}\n\`\`\`json\n{"status":"insufficient","module":"第3章","judgment":"缺前文"}\n\`\`\``,
    )
    expect(outcome.kind).toBe("valid")
    if (outcome.kind !== "valid") return
    expect(outcome.protocol.status).toBe("insufficient")
  })

  it("rejects a truncated block", () => {
    expect(parseChapterDiscussProtocol(`${CHAPTER_DISCUSS_MARKER_OPEN}\n{"status":"needs_choice","directions":[`))
      .toEqual({ kind: "invalid", error: "章节共创协议 JSON 不完整或缺失" })
  })

  it("rejects unparseable JSON", () => {
    expect(parseChapterDiscussProtocol(`${CHAPTER_DISCUSS_MARKER_OPEN}\n{不是 JSON}\n${CHAPTER_DISCUSS_MARKER_CLOSE}`))
      .toEqual({ kind: "invalid", error: "章节共创协议 JSON 无法解析" })
  })

  it("rejects a missing or unknown status", () => {
    const outcome = parseChapterDiscussProtocol(block({ module: "第3章", directions: [] }))
    expect(outcome).toEqual({ kind: "invalid", error: "章节共创协议缺少有效的 status 字段" })
  })
})

describe("validateChapterDiscussProtocol", () => {
  it("accepts a proper needs_choice protocol", () => {
    expect(validateChapterDiscussProtocol(protocol()).kind).toBe("needs_choice")
  })

  it("rejects fewer than three directions", () => {
    const result = validateChapterDiscussProtocol(protocol({
      directions: [direction({ id: "d1" }), direction({ id: "d2", storyType: "悬念反转" })],
    }))
    expect(result.kind).toBe("invalid")
    if (result.kind !== "invalid") return
    expect(result.error).toContain("3-4 个方向")
  })

  it("rejects more than four directions", () => {
    const result = validateChapterDiscussProtocol(protocol({
      directions: [
        direction({ id: "d1", storyType: "复仇线" }),
        direction({ id: "d2", storyType: "悬念反转" }),
        direction({ id: "d3", storyType: "情感升温" }),
        direction({ id: "d4", storyType: "势力升级" }),
        direction({ id: "d5", storyType: "意外重逢" }),
      ],
    }))
    expect(result.kind).toBe("invalid")
  })

  it("rejects a direction missing its story type", () => {
    const result = validateChapterDiscussProtocol(protocol({
      directions: [
        direction({ id: "d1", storyType: "" }),
        direction({ id: "d2", storyType: "悬念反转" }),
        direction({ id: "d3", storyType: "情感升温" }),
      ],
    }))
    expect(result.kind).toBe("invalid")
    if (result.kind !== "invalid") return
    expect(result.error).toContain("缺少故事类型")
  })

  it("rejects duplicated story types", () => {
    const result = validateChapterDiscussProtocol(protocol({
      directions: [
        direction({ id: "d1", storyType: "复仇线" }),
        direction({ id: "d2", storyType: "复仇线" }),
        direction({ id: "d3", storyType: "情感升温" }),
      ],
    }))
    expect(result.kind).toBe("invalid")
    if (result.kind !== "invalid") return
    expect(result.error).toContain("故事类型重复")
  })

  it("rejects a direction whose summary is too short", () => {
    const result = validateChapterDiscussProtocol(protocol({
      directions: [
        direction({ id: "d1", storyType: "复仇线", summary: "太短了" }),
        direction({ id: "d2", storyType: "悬念反转" }),
        direction({ id: "d3", storyType: "情感升温" }),
      ],
    }))
    expect(result.kind).toBe("invalid")
    if (result.kind !== "invalid") return
    expect(result.error).toContain("过短")
  })

  it("rejects a preference id that points at no direction", () => {
    const result = validateChapterDiscussProtocol(protocol({ preferenceId: "d9" }))
    expect(result.kind).toBe("invalid")
    if (result.kind !== "invalid") return
    expect(result.error).toContain("AI 推荐")
  })

  it("allows an empty preference id (no recommendation)", () => {
    expect(validateChapterDiscussProtocol(protocol({ preferenceId: "", preferenceReason: "" })).kind)
      .toBe("needs_choice")
  })

  it("treats insufficient with directions as invalid", () => {
    expect(validateChapterDiscussProtocol(protocol({ status: "insufficient" })).kind).toBe("invalid")
  })

  it("treats insufficient without a judgement as invalid", () => {
    const result = validateChapterDiscussProtocol(protocol({
      status: "insufficient",
      directions: [],
      judgment: "",
    }))
    expect(result.kind).toBe("invalid")
  })

  it("accepts insufficient with a reason and no directions", () => {
    const result = validateChapterDiscussProtocol(protocol({
      status: "insufficient",
      directions: [],
      judgment: "前两章信息不足，无法推演第三章",
    }))
    expect(result.kind).toBe("insufficient")
  })
})

describe("stripChapterDiscussMarkers", () => {
  it("removes a complete block", () => {
    const text = `判断。\n${block({ status: "needs_choice" })}\n结尾`
    expect(stripChapterDiscussMarkers(text)).toBe("判断。\n\n结尾")
  })

  it("removes an unclosed trailing block", () => {
    const text = `判断。\n${CHAPTER_DISCUSS_MARKER_OPEN}\n{"status":"needs_choice"}`
    expect(stripChapterDiscussMarkers(text).includes("chapter_discuss")).toBe(false)
  })
})

describe("isChapterDiscussProtocol", () => {
  it("keeps a complete protocol", () => {
    expect(isChapterDiscussProtocol(protocol())).toBe(true)
  })

  it("rejects structural damage", () => {
    expect(isChapterDiscussProtocol(null)).toBe(false)
    expect(isChapterDiscussProtocol({ ...protocol(), status: "ready" })).toBe(false)
    expect(isChapterDiscussProtocol({ ...protocol(), directions: [{ id: 1 }] })).toBe(false)
  })
})

describe("findLatestChapterDiscussProtocol", () => {
  it("returns the last non-null protocol", () => {
    const older = protocol({ judgment: "旧的" })
    const newer = protocol({ judgment: "新的" })
    expect(findLatestChapterDiscussProtocol([
      { chapterDiscussProtocol: older },
      { chapterDiscussProtocol: null },
      { chapterDiscussProtocol: newer },
    ])?.judgment).toBe("新的")
  })
})

describe("prompt builders", () => {
  it("scopes the discuss rules to the chapter and embeds the marker", () => {
    const rules = buildChapterDiscussPhaseSystemRules("第3章")
    expect(rules).toContain("第3章")
    expect(rules).toContain(CHAPTER_DISCUSS_MARKER_OPEN)
    expect(rules).toContain("禁止调用 run_chapter_workflow")
  })

  it("builds an execution prompt in a writing voice", () => {
    const prompt = buildChapterDiscussExecutionPrompt({
      module: "第3章",
      direction: direction({ title: "血债血偿" }),
    })
    expect(prompt).toContain("第3章")
    expect(prompt).toContain("血债血偿")
    expect(prompt).toContain("续写")
  })

  it("turns a direction into a plan blueprint", () => {
    const blueprint = buildChapterDiscussPlanBlueprint(direction({ storyType: "复仇线", title: "血债血偿" }))
    expect(blueprint).toContain("复仇线")
    expect(blueprint).toContain("血债血偿")
  })

  it("builds an execution prompt that routes to a chapter-writing intent", () => {
    // 回归：选定方向后的执行 prompt 必须能被 routeTask 识别为章节写作，
    // 否则生成轮不会强制调用 run_chapter_workflow，出不了正文。
    const prompt = buildChapterDiscussExecutionPrompt({
      module: "第3章",
      direction: direction({ title: "血债血偿" }),
    })
    expect(OUTLINE_FIND_CHAPTER_INTENTS.has(routeTask(prompt).intent)).toBe(true)
  })

  it("lists the previous batch when regenerating", () => {
    const prompt = buildChapterDiscussRegeneratePrompt({
      module: "第3章",
      previous: [{ storyType: "复仇线", title: "血债血偿" }],
    })
    expect(prompt).toContain("复仇线")
    expect(prompt).toContain("完全不同")
  })

  it("embeds the author's own idea when asking for a custom re-roll", () => {
    const prompt = buildChapterDiscussCustomPrompt({
      module: "第3章",
      idea: "我想让主角这次主动认输，把节奏压下来",
    })
    expect(prompt).toContain("我想让主角这次主动认输，把节奏压下来")
    expect(prompt).toContain("第3章")
    expect(prompt).toContain("chapter_discuss")
  })
})

describe("repair helpers", () => {
  it("only repairs substantial content without a marker", () => {
    expect(hasChapterDiscussRepairableContent("")).toBe(false)
    expect(hasChapterDiscussRepairableContent("好的。")).toBe(false)
    expect(hasChapterDiscussRepairableContent("一".repeat(200))).toBe(true)
    expect(hasChapterDiscussRepairableContent(block({ status: "needs_choice" }))).toBe(false)
  })

  it("emits a repair template that the parser accepts", () => {
    const messages = buildChapterDiscussRepairMessages({ content: "一".repeat(200), module: "第3章" })
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toContain(CHAPTER_DISCUSS_MARKER_OPEN)
    expect(messages[0].content).toContain(CHAPTER_DISCUSS_MARKER_CLOSE)
    expect(messages[0].content).toContain("不要复述原回复")
    expect(messages[0].content).not.toContain("原样保留")
  })
})
