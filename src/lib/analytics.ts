/**
 * 用户统计 - 静默上报模块
 *
 * 功能：
 * - 软件启动时发送 /open（注册 + 标记在线）
 * - 软件关闭时发送 /close（标记离线）
 * - 无任何 UI，完全后台运行
 * - 失败静默忽略，不影响正常使用
 */

import { getStore } from "@/lib/web-store"
import { isTauri } from "@/lib/platform"

// ⚠️ 部署 Worker 后，将此 URL 替换为你的实际 Worker 地址
const ANALYTICS_URL = "https://qmai-analytics.qmai.workers.dev"

const DEVICE_UUID_KEY = "analytics_device_uuid"
const HEARTBEAT_INTERVAL_MS = 60_000

/**
 * 获取或生成设备唯一标识
 * 存储在本地，重启软件后保持不变
 */
async function getDeviceUUID(): Promise<string> {
  try {
    const store = await getStore()
    const existing = await store.get<string>(DEVICE_UUID_KEY)
    if (existing) return existing

    const uuid = crypto.randomUUID()
    await store.set(DEVICE_UUID_KEY, uuid)
    return uuid
  } catch {
    // 降级：每次生成新的（会多计一个用户，但不影响在线数）
    return crypto.randomUUID()
  }
}

/**
 * 发送统计请求（静默，失败不报错）
 */
async function sendAnalytics(
  endpoint: string,
  uuid: string,
): Promise<void> {
  try {
    // Tauri 环境使用 plugin-http（避免 CORS 问题）
    // 非 Tauri 环境直接用 fetch
    if (isTauri()) {
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http")
      await tauriFetch(`${ANALYTICS_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuid }),
      })
    } else {
      await fetch(`${ANALYTICS_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuid }),
      })
    }
  } catch {
    // 静默失败，不影响软件使用
  }
}

/** 缓存 UUID 避免重复读取 */
let cachedUUID: string | null = null
let heartbeatTimer: number | null = null

/**
 * 初始化统计 - 在 App 启动时调用一次即可
 * 会自动注册 open 事件和 beforeunload close 事件
 */
export async function initAnalytics(): Promise<void> {
  try {
    cachedUUID = await getDeviceUUID()

    // 上报启动（在线）
    await sendAnalytics("/open", cachedUUID)
    await sendAnalytics("/heartbeat", cachedUUID)

    // 注册关闭事件
    if (typeof window !== "undefined") {
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer)
      }
      heartbeatTimer = window.setInterval(() => {
        if (cachedUUID) void sendAnalytics("/heartbeat", cachedUUID)
      }, HEARTBEAT_INTERVAL_MS)

      window.addEventListener("beforeunload", () => {
        if (!cachedUUID) return
        if (heartbeatTimer !== null) {
          window.clearInterval(heartbeatTimer)
          heartbeatTimer = null
        }
        // 使用 sendBeacon 确保关闭时请求能发出
        const blob = new Blob(
          [JSON.stringify({ uuid: cachedUUID })],
          { type: "application/json" },
        )
        navigator.sendBeacon(`${ANALYTICS_URL}/close`, blob)
      })
    }
  } catch {
    // 整个统计模块失败也不影响软件运行
  }
}
