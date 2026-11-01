/**
 * 把 Rust 侧的插件 provider 同步进 zustand 的 `providerConfigs`。
 *
 * 为什么需要同步而不是让界面直接读 `pluginsApi.providers()`：
 * 模型选择器、上下文裁剪、模型测试、用量统计全都读 `providerConfigs`
 * （`ProviderConfigs = Record<string, ProviderOverride>` 本来就是开放的）。
 * 把插件 provider 写进去之后，这些既有逻辑**零改动**就能用 —— 这正是 v2 设计的支点。
 *
 * 铁律（计划第 0 节）：**不写 apiKey**。
 * token 只在 Rust 内存，请求前由 `ensurePluginProviderAuth` 现取。
 * 一旦写进 `providerConfigs`，它会被 project-store 持久化到磁盘，与「凭证归插件」矛盾。
 *
 * 另一个铁律：**只清理自己注入过的 id**。
 * 删除条件不是「不在 `providers()` 里」，而是「上次由我们注入、这次不再就绪」。
 * 用户手工配置的 provider（内置 11 个、`custom-*` 卡片、甚至历史遗留的自定义 id）
 * 同样不会出现在 `providers()` 里，用前者当条件会直接删掉用户的配置。
 */
import { useWikiStore, type ProviderConfigs, type ProviderOverride, type SavedModel } from "@/stores/wiki-store"
import { pluginsApi } from "./api"
import { clearPluginProviderAuth } from "./provider-auth"
import {
  listInjectedPluginProviderIds,
  markPluginProviderInjected,
  unmarkPluginProviderInjected,
} from "./provider-registry"
import type { PluginProviderModel, PluginProviderView } from "./types"

/**
 * 「本进程注入过谁」的登记表在 `provider-registry`：那个文件没有任何 import，
 * 好让 store 的规范化层（`llm-context-size`）也能直接判断，而不绕出
 * `wiki-store → llm-context-size → provider-sync → wiki-store` 的循环。
 * 这里 re-export，调用方 API 不变。
 */
export { isPluginProviderInjected } from "./provider-registry"
import {
  forgetPluginProviderOverrides,
  getPluginProviderOverride,
  mergePluginProviderConfig,
} from "./provider-overrides"

/** 最近一次 `plugins_providers()` 的快照，供设置页渲染运行期卡片（含未就绪的）。 */
let providerViews: PluginProviderView[] = []

const viewListeners = new Set<() => void>()

/**
 * 最近一次同步拿到的 provider 视图。
 *
 * 设置页需要它来渲染「未就绪」的卡片：这类 provider 按设计**没有**写进
 * `providerConfigs`，所以只看配置是看不到它们的。
 */
export function getPluginProviderViews(): PluginProviderView[] {
  return providerViews
}

/** 订阅快照变化（供 `useSyncExternalStore` 使用）。 */
export function subscribePluginProviderViews(listener: () => void): () => void {
  viewListeners.add(listener)
  return () => {
    viewListeners.delete(listener)
  }
}

function maxOf(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  return values.reduce((max, value) => (value > max ? value : max), values[0])
}

/**
 * 插件模型 → `SavedModel`。
 *
 * 字段形状按 `getEffectiveSavedModels` 实际读的来（id/name/model/createdAt）：
 * 模型选择器与裁剪只认这四个，多写字段（apiKey / customEndpoint）反而会把
 * 「凭证归插件」的边界弄模糊。
 */
function toSavedModel(model: PluginProviderModel): SavedModel {
  return {
    id: model.id,
    name: model.name,
    model: model.id,
    createdAt: 0,
  }
}

/** 插件 provider → 运行期 `ProviderOverride`。**故意不写 apiKey**（见文件头）。 */
function toProviderOverride(provider: PluginProviderView): ProviderOverride {
  return {
    label: provider.name,
    baseUrl: provider.baseUrl,
    savedModels: provider.models.map(toSavedModel),
    maxContextSize: maxOf(provider.models.map((model) => model.maxInputTokens)),
    maxOutputTokens: maxOf(provider.models.map((model) => model.maxOutputTokens)),
    // provider 已就绪，模型可以出现在选择器里；用户不能像 preset 那样关掉它，
    // 停用插件才是「关掉」的正确方式（那时整条配置会被同步删掉）。
    enabled: true,
    // apiKey 故意不写：token 只在 Rust 内存里，请求前由 ensurePluginProviderAuth 现取。
  }
}

function publishViews(next: PluginProviderView[]): void {
  // 引用不稳定会让 useSyncExternalStore 每次渲染都认为变了（甚至死循环）。
  if (JSON.stringify(next) === JSON.stringify(providerViews)) return
  providerViews = next
  for (const listener of viewListeners) listener()
}

/**
 * 同步一次插件 provider 列表。
 *
 * 调用时机：应用启动（一次性初始化）、插件启用/停用/卸载后、「刷新模型」按钮。
 * 失败原样抛出（Rust 错误字符串可直接展示），调用方决定是提示还是只 warn ——
 * 启动路径必须只 warn，不能因为插件系统异常挡住整个应用。
 */
export async function syncPluginProviders(): Promise<{ added: string[]; removed: string[] }> {
  const providers = await pluginsApi.providers()
  publishViews(providers)

  const state = useWikiStore.getState()
  const next: ProviderConfigs = { ...state.providerConfigs }
  const added: string[] = []
  const removed: string[] = []
  const readyIds = new Set<string>()

  for (const provider of providers) {
    if (!provider.ready) {
      // 未就绪的 provider **不写进 providerConfigs**：写进去用户就能在模型选择器里
      // 选到一个必然打不通的模型，而报错会以「请求失败」的形式出现，看不出根因。
      console.warn(
        `[plugins] provider「${provider.providerId}」未就绪，模型未加入列表：${provider.lastError ?? "原因未知"}`,
      )
      continue
    }

    readyIds.add(provider.providerId)
    const config = toProviderOverride(provider)

    // 端口每次启动都可能变（宿主分配，设计 D4）。端点变了说明插件是另一个进程，
    // 旧 token 已经失效 —— 不清掉的话请求会带着旧 token 打到新端口上，收到 401。
    const previousBaseUrl = next[provider.providerId]?.baseUrl
    if (previousBaseUrl !== undefined && previousBaseUrl !== config.baseUrl) {
      clearPluginProviderAuth(provider.providerId)
    }

    if (markPluginProviderInjected(provider.providerId)) {
      added.push(provider.providerId)
    }
    /*
     * 用户可能改过名称 / 勾选的模型 / 窗口大小。这些改动存在覆盖表里，
     * 必须在这里合并 —— 否则每次刷新（启动、重启插件、点拉取模型）都会
     * 把用户的设置整条冲掉，而且界面上看不出发生过什么。
     */
    next[provider.providerId] = mergePluginProviderConfig(config, getPluginProviderOverride(provider.providerId))
  }

  for (const id of listInjectedPluginProviderIds()) {
    if (readyIds.has(id)) continue
    // 从登记表里摘掉，同时清 token：插件停了，旧 token 立刻失效（设计 §7 第 4 条）。
    unmarkPluginProviderInjected(id)
    // 插件没了，它的覆盖也不该留着（重装回来会带着上一个账号的改法）。
    forgetPluginProviderOverrides(id)
    if (Object.prototype.hasOwnProperty.call(next, id)) {
      delete next[id]
      removed.push(id)
    }
    clearPluginProviderAuth(id)
  }

  // 内容没变就不写 store：每次启动/刷新都 setState 会让模型选择器白白重渲染。
  if (JSON.stringify(next) !== JSON.stringify(state.providerConfigs)) {
    state.setProviderConfigs(next)
  }

  return { added, removed }
}
