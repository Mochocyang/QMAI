import { describe, expect, it, vi } from "vitest"
import { getOutlinePlanRequiredElements } from "./outline-plan-elements"
import {
  OUTLINE_PLAN_MARKER_CLOSE,
  OUTLINE_PLAN_MARKER_OPEN,
  type OutlinePlanProtocol,
} from "./outline-plan-protocol"
import { resolveOutlinePlanProtocol } from "./outline-plan-repair"

const required = getOutlinePlanRequiredElements("章节细纲")

function wrap(payload: unknown): string {
  return `${OUTLINE_PLAN_MARKER_OPEN}\n${JSON.stringify(payload)}\n${OUTLINE_PLAN_MARKER_CLOSE}`
}

function allSatisfied() {
  return required.map((spec) => ({
    key: spec.key,
    value: `已确认-${spec.label}`,
    source: "user" as const,
    satisfied: true,
  }))
}

const READY_PLAN = {
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
  risks: [],
  openQuestions: [],
}

function readyReply(): string {
  return wrap({
    status: "ready",
    module: "章节细纲",
    elements: allSatisfied(),
    missing: [],
    questions: [],
    plan: READY_PLAN,
  })
}

/** ready 但没有任何生成步骤：闸门判 invalid。 */
function planWithoutSteps(): string {
  return wrap({
    status: "ready",
    module: "章节细纲",
    elements: allSatisfied(),
    missing: [],
    questions: [],
    plan: { ...READY_PLAN, steps: [] },
  })
}

const base = {
  module: "章节细纲",
  required,
  llmConfig: {} as never,
  signal: new AbortController().signal,
}

describe("resolveOutlinePlanProtocol", () => {
  it("合格计划零额外调用", async () => {
    const repair = vi.fn(async () => "")
    const topUp = vi.fn(async () => "")
    const gate = await resolveOutlinePlanProtocol({ ...base, text: readyReply(), repair, topUp })
    expect(gate.validation.kind).toBe("ready")
    expect(gate.notice).toBe("")
    expect(repair).not.toHaveBeenCalled()
    expect(topUp).not.toHaveBeenCalled()
  })

  it("缺生成步骤时先补齐一轮，补齐成功就用新协议", async () => {
    const topUp = vi.fn(async ({ error }: { error: string }) => {
      expect(error).toContain("生成步骤")
      return readyReply()
    })
    const gate = await resolveOutlinePlanProtocol({
      ...base,
      text: planWithoutSteps(),
      repair: async () => "",
      topUp,
    })
    expect(topUp).toHaveBeenCalledTimes(1)
    expect(gate.validation.kind).toBe("ready")
    expect(gate.notice).toBe("")
  })

  it("补齐仍不合格就降级成追问（不整轮作废），并按必填要素生成兜底问题", async () => {
    const gate = await resolveOutlinePlanProtocol({
      ...base,
      text: planWithoutSteps(),
      repair: async () => "",
      topUp: async () => planWithoutSteps(),
    })
    expect(gate.validation.kind).toBe("needs_input")
    if (gate.validation.kind !== "needs_input") return
    expect(gate.validation.downgraded).toBe(true)
    expect(gate.validation.protocol.questions.length).toBeGreaterThan(0)
    expect(gate.validation.protocol.plan).toBeUndefined()
    expect(gate.notice).toContain("已按现有内容展示")
  })

  it("降级时优先保留模型自己给的可用追问，丢掉选项不足的那个", async () => {
    const mixedQuestions = wrap({
      status: "needs_input",
      module: "章节细纲",
      elements: allSatisfied(),
      missing: [],
      questions: [
        {
          id: "q1",
          key: "chapterRange",
          question: "这一批写到哪一章",
          multiple: false,
          options: [
            { id: "A", label: "第 11-12 章", description: "" },
            { id: "B", label: "第 11-15 章", description: "" },
            { id: "C", label: "第 11-20 章", description: "" },
          ],
        },
        {
          id: "q2",
          key: "chapterGoal",
          question: "这一卷要达成什么",
          multiple: false,
          options: [
            { id: "A", label: "收掉线索", description: "" },
            { id: "B", label: "开新线", description: "" },
            // 只有 2 个真实选项 → 整份协议判 invalid
          ],
        },
      ],
    })
    const gate = await resolveOutlinePlanProtocol({
      ...base,
      text: mixedQuestions,
      repair: async () => "",
      topUp: async () => "",
    })
    expect(gate.validation.kind).toBe("needs_input")
    if (gate.validation.kind !== "needs_input") return
    expect(gate.validation.protocol.questions.map((q) => q.id)).toEqual(["q1"])
    expect(gate.notice).toContain("已按现有内容展示")
  })

  it("完全没有协议时先补协议，补不出来才报错（正文由调用方保留）", async () => {
    const gate = await resolveOutlinePlanProtocol({
      ...base,
      text: "一".repeat(200),
      repair: async () => "",
      topUp: async () => "",
    })
    expect(gate.validation.kind).toBe("invalid")
    if (gate.validation.kind !== "invalid") return
    expect(gate.validation.error).toContain("outline_plan")
    expect(gate.notice).toBe("")
  })

  it("回复太短时不做无谓的重试", async () => {
    const repair = vi.fn(async () => "")
    const gate = await resolveOutlinePlanProtocol({
      ...base,
      text: "好的",
      repair,
      topUp: async () => "",
    })
    expect(repair).not.toHaveBeenCalled()
    expect(gate.validation.kind).toBe("invalid")
  })
})

describe("degradeOutlinePlanToQuestions（经 resolve 间接覆盖）", () => {
  it("缺文件清单也能降级成追问，plan 字段被清掉", async () => {
    const withoutFiles = wrap({
      status: "ready",
      module: "章节细纲",
      elements: allSatisfied(),
      missing: [],
      questions: [],
      plan: { ...READY_PLAN, files: [] },
    })
    const gate = await resolveOutlinePlanProtocol({
      ...base,
      text: withoutFiles,
      repair: async () => "",
      topUp: async () => withoutFiles,
    })
    expect(gate.validation.kind).toBe("needs_input")
    if (gate.validation.kind !== "needs_input") return
    const protocol = gate.validation.protocol as OutlinePlanProtocol
    expect(protocol.plan).toBeUndefined()
    expect(protocol.questions.length).toBeGreaterThan(0)
  })
})
