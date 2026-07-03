import { describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import { createRunChapterWorkflowTool } from "./run-chapter-workflow"

const llmConfig: LlmConfig = {
  provider: "custom",
  apiKey: "test-key",
  model: "test-model",
  ollamaUrl: "",
  customEndpoint: "https://example.test/v1",
  maxContextSize: 120000,
}

describe("createRunChapterWorkflowTool", () => {
  it("wraps deep chapter generation as an auto action tool", async () => {
    const runDeepChapterGeneration = vi.fn(async (_input, callbacks) => {
      callbacks.onWorkflowEvent?.({
        type: "started",
        id: "deep_chapter:chapter_context",
        name: "chapter_context",
        title: "读取上下文",
        timestamp: 100,
      })
      return {
        finalContent: "最终正文",
        taskBrief: "任务书",
        draftContent: "初稿",
        reviewResults: [],
        revised: false,
      }
    })
    const onToolEvent = vi.fn()
    const tool = createRunChapterWorkflowTool({
      projectPath: "E:/Novel",
      llmConfig,
      aiWorkflowMode: "standard",
      runDeepChapterGeneration,
      onToolEvent,
    })

    expect(tool.name).toBe("run_chapter_workflow")
    expect(tool.category).toBe("action")
    expect(tool.permission).toBe("auto")

    const result = await tool.execute({
      intent: "write_chapter",
      userRequest: "生成第3章",
      chapterNumber: 3,
    })

    expect(runDeepChapterGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: "E:/Novel",
        userRequest: "生成第3章",
        chapterNumber: 3,
        aiWorkflowMode: "standard",
      }),
      expect.any(Object),
      undefined,
      undefined,
    )
    expect(onToolEvent).toHaveBeenCalledWith(expect.objectContaining({
      parentCallId: expect.stringContaining("run_chapter_workflow"),
      name: "chapter_context",
    }))
    expect(result).toContain("最终正文")
    expect(result).toContain("任务书")
  })

  it("uses the runner tool call id as parent id for workflow child events", async () => {
    const runDeepChapterGeneration = vi.fn(async (_input, callbacks) => {
      callbacks.onWorkflowEvent?.({
        type: "started",
        id: "deep_chapter:chapter_context",
        name: "chapter_context",
        title: "读取上下文",
        timestamp: 100,
      })
      return {
        finalContent: "最终正文",
        taskBrief: "任务书",
        draftContent: "初稿",
        reviewResults: [],
        revised: false,
      }
    })
    const onToolEvent = vi.fn()
    const tool = createRunChapterWorkflowTool({
      projectPath: "E:/Novel",
      llmConfig,
      aiWorkflowMode: "strict",
      runDeepChapterGeneration,
      onToolEvent,
    })

    await tool.execute(
      { userRequest: "继续第3章" },
      undefined,
      { callId: "agent_tool_call_7", toolName: "run_chapter_workflow" },
    )

    expect(onToolEvent).toHaveBeenCalledWith(expect.objectContaining({
      callId: "agent_tool_call_7:chapter_context",
      parentCallId: "agent_tool_call_7",
      name: "chapter_context",
    }))
  })

  it("forwards workflow child events through the execution context emitter", async () => {
    const runDeepChapterGeneration = vi.fn(async (_input, callbacks) => {
      callbacks.onWorkflowEvent?.({
        type: "started",
        id: "deep_chapter:chapter_context",
        name: "chapter_context",
        title: "读取上下文",
        timestamp: 100,
      })
      return {
        finalContent: "最终正文",
        taskBrief: "任务书",
        draftContent: "初稿",
        reviewResults: [],
        revised: false,
      }
    })
    const tool = createRunChapterWorkflowTool({
      projectPath: "E:/Novel",
      llmConfig,
      aiWorkflowMode: "strict",
      runDeepChapterGeneration,
    })
    const onToolEvent = vi.fn()

    await tool.execute(
      { userRequest: "继续第3章" },
      undefined,
      { callId: "agent_tool_call_8", toolName: "run_chapter_workflow", onToolEvent } as any,
    )

    expect(onToolEvent).toHaveBeenCalledWith(expect.objectContaining({
      callId: "agent_tool_call_8:chapter_context",
      parentCallId: "agent_tool_call_8",
      name: "chapter_context",
    }))
  })

  it("forwards deep chapter activity events through tool execution context", async () => {
    const onActivityEvent = vi.fn()
    const runDeepChapterGeneration = vi.fn(async (_input, callbacks) => {
      callbacks?.onActivityEvent?.({
        id: "activity-1",
        stageId: "read_context",
        kind: "extract_result",
        title: "提取结果",
        content: "上一章结尾：铜铃线索未揭示。",
        timestamp: 100,
      })
      return {
        finalContent: "正文",
        taskBrief: "任务书",
        draftContent: "草稿",
        reviewResults: [],
        revised: false,
      }
    })

    const tool = createRunChapterWorkflowTool({
      projectPath: "C:/Novel",
      llmConfig,
      aiWorkflowMode: "standard",
      runDeepChapterGeneration,
    })

    await tool.execute(
      { userRequest: "生成第14章" },
      undefined,
      { callId: "workflow-1", toolName: "run_chapter_workflow", onActivityEvent },
    )

    expect(onActivityEvent).toHaveBeenCalledWith(expect.objectContaining({
      id: "activity-1",
      stageId: "read_context",
      kind: "extract_result",
    }))
  })
})
