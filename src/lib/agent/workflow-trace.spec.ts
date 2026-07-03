import { describe, expect, it } from "vitest"
import { buildAgentWorkflowSteps, getWorkflowToolDescription, type WorkflowToolCall } from "./workflow-trace"
import type { ContextTrace } from "./context-trace"

function call(overrides: Partial<WorkflowToolCall> & Pick<WorkflowToolCall, "id" | "name">): WorkflowToolCall {
  return {
    params: {},
    result: "",
    status: "done",
    startedAt: 0,
    finishedAt: 10,
    ...overrides,
  }
}

describe("buildAgentWorkflowSteps", () => {
  it("groups list tools into one context summary instead of repeating rows", () => {
    const steps = buildAgentWorkflowSteps({
      toolCalls: [
        call({ id: "list-1", name: "list_chapters" }),
        call({ id: "list-2", name: "list_outlines" }),
        call({ id: "list-3", name: "list_memories" }),
      ],
    })

    const context = steps.find((step) => step.kind === "context")

    expect(context?.summary).toContain("已整理资料范围")
    expect(context?.details.filter((detail) => detail.value.includes("资料范围"))).toHaveLength(1)
  })

  it("shows concrete read targets for chapters outlines and memories", () => {
    const steps = buildAgentWorkflowSteps({
      toolCalls: [
        call({ id: "chapter", name: "read_chapter", params: { name: "chapter-017" } }),
        call({ id: "outline", name: "read_outline", params: { path: "E:/QM-BOOK/01/wiki/outlines/总大纲.md" } }),
        call({ id: "memory", name: "read_memory", params: { name: "character-states" } }),
      ],
    })

    const details = steps.find((step) => step.kind === "context")?.details.map((detail) => detail.value).join("\n")

    expect(details).toContain("读取章节《chapter-017》")
    expect(details).toContain("读取大纲《总大纲.md》")
    expect(details).toContain("读取记忆「character-states」")
  })

  it("marks context as running when a read call is still running", () => {
    const steps = buildAgentWorkflowSteps({
      toolCalls: [
        call({ id: "chapter", name: "read_chapter", params: { name: "chapter-017" }, status: "running" }),
      ],
    })

    const context = steps.find((step) => step.kind === "context")

    expect(context?.status).toBe("running")
    expect(context?.summary).toBe("正在读取章节《chapter-017》。")
  })

  it("marks tool stage as approval required for write drafts", () => {
    const steps = buildAgentWorkflowSteps({
      toolCalls: [
        call({
          id: "write",
          name: "write_outline_node",
          params: { outlineName: "分卷细纲", nodeTitle: "第18章" },
          status: "approval_required",
        }),
      ],
    })

    const tool = steps.find((step) => step.kind === "tool")
    const decision = steps.find((step) => step.kind === "decision")

    expect(tool?.status).toBe("approval_required")
    expect(tool?.summary).toContain("等待确认")
    expect(tool?.details.map((detail) => detail.value).join("\n")).toContain("生成大纲节点写入草稿「第18章」到「分卷细纲」")
    expect(decision?.summary).toContain("等待用户确认")
  })

  it("uses context trace result protocol for validation", () => {
    const trace: ContextTrace = {
      id: "trace-1",
      startedAt: 0,
      finishedAt: 100,
      status: "done",
      toolCalls: [],
      contextInfo: {
        intent: "generate_outline",
        confidence: 0.92,
        routeSource: "project",
        loadedSources: [],
        blockedSources: [],
        retrievalHits: [],
        trimmedSections: [],
        resultProtocol: {
          type: "outline",
          valid: true,
          warnings: [],
          errors: [],
          validatedAt: 100,
        },
      },
    }

    const steps = buildAgentWorkflowSteps({ contextTrace: trace })

    expect(steps.find((step) => step.kind === "intent")?.summary).toContain("生成大纲")
    expect(steps.find((step) => step.kind === "validation")?.summary).toContain("outline")
  })
})

describe("getWorkflowToolDescription", () => {
  it("does not expose undefined when params are missing", () => {
    expect(getWorkflowToolDescription(call({ id: "chapter", name: "read_chapter" }))).toBe("读取章节")
    expect(getWorkflowToolDescription(call({ id: "memory", name: "read_memory" }))).toBe("读取记忆")
  })
})
