import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import { streamChat } from "@/lib/llm-client"
import {
  buildChapterExecutionContractPrompt,
  contractToTaskBriefText,
  fallbackParseChapterExecutionContract,
  parseChapterExecutionContractJson,
  runChapterExecutionContractBuild,
} from "./chapter-execution-contract"

vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(),
}))

const mockLlmConfig: LlmConfig = {
  provider: "openai",
  apiKey: "test-key",
  model: "test-model",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 8192,
}

describe("chapter execution contract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("buildChapterExecutionContractPrompt 要求输出完整 ChapterExecutionContract JSON", () => {
    const prompt = buildChapterExecutionContractPrompt("## 本章策划案\nS1：旧屋门口\n- 输出结果：主角进入旧屋")

    expect(prompt).toContain("ChapterExecutionContract")
    expect(prompt).toContain("只输出 JSON")
    expect(prompt).toContain("sceneSteps")
    expect(prompt).toContain("purpose")
    expect(prompt).toContain("conflict")
    expect(prompt).toContain("turn")
    expect(prompt).toContain("requiredOutcome")
    expect(prompt).toContain("acceptanceCriteria")
    expect(prompt).toContain("reveal/hide/mislead/foreshadow")
    expect(prompt).toContain("## 本章策划案")
    expect(prompt).not.toContain("维度一")
  })

  it("parseChapterExecutionContractJson 能解析 fenced 结构化 JSON", () => {
    const contract = parseChapterExecutionContractJson([
      "```json",
      JSON.stringify({
        objective: "推进旧屋线索",
        knownContext: ["上一章听见门缝声"],
        assumptions: ["主角不知道屋主身份"],
        sceneSteps: [
          {
            id: "S1",
            title: "旧屋门口",
            purpose: "承接悬念",
            conflict: "主角想进去，小晴阻止",
            turn: "门内传来第二声响",
            requiredOutcome: "主角进入旧屋",
            acceptanceCriteria: ["出现门缝声承接", "主角进入旧屋"],
          },
        ],
        mustDo: ["推进锈钥匙"],
        mustAvoid: ["不要提前揭露屋主身份"],
        dialogueGoals: ["主角试探小晴"],
        informationFlow: {
          reveal: ["旧屋有新脚印"],
          hide: ["屋主身份"],
          mislead: ["小晴误导主角"],
          foreshadow: ["锈钥匙发热"],
        },
        finalHook: "门外第二串脚步",
        freeSpace: ["可补足环境细节"],
      }),
      "```",
    ].join("\n"))

    expect(contract.objective).toBe("推进旧屋线索")
    expect(contract.knownContext).toEqual(["上一章听见门缝声"])
    expect(contract.assumptions).toEqual(["主角不知道屋主身份"])
    expect(contract.sceneSteps[0]).toMatchObject({
      id: "S1",
      title: "旧屋门口",
      purpose: "承接悬念",
      conflict: "主角想进去，小晴阻止",
      turn: "门内传来第二声响",
      requiredOutcome: "主角进入旧屋",
      acceptanceCriteria: ["出现门缝声承接", "主角进入旧屋"],
    })
    expect(contract.mustDo).toEqual(["推进锈钥匙"])
    expect(contract.mustAvoid).toEqual(["不要提前揭露屋主身份"])
    expect(contract.dialogueGoals).toEqual(["主角试探小晴"])
    expect(contract.informationFlow.reveal).toEqual(["旧屋有新脚印"])
    expect(contract.informationFlow.hide).toEqual(["屋主身份"])
    expect(contract.informationFlow.mislead).toEqual(["小晴误导主角"])
    expect(contract.informationFlow.foreshadow).toEqual(["锈钥匙发热"])
    expect(contract.finalHook).toBe("门外第二串脚步")
    expect(contract.freeSpace).toEqual(["可补足环境细节"])
  })

  it("fallbackParseChapterExecutionContract 能从主编策划案提取场景、风险和结尾钩子", () => {
    const contract = fallbackParseChapterExecutionContract([
      "## 主编策划案",
      "### 1. 本章目标",
      "推进旧屋线索。",
      "S1：旧屋门口",
      "- 目的：承接门缝声。",
      "- 冲突：主角要进屋，小晴阻止。",
      "- 转折：门内传来第二声响。",
      "- 输出结果：主角进入旧屋。",
      "- 验收标准：出现门缝声承接；主角进入旧屋。",
      "S2：堂屋信纸",
      "- 输出结果：发现锈钥匙线索。",
      "- 验收标准：主角必须拿到信纸。",
      "### 7. 结尾钩子",
      "门外传来第二串脚步。",
      "### 8. 风险提醒",
      "- 不要提前揭露屋主身份。",
      "- 禁止只解释设定不行动。",
    ].join("\n"))

    expect(contract.objective).toBe("推进旧屋线索。")
    expect(contract.sceneSteps).toHaveLength(2)
    expect(contract.sceneSteps[0]).toMatchObject({
      id: "S1",
      title: "旧屋门口",
      purpose: "承接门缝声。",
      conflict: "主角要进屋，小晴阻止。",
      turn: "门内传来第二声响。",
      requiredOutcome: "主角进入旧屋。",
      acceptanceCriteria: ["出现门缝声承接", "主角进入旧屋。"],
    })
    expect(contract.sceneSteps[1]).toMatchObject({
      id: "S2",
      title: "堂屋信纸",
      requiredOutcome: "发现锈钥匙线索。",
      acceptanceCriteria: ["主角必须拿到信纸。"],
    })
    expect(contract.mustAvoid).toContain("不要提前揭露屋主身份。")
    expect(contract.mustAvoid).toContain("禁止只解释设定不行动。")
    expect(contract.finalHook).toBe("门外传来第二串脚步。")
  })

  it("contractToTaskBriefText 输出 Codex 风格中文写作任务书", () => {
    const brief = contractToTaskBriefText({
      objective: "推进旧屋线索",
      knownContext: ["上一章听见门缝声"],
      assumptions: [],
      sceneSteps: [
        {
          id: "S1",
          title: "旧屋门口",
          purpose: "承接悬念",
          conflict: "主角想进去，小晴阻止",
          turn: "门内传来第二声响",
          requiredOutcome: "主角进入旧屋",
          acceptanceCriteria: ["出现门缝声承接", "主角进入旧屋"],
        },
      ],
      mustDo: ["推进锈钥匙"],
      mustAvoid: ["不要提前揭露屋主身份"],
      dialogueGoals: ["主角试探小晴"],
      informationFlow: {
        reveal: ["旧屋有新脚印"],
        hide: ["屋主身份"],
        mislead: ["小晴误导主角"],
        foreshadow: ["锈钥匙发热"],
      },
      finalHook: "门外传来第二串脚步。",
      freeSpace: ["可补足环境和心理细节"],
    })

    expect(brief).toContain("## 写作任务书")
    expect(brief).toContain("执行顺序")
    expect(brief).toContain("S1：旧屋门口")
    expect(brief).toContain("完成后状态：主角进入旧屋")
    expect(brief).toContain("必须完成：出现门缝声承接；主角进入旧屋")
    expect(brief).toContain("禁止违背：不要提前揭露屋主身份")
    expect(brief).toContain("章末钩子")
    expect(brief).not.toContain("正文")
  })

  it("runChapterExecutionContractBuild 使用 streamChat 聚合 token 并解析 JSON", async () => {
    const aiResponse = JSON.stringify({
      objective: "推进旧屋线索",
      knownContext: ["上一章听见门缝声"],
      assumptions: [],
      sceneSteps: [
        {
          id: "S1",
          title: "旧屋门口",
          purpose: "承接悬念",
          conflict: "主角想进去，小晴阻止",
          turn: "门内传来第二声响",
          requiredOutcome: "主角进入旧屋",
          acceptanceCriteria: ["完成进入动作"],
        },
      ],
      mustDo: ["推进锈钥匙"],
      mustAvoid: [],
      dialogueGoals: [],
      informationFlow: { reveal: [], hide: [], mislead: [], foreshadow: [] },
      finalHook: "门外第二串脚步",
      freeSpace: ["可补足环境细节"],
    })
    vi.mocked(streamChat).mockImplementationOnce(async (_config, messages, callbacks) => {
      expect(messages.map((message) => message.content).join("\n")).toContain("ChapterExecutionContract")
      callbacks.onToken(aiResponse.slice(0, 20))
      callbacks.onToken(aiResponse.slice(20))
      callbacks.onDone()
    })

    const contract = await runChapterExecutionContractBuild(mockLlmConfig, "## 本章策划案\nS1：旧屋门口")

    expect(streamChat).toHaveBeenCalledOnce()
    expect(contract.objective).toBe("推进旧屋线索")
    expect(contract.sceneSteps[0].title).toBe("旧屋门口")
  })
})
