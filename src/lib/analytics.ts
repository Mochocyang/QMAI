/**
 * 用户统计 - 静默上报模块
 *
 * 功能：
 * - 软件启动时发送 /open（注册 + 标记在线，附带版本号与平台）
 * - 运行期间每 5 分钟发送 /heartbeat（刷新在线状态）
 * - 软件关闭时发送 /close（标记离线）
 * - 无任何 UI，完全后台运行
 * - 失败静默忽略，不影响正常使用
 *
 * ⚠️ 心跳间隔与服务端在线窗口是配套的：服务端按"最近 15 分钟内有心跳"
 * 判定在线（analytics-worker/src/index.ts 的 ACTIVE_ONLINE_WINDOW_MS）。
 * 改这里的间隔必须同步检查服务端窗口，否则用户会在两次心跳之间被判离线。
 * 之所以放宽到 5 分钟，是因为免费版 D1 每天只有 10 万行写入额度，
 * 1 分钟心跳在约 20~25 个并发在线用户时就会打爆。
 */

import { getStore } from "@/lib/web-store"
import { isTauri } from "@/lib/platform"

// ⚠️ 部署 Worker 后，将此 URL 替换为你的实际 Worker 地址
const ANALYTICS_URL = "https://qmai-analytics.qmai.workers.dev"

const DEVICE_UUID_KEY = "analytics_device_uuid"
const HEARTBEAT_INTERVAL_MS = 5 * 60_000

/** 缓存的版本号与平台，只在启动时解析一次 */
let cachedVersion = ""
let cachedPlatform = ""

/**
 * 从 userAgent 推断平台。
 *
 * 刻意不引入 @tauri-apps/plugin-os：那会增加一个 Rust 依赖、一条
 * capability 和打包体积，只为拿三个字符串不划算。userAgent 在
 * WebView2 / WKWebView 里都能稳定区分这两个平台。
 */
function detectPlatform(): string {
  if (typeof navigator === "undefined") return ""
  const ua = navigator.userAgent
  if (/Macintosh|Mac OS X/i.test(ua)) return "macos"
  if (/Windows/i.test(ua)) return "windows"
  if (/Linux/i.test(ua)) return "linux"
  return "unknown"
}

/**
 * 获取应用版本与平台标识。
 * 版本读取失败时返回空串，服务端会归到「未知」分组，不影响其他统计。
 */
async function resolveAppMeta(): Promise<{ version: string; platform: string }> {
  const platform = isTauri() ? detectPlatform() : "web"
  try {
    const { getVersion } = await import("@tauri-apps/api/app")
    const version = await getVersion()
    return { version: version ?? "", platform }
  } catch {
    return { version: "", platform }
  }
}

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
    const payload = {
      uuid,
      ...(cachedVersion ? { version: cachedVersion } : {}),
      ...(cachedPlatform ? { platform: cachedPlatform } : {}),
    }
    // Tauri 环境使用 plugin-http（避免 CORS 问题）
    // 非 Tauri 环境直接用 fetch
    if (isTauri()) {
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http")
      await tauriFetch(`${ANALYTICS_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    } else {
      await fetch(`${ANALYTICS_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
 *
 * ⚠️ 唯一的调用点在 src/App.tsx 的启动流程里。它曾经在 26f80ee6 被整块删掉，
 * 导致本模块被 tree-shake、后台统计全面停摆。改动前请先看回归守卫：
 * src/lib/analytics-wiring.test.ts。
 */
export async function initAnalytics(): Promise<void> {
  try {
    const meta = await resolveAppMeta()
    cachedVersion = meta.version
    cachedPlatform = meta.platform
    cachedUUID = await getDeviceUUID()

    // 上报启动（在线）
    await sendAnalytics("/open", cachedUUID)

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
        // 使用 sendBeacon 确保关闭时请求能发出。
        // 注意：桌面端关窗不保证触发本事件，因此服务端不能只依赖 /close
        // 判断离线，在线判定以 last_active 的滚动窗口为准。
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
