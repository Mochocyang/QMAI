import { streamChat, type StreamCallbacks } from "@/lib/llm-client"
import type { ChatMessage } from "@/lib/llm-providers"
import { buildDeAiRewriteMessages } from "@/lib/novel/de-ai-adapter"
import { filterDeAiOutput } from "@/lib/novel/de-ai-output"
import {
  isModelKeyRegistered,
  resolveModelConfig,
  resolveUsableModelKey,
} from "@/lib/novel/model-resolver"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { useWikiStore, type LlmConfig, type ProviderConfigs } from "@/stores/wiki-store"
import type { DeAiChapterRunner } from "./engine"
import type { DeAiBatchTask } from "./types"

export interface DeAiBatchLlmRunnerOptions {
  resolveConfig: (task: DeAiBatchTask) => LlmConfig
  stream: (
    config: LlmConfig,
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ) => Promise<void>
}

export interface DeAiBatchModelKeyInput {
  taskModel: string
  defaultModel: string
  chatModel: string
  baseConfig: LlmConfig
  providerConfigs: ProviderConfigs
}

export function resolveDeAiBatchModelKey(input: DeAiBatchModelKeyInput): string {
  for (const candidate of [input.taskModel, input.defaultModel, input.chatModel]) {
    const key = resolveUsableModelKey(candidate, input.baseConfig, input.providerConfigs)
    if (key) return key
  }
  return ""
}

export function resolveBoundDeAiBatchModel(
  task: Pick<DeAiBatchTask, "modelKey">,
  input: { baseConfig: LlmConfig; providerConfigs: ProviderConfigs },
): LlmConfig {
  const modelKey = task.modelKey.trim()
  if (!modelKey || !isModelKeyRegistered(modelKey, input.providerConfigs)) {
    throw new Error(`任务绑定模型“${modelKey || "未设置"}”已不可用，请重新配置该模型后再继续`)
  }
  const config = resolveModelConfig(modelKey, input.baseConfig, input.providerConfigs)
  if (!hasUsableLlm(config, input.providerConfigs)) {
    throw new Error(`任务绑定模型“${modelKey}”已不可用，请重新配置该模型后再继续`)
  }
  return config
}

export function getDeAiBatchTaskModelError(task: Pick<DeAiBatchTask, "modelKey">): string | null {
  const state = useWikiStore.getState()
  try {
    resolveBoundDeAiBatchModel(task, {
      baseConfig: state.llmConfig,
      providerConfigs: state.providerConfigs,
    })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export function createDeAiBatchLlmRunner(options: DeAiBatchLlmRunnerOptions): DeAiChapterRunner {
  return async ({ task, chapter, signal }) => {
    const config = options.resolveConfig(task)
    let content = ""
    let streamError: Error | null = null
    await options.stream(
      config,
      buildDeAiRewriteMessages(chapter.sourceContent, task.skillContent),
      {
        onToken: (token) => { content += token },
        onDone: () => undefined,
        onError: (error) => { streamError = error },
      },
      signal,
    )
    if (streamError) throw streamError
    return filterDeAiOutput(content)
  }
}

export function createDefaultDeAiBatchLlmRunner(): DeAiChapterRunner {
  return createDeAiBatchLlmRunner({
    resolveConfig: (task) => {
      const state = useWikiStore.getState()
      return resolveBoundDeAiBatchModel(task, {
        baseConfig: state.llmConfig,
        providerConfigs: state.providerConfigs,
      })
    },
    stream: streamChat,
  })
}
