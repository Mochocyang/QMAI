import type { ProviderOverride, SavedModel } from "@/stores/wiki-store"

/**
 * 插件 provider 的**用户覆盖表**。
 *
 * ── 它解决什么问题 ──────────────────────────────────────────────
 * 插件上报的 provider 配置（`toProviderOverride`）是"插件的看法"：
 * 名称、41 个模型的完整清单、每个模型的窗口大小。而用户在设置页里会改：
 *   · 把配置名改成「我的 WorkBuddy」
 *   · 只勾 3 个模型（41 个在聊天下拉里太吵）
 *   · 把上下文窗口从 128K 改到 200K（插件上报值不准时）
 *
 * 这些改动如果只写进 `providerConfigs`，下一次 `syncPluginProviders()`
 * （启动、刷新模型、插件重启）就会**整条覆盖**回去 —— 用户会觉得"我改的东西
 * 自己变回去了"，而且没有任何提示。
 *
 * 所以用户改过的字段在这里单独存一份，同步时以它为准。
 *
 * ── 明确的边界 ────────────────────────────────────────────────
 * · **只允许覆盖展示与选择相关的字段**（下方 `OVERRIDABLE_FIELDS`）。
 *   `baseUrl` 由宿主分配、`apiKey` 归插件，用户能改它们只会制造"打不通"。
 * · `savedModels` 存的是**用户选中的模型 id 列表**，不是完整模型对象 ——
 *   模型能力（窗口、是否支持工具）永远以插件上报为准，避免用户手改成插件不支持的值。
 * · 插件卸载时整条覆盖一起删（见 `forgetPluginProviderOverrides`）。
 */

const STORAGE_KEY = "qmai-plugin-provider-overrides-v1"

/** 用户可覆盖的字段。超出这个集合的键一律忽略（见模块头的边界说明）。 */
const OVERRIDABLE_FIELDS = ["label", "maxContextSize", "maxOutputTokens", "enabled"] as const

/** 一个插件 provider 的用户覆盖。 */
export interface PluginProviderOverride {
  /** 配置名称。 */
  label?: string
  /**
   * 用户勾选的模型 id（顺序即展示顺序）。
   * `undefined`（没写过）= 沿用插件全部模型；`[]` = **显式清空**（一个都不显示）。
   * 两者必须区分：内置卡片的「清空」就是"都不选"，清完又变回全选是错的。
   */
  selectedModels?: string[]
  /** 上下文窗口（tokens）。 */
  maxContextSize?: number
  /** 输出上限（tokens）。 */
  maxOutputTokens?: number
  /** 用户是否在模型选择器里显示它。 */
  enabled?: boolean
}

type OverrideMap = Record<string, PluginProviderOverride>

let cache: OverrideMap | null = null
const listeners = new Set<() => void>()

function readRaw(): OverrideMap {
  if (cache) return cache
  let raw: string | null = null
  try {
    raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY)
  } catch {
    raw = null
  }
  cache = parseOverrides(raw)
  return cache
}

/**
 * 解析存储。坏 JSON / 非对象 / 未知字段一律丢弃 —— 覆盖表是用户偏好，
 * 它坏了应该是"回到默认"，而不是让设置页打不开。
 */
export function parseOverrides(raw: string | null): OverrideMap {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}

  const result: OverrideMap = {}
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue
    const record = value as Record<string, unknown>
    const override: PluginProviderOverride = {}
    const label = typeof record.label === "string" ? record.label.trim() : ""
    if (label) override.label = label
    if (Array.isArray(record.selectedModels)) {
      // 空数组也是合法值（显式清空）：丢掉它会让"清空"在重启后变回全选。
      override.selectedModels = record.selectedModels.filter((item): item is string => typeof item === "string")
    }
    for (const field of ["maxContextSize", "maxOutputTokens"] as const) {
      const number = record[field]
      // 只收正整数：0 / 负数 / NaN 都是坏数据
      if (typeof number === "number" && Number.isInteger(number) && number > 0) {
        override[field] = number
      }
    }
    if (typeof record.enabled === "boolean") override.enabled = record.enabled
    if (Object.keys(override).length > 0) result[id] = override
  }
  return result
}

function write(next: OverrideMap): void {
  cache = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 存不进去本次会话照样生效（cache 已更新），不值得弹一个用户无法处理的提示。
  }
  for (const listener of listeners) listener()
}

export function subscribePluginProviderOverrides(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getPluginProviderOverrides(): OverrideMap {
  return readRaw()
}

export function getPluginProviderOverride(id: string): PluginProviderOverride | undefined {
  return readRaw()[id]
}

/**
 * 写入一条覆盖。`undefined` 的字段表示"删掉这一项的覆盖"（回到插件上报值）。
 */
export function setPluginProviderOverride(id: string, patch: PluginProviderOverride): void {
  const next: OverrideMap = { ...readRaw() }
  const merged: PluginProviderOverride = { ...(next[id] ?? {}) }
  /*
   * 区分"没传这个字段"和"显式传 undefined"：
   *   · 没传 → 保留已有值（浅合并，用户分两次改名字和窗口不会互相冲掉）；
   *   · 显式传 undefined → 删掉这一项的覆盖（"恢复插件默认"）。
   * 只看 value === undefined 是不够的：那会把"没传"也当成删除，
   * 于是第二次改别的字段时，第一次改的名字被悄悄清掉。
   */
  for (const field of OVERRIDABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue
    const value = patch[field]
    if (value === undefined) delete merged[field]
    else (merged as Record<string, unknown>)[field] = value
  }
  if (Object.prototype.hasOwnProperty.call(patch, "selectedModels")) {
    /*
     * 这里同样区分"没传 / 显式 undefined / 空数组"：
     *   · 没传 → 保留已有值；
     *   · 显式传 undefined → 删掉字段（「全选」= 回到"没勾过 = 全选"语义）；
     *   · 传 [] → **原样保留**（「清空」= 一个都不显示）。
     * 把 [] 当 undefined 删掉，"清空"就会在写覆盖表的那一步被吞掉，
     * 下一次同步又回到全部模型 —— 那正是要修的 bug。
     */
    const selected = patch.selectedModels
    if (!selected) delete merged.selectedModels
    else merged.selectedModels = [...selected]
  }
  if (Object.keys(merged).length === 0) delete next[id]
  else next[id] = merged
  write(next)
}

/** 插件卸载/停用时清掉覆盖（否则重新装回来的插件会带着上一个账号的改法）。 */
export function forgetPluginProviderOverrides(id: string): void {
  const current = readRaw()
  if (!(id in current)) return
  const next = { ...current }
  delete next[id]
  write(next)
}

/**
 * 把插件的**全部模型**按用户勾选过滤。
 *
 * 没勾过（`selectedModels` 为 `undefined`）→ 返回全部（首次登录就是"全选"）。
 * **空数组 = 显式清空** → 返回 `[]`：内置卡片的「清空」就是"都不显示"，
 * 清完又变回全选是错的（旧语义正是这么错的）。
 * 勾过但一个都不在插件清单里（插件下架了那些模型）→ 返回全部，
 * 否则用户会看到"一个模型都没有"，而原因（模型下架）界面上看不出来。
 */
export function applySelectedModels(
  models: readonly SavedModel[],
  override: PluginProviderOverride | undefined,
): SavedModel[] {
  const selected = override?.selectedModels
  if (!selected) return [...models]
  if (selected.length === 0) return []
  const wanted = new Set(selected)
  const filtered = models.filter((model) => wanted.has(model.id) || wanted.has(model.model))
  return filtered.length > 0 ? filtered : [...models]
}

/**
 * 把插件上报的配置与用户覆盖合并成最终写进 `providerConfigs` 的形状。
 *
 * 这是本模块的**唯一合并入口**：`provider-sync` 只调它，界面也只通过
 * `setPluginProviderOverride` 写覆盖 —— 两条路径不会各自拼一套。
 */
export function mergePluginProviderConfig(
  reported: ProviderOverride,
  override: PluginProviderOverride | undefined,
): ProviderOverride {
  const merged: ProviderOverride = { ...reported }
  if (!override) return merged
  if (override.label) merged.label = override.label
  if (override.maxContextSize !== undefined) merged.maxContextSize = override.maxContextSize
  if (override.maxOutputTokens !== undefined) merged.maxOutputTokens = override.maxOutputTokens
  if (override.enabled !== undefined) merged.enabled = override.enabled
  if (reported.savedModels) {
    merged.savedModels = applySelectedModels(reported.savedModels, override)
  }
  return merged
}

/** 测试用：清掉缓存让下一次读走 localStorage。 */
export function __resetPluginProviderOverrideCacheForTests(): void {
  cache = null
  listeners.clear()
}

export const PLUGIN_PROVIDER_OVERRIDE_STORAGE_KEY = STORAGE_KEY
