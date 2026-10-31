/**
 * 设备绑定：限制「一台设备最多注册 N 个账号」。
 *
 * ## 为什么靠设备指纹而不是 IP
 *
 * IP 限制挡不住换代理：一个 IP 每小时能发 20 次码，换 10 个代理就是 200 个账号。
 * 设备指纹是更硬的身份锚点 —— 同一台电脑换多少 IP、清多少缓存，指纹都不变。
 *
 * ## 隐私边界
 *
 * 客户端在 Rust 侧就对 MachineGuid 做了 SHA-256，只上报 32 位十六进制摘要。
 * 服务端**拿不到也存不下**原始机器标识，无法反推、也挪作不了别的用途。
 *
 * ## 限额策略
 *
 * 默认「一台设备最多 3 个账号」。
 *   - 已存在的（设备, 账号）组合：放行并刷新 last_seen_at
 *   - 新组合但该设备账号数 < 上限：放行并记录
 *   - 已达上限：拒绝注册
 *
 * 登录时不拦截 —— 已达上限的设备，用已有账号登录天经地义。
 */

import type { Env } from "./types"

/** 一台设备最多绑定几个账号（默认 3，可用 MAX_ACCOUNTS_PER_DEVICE 覆盖，便于测试）。 */
export const DEFAULT_MAX_ACCOUNTS_PER_DEVICE = 3

export function maxAccountsPerDevice(env: Env): number {
  const raw = Number((env.MAX_ACCOUNTS_PER_DEVICE ?? "").trim())
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_ACCOUNTS_PER_DEVICE
}

/** 设备指纹格式：32 位十六进制（客户端 SHA-256 前 16 字节）。 */
const DEVICE_HASH_PATTERN = /^[0-9a-f]{32}$/

export function isValidDeviceHash(value: unknown): value is string {
  return typeof value === "string" && DEVICE_HASH_PATTERN.test(value)
}

export interface DeviceCheck {
  allowed: boolean
  /** 该设备已绑定的账号数（含本次）。 */
  count: number
  limit: number
}

/**
 * 注册前检查：这台设备还能不能再绑一个账号。
 *
 * 注意顺序：先查再写。真正的写入在 `bindDevice`，注册成功后调用 ——
 * 避免"注册失败但设备额度已经被占掉"。
 */
export async function checkDeviceQuota(
  env: Env,
  deviceHash: string,
): Promise<DeviceCheck> {
  const db = env.DB
  const result = await db
    .prepare("SELECT COUNT(*) AS n FROM device_accounts WHERE device_hash = ?1")
    .bind(deviceHash)
    .first<{ n: number }>()
  const count = Number(result?.n ?? 0)
  const limit = maxAccountsPerDevice(env)
  return { allowed: count < limit, count, limit }
}

/** 绑定（幂等）：重复登录只刷新 last_seen_at。 */
export async function bindDevice(
  db: Env["DB"],
  deviceHash: string,
  userId: number,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO device_accounts (device_hash, user_id, first_seen_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT(device_hash, user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    )
    .bind(deviceHash, userId, now)
    .run()
}

/** 某设备绑定过的账号列表（管理端排查用）。 */
export async function listDeviceAccounts(
  db: Env["DB"],
  deviceHash: string,
): Promise<number[]> {
  const result = await db
    .prepare("SELECT user_id FROM device_accounts WHERE device_hash = ?1 ORDER BY first_seen_at ASC")
    .bind(deviceHash)
    .all<{ user_id: number }>()
  return result.results.map((row) => Number(row.user_id))
}

/** 某账号出现过的设备数（异常检测用：一个号在多台机器登录）。 */
export async function countUserDevices(db: Env["DB"], userId: number): Promise<number> {
  const result = await db
    .prepare("SELECT COUNT(*) AS n FROM device_accounts WHERE user_id = ?1")
    .bind(userId)
    .first<{ n: number }>()
  return Number(result?.n ?? 0)
}
