import type { ProviderOverride, SavedModel } from "@/stores/wiki-store"
import { getEffectiveSavedModels } from "@/lib/llm-model-keys"

/**
 * 从 `providerConfigs` 里的一条插件 provider 配置倒推出「用户勾选了哪些模型」。
 *
 * ── 为什么要从 `providerConfigs` 倒推，而不是直接读覆盖表 ──
 * 覆盖表里 `selectedModels` 缺省的含义是「全选」，而不是「一个都没选」。
 * 所以「用户在设置页看到的那几个模型」与「覆盖表里存了什么」并不是同一件事：
 *   · 从未勾选过（覆盖表没有这个字段）→ 同步时 `savedModels` 是**插件上报的全部**；
 *   · 显式清空 → `setPluginProviderOverride` 会把这个字段删掉（见其注释）
 *     → 同步又会回到全部。也就是说「清空」在数据上是「回到默认」，
 *     界面必须用**同一份**候选来显示，否则会出现「界面说 2 个、聊天里能选 41 个」。
 *
 * 唯一的例外是「还没同步过」：刚装好插件、`syncPluginProviders` 失败或尚未跑完时，
 * `providerConfigs` 里没有这一条。那时用插件快照里的模型（`reportedModels`）兜底，
 * 让卡片至少能显示「插件报了什么」，而不是一片空白。
 *
 * 返回的 id 列表用作勾选浮层的**默认勾选状态**，保证「浮层里勾着的」= 「聊天里能选的」。
 */
export function deriveSelectedModelIds(
  config: ProviderOverride | undefined,
  reportedModels: readonly { id: string }[],
): string[] {
  if (config) {
    return getEffectiveSavedModels(config).map((model: SavedModel) => model.model || model.id)
  }
  return reportedModels.map((model) => model.id)
}
