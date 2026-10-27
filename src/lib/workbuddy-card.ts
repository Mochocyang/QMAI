/**
 * 登录成功后的「WorkBuddy 模型卡片」生成规则。
 *
 * 这几条规则值得单测，因为它们决定了用户第一次看到什么：
 *   · 默认勾哪几个模型（勾太多会把模型下拉框塞满 50 项）；
 *   · 上下文窗口取「已选模型里最小的那个」（取最大的后果是长章节必然被上游 400）；
 *   · 删掉最后一个账号时卡片**置灰而不是删除**（用户下次登录还在原位置）。
 */

import type { ProviderOverride, SavedModel } from "@/stores/wiki-store"
import type { WorkbuddyModel } from "@/lib/workbuddy-accounts"

/** 自动勾选的模型上限。超过它就把剩下的留给用户自己点。 */
export const MAX_DEFAULT_MODELS = 3

/** 上游没给上下文的兜底值（与 Rust 侧 `ModelInfo::effective_context` 同源）。 */
const FALLBACK_CONTEXT = 131_072

function contextOf(model: WorkbuddyModel): number {
  return model.maxInputTokens > 0 ? model.maxInputTokens : FALLBACK_CONTEXT
}

function toSavedModel(model: WorkbuddyModel): SavedModel {
  return {
    id: model.id,
    name: model.name || model.id,
    model: model.id,
    createdAt: Date.now(),
  }
}

/**
 * 从远程目录生成一张卡片。
 *
 * 选择顺序：`isDefault` 优先，不足上限时按目录顺序补齐（目录顺序是上游给的
 * 重要度顺序）。一个都没有时返回空 `savedModels`，但卡片仍是「启用」——
 * 让用户自己去拉/点，而不是给一张看起来像坏了的卡。
 */
export function buildWorkbuddyCard(models: WorkbuddyModel[]): ProviderOverride {
  const preferred = models.filter((model) => model.isDefault)
  const picked: WorkbuddyModel[] = []
  for (const model of [...preferred, ...models]) {
    if (picked.length >= MAX_DEFAULT_MODELS) break
    if (!picked.some((item) => item.id === model.id)) picked.push(model)
  }

  const savedModels = picked.map(toSavedModel)
  const context = picked.length > 0 ? Math.min(...picked.map(contextOf)) : FALLBACK_CONTEXT
  const maxOutput = picked.find((model) => model.isDefault)?.maxOutputTokens
    || picked[0]?.maxOutputTokens
    || undefined

  return {
    enabled: true,
    model: savedModels[0]?.model ?? "",
    savedModels,
    maxContextSize: context,
    maxOutputTokens: maxOutput && maxOutput > 0 ? maxOutput : undefined,
  }
}

/**
 * 用户手动改了模型勾选后，重新算上下文窗口（取已选模型最小值）。
 *
 * 只改上下文，不动 `enabled` / 推理档位等用户自己的选择。
 */
export function retuneWorkbuddyCard(card: ProviderOverride, models: WorkbuddyModel[]): ProviderOverride {
  const selected = card.savedModels ?? []
  if (selected.length === 0) return card
  const contexts = selected
    .map((saved) => models.find((model) => model.id === saved.model))
    .filter((model): model is WorkbuddyModel => Boolean(model))
    .map(contextOf)
  if (contexts.length === 0) return card
  return { ...card, maxContextSize: Math.min(...contexts) }
}

/**
 * 删掉最后一个账号：卡片置灰但**保留**模型列表。
 *
 * 保留的理由：用户重新登录同一个账号时，勾选的模型不会丢；置灰是为了让
 * `hasUsableLlm` 与模型选择器立刻认为「当前没有可用模型」。
 */
export function disableWorkbuddyCard(card: ProviderOverride): ProviderOverride {
  return { ...card, enabled: false }
}

/** 重新登录后恢复启用。 */
export function enableWorkbuddyCard(card: ProviderOverride): ProviderOverride {
  return { ...card, enabled: true }
}
