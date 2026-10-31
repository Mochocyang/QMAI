/**
 * 内置模型的凭证层（网关卡版）。
 *
 * ## 与上一版的区别
 *
 * 上一版叫"票据"：30 分钟过期，客户端要反复换 —— 把**认证状态**当**配置数据**同步，天生脆。
 * 现在叫"网关卡"：与账号 session 绑定的长期凭证，**登录一次拿到手，之后永远不用换**。
 *
 * 因此这个文件不再需要：
 *   - 过期判断 / 提前续签
 *   - 并发去重
 *   - 换票失败回退
 * 只剩三件事：从登录结果里取卡、存起来、取出来给请求用。
 *
 * ## 存在哪
 *
 * 存在**账号登录态**里（localStorage 的 account session），不单独开一份。
 * 理由：卡与登录态同生共死 —— 退出登录就该一起清掉，多存一处只会制造不一致。
 * 传输层（Tauri）拿到的是内存里的字符串，不落额外文件。
 */

import type { StoredAccountSession } from "@/lib/account/types"

/** 中转站基址。 */
export const DEFAULT_RELAY_URL = "https://relay.qmai.work"

/** 账号服务里的签发接口（老用户升级时用一次）。 */
export const NETCARD_ISSUE_PATH = "/v1/netcard"

/**
 * 从登录/注册/刷新的返回里取出网关卡。
 *
 * 后端可能因未配私钥而返回 null —— 这时不要抛错：登录本身是成功的，
 * 只是"内置模型不可用"，由界面给出提示。
 */
export function netcardFromAuthPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const data = (payload as { data?: unknown }).data
  if (!data || typeof data !== "object") return null
  const card = (data as { netcard?: unknown }).netcard
  return typeof card === "string" && card.length > 0 ? card : null
}

/** 当前会话的网关卡（没有就返回 null）。 */
export function netcardOf(session: StoredAccountSession | null | undefined): string | null {
  const card = session?.netcard
  return typeof card === "string" && card.length > 0 ? card : null
}

/**
 * 判断某个 provider 配置是否指向内置中转站。
 *
 * 用 URL 前缀判断而不是 provider id：用户可能自己建了同名 provider，
 * 只有真正指向 relay 域名的那一份才该注入网关卡。
 */
export function isBuiltinRelayEndpoint(endpoint: string | undefined): boolean {
  const value = (endpoint ?? "").trim()
  if (!value) return false
  return value.startsWith(DEFAULT_RELAY_URL)
}

/** 判断内置模型现在能不能用（已登录 + 手上有卡）。 */
export function hasUsableNetcard(session: StoredAccountSession | null | undefined): boolean {
  return netcardOf(session) !== null
}
