/**
 * 自动同步的「什么时候该跑」判定（纯函数）。
 *
 * 这里只回答一个问题：这次触发要不要真的开一轮同步，不要就等多久。
 * 真正的 IO 在 Rust；定时器与事件订阅在 `use-cloud-sync-auto-sync.ts`。
 *
 * 三条铁律：
 * 1. **正在同步就什么都不做** —— 后端会回 `sync.busy`，但前端不该先去撞它。
 * 2. **保存后要攒一下**：用户连续打字会连着落盘，每次落盘都同步等于每几秒传一遍。
 * 3. **失败要退避**，但「需要用户动手」的错误（没选目录、密码没了、授权过期）**不退避也不重试**：
 *    重试一百次也不会好，只会一直弹气泡。
 */

/** 保存落盘后等多久再同步（攒一批改动）。 */
export const SAVE_DEBOUNCE_MS = 8_000
/** 窗口重新聚焦时的最小间隔：切来切去不该每次都传。 */
export const FOCUS_THROTTLE_MS = 120_000
/** 失败退避的起点与上限。 */
export const RETRY_BASE_MS = 60_000
export const RETRY_MAX_MS = 10 * 60_000

/** 只有这三种是「自动触发」；手动同步和重试不走这里的判定。 */
export type AutoTrigger = "editor-save" | "window-focus" | "first-connect"

export type ScheduleVerdict =
  /** 可以跑。 */
  | "run"
  /** 云同步关着，或还没连网盘。 */
  | "disabled"
  /** 上一轮还没结束。 */
  | "busy"
  /** 间隔/退避没到，等 `waitMs` 再说。 */
  | "wait"
  /** 上一次的错误得用户自己处理，自动触发不再重试。 */
  | "needs-user"

export interface ScheduleInput {
  enabled: boolean
  connected: boolean
  running: boolean
  /** 上一次真正发起同步的时刻（毫秒）。 */
  lastAttemptAt?: number
  /** 连续失败次数（成功一次就清零）。 */
  consecutiveFailures?: number
  /** 上一次失败的错误码，用来识别「重试无意义」的情况。 */
  lastErrorCode?: string
  trigger: AutoTrigger
  now: number
}

export interface ScheduleDecision {
  verdict: ScheduleVerdict
  /** `wait` 时建议的等待时长（毫秒）。 */
  waitMs: number
}

/**
 * 这些错误重试不会自己好：目录没了、密码没了、授权过期、应用没审核。
 * 自动触发遇到它们就停手，把决定权交回用户（气泡里已经有「去设置/重新登录」）。
 */
const NEEDS_USER_CODES = new Set([
  "remote.missing",
  "sync.disabled",
  "sync.baidu-review",
  "not.configured",
  "webdav.reconnect",
  // 限流是「等一会儿就好」，不是配置错，但也不该按指数退避猛撞服务端。
  "webdav.rate-limited",
  "webdav.auth",
  "webdav.read-only",
  "folder.missing",
  "folder.not-directory",
  "folder.not-writable",
  "folder.is-project",
  "auth.required",
  "auth.expired",
  "auth.revoked",
  "auth.invalid-app",
  /*
   * GitHub 授权失效（401 Bad credentials）。
   *
   * 这个错误重试一百次也不会好 —— token 已经被 GitHub 吊销了。
   * 曾经没把它列进来，于是自动同步每两分钟撞一次，历史里堆出 162 条
   * 一模一样的失败，用户看着红点永远消不掉（真实投诉）。
   * 停手，把决定权交回用户：面板会提示「登录失效，请重新登录」。
   */
  "github.auth",
  "github.no-repo",
])

export function baseIntervalFor(trigger: AutoTrigger): number {
  switch (trigger) {
    case "editor-save":
      return SAVE_DEBOUNCE_MS
    case "window-focus":
      return FOCUS_THROTTLE_MS
    case "first-connect":
      // 刚连上就该立刻同步一次：用户此刻正盯着「已连接」，什么都不发生很像坏了。
      return 0
  }
}

/** 连续失败 n 次的退避时长：1 分钟、2 分钟、4 分钟……最多 10 分钟。 */
export function backoffFor(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0
  const steps = Math.min(consecutiveFailures - 1, 16)
  return Math.min(RETRY_BASE_MS * 2 ** steps, RETRY_MAX_MS)
}

export function decideAutoRun(input: ScheduleInput): ScheduleDecision {
  if (!input.enabled || !input.connected) return { verdict: "disabled", waitMs: 0 }
  if (input.running) return { verdict: "busy", waitMs: 0 }

  const failures = input.consecutiveFailures ?? 0
  if (failures > 0 && input.lastErrorCode && NEEDS_USER_CODES.has(input.lastErrorCode)) {
    return { verdict: "needs-user", waitMs: 0 }
  }

  const required = Math.max(baseIntervalFor(input.trigger), backoffFor(failures))
  const elapsed = input.now - (input.lastAttemptAt ?? 0)
  if (elapsed >= required) return { verdict: "run", waitMs: 0 }
  return { verdict: "wait", waitMs: required - elapsed }
}
