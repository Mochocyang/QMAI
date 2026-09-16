import { useWikiStore } from "@/stores/wiki-store"
import { resolveDefaultModel, resolveModelConfig } from "@/lib/novel/model-resolver"
import type { BookAnalysisPipelineTask } from "./analysis-pipeline-types"

/**
 * 解析某个任务实际要用的模型。
 * 任务上选了 modelKey 就用它，否则沿用项目默认模型。
 * 选定的 key 解析不出可用配置时也照样返回，由 hasUsableLlm 在启动前拦下来并报错，
 * 而不是静默换成另一个模型跑完一整本书。
 */
export function resolveTaskLlmConfig(task: Pick<BookAnalysisPipelineTask, "modelKey">) {
  const { llmConfig, providerConfigs } = useWikiStore.getState()
  const modelKey = task.modelKey?.trim()
  if (!modelKey) return resolveDefaultModel(llmConfig)
  return resolveModelConfig(modelKey, llmConfig, providerConfigs)
}
