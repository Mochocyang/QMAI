/**
 * 已经从产品里移除的 LLM provider。
 *
 * ## 为什么需要这层
 *
 * 删掉一个 provider 的**代码**，不等于删掉用户机器上的**配置**：
 * `providerConfigs` 是持久化的（加密后存在应用配置里），里面那条
 * `workbuddy: { label: "WorkBuddy 国内版", savedModels: [...] }` 会一直留着。
 *
 * 结果就是用户卸载了插件、代码里也早就没有 WorkBuddy 了，但：
 *   · 设置 → 模型设置 里还挂着一张「WorkBuddy 国内版 / 未选择模型」的空卡片
 *     （没有预设可认，走了兜底渲染）；
 *   · AI 对话的模型下拉里还留着一个「WORKBUDDY 国内版」分组。
 *
 * 所以这里维护一份「已移除」清单，在**读取配置时**就把它剔掉，
 * 并在下一次保存时顺带写回，做到「删掉的东西不会再回来」。
 *
 * 新增已移除 provider 时只需往 `OBSOLETE_PROVIDER_IDS` 里加 id。
 */

export const OBSOLETE_PROVIDER_IDS = ["workbuddy"] as const

const OBSOLETE = new Set<string>(OBSOLETE_PROVIDER_IDS)

/** 这个 provider id 是不是已经从产品里移除了。 */
export function isObsoleteProviderId(id: string | null | undefined): boolean {
  if (!id) return false
  return OBSOLETE.has(id)
}

export interface PruneResult<T> {
  configs: T
  /** 被剔除的 provider id（空数组表示没有变化）。 */
  removed: string[]
}

/**
 * 从 `providerConfigs` 里剔除已移除的 provider。
 *
 * 只删清单里的 id：`custom-*`（用户自建）与插件注入的 provider 一律不动，
 * 避免误删用户自己的配置。
 */
export function pruneObsoleteProviders<T extends Record<string, unknown>>(configs: T): PruneResult<T> {
  const removed: string[] = []
  const kept: Record<string, unknown> = {}
  for (const [id, value] of Object.entries(configs)) {
    if (isObsoleteProviderId(id)) {
      removed.push(id)
      continue
    }
    kept[id] = value
  }
  if (removed.length === 0) return { configs, removed }
  return { configs: kept as T, removed }
}

/**
 * 当前选中的模型如果指向已移除的 provider，把 provider / model 清空。
 *
 * 不清的话，聊天请求会带着一个不存在的 provider 去发，报错信息还很难懂。
 * 清空后界面表现为「未选择模型」，用户重新选一个即可。
 */
export function clearObsoleteLlmProvider<
  T extends { provider: string; model?: string; customEndpoint?: string },
>(config: T): { config: T; cleared: boolean } {
  if (!isObsoleteProviderId(config.provider)) return { config, cleared: false }
  const next = { ...config, provider: "", model: "" }
  // customEndpoint 是 WorkBuddy 那类网关地址，一并清掉免得下次误用
  if (typeof next.customEndpoint === "string" && next.customEndpoint.length > 0) {
    next.customEndpoint = ""
  }
  return { config: next as T, cleared: true }
}
