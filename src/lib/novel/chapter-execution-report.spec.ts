import { describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import { streamChat } from "@/lib/llm-client"
import { createEmptyContract } from "./chapter-execution-contract"
import {
  buildChapterExecutionReportPrompt,
  executionReportToToolSummary,
  extractExecutionRepairItems,
  parseChapterExecutionReportJson,
  runChapterExecutionReportCheck,
} from "./chapter-execution-report"

vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(),
}))

const llmConfig: LlmConfig = {
  provider: "custom",
  apiKey: "test-key",
  model: "test-model",
  ollamaUrl: "",
  customEndpoint: "https://example.test/v1",
  maxContextSize: 120000,
}

describe("chapter-execution-report", () => {
  it("builds a checklist report prompt from contract and final content", () => {
    const contract = {
      ...createEmptyContract(),
      objective: "推进旧屋线索",
      sceneSteps: [{
        id: "S1",
        title: "旧屋门口",
        purpose: "承接悬念",
        conflict: "阻止进入",
        turn: "门内响动",
        requiredOutcome: "主角进入旧屋",
        acceptanceCriteria: ["主角进入旧屋"],
      }],
      finalHook: "门外出现第二个人影",
    }

    const prompt = buildChapterExecutionReportPrompt(contract, "最终正文")

    expect(prompt).toContain("逐项验收")
    expect(prompt).toContain("sceneResults")
    expect(prompt).toContain("S1")
    expect(prompt).toContain("主角进入旧屋")
    expect(prompt).toContain("最终正文")
  })

  it("parses report JSON and extracts repair items", () => {
    const report = parseChapterExecutionReportJson(JSON.stringify({
      status: "fail",
      sceneResults: [{
        id: "S2",
        passed: false,
        missing: ["半张族谱误导"],
        evidence: "正文只写信纸，没有误导。",
        repairInstruction: "在 S2 补入族谱误导。",
      }],
      mustDoResults: [],
      mustAvoidResults: [],
      finalHookPassed: false,
      repairItems: ["S2 缺少半张族谱误导", "章末钩子缺失"],
    }))

    expect(report.status).toBe("fail")
    expect(extractExecutionRepairItems(report)).toEqual(["S2 缺少半张族谱误导", "章末钩子缺失"])
  })

  it("formats a short tool summary", () => {
    const summary = executionReportToToolSummary({
      status: "warning",
      sceneResults: [
        { id: "S1", passed: true, missing: [], evidence: "已进入旧屋", repairInstruction: "" },
        { id: "S2", passed: false, missing: ["误导不足"], evidence: "", repairInstruction: "补误导" },
      ],
      mustDoResults: [],
      mustAvoidResults: [],
      finalHookPassed: true,
      repairItems: ["S2 误导不足"],
    })

    expect(summary).toContain("执行状态：有警告")
    expect(summary).toContain("完成场景：S1")
    expect(summary).toContain("待处理偏离项：S2 误导不足")
  })

  it("runs report model call and returns parsed report", async () => {
    vi.mocked(streamChat).mockImplementationOnce(async (_config, messages, callbacks) => {
      expect(messages[0].content).toContain("逐项验收")
      callbacks.onToken(JSON.stringify({
        status: "pass",
        sceneResults: [],
        mustDoResults: [],
        mustAvoidResults: [],
        finalHookPassed: true,
        repairItems: [],
      }))
      callbacks.onDone()
    })

    const report = await runChapterExecutionReportCheck(llmConfig, createEmptyContract(), "最终正文")

    expect(report.status).toBe("pass")
  })
})
