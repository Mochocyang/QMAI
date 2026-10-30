/**
 * 内置模型的请求期鉴权注入。
 *
 * 问题：`llm-client` 在请求开始时一次性生成 headers；如果内置模型的凭证写死在
 * provider 配置里，那它就是一个"会过期的死值"（上一版 30 分钟票据正是栽在这）。
 *
 * 解法：**不在配置里存凭证**。每次发请求前，如果目标指向内置中转站，
 * 就从账号登录态里取当前网关卡，覆盖 Authorization 头。
 *
 * 好处：
 *   - 配置里没有会变的东西 → 不需要同步、不需要续期；
 *   - 换账号立刻生效（取的是"当前登录态"，不是复制的那份）；
 *   - 用户退出登录后自然失效（卡随登录态一起被清）。
 *
 * 这一层刻意做成纯函数 + 一个取会话的注入点，方便单测。
 */

import type { LlmConfig } from "@/stores/wiki-store"
import type { StoredAccountSession } from "@/lib/account/types"
import { DEFAULT_RELAY_URL, isBuiltinRelayEndpoint, netcardOf } from "./netcard"

/** 取当前登录态的实现，默认从 account-store 读；测试可替换。 */
export type SessionGetter = () => StoredAccountSession | null

let sessionGetter: SessionGetter = () => null

/** 应用启动时调用一次，把 account-store 接进来。 */
export function setBuiltinSessionGetter(getter: SessionGetter): void {
  sessionGetter = getter
}

/** 测试用：恢复默认（返回 null）。 */
export function resetBuiltinSessionGetter(): void {
  sessionGetter = () => null
}

export interface BuiltinAuthResult {
  config: LlmConfig
  /** 这次是否真的注入了网关卡。 */
  injected: boolean
}

/**
 * 把网关卡注入到配置里（只改 apiKey 与 endpoint，不动模型参数）。
 *
 * 没有卡时**不抛错**：让请求照常发出去，由网关返回 401，再转成"请登录"的提示。
 * 抛错会把"没登录"变成一个静默失败的写作任务，更难排查。
 */
export function withBuiltinAuth(config: LlmConfig, session: StoredAccountSession | null): BuiltinAuthResult {
  const endpoint = config.customEndpoint ?? ""
  if (!isBuiltinRelayEndpoint(endpoint)) return { config, injected: false }

  const card = netcardOf(session)
  if (!card) return { config, injected: false }

  return { config: { ...config, apiKey: card }, injected: true }
}

/** 从默认会话源注入（请求链路上用这个）。 */
export function applyBuiltinAuth(config: LlmConfig): BuiltinAuthResult {
  return withBuiltinAuth(config, sessionGetter())
}

/** 内置模型现在是否可用（已登录 + 有卡 + 已指向中转站）。 */
export function isBuiltinReady(config: LlmConfig): boolean {
  return isBuiltinRelayEndpoint(config.customEndpoint) && netcardOf(sessionGetter()) !== null
}

export { DEFAULT_RELAY_URL }
