/**
 * 限流决策（纯函数，便于单测）。
 *
 * D1 的 rate_limits 表只有 bucket / window_start / count 三列，因此采用
 * 以首次请求为起点的固定窗口：窗口内计数达到上限即拒绝，窗口结束后重置。
 * 写入由单条 UPSERT ... RETURNING 完成，返回的 count 已包含本次请求。
 */

export interface RateLimitState {
  windowStart: number
  count: number
}

export interface RateLimitDecision {
  allowed: boolean
  state: RateLimitState
  retryAfterSeconds: number
}

export interface RateLimitPeek {
  allowed: boolean
  retryAfterSeconds: number
}

function isWindowActive(
  previous: RateLimitState | null | undefined,
  windowSeconds: number,
  nowSeconds: number,
): previous is RateLimitState {
  return (
    previous !== null &&
    previous !== undefined &&
    Number.isFinite(previous.windowStart) &&
    Number.isFinite(previous.count) &&
    previous.windowStart <= nowSeconds &&
    nowSeconds < previous.windowStart + windowSeconds
  )
}

/**
 * 仅测试参考：模拟一次消费后的结果，语义与 db.consumeRateLimit 的单条 SQL 一致。
 * 生产写入只走 db.consumeRateLimit，本函数当前无生产调用。
 * 窗口内 count + 1，窗口外新开窗口 count = 1；allowed 用 count <= limit。
 */
export function evaluateRateLimit(
  previous: RateLimitState | null | undefined,
  limit: number,
  windowSeconds: number,
  nowSeconds: number,
): RateLimitDecision {
  const active = isWindowActive(previous, windowSeconds, nowSeconds)
  const windowStart = active ? previous.windowStart : nowSeconds
  const count = active ? Math.max(0, Math.floor(previous.count)) + 1 : 1
  const allowed = count <= limit

  return {
    allowed,
    state: { windowStart, count },
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, windowStart + windowSeconds - nowSeconds),
  }
}

/**
 * 只读判断：不消费配额，用于登录前保护 PBKDF2 的 CPU 闸门。
 * count 是已发生次数；还有余量（count < limit）才允许。
 */
export function peekRateLimitDecision(
  previous: RateLimitState | null | undefined,
  limit: number,
  windowSeconds: number,
  nowSeconds: number,
): RateLimitPeek {
  const active = isWindowActive(previous, windowSeconds, nowSeconds)
  const count = active ? Math.max(0, Math.floor(previous.count)) : 0
  const allowed = count < limit

  return {
    allowed,
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, (active ? previous.windowStart : nowSeconds) + windowSeconds - nowSeconds),
  }
}
