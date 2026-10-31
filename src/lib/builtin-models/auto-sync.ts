/**
 * 登录后自动登记内置模型（无需用户打开任何设置页）。
 *
 * ## 为什么需要这一层
 *
 * 之前内置模型要用户手动去「设置 → 内置模型」点「启用」。那个页面已经删掉了，
 * 因为产品上要求是「登录后模型直接出现在各个对话框的模型下拉里」——
 * 用户不该为了用内置模型再点一次按钮。
 *
 * ## 什么时候调
 *
 * - 登录成功
 * - 注册成功（注册后自动登录）
 * - 应用启动 bootstrap（已登录态）
 * - token 刷新成功（顺便校验卡还在不在）
 *
 * ## 关键约束
 *
 * 1. **不抢默认模型**：`makeDefault: false`。用户自己选的默认模型不该被登录动作改掉，
 *    内置模型只是"多几个可选项"。
 * 2. **没卡就清掉**：退出登录或卡被吊销时，把 provider 配置移除，
 *    否则下拉框里会出现"选了就 401"的死选项。
 * 3. **失败不抛**：这是锦上添花的自动登记，网络抖动不该让登录本身失败。
 *    失败时清掉旧配置（避免显示过期清单），并记一条日志。
 */

import { gatewayListModels, normalizeGatewayBaseUrl, DEFAULT_RELAY_URL } from "./gateway-api"
import { netcardOf } from "./netcard"
import { BUILTIN_PROVIDER_ID, applyBuiltinModels } from "./provider-bridge"
import type { StoredAccountSession } from "@/lib/account/types"

/** 防止登录 + bootstrap 并发触发时重复拉清单。 */
let inFlight: Promise<boolean> | null = null

/** 上一次成功登记的"卡 + 清单"指纹，避免每次刷新都重写配置。 */
let lastSignature = ""

function removeBuiltinProvider(): void {
  // 动态 import 避免 lib → store 的顶层循环依赖
  return void import("@/stores/wiki-store").then(async ({ useWikiStore }) => {
    const store = useWikiStore.getState()
    if (!store.providerConfigs[BUILTIN_PROVIDER_ID]) return
    const next = { ...store.providerConfigs }
    delete next[BUILTIN_PROVIDER_ID]
    const { saveProviderConfigs } = await import("@/lib/project-store")
    await saveProviderConfigs(next).catch(() => {})
    useWikiStore.getState().setProviderConfigs(next)
  })
}

/**
 * 同步内置模型清单到 provider 配置。
 * 返回 true 表示当前已登记可用清单；false 表示没有卡或拉取失败。
 */
export async function syncBuiltinModels(session: StoredAccountSession | null): Promise<boolean> {
  if (inFlight) return inFlight

  const card = netcardOf(session)
  if (!card) {
    lastSignature = ""
    removeBuiltinProvider()
    return false
  }

  inFlight = (async () => {
    try {
      const relay = normalizeGatewayBaseUrl(DEFAULT_RELAY_URL) || DEFAULT_RELAY_URL
      const models = await gatewayListModels(relay, card)
      if (models.length === 0) {
        console.warn("[builtin] 中转站返回了空模型清单，保留原有配置")
        return false
      }

      // 卡没变、清单也没变 → 不重复写盘（每次启动都写一遍会无谓改动配置文件）
      const signature = `${card.slice(-24)}|${models.join(",")}`
      if (signature === lastSignature) return true

      await applyBuiltinModels({ session: { serverUrl: relay }, modelIds: models, makeDefault: false })
      lastSignature = signature
      return true
    } catch (error) {
      console.warn("[builtin] 自动登记内置模型失败：", error)
      // 卡在但拉不到清单：不清配置（可能只是网关抖动），下次刷新会再试
      return false
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

/** 测试用：重置内部状态。 */
export function resetBuiltinSyncState(): void {
  inFlight = null
  lastSignature = ""
}
