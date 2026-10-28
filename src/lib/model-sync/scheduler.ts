/**
 * 同步时机策略（纯函数，便于单测）。
 *
 * 目标：在「改动及时同步」与「少写库」之间取平衡。D1 免费额度最紧的是
 * **每日写入行数**，所以推送必须攒批、限速、失败退避。
 *
 * 规则：
 * - 推送防抖 3 秒：连续改配置时只推最后一次；
 * - 连续编辑要停下 30 秒才推（用户在模型页操作时不打断）；
 * - 两次推送至少间隔 60 秒（冷却），把零碎改动攒成一批；
 * - 启动/登录时拉取，距上次拉取不足 5 分钟就跳过；
 * - 失败退避：30 秒 → 2 分钟 → 10 分钟，3 次后交给用户手动重试。
 */

export const PUSH_DEBOUNCE_MS = 3_000
export const EDIT_QUIET_MS = 30_000
export const PUSH_COOLDOWN_MS = 60_000
export const PULL_MIN_INTERVAL_MS = 5 * 60_000
export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000] as const

/** 是否该拉取云端：从未拉过、或距上次超过最小间隔。 */
export function shouldPull(lastPullAt: number | null, now: number): boolean {
  if (lastPullAt === null) return true
  if (!Number.isFinite(lastPullAt)) return true
  return now - lastPullAt >= PULL_MIN_INTERVAL_MS
}

/**
 * 距离下一次推送还要等多久（毫秒）；返回 0 表示现在就可以推，
 * 返回 `null` 表示当前没有待推送的改动。
 */
export function pushDelay(input: {
  /** 最近一次内容变更的时间戳；null/undefined 表示没有待推送改动。 */
  dirtyAt: number | null | undefined
  /** 最近一次推送（成功或失败）的时间戳。 */
  lastPushAt?: number | null
  /** 最近一次用户编辑配置的时间戳（用于「正在编辑就先别推」）。 */
  lastEditAt?: number | null
  now: number
}): number | null {
  const { dirtyAt, now } = input
  if (dirtyAt === null || dirtyAt === undefined) return null

  let readyAt = dirtyAt + PUSH_DEBOUNCE_MS

  const lastEditAt = input.lastEditAt
  if (lastEditAt !== null && lastEditAt !== undefined) {
    // 用户还在编辑：等停止操作满 30 秒再推。
    readyAt = Math.max(readyAt, lastEditAt + EDIT_QUIET_MS)
  }

  const lastPushAt = input.lastPushAt
  if (lastPushAt !== null && lastPushAt !== undefined) {
    readyAt = Math.max(readyAt, lastPushAt + PUSH_COOLDOWN_MS)
  }

  return Math.max(0, readyAt - now)
}

/** 第 N 次（从 0 开始）失败后的重试延迟；超出次数返回 null（改为手动重试）。 */
export function retryDelay(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 0) return RETRY_DELAYS_MS[0]
  if (attempt >= RETRY_DELAYS_MS.length) return null
  return RETRY_DELAYS_MS[attempt]
}
