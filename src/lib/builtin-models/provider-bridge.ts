/**
 * 把「内置模型」的凭证接进 QMAI 现有的模型体系。
 *
 * 现有链路只认 providerConfigs[id]（预设 id → 覆盖字段），模型键是
 * `${providerId}/${modelId}`。所以我们把中转站登记成一个 provider：
 *
 *   qmai-builtin  →  provider: "custom"（OpenAI 兼容）
 *                    baseUrl: https://relay.qmai.work/v1
 *                    apiKey:  30 分钟中转票据（由 token-fresh 层保鲜）
 *                    savedModels: 中转站清单里勾选的对外模型名
 *
 * 这样写作、大纲、审稿、摘要都不需要改代码，现有 resolver 自动认识它。
 */

import { useWikiStore, type LlmConfig, type ProviderOverride, type SavedModel } from "@/stores/wiki-store"
import {
  saveActivePresetId,
  saveAiChatModel,
  saveDefaultLlmModel,
  saveLlmConfig,
  saveNovelConfig,
  saveProviderConfigs,
} from "@/lib/project-store"
import { describeBuiltinModel } from "./catalog"
import type { BuiltinSession } from "./session"
import { DEFAULT_RELAY_URL } from "./gateway-api"

export const BUILTIN_PROVIDER_ID = "qmai-builtin"
export const BUILTIN_PROVIDER_LABEL = "青幕内置模型"

export function builtinModelKey(modelId: string): string {
  return `${BUILTIN_PROVIDER_ID}/${modelId}`
}

function toSavedModels(modelIds: string[]): SavedModel[] {
  const now = Date.now()
  return modelIds.map((modelId, index) => {
    const meta = describeBuiltinModel(modelId)
    return {
      id: `builtin-${modelId}`,
      name: meta.label,
      model: modelId,
      description: meta.note,
      createdAt: now + index,
    }
  })
}

/**
 * 上下文上限取所选模型里**最小**的那个：
 * 写作请求按这个值裁剪上下文，取最大值会让小窗口模型直接被接口拒绝。
 */
export function buildBuiltinProviderOverride(
  session: Pick<BuiltinSession, "serverUrl" | "tokenKey">,
  modelIds: string[],
  existing?: ProviderOverride,
): ProviderOverride {
  const models = [...new Set(modelIds)]
  const metas = models.map(describeBuiltinModel)
  const contextSize = metas.length > 0
    ? Math.min(...metas.map((meta) => meta.contextSize))
    : 204800
  const maxOutputTokens = metas.length > 0
    ? Math.min(...metas.map((meta) => meta.maxOutputTokens))
    : 32768
  const first = models[0] ?? ""

  return {
    ...existing,
    label: BUILTIN_PROVIDER_LABEL,
    apiKey: session.tokenKey,
    baseUrl: `${(session.serverUrl || DEFAULT_RELAY_URL).replace(/\/+$/, "")}/v1`,
    apiMode: "chat_completions",
    model: first,
    savedModels: toSavedModels(models),
    maxContextSize: contextSize,
    maxOutputTokens,
    reasoning: existing?.reasoning ?? { mode: "auto" },
    functionCallingEnabled: existing?.functionCallingEnabled !== false,
    enabled: true,
  }
}

export interface ApplyBuiltinOptions {
  session: Pick<BuiltinSession, "serverUrl" | "tokenKey">
  modelIds: string[]
  /** 同时设为默认模型（正文对话与后台任务都用它）。默认打开。 */
  makeDefault?: boolean
}

export interface ApplyBuiltinResult {
  modelKey: string
  modelCount: number
}

/**
 * 写入配置并（可选）设为默认模型。
 * 只写 providerConfigs 与默认模型字段，不动用户其它提供方。
 */
export async function applyBuiltinModels(options: ApplyBuiltinOptions): Promise<ApplyBuiltinResult> {
  const state = useWikiStore.getState()
  const override = buildBuiltinProviderOverride(
    options.session,
    options.modelIds,
    state.providerConfigs[BUILTIN_PROVIDER_ID],
  )
  const nextConfigs = { ...state.providerConfigs, [BUILTIN_PROVIDER_ID]: override }
  await saveProviderConfigs(nextConfigs)
  useWikiStore.getState().setProviderConfigs(nextConfigs)

  const firstModel = options.modelIds[0] ?? ""
  const modelKey = firstModel ? builtinModelKey(firstModel) : ""

  if (options.makeDefault !== false && modelKey) {
    const latest = useWikiStore.getState()
    await saveDefaultLlmModel(modelKey)
    latest.setDefaultLlmModel(modelKey)

    // 把内置模型同时写进「当前生效的配置」：QMAI 里几十处 hasUsableLlm()
    // 守卫只看 llmConfig，不写它就会出现「已经配好、点写作仍说没配模型」。
    const base = latest.llmConfig
    const llmConfig: LlmConfig = {
      ...base,
      provider: "custom",
      apiKey: override.apiKey ?? "",
      model: firstModel,
      customEndpoint: override.baseUrl ?? "",
      apiMode: "chat_completions",
      maxContextSize: override.maxContextSize ?? 204800,
      maxOutputTokens: override.maxOutputTokens,
      reasoning: override.reasoning,
      localCliIsolation: false,
      functionCallingEnabled: override.functionCallingEnabled !== false,
    }
    await saveLlmConfig(llmConfig)
    useWikiStore.getState().setLlmConfig(llmConfig)

    // 让下次启动按这个预设重新解析（否则旧的 activePresetId 会把
    // llmConfig 覆盖回上一家提供方）。
    await saveActivePresetId(BUILTIN_PROVIDER_ID)
    useWikiStore.getState().setActivePresetId(BUILTIN_PROVIDER_ID)

    const novelConfig = { ...latest.novelConfig, defaultLlmModel: modelKey }
    await saveNovelConfig(novelConfig, latest.project?.id, latest.project?.path)
    latest.setNovelConfig(novelConfig)

    // 对话区如果还没选过模型，直接落到内置模型，省一步手动切换。
    if (!latest.aiChatModel) {
      latest.setAiChatModel(modelKey)
      await saveAiChatModel(modelKey)
    }
  }

  return { modelKey, modelCount: override.savedModels?.length ?? 0 }
}
