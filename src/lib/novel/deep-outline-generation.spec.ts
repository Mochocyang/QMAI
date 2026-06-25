import { describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import type { ChatMessage, StreamCallbacks } from "@/lib/llm-client"
import {
  runDeepOutlineGeneration,
  type DeepOutlineGenerationDeps,
} from "./deep-outline-generation"

const llmConfig = {
  provider: "custom",
  apiKey: "test-key",
  model: "test-model",
  ollamaUrl: "",
  customEndpoint: "https://example.test/v1",
  maxContextSize: 120000,
  reasoning: { mode: "high" },
} satisfies LlmConfig

function createDeps(): DeepOutlineGenerationDeps {
  return {
    streamChat: vi.fn(async (_config: LlmConfig, messages: ChatMessage[], callbacks: StreamCallbacks) => {
      const prompt = messages.map((message) => String(message.content)).join("\n")
      const content = prompt.includes("自检")
        ? "结论：通过\n大纲承接合理。"
        : prompt.includes("草稿")
          ? "## 第八章细纲\n主角根据上一章线索进入旧屋。"
          : "大纲任务书：承接第七章，生成第八章细纲。"
      callbacks.onToken(content)
      callbacks.onDone()
    }),
  }
}

describe("runDeepOutlineGeneration", () => {
  it("falls back safely when outline context is missing", async () => {
    const deps = createDeps()
    const thinking: string[] = []
    const final: string[] = []

    const result = await runDeepOutlineGeneration(
      {
        llmConfig,
        userRequest: "生成第八章细纲",
        context: undefined as unknown as string,
        historyMessages: undefined,
      },
      {
        onThinking: (content) => thinking.push(content),
        onFinalContent: (content) => final.push(content),
      },
      deps,
    )

    expect(result.finalContent).toContain("第八章细纲")
    expect(final.join("")).toContain("第八章细纲")
    expect(thinking.join("\n")).toContain("阶段1：大纲上下文分析")
    expect(thinking.join("\n")).toContain("未读取到现有大纲或章节上下文")
  })

  it("publishes staged outline thinking and returns the final outline", async () => {
    const deps = createDeps()
    const thinking: string[] = []
    const final: string[] = []

    const result = await runDeepOutlineGeneration(
      {
        llmConfig,
        userRequest: "生成第八章细纲",
        context: "已有大纲：第七章结尾，主角拿到锈钥匙。",
        historyMessages: [],
      },
      {
        onThinking: (content) => thinking.push(content),
        onFinalContent: (content) => final.push(content),
      },
      deps,
    )

    expect(result.finalContent).toContain("第八章细纲")
    expect(final.join("")).toContain("第八章细纲")
    expect(thinking.join("\n")).toContain("阶段1：大纲上下文分析")
    expect(thinking.join("\n")).toContain("阶段2：大纲任务书")
    expect(thinking.join("\n")).toContain("阶段3：大纲草稿")
    expect(thinking.join("\n")).toContain("阶段4：大纲自检")
  })

  it("streams outline stage content into thinking while each stage is generating", async () => {
    const deps: DeepOutlineGenerationDeps = {
      streamChat: vi.fn(async (_config: LlmConfig, messages: ChatMessage[], callbacks: StreamCallbacks) => {
        const prompt = messages.map((message) => String(message.content)).join("\n")
        if (prompt.includes("自检")) {
          callbacks.onToken("结论")
          callbacks.onToken("：通过")
        } else if (prompt.includes("草稿")) {
          callbacks.onToken("草稿第一段")
          callbacks.onToken("草稿第二段")
        } else {
          callbacks.onToken("任务书第一段")
          callbacks.onToken("任务书第二段")
        }
        callbacks.onDone()
      }),
    }
    const thinking: string[] = []

    await runDeepOutlineGeneration(
      {
        llmConfig,
        userRequest: "生成第八章细纲",
        context: "已有大纲：第七章结尾，主角拿到锈钥匙。",
        historyMessages: [],
      },
      { onThinking: (content) => thinking.push(content) },
      deps,
    )

    expect(thinking).toContain("## 阶段2：大纲任务书\n任务书第一段")
    expect(thinking).toContain("## 阶段2：大纲任务书\n任务书第一段任务书第二段")
    expect(thinking).toContain("## 阶段3：大纲草稿\n草稿第一段")
    expect(thinking).toContain("## 阶段4：大纲自检\n结论")
  })
})
