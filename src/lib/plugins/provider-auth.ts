import { invoke } from "@tauri-apps/api/core"

/**
 * 插件 provider 的 bearer token 缓存。
 *
 * token **不落盘**（v2.0 计划第 0 节）：它只活在 Rust 内存里，前端需要时通过
 * `plugins_provider_auth` 现取。这里按进程缓存一份，省掉每个请求一次 IPC ——
 * 一次聊天会发多个请求（重试、Agent 多轮），不缓存就是每轮一次跨进程往返。
 *
 * 插件停用/卸载/崩溃后**必须**调用 `clearPluginProviderAuth(providerId)`：
 * 否则后续请求会带着已失效的 token 打到已经关闭的端口上，症状是连接被拒或 401，
 * 而不是「provider 已停用」这种能读懂的提示。
 *
 * 注意：这里缓存的是 token 而不是「provider 可用」，provider 的可用性由
 * `plugins_providers()` 的 `ready` 字段表达，两者不要混用。
 */
const tokenCache = new Map<string, string>()

/**
 * 取插件 provider 的 bearer token；同一 provider 在一个进程内只 IPC 一次。
 *
 * 失败时原样抛出 Rust 侧的错误字符串（例如「provider wb-connect 未就绪」），
 * 调用方（请求适配器）直接把它变成用户能看懂的报错，不要吞成笼统的「请求失败」。
 */
export async function ensurePluginProviderAuth(providerId: string): Promise<string> {
  const hit = tokenCache.get(providerId)
  if (hit) return hit
  const token = await invoke<string>("plugins_provider_auth", { providerId })
  tokenCache.set(providerId, token)
  return token
}

/**
 * 同步读已缓存的 token（没有则返回 undefined）。
 *
 * 给同步调用方用：`getProviderConfig()` 是同步函数，拿不到 `await invoke()` 的结果，
 * 只能读这里的缓存。真正的请求前取 token 走 `ensurePluginProviderAuth()`。
 */
export function getCachedPluginProviderAuth(providerId: string): string | undefined {
  return tokenCache.get(providerId)
}

/**
 * 清缓存。传 `providerId` 只清该 provider；不传则全清（例如退出登录 / 关闭插件系统）。
 * 插件停用、卸载、崩溃重启后都要调，避免继续用旧 token。
 */
export function clearPluginProviderAuth(providerId?: string): void {
  if (providerId === undefined) tokenCache.clear()
  else tokenCache.delete(providerId)
}
