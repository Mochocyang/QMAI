import type { LlmConfig, ProviderConfigs } from "@/stores/wiki-store"
import { resolveModelConfig, resolveUsableModelKey } from "@/lib/novel/model-resolver"
import { getEffectiveSavedModels, isProviderAvailable } from "@/lib/llm-model-keys"
import { findLlmPresetById } from "@/components/settings/llm-presets"

export function listDefaultModelOptions(configs: ProviderConfigs) {
  return Object.entries(configs).filter(([id, config]) => isProviderAvailable(id, config)).flatMap(([id, config]) =>
    getEffectiveSavedModels(config).map(model => ({ key: `${id}/${model.model}`, label: `${config.label ?? findLlmPresetById(id)?.label ?? "模型配置"} · ${model.name || model.model}`, model: model.model })))
}
/** 与运行时的任务 > 通用 > 聊天回退顺序一致，但只计算草稿，不临时修改store。 */
export function resolveDraftDefaultModel(task: string, common: string, chat: string, base: LlmConfig, configs: ProviderConfigs) {
  for (const candidate of [...new Set([task, common, chat].filter(Boolean))]) {
    const key = resolveUsableModelKey(candidate, base, configs)
    if (!key) continue
    return { key, config: resolveModelConfig(key, base, configs), fallback: !!task && key !== resolveUsableModelKey(task, base, configs) }
  }
  return { key: "", config: null, fallback: !!task }
}
