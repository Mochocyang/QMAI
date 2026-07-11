import { describe, it, expect } from "vitest"
import { buildOutlineStages, type OutlineStageInput } from "./outline-stage-trace"
import type { ToolCallRecord } from "@/lib/agent/tool-events"

function makeToolCall(name: string, status: "done" | "running" = "done"): ToolCallRecord {
  return {
    id: `${name}-1`,
    name,
    params: {},
    status,
    startedAt: Date.now() - 1000,
    finishedAt: status === "done" ? Date.now() : undefined,
  } as ToolCallRecord
}

describe("buildOutlineStages", () => {
  it("无事件时所有阶段为 hidden", () => {
    const input: OutlineStageInput = { toolCalls: [], content: "", isStreaming: false }
    const stages = buildOutlineStages(input)
    expect(stages.every((s) => s.status === "hidden")).toBe(true)
  })

  it("检测到 route_task 后任务理解阶段激活", () => {
    const input: OutlineStageInput = {
      toolCalls: [makeToolCall("route_task")],
      content: "",
      isStreaming: true,
    }
    const stages = buildOutlineStages(input)
    const intentStage = stages.find((s) => s.kind === "intent")
    expect(intentStage?.status).toBe("active")
    const skillStage = stages.find((s) => s.kind === "skill")
    expect(skillStage?.status).toBe("hidden")
  })

  it("检测到 intent_clarity 后范围分析阶段激活", () => {
    const content = `<!-- intent_clarity -->
{"clarity":"clear","module":"章节细纲","analysis":"3章缺细纲","detectedScope":"第1-3章","missingItems":[],"options":[],"question":""}
<!-- /intent_clarity -->`
    const input: OutlineStageInput = {
      toolCalls: [makeToolCall("route_task")],
      content,
      isStreaming: true,
    }
    const stages = buildOutlineStages(input)
    const scopeStage = stages.find((s) => s.kind === "scope")
    expect(scopeStage?.status).toBe("active")
  })

  it("检测到 apply_skill 后技能选择阶段激活，前一阶段变 done", () => {
    const input: OutlineStageInput = {
      toolCalls: [makeToolCall("route_task"), makeToolCall("apply_skill")],
      content: "",
      isStreaming: true,
    }
    const stages = buildOutlineStages(input)
    const intentStage = stages.find((s) => s.kind === "intent")
    const skillStage = stages.find((s) => s.kind === "skill")
    expect(intentStage?.status).toBe("done")
    expect(skillStage?.status).toBe("active")
  })

  it("检测到 read_outline 后上下文准备阶段激活", () => {
    const input: OutlineStageInput = {
      toolCalls: [makeToolCall("route_task"), makeToolCall("read_outline")],
      content: "",
      isStreaming: true,
    }
    const stages = buildOutlineStages(input)
    const ctxStage = stages.find((s) => s.kind === "context")
    expect(ctxStage?.status).toBe("active")
  })

  it("检测到 thinking 块后思考阶段激活", () => {
    const input: OutlineStageInput = {
      toolCalls: [],
      content: "<thinking>正在分析角色动机...</thinking>",
      isStreaming: true,
    }
    const stages = buildOutlineStages(input)
    const thinkingStage = stages.find((s) => s.kind === "thinking")
    expect(thinkingStage?.status).toBe("active")
  })

  it("流结束后所有已激活阶段变为 done", () => {
    const input: OutlineStageInput = {
      toolCalls: [makeToolCall("route_task"), makeToolCall("apply_skill")],
      content: "",
      isStreaming: false,
    }
    const stages = buildOutlineStages(input)
    const activeStages = stages.filter((s) => s.status === "active")
    const doneStages = stages.filter((s) => s.status === "done")
    expect(activeStages.length).toBe(0)
    expect(doneStages.length).toBeGreaterThanOrEqual(2)
  })

  it("任务理解阶段摘要包含工具信息", () => {
    const input: OutlineStageInput = {
      toolCalls: [makeToolCall("route_task", "done")],
      content: "",
      isStreaming: false,
    }
    const stages = buildOutlineStages(input)
    const intentStage = stages.find((s) => s.kind === "intent")
    expect(intentStage?.summary).toBeTruthy()
    expect(intentStage?.summary).toContain("route_task")
  })

  it("范围分析阶段摘要包含模块名", () => {
    const content = `<!-- intent_clarity -->
{"clarity":"clear","module":"章节细纲","analysis":"3章缺细纲","detectedScope":"第1-3章","missingItems":[],"options":[],"question":""}
<!-- /intent_clarity -->`
    const input: OutlineStageInput = {
      toolCalls: [makeToolCall("route_task", "done")],
      content,
      isStreaming: false,
    }
    const stages = buildOutlineStages(input)
    const scopeStage = stages.find((s) => s.kind === "scope")
    expect(scopeStage?.summary).toContain("章节细纲")
  })

  it("上下文准备阶段摘要包含读取文件数", () => {
    const input: OutlineStageInput = {
      toolCalls: [
        makeToolCall("route_task", "done"),
        makeToolCall("read_outline", "done"),
        makeToolCall("read_chapter", "done"),
        makeToolCall("list_outlines", "done"),
      ],
      content: "",
      isStreaming: false,
    }
    const stages = buildOutlineStages(input)
    const ctxStage = stages.find((s) => s.kind === "context")
    expect(ctxStage?.summary).toContain("3")
  })

  it("闭合 thinking 标签提取 thinkingContent 且不标记 streaming", () => {
    const input: OutlineStageInput = {
      toolCalls: [],
      content: "<thinking>正在分析角色动机...</thinking>",
      isStreaming: true,
    }
    const stages = buildOutlineStages(input)
    const thinkingStage = stages.find((s) => s.kind === "thinking")
    expect(thinkingStage?.thinkingContent).toBe("正在分析角色动机...")
    expect(thinkingStage?.thinkingStreaming).toBeFalsy()
    expect(thinkingStage?.status).toBe("active")
  })

  it("流式未闭合 thinking 标签提取 thinkingContent 并标记 streaming", () => {
    const input: OutlineStageInput = {
      toolCalls: [],
      content: "<thinking>正在分析角色动机...",
      isStreaming: true,
    }
    const stages = buildOutlineStages(input)
    const thinkingStage = stages.find((s) => s.kind === "thinking")
    expect(thinkingStage?.thinkingContent).toBe("正在分析角色动机...")
    expect(thinkingStage?.thinkingStreaming).toBe(true)
    expect(thinkingStage?.status).toBe("active")
  })
})
