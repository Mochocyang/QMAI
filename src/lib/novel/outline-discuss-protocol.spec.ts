import { describe, expect, it } from "vitest"
import {
  OUTLINE_DISCUSS_CUSTOM_OPTION_ID,
  OUTLINE_DISCUSS_MARKER_CLOSE,
  OUTLINE_DISCUSS_MARKER_OPEN,
  buildOutlineDiscussAnswerPrompt,
  buildOutlineDiscussExecutionPrompt,
  buildOutlineDiscussPhaseSystemRules,
  findLatestOutlineDiscussProtocol,
  isOutlineDiscussFinalizeRequest,
  isOutlineDiscussProtocol,
  parseOutlineDiscussProtocol,
  stripOutlineDiscussMarkers,
  validateOutlineDiscussProtocol,
} from "./outline-discuss-protocol"

function wrap(payload: unknown): string {
  return `${OUTLINE_DISCUSS_MARKER_OPEN}\n${JSON.stringify(payload)}\n${OUTLINE_DISCUSS_MARKER_CLOSE}`
}

function twoOptions() {
  return [
    { id: "A", label: "明线复仇", description: "更狠" },
    { id: "B", label: "暗线布局", description: "更稳" },
  ]
}

describe("parseOutlineDiscussProtocol", () => {
  it("returns none when the marker is absent", () => {
    expect(parseOutlineDiscussProtocol("普通回复内容").kind).toBe("none")
  })

  it("parses a well formed protocol block", () => {
    const outcome = parseOutlineDiscussProtocol(wrap({
      status: "ready",
      module: "章节细纲",
      judgment: "第45章冲突已经够用",
      nextStep: "确认后开写",
      decisions: [],
      agreed: [{ id: "a1", question: "开场钩子", value: "仇人登门" }],
    }))

    expect(outcome.kind).toBe("valid")
    if (outcome.kind !== "valid") return
    expect(outcome.protocol.status).toBe("ready")
    expect(outcome.protocol.module).toBe("章节细纲")
    expect(outcome.protocol.agreed[0].value).toBe("仇人登门")
  })

  it("recovers a truncated block that lost its closing marker", () => {
    const outcome = parseOutlineDiscussProtocol(
      `${OUTLINE_DISCUSS_MARKER_OPEN}\n${JSON.stringify({
        status: "needs_decision",
        module: "卷纲",
        judgment: "第二卷节奏偏慢",
      })}`,
    )

    expect(outcome.kind).toBe("valid")
    if (outcome.kind !== "valid") return
    expect(outcome.protocol.status).toBe("needs_decision")
  })

  it("rejects an unclosed block that still has trailing content", () => {
    expect(parseOutlineDiscussProtocol(
      `${OUTLINE_DISCUSS_MARKER_OPEN}\n{"status":"ready"}\n后面还有别的正文`,
    )).toEqual({
      kind: "invalid",
      error: "共创协议缺少闭合标记且 JSON 后仍有额外内容",
    })
  })

  it("rejects unparsable json", () => {
    expect(parseOutlineDiscussProtocol(
      `${OUTLINE_DISCUSS_MARKER_OPEN}\n{status: ready}\n${OUTLINE_DISCUSS_MARKER_CLOSE}`,
    ).kind).toBe("invalid")
  })

  it("rejects a missing or unknown status", () => {
    expect(parseOutlineDiscussProtocol(wrap({ module: "卷纲" })).kind).toBe("invalid")
    expect(parseOutlineDiscussProtocol(wrap({ status: "needs_input" })).kind).toBe("invalid")
  })

  it("appends a custom input option to every decision", () => {
    const outcome = parseOutlineDiscussProtocol(wrap({
      status: "needs_decision",
      module: "章节细纲",
      decisions: [{
        id: "d1",
        question: "这章用什么钩子？",
        options: twoOptions(),
        preferenceId: "A",
        preferenceReason: "更有冲突",
      }],
    }))

    expect(outcome.kind).toBe("valid")
    if (outcome.kind !== "valid") return
    const options = outcome.protocol.decisions[0].options
    expect(options).toHaveLength(3)
    expect(options[2].id).toBe(OUTLINE_DISCUSS_CUSTOM_OPTION_ID)
    expect(options[2].label).toBe("其它（我来补充描述）")
  })

  it("keeps a model supplied custom option at the end without duplicating it", () => {
    const outcome = parseOutlineDiscussProtocol(wrap({
      status: "needs_decision",
      module: "章节细纲",
      decisions: [{
        id: "d1",
        question: "这章用什么钩子？",
        options: [
          { id: "CUSTOM", label: "自己写" },
          ...twoOptions(),
        ],
        preferenceId: "A",
        preferenceReason: "更有冲突",
      }],
    }))

    expect(outcome.kind).toBe("valid")
    if (outcome.kind !== "valid") return
    const options = outcome.protocol.decisions[0].options
    expect(options).toHaveLength(3)
    expect(options.filter((option) => option.id === OUTLINE_DISCUSS_CUSTOM_OPTION_ID)).toHaveLength(1)
    expect(options[2].label).toBe("自己写")
  })
})

describe("validateOutlineDiscussProtocol", () => {
  it("rejects needs_decision without any decision", () => {
    expect(validateOutlineDiscussProtocol({
      status: "needs_decision",
      module: "章节细纲",
      judgment: "还缺拍板",
      nextStep: "先选钩子",
      decisions: [],
      agreed: [],
    }).kind).toBe("invalid")
  })

  it("rejects a decision with fewer than two real options", () => {
    const result = validateOutlineDiscussProtocol({
      status: "needs_decision",
      module: "章节细纲",
      judgment: "还缺拍板",
      nextStep: "先选钩子",
      decisions: [{
        id: "d1",
        question: "这章用什么钩子？",
        options: [
          { id: "A", label: "仇人登门", description: "" },
          { id: OUTLINE_DISCUSS_CUSTOM_OPTION_ID, label: "其它（我来补充描述）", description: "" },
        ],
        preferenceId: "A",
        preferenceReason: "更狠",
      }],
      agreed: [],
    })

    expect(result.kind).toBe("invalid")
    if (result.kind !== "invalid") return
    expect(result.error).toContain("可选项少于 2")
  })

  it("rejects a decision without a valid preference", () => {
    const result = validateOutlineDiscussProtocol({
      status: "needs_decision",
      module: "章节细纲",
      judgment: "还缺拍板",
      nextStep: "先选钩子",
      decisions: [{
        id: "d1",
        question: "这章用什么钩子？",
        options: [
          ...twoOptions(),
          { id: OUTLINE_DISCUSS_CUSTOM_OPTION_ID, label: "其它（我来补充描述）", description: "" },
        ],
        preferenceId: "CUSTOM",
        preferenceReason: "让作者自己想",
      }],
      agreed: [],
    })

    expect(result.kind).toBe("invalid")
    if (result.kind !== "invalid") return
    expect(result.error).toContain("没有标出有效的 AI 倾向")
  })

  it("rejects ready without judgment", () => {
    expect(validateOutlineDiscussProtocol({
      status: "ready",
      module: "章节细纲",
      judgment: "  ",
      nextStep: "可以开写",
      decisions: [],
      agreed: [],
    }).kind).toBe("invalid")
  })

  it("accepts a valid needs_decision protocol", () => {
    const result = validateOutlineDiscussProtocol({
      status: "needs_decision",
      module: "章节细纲",
      judgment: "第45章缺一个开场选择",
      nextStep: "先定钩子",
      decisions: [{
        id: "d1",
        question: "这章用什么钩子？",
        options: [
          ...twoOptions(),
          { id: OUTLINE_DISCUSS_CUSTOM_OPTION_ID, label: "其它（我来补充描述）", description: "" },
        ],
        preferenceId: "A",
        preferenceReason: "冲突来得更快",
      }],
      agreed: [],
    })

    expect(result.kind).toBe("needs_decision")
  })

  it("accepts ready with judgment and no new decisions", () => {
    const result = validateOutlineDiscussProtocol({
      status: "ready",
      module: "章节细纲",
      judgment: "冲突和人物动机已经对齐",
      nextStep: "确认后开写",
      decisions: [],
      agreed: [{ id: "a1", question: "开场钩子", value: "仇人登门" }],
    })

    expect(result.kind).toBe("ready")
  })
})

describe("stripOutlineDiscussMarkers", () => {
  it("strips complete, truncated and leftover markers", () => {
    expect(stripOutlineDiscussMarkers(`前文${wrap({ status: "ready" })}后文`)).toBe("前文后文")
    expect(stripOutlineDiscussMarkers(`前文${OUTLINE_DISCUSS_MARKER_OPEN}\n{"status":"rea`)).toBe("前文")
    expect(stripOutlineDiscussMarkers(`前文${OUTLINE_DISCUSS_MARKER_CLOSE}后文`)).toBe("前文后文")
  })
})

describe("isOutlineDiscussProtocol", () => {
  it("keeps a structurally complete protocol", () => {
    expect(isOutlineDiscussProtocol({
      status: "needs_decision",
      module: "章节细纲",
      judgment: "判断",
      nextStep: "下一步",
      decisions: [{
        id: "d1",
        question: "钩子？",
        options: [{ id: "A", label: "仇人登门" }],
        preferenceId: "A",
        preferenceReason: "狠",
      }],
      agreed: [{ id: "a1", question: "视角", value: "主角" }],
    })).toBe(true)
  })

  it("rejects incomplete persisted payloads", () => {
    expect(isOutlineDiscussProtocol(null)).toBe(false)
    expect(isOutlineDiscussProtocol({
      status: "needs_input",
      module: "章节细纲",
      judgment: "",
      nextStep: "",
      decisions: [],
      agreed: [],
    })).toBe(false)
    expect(isOutlineDiscussProtocol({
      status: "ready",
      module: "",
      judgment: "判断",
      nextStep: "",
      decisions: [],
      agreed: [],
    })).toBe(false)
    expect(isOutlineDiscussProtocol({
      status: "ready",
      module: "章节细纲",
      judgment: "判断",
      nextStep: "",
      decisions: [{ question: 1 }],
      agreed: [],
    })).toBe(false)
  })
})

describe("discuss prompt builders", () => {
  it("requires the discuss protocol and forbids plan or intent gates", () => {
    const rules = buildOutlineDiscussPhaseSystemRules("章节细纲")
    expect(rules).toContain("## 本轮阶段：共创讨论")
    expect(rules).toContain("outline_discuss")
    expect(rules).toContain("preferenceId")
    expect(rules).not.toContain("intent_clarity -->")
    expect(rules).not.toContain("<!-- outline_plan -->")
  })

  it("feeds selected answers back as agreed items", () => {
    const prompt = buildOutlineDiscussAnswerPrompt({
      module: "章节细纲",
      answers: [{ id: "d1", question: "开场钩子", value: "仇人登门" }],
      agreed: [{ id: "a1", question: "视角", value: "主角" }],
    })
    expect(prompt).toContain("本次拍板")
    expect(prompt).toContain("开场钩子：仇人登门")
    expect(prompt).toContain("之前已拍板")
    expect(prompt).toContain("视角：主角")
  })

  it("turns finalized discussion into a generation prompt", () => {
    const prompt = buildOutlineDiscussExecutionPrompt({
      module: "章节细纲",
      judgment: "冲突已经够用",
      agreed: [{ id: "a1", question: "开场钩子", value: "仇人登门" }],
    })
    expect(prompt).toContain("已经定稿")
    expect(prompt).toContain("禁止再输出")
    expect(prompt).toContain("outlineSaveRequest")
    expect(prompt).toContain("开场钩子：仇人登门")
  })
})

describe("finalize request detection", () => {
  it("treats short confirmation phrases as finalize", () => {
    expect(isOutlineDiscussFinalizeRequest("定稿")).toBe(true)
    expect(isOutlineDiscussFinalizeRequest("就按这个写")).toBe(true)
    expect(isOutlineDiscussFinalizeRequest("可以了")).toBe(true)
    expect(isOutlineDiscussFinalizeRequest("开始生成")).toBe(true)
  })

  it("does not treat ordinary discussion as finalize", () => {
    expect(isOutlineDiscussFinalizeRequest("主角动机还是站不住，可以再讨论一下")).toBe(false)
    expect(isOutlineDiscussFinalizeRequest("")).toBe(false)
  })
})

describe("findLatestOutlineDiscussProtocol", () => {
  it("returns the last attached discuss protocol", () => {
    expect(findLatestOutlineDiscussProtocol([
      { outlineDiscussProtocol: null },
      {
        outlineDiscussProtocol: {
          status: "needs_decision",
          module: "章节细纲",
          judgment: "先定钩子",
          nextStep: "拍板",
          decisions: [],
          agreed: [],
        },
      },
      {
        outlineDiscussProtocol: {
          status: "ready",
          module: "章节细纲",
          judgment: "可以开写",
          nextStep: "定稿",
          decisions: [],
          agreed: [],
        },
      },
    ])?.status).toBe("ready")
  })
})
