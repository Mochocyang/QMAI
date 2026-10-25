/**
 * 固定窗口限流决策（纯函数，便于单测）。
 *
 * D1 的 rate_limits 表只有 bucket / window_start / count 三列，因此采用
 * 以首次请求为起点的固定窗口：窗口内计数达到上限即拒绝，窗口结束后重置。
 * 发送验证码另有独立的 60 秒冷却桶（limit=1, window=60）。
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

export function evaluateRateLimit(
  previous: RateLimitState | null | undefined,
  limit: number,
  windowSeconds: number,
  nowSeconds: number,
): RateLimitDecision {
  const validPrevious =
    previous !== null &&
    previous !== undefined &&
    Number.isFinite(previous.windowStart) &&
    Number.isFinite(previous.count) &&
    previous.windowStart <= nowSeconds &&
    nowSeconds < previous.windowStart + windowSeconds

  const windowStart = validPrevious ? previous.windowStart : nowSeconds
  const count = validPrevious ? Math.max(0, Math.floor(previous.count)) : 0
  const allowed = count < limit

  return {
    allowed,
    state: {
      windowStart,
      count: allowed ? count + 1 : count,
    },
    retryAfterSeconds: allowed ? 0 : Math.max(1, windowStart + windowSeconds - nowSeconds),
  }
}
