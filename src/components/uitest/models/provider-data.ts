import type { ProviderOverride, SavedModel } from "@/stores/wiki-store"
import { MIN_USER_LLM_CONTEXT_SIZE } from "@/lib/llm-context-size"
import { validateModelEndpoint } from "./model-feedback"

export function mergeProviderModels(draft: ProviderOverride, ids: string[]): ProviderOverride {
  const savedModels: SavedModel[] = [...(draft.savedModels ?? [])]
  if (!savedModels.length && draft.model?.trim()) savedModels.push({ id: crypto.randomUUID(), name: draft.model.trim(), model: draft.model.trim(), createdAt: Date.now() })
  const present = new Set(savedModels.map(item => item.model))
  for (const value of ids) {
    const model = value.trim()
    if (!model || present.has(model)) continue
    present.add(model); savedModels.push({ id: crypto.randomUUID(), name: model, model, createdAt: Date.now() })
  }
  return { ...draft, savedModels, model: draft.model && savedModels.some(item => item.model === draft.model) ? draft.model : savedModels[0]?.model ?? "" }
}
export function removeProviderModel(draft: ProviderOverride, model: string): ProviderOverride {
  const savedModels = (draft.savedModels ?? []).filter(item => item.model !== model)
  return { ...draft, savedModels, model: draft.model === model ? savedModels[0]?.model ?? "" : draft.model }
}
export function validateProviderDraft(draft: ProviderOverride, options: { endpointRequired?: boolean; modelRequired?: boolean } = {}): string | null {
  if (draft.enabled === false) return null
  if (options.endpointRequired !== false) { const error = validateModelEndpoint(draft.baseUrl ?? ""); if (error) return error }
  if (options.modelRequired !== false && !draft.model?.trim() && !draft.savedModels?.length) return "请填写或选择至少一个模型 ID。"
  if (draft.maxContextSize !== undefined && (!Number.isInteger(draft.maxContextSize) || draft.maxContextSize < MIN_USER_LLM_CONTEXT_SIZE)) return "当前应用要求上下文窗口至少 204,800 tokens。请填写模型真实支持值，不要以调大数字代替模型能力。"
  if (draft.maxOutputTokens !== undefined && (!Number.isInteger(draft.maxOutputTokens) || draft.maxOutputTokens < 512 || draft.maxOutputTokens > 393216)) return "输出上限应为 512–393,216 的整数，请以模型实际能力为准。"
  if (draft.maxContextSize && draft.maxOutputTokens && draft.maxOutputTokens > draft.maxContextSize) return "输出上限不能超过上下文窗口。"
  return null
}
