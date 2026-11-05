import { describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import {
  classifyTaskIntent,
  parseTaskIntentClassification,
  TASK_INTENT_CLASSIFIER_SYSTEM,
} from "./task-intent-classifier"

const llmConfig = {
  provider: "custom",
  apiKey: "test-key",
  model: "writer",
  ollamaUrl: "",
  customEndpoint: "https://example.test/v1",
  maxContextSize: 8192,
} as LlmConfig

describe("parseTaskIntentClassification", () => {
  it("reads a JSON object and tolerates a fenced payload", () => {
    expect(parseTaskIntentClassification('{"intent":"write_chapter","confidence":0.81}')).toEqual({
      intent: "write_chapter",
      confidence: 0.81,
    })
    expect(parseTaskIntentClassification("```json\n{\"intent\":\"search_plot\",\"confidence\":\"0.6\"}\n```")).toEqual({
      intent: "search_plot",
      confidence: 0.6,
    })
  })

  it("returns null when the payload is not a usable classification", () => {
    expect(parseTaskIntentClassification("")).toBeNull()
    expect(parseTaskIntentClassification('{"confidence":0.4}')).toBeNull()
    expect(parseTaskIntentClassification('{"intent":"write_chapter"}')).toBeNull()
  })
})

describe("classifyTaskIntent", () => {
  it("makes one structured call and parses the model JSON", async () => {
    const stream = vi.fn(async (_config, _messages, callbacks) => {
      callbacks.onToken('{"intent":"foreshadowing_query","confidence":0.77}')
      callbacks.onDone()
    })

    const result = await classifyTaskIntent({
      userInput: "还有哪些伏笔没回收",
      llmConfig,
      streamChat: stream,
    })

    expect(result).toEqual({ intent: "foreshadowing_query", confidence: 0.77 })
    expect(stream).toHaveBeenCalledOnce()
    const messages = stream.mock.calls[0][1]
    expect(messages[0].content).toBe(TASK_INTENT_CLASSIFIER_SYSTEM)
    expect(messages[1].content).toContain("伏笔")
    const overrides = stream.mock.calls[0][4]
    expect(overrides).toMatchObject({
      max_tokens: 80,
      temperature: 0,
      toolChoice: "none",
      skipUserMemory: true,
      reasoning: { mode: "off" },
    })
  })

  it("returns null when the model call fails or the JSON is unusable", async () => {
    const failed = vi.fn(async (_config, _messages, callbacks) => {
      callbacks.onError(new Error("上游超时"))
      callbacks.onDone()
    })
    const garbage = vi.fn(async (_config, _messages, callbacks) => {
      callbacks.onToken("我先帮你搜一下网上的伏笔套路")
      callbacks.onDone()
    })

    await expect(classifyTaskIntent({
      userInput: "查伏笔",
      llmConfig,
      streamChat: failed,
    })).resolves.toBeNull()
    await expect(classifyTaskIntent({
      userInput: "查伏笔",
      llmConfig,
      streamChat: garbage,
    })).resolves.toBeNull()
  })

  it("does not call the model when no usable config exists", async () => {
    const stream = vi.fn()
    const result = await classifyTaskIntent({
      userInput: "写第3章",
      llmConfig: { ...llmConfig, apiKey: "", model: "" },
      streamChat: stream,
    })

    expect(result).toBeNull()
    expect(stream).not.toHaveBeenCalled()
  })
})
