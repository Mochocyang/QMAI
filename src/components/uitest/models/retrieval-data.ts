import type { EmbeddingConfig, RerankConfig } from "@/stores/wiki-store"
import { validateModelEndpoint } from "./model-feedback"
export function validateEmbeddingDraft(config: EmbeddingConfig): string | null {
  if (!config.enabled) return null
  const addressError = validateModelEndpoint(config.endpoint)
  if (addressError) return addressError
  if (!config.model.trim()) return "请填写向量模型 ID。"
  const chunk = config.maxChunkChars ?? 1000, overlap = config.overlapChunkChars ?? 200
  if (!Number.isInteger(chunk) || chunk < 200) return "每块字符数必须是至少 200 的整数。"
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= chunk) return "重叠字符数必须是非负整数，且小于每块字符数。"
  if (config.outputDimensionality !== undefined && (!Number.isInteger(config.outputDimensionality) || config.outputDimensionality < 1)) return "输出维度必须为正整数，留空则使用模型默认维度。"
  return null
}
export function validateRerankDraft(config: RerankConfig, mainModel: string): string | null {
  if (!config.enabled) return null
  if (!Number.isInteger(config.maxCandidates) || config.maxCandidates < 3 || config.maxCandidates > 30) return "候选 TOPN 必须是 3–30 的整数，不是最终返回数量 TOPK。"
  if (config.useMainLlm) return mainModel.trim() ? null : "当前主模型未配置，请先保存大语言模型，或选择独立重排模型。"
  if (["custom", "ollama", "azure"].includes(config.provider)) {
    const error = validateModelEndpoint(config.provider === "ollama" ? config.ollamaUrl : config.customEndpoint)
    if (error) return error
  }
  if (!["claude-code", "codex-cli", "cursor-cli"].includes(config.provider) && !config.model.trim()) return "请填写重排模型 ID。"
  return null
}
