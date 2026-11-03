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

import { gatewayListModelCatalog, normalizeGatewayBaseUrl, DEFAULT_RELAY_URL } from "./gateway-api"
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
 * 背景：网关卡字段是后加的，早期登录的用户会话里 `netcard: null`。
 * 虽然后端 refresh 已经会回传，但用户可能长时间不触发 refresh（现有 accessToken
 * 还没过期）。所以这里再兜一层：缺卡时主动调 `/v1/netcard` 换一张。
 *
 * ## 必须带上设备指纹与签名公钥（2026-11-03 修）
 *
 * 原来只发 `{ refreshToken }`，服务端签出来的卡就**不含 `dev`/`dpk`**：
 *   · 网关拿不到设备指纹 → 走「首绑放行」→ 卡被抄到别的机器照样能用；
 *   · 卡里没有公钥 → 客户端签的 `X-Request-Sig` 无处验，签名防护失效。
 * 也就是说：走补签路径拿到的卡是「永远不绑定设备」的弱卡，而这条路径恰恰是
 * 老用户唯一的取卡方式。现在与登录/续期一致，把两个字段一起上报。
 *
 * 换到卡后顺手写回会话，下次启动就不用再换。
 */
async function repairMissingNetcard(session: StoredAccountSession): Promise<string | null> {
  try {
    const fetcher = await getHttpFetch()

    /*
     * 与登录/续期同源地取设备字段：签进卡里的 dev/dpk 是网关卡「离开原机器
     * 就失效」的唯一依据，补签路径漏了它们，补出来的卡就是无绑定的弱卡。
     * 取不到就不上报（服务端沿用「缺字段则跳过」的旧行为），不编造。
     */
    const body: Record<string, unknown> = { refreshToken: session.refreshToken }
    try {
      const { getDeviceFingerprint } = await import("@/lib/account/device")
      const deviceHash = await getDeviceFingerprint()
      if (deviceHash) body.deviceHash = deviceHash
    } catch {
      // 取不到设备指纹：不上报，服务端按缺字段处理。
    }
    try {
      const { ensureDeviceKey } = await import("@/lib/account/request-sign")
      const deviceKey = await ensureDeviceKey()
      if (deviceKey?.publicKey) body.devicePublicKey = deviceKey.publicKey
    } catch {
      // 生成不了密钥对（环境不支持 Ed25519）：同上。
    }

    const response = await fetcher(`${session.baseUrl.replace(/\/+$/, "")}${NETCARD_ISSUE_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(body),
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

/**
 * 移除已登记的内置模型配置。
 *
 * **只在「确认没有会话」时调用**（用户退出登录 / 注销账号）。
 * 故障态（有会话但签不出卡、拉不到清单）绝不能走这里 —— 见 syncBuiltinModels
 * 里的注释：删掉之后用户无法自愈，只能等下一次登录重新登记。
 */
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
 *
 * 返回 true 表示当前已登记可用清单；false 表示没有卡或拉取失败。
 *
 * ## 故障态 vs 确认无会话（2026-11-03 修）
 *
 * 入参有两种「没有卡」的语义，此前混为一谈：
 *   - `session === null`：**确认**这台机器没有登录态（退出登录 / 注销）
 *     → 应当移除内置模型配置，否则下拉框里留着一个永远用不了的选项。
 *   - `session` 有值但没有网关卡：这是**故障**（服务端签发失败、网络抖动）
 *     → **必须保留配置**。曾经的实现一律删除，导致用户遇到一次签卡失败就
 *       永久失去内置模型，且下次登录若仍签不出卡也回不来 —— 表现为
 *       「内置模型突然没了，且怎么都恢复不了」（这是一个真实的线上事故）。
 */
export async function syncBuiltinModels(session: StoredAccountSession | null): Promise<boolean> {
  if (inFlight) {
    console.info("[builtin] 已有同步在进行，复用")
    return inFlight
  }

  // 确认无会话：这才是真正该清理配置的场景。
  if (!session) {
    console.warn("[builtin] 确认没有登录态 —— 移除内置模型配置")
    lastSignature = ""
    removeBuiltinProvider()
    return false
  }

  let card = netcardOf(session)
  if (!card) {
    // 老会话没有卡：先尝试补签一次，而不是直接放弃。
    card = await repairMissingNetcard(session)
  }
  if (!card) {
    /*
     * 有会话但拿不到卡 = 故障态。此时**保留**已有配置并返回 false：
     *   · 配置还在，用户至少能看到条目（只是调用会失败并给出明确报错）；
     *   · 下次登录/刷新成功登记后即可自愈；
     *   · 若在这里删除，用户没有任何自助恢复手段。
     */
    console.warn("[builtin] 会话存在但拿不到网关卡 —— 保留内置模型配置，等下次同步")
    return false
  }

  const usableCard = card
  inFlight = (async () => {
    try {
      const relay = normalizeGatewayBaseUrl(DEFAULT_RELAY_URL) || DEFAULT_RELAY_URL
      console.info("[builtin] 开始拉取模型清单", { relay, cardTail: usableCard.slice(-8) })
      const catalog = await gatewayListModelCatalog(relay, usableCard)
      const modelIds = catalog.map((item) => item.id)
      console.info("[builtin] 清单返回", { count: modelIds.length })
      if (modelIds.length === 0) {
        console.warn("[builtin] 中转站返回了空模型清单，保留原有配置")
        return false
      }

      /*
       * 卡没变、清单没变、**倍率也没变** → 不重复写盘。
       *
       * 倍率必须进签名：控制台改了倍率、清单一个字都没变时，之前的签名会判定
       * 「什么都没变」而跳过写盘，用户就永远看不到新倍率。
       */
      const ratioSignature = catalog
        .map((item) => `${item.id}:${item.ratio ?? ""}:${item.displayName ?? ""}`)
        .join(",")
      const signature = `${usableCard.slice(-24)}|${ratioSignature}`
      if (signature === lastSignature) {
        console.info("[builtin] 卡、清单与倍率都没变，跳过写盘")
        return true
      }

      console.info("[builtin] 写入 provider 配置", { modelIds })
      const result = await applyBuiltinModels({
        session: { serverUrl: relay },
        modelIds,
        catalog,
        makeDefault: false,
      })
      console.info("[builtin] 写入完成", result)
      lastSignature = signature
      return true
    } catch (error) {
      console.error("[builtin] 自动登记内置模型失败：", error)
      // 卡在但拉不到清单：不清配置（可能只是网关抖动），下次刷新会再试
      return false
    } finally {
      inFlight = null
      lastRefreshAt = Date.now()
    }
  })()

  return inFlight
}

/** 下拉框打开时的最短刷新间隔：防连点造成请求风暴。 */
export const BUILTIN_REFRESH_MIN_INTERVAL_MS = 30_000

let lastRefreshAt = 0

/**
 * 按需刷新倍率（下拉框打开时调）。
 *
 * 倍率必须与控制台一致且能立即生效，所以不能只靠「登录时同步一次」：
 * 用户打开下拉框就是要挑模型，这一刻拿到的倍率必须是最新的。
 * 但下拉框可能被反复打开，所以加一个 30 秒节流；命中节流时静默跳过，
 * 界面上仍然显示上一次缓存的值，不会闪。
 */
export async function refreshBuiltinModels(
  session?: StoredAccountSession | null,
  minIntervalMs = BUILTIN_REFRESH_MIN_INTERVAL_MS,
): Promise<void> {
  if (Date.now() - lastRefreshAt < minIntervalMs) return
  const current = session !== undefined
    ? session
    : (await import("@/stores/account-store")).useAccountStore.getState().session
  /*
   * 没有登录态时什么都不做。
   *
   * `syncBuiltinModels(null)` 的语义是「确认没有卡 → 清掉内置模型配置」，
   * 那是退出登录该做的事。这里如果也走那条路，未登录用户只是打开一次下拉框，
   * 就会把配置删掉，属于不该有的副作用。
   */
  if (!current) return
  lastRefreshAt = Date.now()
  await syncBuiltinModels(current)
}

/** 测试用：重置内部状态。 */
export function resetBuiltinSyncState(): void {
  inFlight = null
  lastSignature = ""
  lastRefreshAt = 0
}
