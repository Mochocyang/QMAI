import { describe, expect, it, vi } from "vitest"
import {
  createDeAiBatchLlmRunner,
  resolveBoundDeAiBatchModel,
  resolveDeAiBatchModelKey,
} from "./llm-runner"
import type { DeAiBatchChapter, DeAiBatchTask } from "./types"

const task = {
  id: "task-a",
  modelKey: "custom-bound/test-model",
  skillContent: "自然改写规则",
} as DeAiBatchTask
const chapter = {
  id: "chapter-a",
  sourceContent: "需要处理的正文",
} as DeAiBatchChapter

const baseConfig = {
  provider: "openai",
  apiKey: "current-fallback-key",
  model: "current-fallback-model",
  ollamaUrl: "",
  customEndpoint: "https://fallback.example/v1",
  maxContextSize: 120000,
}

const providerConfigs = {
  "custom-bound": {
    enabled: true,
    apiKey: "bound-key",
    baseUrl: "https://bound.example/v1",
    savedModels: [{ id: "saved-1", name: "绑定模型", model: "test-model", createdAt: 1 }],
  },
  "custom-default": {
    enabled: true,
    apiKey: "default-key",
    baseUrl: "https://default.example/v1",
    savedModels: [{ id: "saved-2", name: "默认模型", model: "default-model", createdAt: 1 }],
  },
}

describe("de-ai batch llm runner", () => {
  it("复用去 AI 味消息、任务绑定模型和 AbortSignal，并拼接流式结果", async () => {
    const config = { provider: "openai", model: "test-model" }
    const signal = new AbortController().signal
    const resolveConfig = vi.fn(() => config as never)
    const stream = vi.fn(async (_config, messages, callbacks, receivedSignal) => {
      expect(messages[0].content).toContain("自然改写规则")
      expect(messages[1].content).toContain("需要处理的正文")
      expect(receivedSignal).toBe(signal)
      callbacks.onToken("候选")
      callbacks.onToken("正文")
      callbacks.onDone()
    })
    const runner = createDeAiBatchLlmRunner({ resolveConfig, stream: stream as never })

    await expect(runner({ task, chapter, signal })).resolves.toBe("候选正文")
    expect(resolveConfig).toHaveBeenCalledWith(task)
    expect(stream).toHaveBeenCalledWith(config, expect.any(Array), expect.any(Object), signal)
  })

  it("在完整结果形成后过滤 Gemini 普通文本形式的思考摘要", async () => {
    const stream = vi.fn(async (_config, _messages, callbacks) => {
      callbacks.onToken("**Initiating the Analysis**\n\n")
      callbacks.onToken("I'm currently dissecting the task and applying the requested rewrite rules.\n\n")
      callbacks.onToken("巷口的雨停了，叶刃收起伞。")
      callbacks.onDone()
    })
    const runner = createDeAiBatchLlmRunner({ resolveConfig: () => ({}) as never, stream: stream as never })

    await expect(runner({ task, chapter, signal: new AbortController().signal }))
      .resolves.toBe("巷口的雨停了，叶刃收起伞。")
  })

  it("按任务模型、项目默认模型、聊天模型的顺序生成稳定 provider/model key", () => {
    expect(resolveDeAiBatchModelKey({
      taskModel: "custom-bound/test-model",
      defaultModel: "custom-default/default-model",
      chatModel: "",
      baseConfig: baseConfig as never,
      providerConfigs: providerConfigs as never,
    })).toBe("custom-bound/test-model")

    expect(resolveDeAiBatchModelKey({
      taskModel: "missing/model",
      defaultModel: "custom-default/default-model",
      chatModel: "custom-bound/test-model",
      baseConfig: baseConfig as never,
      providerConfigs: providerConfigs as never,
    })).toBe("custom-default/default-model")
  })

  it("按持久化 key 重新解析当前凭据，不持久化或回退到当前模型", () => {
    const resolved = resolveBoundDeAiBatchModel(task, {
      baseConfig: baseConfig as never,
      providerConfigs: providerConfigs as never,
    })

    expect(resolved.model).toBe("test-model")
    expect(resolved.apiKey).toBe("bound-key")
    expect(resolved.customEndpoint).toBe("https://bound.example/v1")
  })

  it("恢复时任务绑定模型缺失会中文失败，不静默使用当前 fallback 模型", () => {
    const missingTask = { ...task, modelKey: "removed-provider/test-model" }

    expect(() => resolveBoundDeAiBatchModel(missingTask, {
      baseConfig: baseConfig as never,
      providerConfigs: providerConfigs as never,
    })).toThrow("任务绑定模型“removed-provider/test-model”已不可用，请重新配置该模型后再继续")
  })

  it("流式错误会拒绝当前章节而不是吞掉", async () => {
    const stream = vi.fn(async (_config, _messages, callbacks) => {
      callbacks.onError(new Error("模型失败"))
    })
    const runner = createDeAiBatchLlmRunner({ resolveConfig: () => ({}) as never, stream: stream as never })

    await expect(runner({ task, chapter, signal: new AbortController().signal })).rejects.toThrow("模型失败")
  })
})
