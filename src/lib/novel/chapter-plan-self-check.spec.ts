import { describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import {
  buildChapterPlanSelfCheckPrompt,
  buildChapterPlanRevisionPrompt,
  parseChapterPlanSelfCheckResult,
  runChapterPlanRevision,
  runChapterPlanSelfCheck,
} from "./chapter-plan-self-check"

const streamChatMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/llm-client", () => ({
  streamChat: streamChatMock,
}))

const llmConfig: LlmConfig = {
  provider: "custom",
  apiKey: "test-key",
  model: "test-model",
  ollamaUrl: "",
  customEndpoint: "https://example.test/v1",
  maxContextSize: 120000,
}

describe("chapter-plan-self-check", () => {
  it("builds a prompt that checks Codex-style plan completeness and includes the source plan", () => {
    const prompt = buildChapterPlanSelfCheckPrompt("维度四·场景序列编排：旧屋揭示")

    expect(prompt).toContain("计划自检")
    expect(prompt).not.toContain("蓝图")
    expect(prompt).not.toContain("七个维度")
    for (const section of [
      "本章目标",
      "已知依据",
      "执行边界",
      "分场景执行计划",
      "信息流与伏笔",
      "验收标准",
      "风险与兜底",
    ]) {
      expect(prompt).toContain(section)
    }
    expect(prompt).toContain("维度四·场景序列编排：旧屋揭示")
    expect(prompt).toContain("目的、冲突、转折、输出结果、验收标准")
    expect(prompt).toContain("缺失段落、缺失场景字段或不可验收的标准必须进入 issues")
    expect(prompt).toContain("对话目标")
    expect(prompt).toContain("水文")
    expect(prompt).toContain("只输出一个 JSON 对象")
    expect(prompt.length).toBeLessThan(1100)
  })

  it("includes compressed project context when provided", () => {
    const prompt = buildChapterPlanSelfCheckPrompt("维度四·场景序列编排：旧屋揭示", {
      chapterGoal: "第8章目标：旧屋揭示族谱缺页。",
      characterStates: "主角谨慎，不知道族谱已被换。",
      cognitionStates: "主角不知道族谱已经被换过。",
      foreshadowingStates: "旧钥匙、族谱缺页未回收。",
      timeline: "雨夜，当晚十点。",
      canonRules: "主角不能凭空知道旧屋主人身份。",
      mustAvoid: "不要提前揭露旧屋主人身份。",
    })

    expect(prompt).toContain("项目上下文核对资料")
    expect(prompt).toContain("第8章目标：旧屋揭示族谱缺页。")
    expect(prompt).toContain("主角不知道族谱已经被换过。")
    expect(prompt).toContain("旧钥匙、族谱缺页未回收。")
  })

  it("parses structured self-check JSON", () => {
    const parsed = parseChapterPlanSelfCheckResult(JSON.stringify({
      status: "warning",
      summary: "计划基本可用，但缺少字数预算。",
      issues: [
        { severity: "warning", problem: "缺少字数预算", risk: "正文篇幅可能失控", suggestion: "补充每个场景的篇幅分配" },
      ],
    }))

    expect(parsed.status).toBe("warning")
    expect(parsed.issues).toHaveLength(1)
    expect(parsed.formattedText).toContain("状态：warning")
    expect(parsed.formattedText).toContain("缺少字数预算")
  })

  it("falls back to raw text when the model does not return JSON", () => {
    const parsed = parseChapterPlanSelfCheckResult("自检通过：场景序列完整")

    expect(parsed.status).toBe("unknown")
    expect(parsed.formattedText).toBe("自检通过：场景序列完整")
  })

  it("runs the self-check model call and returns streamed text", async () => {
    streamChatMock.mockImplementationOnce(async (_config, messages, callbacks) => {
      expect(messages[0].content).toContain("计划自检")
      callbacks.onToken('{"status":"pass","summary":"计划可执行","issues":[]}')
      callbacks.onDone()
    })

    await expect(runChapterPlanSelfCheck(llmConfig, "维度四·场景序列编排：旧屋揭示"))
      .resolves.toBe("状态：pass\n计划可执行")
  })

  it("builds a revision prompt from plan and self-check result", () => {
    const prompt = buildChapterPlanRevisionPrompt(
      "原计划",
      "状态：warning\n1. [warning] 缺少字数预算\n建议：补充篇幅分配",
    )

    expect(prompt).toContain("计划修订助手")
    expect(prompt).toContain("原计划")
    expect(prompt).not.toContain("蓝图")
    expect(prompt).toContain("缺少字数预算")
    expect(prompt).toContain("分场景执行计划")
    expect(prompt).toContain("验收标准")
    expect(prompt).toContain("风险与兜底")
    expect(prompt).toContain("对话目标")
    expect(prompt).toContain("只输出修订后的章节计划")
    expect(prompt.length).toBeLessThan(520)
  })

  it("runs plan revision and returns the revised plan", async () => {
    streamChatMock.mockImplementationOnce(async (_config, messages, callbacks) => {
      expect(messages[0].content).toContain("计划修订助手")
      callbacks.onToken("修订后计划")
      callbacks.onDone()
    })

    await expect(runChapterPlanRevision(llmConfig, "原计划", "自检建议"))
      .resolves.toBe("修订后计划")
  })
})
