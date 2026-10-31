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
import { NETCARD_ISSUE_PATH, netcardOf } from "./netcard"
import { BUILTIN_PROVIDER_ID, applyBuiltinModels } from "./provider-bridge"
import type { StoredAccountSession } from "@/lib/account/types"
import { getHttpFetch } from "@/lib/tauri-fetch"

/** 防止登录 + bootstrap 并发触发时重复拉清单。 */
let inFlight: Promise<boolean> | null = null

/** 上一次成功登记的"卡 + 清单"指纹，避免每次刷新都重写配置。 */
let lastSignature = ""

/**
 * 老版本会话补签卡。
 *
 * 背景：网关卡字段是后加的，早期登录的用户 localStorage 里 `netcard: null`。
 * 虽然后端 refresh 已经会回传，但用户可能长时间不触发 refresh（现有 accessToken
 * 还没过期）。所以这里再兜一层：缺卡时主动调 `/v1/netcard` 换一张。
 *
 * 换到卡后顺手写回会话，下次启动就不用再换。
 */
async function repairMissingNetcard(session: StoredAccountSession): Promise<string | null> {
  try {
    const fetcher = await getHttpFetch()
    const response = await fetcher(`${session.baseUrl.replace(/\/+$/, "")}${NETCARD_ISSUE_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
      signal: AbortSignal.timeout(15_000),
    })
    const payload = (await response.json().catch(() => null)) as
      | { success?: boolean; data?: { netcard?: string } }
      | null
    const card = payload?.data?.netcard
    if (!response.ok || typeof card !== "string" || card.length === 0) {
      console.warn("[builtin] 补签网关卡失败", { status: response.status })
      return null
    }

    // 写回内存与磁盘：不改的话下次启动还得再换一次。
    const { useAccountStore } = await import("@/stores/account-store")
    const { saveAccountSession } = await import("@/lib/account/session")
    const next = { ...session, netcard: card }
    saveAccountSession(next)
    useAccountStore.getState().replaceSession(next)
    console.info("[builtin] 已为老会话补签网关卡")
    return card
  } catch (error) {
    console.warn("[builtin] 补签网关卡异常", error)
    return null
  }
}

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
  if (inFlight) {
    console.info("[builtin] 已有同步在进行，复用")
    return inFlight
  }

  let card = netcardOf(session)
  if (!card && session) {
    // 老会话没有卡：先尝试补签一次，而不是直接放弃。
    card = await repairMissingNetcard(session)
  }
  if (!card) {
    console.warn("[builtin] 会话里没有网关卡 —— 内置模型无法登记")
    lastSignature = ""
    removeBuiltinProvider()
    return false
  }

  const usableCard = card
  inFlight = (async () => {
    try {
      const relay = normalizeGatewayBaseUrl(DEFAULT_RELAY_URL) || DEFAULT_RELAY_URL
      console.info("[builtin] 开始拉取模型清单", { relay, cardTail: usableCard.slice(-8) })
      const models = await gatewayListModels(relay, usableCard)
      console.info("[builtin] 清单返回", { count: models.length })
      if (models.length === 0) {
        console.warn("[builtin] 中转站返回了空模型清单，保留原有配置")
        return false
      }

      // 卡没变、清单也没变 → 不重复写盘（每次启动都写一遍会无谓改动配置文件）
      const signature = `${usableCard.slice(-24)}|${models.join(",")}`
      if (signature === lastSignature) {
        console.info("[builtin] 卡与清单都没变，跳过写盘")
        return true
      }

      console.info("[builtin] 写入 provider 配置", { modelIds: models })
      const result = await applyBuiltinModels({ session: { serverUrl: relay }, modelIds: models, makeDefault: false })
      console.info("[builtin] 写入完成", result)
      lastSignature = signature
      return true
    } catch (error) {
      console.error("[builtin] 自动登记内置模型失败：", error)
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
