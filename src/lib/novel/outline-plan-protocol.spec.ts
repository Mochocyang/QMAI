import { describe, expect, it } from "vitest"
import { getOutlinePlanRequiredElements } from "./outline-plan-elements"
import {
  OUTLINE_PLAN_CUSTOM_OPTION_ID,
  OUTLINE_PLAN_MARKER_CLOSE,
  OUTLINE_PLAN_MARKER_OPEN,
  buildOutlinePlanClarifyAnswerPrompt,
  buildOutlinePlanElementCheckPrompt,
  buildOutlinePlanExecutionPrompt,
  buildOutlinePlanPhaseSystemRules,
  findUnsatisfiedOutlinePlanElements,
  formatOutlinePlanMarkdown,
  parseOutlinePlanProtocol,
  stripOutlinePlanMarkers,
  validateOutlinePlanProtocol,
  type OutlinePlanProtocol,
} from "./outline-plan-protocol"

function wrap(payload: unknown): string {
  return `${OUTLINE_PLAN_MARKER_OPEN}\n${JSON.stringify(payload)}\n${OUTLINE_PLAN_MARKER_CLOSE}`
}

function threeOptions() {
  return [
    { id: "A", label: "选项一", description: "说明一" },
    { id: "B", label: "选项二", description: "说明二" },
    { id: "C", label: "选项三", description: "说明三" },
  ]
}

const chapterElements = getOutlinePlanRequiredElements("章节细纲")

function satisfyAll(): OutlinePlanProtocol["elements"] {
  return chapterElements.map((spec) => ({
    key: spec.key,
    value: `已确认-${spec.label}`,
    source: "user" as const,
    satisfied: true,
  }))
}

const readyPlan = {
  summary: "先补第 11-15 章章纲",
  steps: [{ id: "s1", title: "读取卷纲", detail: "确认本卷目标" }],
  files: [{
    targetFolder: "章纲",
    fileName: "章纲_第11章.md",
    fileType: "chapter-outline",
    writeMode: "create",
    elements: ["chapterGoal"],
  }],
  order: "先卷后章",
  risks: ["时间线可能断裂"],
  openQuestions: [],
}

describe("parseOutlinePlanProtocol", () => {
  it("returns none when the marker is absent", () => {
    expect(parseOutlinePlanProtocol("普通回复内容").kind).toBe("none")
  })

  it("parses a well formed protocol block", () => {
    const outcome = parseOutlinePlanProtocol(wrap({
      status: "ready",
      module: "章节细纲",
      elements: [{ key: "chapterRange", value: "第11-15章", source: "user", satisfied: true }],
      missing: [],
      questions: [],
      plan: readyPlan,
    }))

    expect(outcome.kind).toBe("valid")
    if (outcome.kind !== "valid") return
    expect(outcome.protocol.status).toBe("ready")
    expect(outcome.protocol.module).toBe("章节细纲")
    expect(outcome.protocol.plan?.files[0].fileName).toBe("章纲_第11章.md")
  })

  it("recovers a truncated block that lost its closing marker", () => {
    const outcome = parseOutlinePlanProtocol(
      `${OUTLINE_PLAN_MARKER_OPEN}\n${JSON.stringify({ status: "needs_input", module: "卷纲" })}`,
    )

    expect(outcome.kind).toBe("valid")
    if (outcome.kind !== "valid") return
    expect(outcome.protocol.status).toBe("needs_input")
  })

  it("rejects an unclosed block that still has trailing content", () => {
    const outcome = parseOutlinePlanProtocol(
      `${OUTLINE_PLAN_MARKER_OPEN}\n{"status":"ready"}\n后面还有别的正文`,
    )

    expect(outcome).toEqual({
      kind: "invalid",
      error: "计划协议缺少闭合标记且 JSON 后仍有额外内容",
    })
  })

  it("rejects unparsable json", () => {
    const outcome = parseOutlinePlanProtocol(
      `${OUTLINE_PLAN_MARKER_OPEN}\n{status: ready}\n${OUTLINE_PLAN_MARKER_CLOSE}`,
    )

    expect(outcome.kind).toBe("invalid")
  })

  it("rejects a missing or unknown status", () => {
    expect(parseOutlinePlanProtocol(wrap({ module: "卷纲" })).kind).toBe("invalid")
    expect(parseOutlinePlanProtocol(wrap({ status: "clear" })).kind).toBe("invalid")
  })

  it("appends a custom input option to every question", () => {
    const outcome = parseOutlinePlanProtocol(wrap({
      status: "needs_input",
      module: "卷纲",
      questions: [{ id: "q1", key: "volumeScope", question: "覆盖哪几章？", options: threeOptions() }],
    }))

    expect(outcome.kind).toBe("valid")
    if (outcome.kind !== "valid") return
    const options = outcome.protocol.questions[0].options
    expect(options).toHaveLength(4)
    expect(options[3].id).toBe(OUTLINE_PLAN_CUSTOM_OPTION_ID)
    expect(options[3].label).toBe("其它（我来补充描述）")
  })

  it("keeps a model supplied custom option at the end without duplicating it", () => {
    const outcome = parseOutlinePlanProtocol(wrap({
      status: "needs_input",
      module: "卷纲",
      questions: [{
        id: "q1",
        key: "volumeScope",
        question: "覆盖哪几章？",
        options: [
          { id: "CUSTOM", label: "自己写" },
          ...threeOptions(),
        ],
      }],
    }))

    expect(outcome.kind).toBe("valid")
    if (outcome.kind !== "valid") return
    const options = outcome.protocol.questions[0].options
    expect(options).toHaveLength(4)
    expect(options.filter((option) => option.id === OUTLINE_PLAN_CUSTOM_OPTION_ID)).toHaveLength(1)
    expect(options[3].label).toBe("自己写")
  })

  it("drops elements that claim to be satisfied without a value", () => {
    const outcome = parseOutlinePlanProtocol(wrap({
      status: "needs_input",
      module: "卷纲",
      elements: [{ key: "volumeScope", value: "", source: "project", satisfied: true }],
    }))

    expect(outcome.kind).toBe("valid")
    if (outcome.kind !== "valid") return
    expect(outcome.protocol.elements[0].satisfied).toBe(false)
  })

  it("falls back to inferred for unknown element sources", () => {
    const outcome = parseOutlinePlanProtocol(wrap({
      status: "needs_input",
      module: "卷纲",
      elements: [{ key: "volumeScope", value: "第二卷", source: "guess", satisfied: true }],
    }))

    expect(outcome.kind).toBe("valid")
    if (outcome.kind !== "valid") return
    expect(outcome.protocol.elements[0].source).toBe("inferred")
  })
})

describe("validateOutlinePlanProtocol", () => {
  it("rejects needs_input without any question", () => {
    const result = validateOutlinePlanProtocol({
      status: "needs_input",
      module: "章节细纲",
      elements: [],
      missing: ["chapterRange"],
      questions: [],
    }, chapterElements)

    expect(result.kind).toBe("invalid")
  })

  it("rejects a question with fewer than three real options", () => {
    const result = validateOutlinePlanProtocol({
      status: "needs_input",
      module: "章节细纲",
      elements: [],
      missing: ["chapterRange"],
      questions: [{
        id: "q1",
        key: "chapterRange",
        question: "写到第几章？",
        multiple: false,
        options: [
          { id: "A", label: "第 11 章", description: "" },
          { id: "B", label: "第 12 章", description: "" },
          { id: OUTLINE_PLAN_CUSTOM_OPTION_ID, label: "其它", description: "" },
        ],
      }],
    }, chapterElements)

    expect(result.kind).toBe("invalid")
    if (result.kind !== "invalid") return
    expect(result.error).toContain("少于 3 个")
  })

  it("accepts needs_input with three real options plus the custom entry", () => {
    const parsed = parseOutlinePlanProtocol(wrap({
      status: "needs_input",
      module: "章节细纲",
      questions: [{ id: "q1", key: "chapterRange", question: "写到第几章？", options: threeOptions() }],
    }))
    expect(parsed.kind).toBe("valid")
    if (parsed.kind !== "valid") return

    const result = validateOutlinePlanProtocol(parsed.protocol, chapterElements)

    expect(result.kind).toBe("needs_input")
    if (result.kind !== "needs_input") return
    expect(result.downgraded).toBe(false)
  })

  it("rejects ready without steps or files", () => {
    const base: OutlinePlanProtocol = {
      status: "ready",
      module: "章节细纲",
      elements: satisfyAll(),
      missing: [],
      questions: [],
      plan: { ...readyPlan, steps: [] },
    }

    expect(validateOutlinePlanProtocol(base, chapterElements).kind).toBe("invalid")
    expect(validateOutlinePlanProtocol({
      ...base,
      plan: { ...readyPlan, files: [] },
    }, chapterElements).kind).toBe("invalid")
    expect(validateOutlinePlanProtocol({
      ...base,
      plan: undefined,
    }, chapterElements).kind).toBe("invalid")
  })

  it("passes ready through when every required element is satisfied", () => {
    const result = validateOutlinePlanProtocol({
      status: "ready",
      module: "章节细纲",
      elements: satisfyAll(),
      missing: [],
      questions: [],
      plan: readyPlan,
    }, chapterElements)

    expect(result.kind).toBe("ready")
  })

  it("downgrades ready to needs_input when required elements are still missing", () => {
    const elements = satisfyAll().filter((element) => element.key !== "chapterGoal")
    const result = validateOutlinePlanProtocol({
      status: "ready",
      module: "章节细纲",
      elements,
      missing: [],
      questions: [],
      plan: readyPlan,
    }, chapterElements)

    expect(result.kind).toBe("needs_input")
    if (result.kind !== "needs_input") return
    expect(result.downgraded).toBe(true)
    expect(result.protocol.plan).toBeUndefined()
    expect(result.protocol.missing).toContain("本章目标")
    expect(result.protocol.questions).toHaveLength(1)
    expect(result.protocol.questions[0].key).toBe("chapterGoal")
    const options = result.protocol.questions[0].options
    expect(options.filter((option) => option.id !== OUTLINE_PLAN_CUSTOM_OPTION_ID).length)
      .toBeGreaterThanOrEqual(3)
    expect(options.at(-1)?.id).toBe(OUTLINE_PLAN_CUSTOM_OPTION_ID)
  })

  it("caps a downgrade to at most four questions per round", () => {
    const result = validateOutlinePlanProtocol({
      status: "ready",
      module: "章节细纲",
      elements: [],
      missing: [],
      questions: [],
      plan: readyPlan,
    }, chapterElements)

    expect(result.kind).toBe("needs_input")
    if (result.kind !== "needs_input") return
    expect(result.protocol.questions).toHaveLength(4)
    expect(result.protocol.missing.length).toBeGreaterThan(4)
  })

  it("ignores optional elements when checking sufficiency", () => {
    const elements = satisfyAll().filter((element) => element.key !== "chapterPosition")
    const result = validateOutlinePlanProtocol({
      status: "ready",
      module: "章节细纲",
      elements,
      missing: [],
      questions: [],
      plan: readyPlan,
    }, chapterElements)

    expect(result.kind).toBe("ready")
  })

  it("matches elements by label as well as by key", () => {
    const volumeElements = getOutlinePlanRequiredElements("卷纲")
    const protocol: OutlinePlanProtocol = {
      status: "ready",
      module: "卷纲",
      elements: volumeElements.map((spec) => ({
        key: spec.label,
        value: "已确认",
        source: "project" as const,
        satisfied: true,
      })),
      missing: [],
      questions: [],
      plan: readyPlan,
    }

    expect(findUnsatisfiedOutlinePlanElements(protocol, volumeElements)).toEqual([])
    expect(validateOutlinePlanProtocol(protocol, volumeElements).kind).toBe("ready")
  })
})

describe("outline plan prompts", () => {
  it("lists every element in the phase system rules and forbids body generation", () => {
    const rules = buildOutlinePlanPhaseSystemRules("章节细纲", chapterElements)

    expect(rules).toContain("本轮禁止生成大纲正文")
    expect(rules).toContain("禁止输出 intent_clarity")
    expect(rules).toContain(OUTLINE_PLAN_MARKER_OPEN)
    expect(rules).toContain(OUTLINE_PLAN_MARKER_CLOSE)
    expect(rules).toContain("章纲")
    for (const spec of chapterElements) {
      expect(rules).toContain(spec.key)
    }
  })

  it("builds the first round element check prompt from the module request hint", () => {
    const prompt = buildOutlinePlanElementCheckPrompt({
      module: "人物小传",
      requestHint: "整理主要人物的小传",
      originalRequest: "帮我补人物",
    })

    expect(prompt).toContain("人物小传")
    expect(prompt).toContain("整理主要人物的小传")
    expect(prompt).toContain("帮我补人物")
  })

  it("carries answers and previously confirmed elements into the follow-up prompt", () => {
    const prompt = buildOutlinePlanClarifyAnswerPrompt({
      module: "章节细纲",
      answers: [{ key: "chapterRange", label: "章节范围", question: "写到第几章？", value: "第 11-15 章" }],
      collected: [{ key: "pov", value: "第三人称", source: "project", satisfied: true }],
    })

    expect(prompt).toContain("章节范围：第 11-15 章")
    expect(prompt).toContain("pov：第三人称（来源：project）")
    expect(prompt).toContain("重新判断是否还有必填要素缺失")
  })

  it("renders the plan as markdown for the card and the edit box", () => {
    const markdown = formatOutlinePlanMarkdown(readyPlan)

    expect(markdown).toContain("## 方案概要")
    expect(markdown).toContain("1. 读取卷纲：确认本卷目标")
    expect(markdown).toContain("- 章纲/章纲_第11章.md（chapter-outline、create）")
    expect(markdown).toContain("## 生成顺序")
    expect(markdown).toContain("- 时间线可能断裂")
    expect(markdown).not.toContain("## 遗留问题")
  })

  it("builds an execution prompt that blocks another planning round", () => {
    const prompt = buildOutlinePlanExecutionPrompt({
      module: "章节细纲",
      planText: formatOutlinePlanMarkdown(readyPlan),
      elements: [{ key: "chapterRange", value: "第 11-15 章", source: "user", satisfied: true }],
    })

    expect(prompt).toContain("生成计划已确认")
    expect(prompt).toContain("=== 已确认的生成计划 ===")
    expect(prompt).toContain("chapterRange：第 11-15 章")
    expect(prompt).toContain(`禁止再输出 ${OUTLINE_PLAN_MARKER_OPEN}`)
    expect(prompt).toContain("outlineSaveRequest")
  })
})

describe("stripOutlinePlanMarkers", () => {
  it("removes complete blocks, streaming leftovers and bare closing markers", () => {
    expect(stripOutlinePlanMarkers(`前文${wrap({ status: "ready" })}后文`)).toBe("前文后文")
    expect(stripOutlinePlanMarkers(`前文${OUTLINE_PLAN_MARKER_OPEN}\n{"status":"rea`)).toBe("前文")
    expect(stripOutlinePlanMarkers(`前文${OUTLINE_PLAN_MARKER_CLOSE}后文`)).toBe("前文后文")
  })
})
