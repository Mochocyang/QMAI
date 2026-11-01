/**
 * 「本进程注入过哪些插件 provider」的登记表。
 *
 * 为什么独立成文件而不是留在 `provider-sync` 里：
 * `llm-context-size`（providerConfigs 规范化）与 `model-resolver`（请求解析）
 * 都要问这个问题，而 `provider-sync` 依赖 `wiki-store`。把这个纯登记表抽出来，
 * 依赖方向就只剩「谁都可以依赖它」，不会绕出
 * `wiki-store → llm-context-size → provider-sync → wiki-store` 的循环。
 *
 * 语义严格限定为「**本进程由 syncPluginProviders 注入过**」：
 * 不是「id 看起来像插件」，也不是「providerConfigs 里存在这个键」。
 * 用户手工配置的 provider（内置 preset、`custom-*`、历史自定义 id）永远不在这里。
 */
const injectedProviderIds = new Set<string>()

/** 该 id 是否是本进程注入的插件 provider。 */
export function isPluginProviderInjected(providerId: string): boolean {
  return injectedProviderIds.has(providerId)
}

/** 登记一个刚注入的 provider；返回它是不是**新**的（同步用它统计 `added`）。 */
export function markPluginProviderInjected(providerId: string): boolean {
  if (injectedProviderIds.has(providerId)) return false
  injectedProviderIds.add(providerId)
  return true
}

/** 从登记表摘掉（插件停用/卸载后不再就绪时）。 */
export function unmarkPluginProviderInjected(providerId: string): void {
  injectedProviderIds.delete(providerId)
}

/** 当前登记的全部 id 的快照（同步清理时遍历用；不要在遍历中直接改集合）。 */
export function listInjectedPluginProviderIds(): string[] {
  return [...injectedProviderIds]
}
