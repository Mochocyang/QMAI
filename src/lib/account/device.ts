/**
 * 设备指纹（前端侧）：从 Tauri 取本机标识摘要并缓存。
 *
 * Rust 侧已经把 MachineGuid 做了 SHA-256，这里拿到的就是可直接上报的 32 位十六进制。
 * 浏览器环境下不可用（返回 null），服务端据此跳过设备限额 —— 宁可少拦，不要让
 * 纯网页环境装不上。
 */

import { isTauri } from "@/lib/platform"

/** 一次进程内只取一次；Rust 侧也有 OnceLock，这里避免重复 invoke。 */
let cached: string | null | undefined

/**
 * 取设备指纹。
 * @returns 32 位十六进制摘要；非 Tauri 环境或取不到时返回 null。
 */
export async function getDeviceFingerprint(): Promise<string | null> {
  if (cached !== undefined) return cached
  if (!isTauri()) {
    cached = null
    return null
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    const value = await invoke<string>("device_fingerprint")
    cached = typeof value === "string" && /^[0-9a-f]{32}$/.test(value) ? value : null
    return cached
  } catch (error) {
    console.warn("[device] 读取设备指纹失败：", error)
    cached = null
    return null
  }
}

/** 测试用：清空缓存。 */
export function resetDeviceFingerprintCache(): void {
  cached = undefined
}
