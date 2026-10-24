/**
 * 自动同步的判定逻辑（纯函数）。
 *
 * 这些用例守的是「不该同步时一定不跑」：
 * 正在同步、刚失败过、错误需要用户动手、间隔没到 —— 每一条错了，
 * 用户看到的就是「云图标一直在转」「同一句报错反复弹」。
 */

import { describe, expect, it } from "vitest"

import {
  FOCUS_THROTTLE_MS,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  SAVE_DEBOUNCE_MS,
  backoffFor,
  baseIntervalFor,
  decideAutoRun,
  type ScheduleInput,
} from "./scheduler"

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    enabled: true,
    connected: true,
    running: false,
    lastAttemptAt: undefined,
    consecutiveFailures: 0,
    lastErrorCode: undefined,
    trigger: "editor-save",
    now: 1_000_000,
    ...overrides,
  }
}

describe("decideAutoRun", () => {
  it("没开同步或没连网盘时不做任何事", () => {
    expect(decideAutoRun(input({ enabled: false })).verdict).toBe("disabled")
    expect(decideAutoRun(input({ connected: false })).verdict).toBe("disabled")
  })

  it("正在同步时不重复发起", () => {
    expect(decideAutoRun(input({ running: true })).verdict).toBe("busy")
  })

  it("第一次落盘就直接跑（没有历史尝试）", () => {
    expect(decideAutoRun(input()).verdict).toBe("run")
  })

  it("保存后 8 秒内不再跑，并给出还要等多久", () => {
    const decision = decideAutoRun(
      input({ lastAttemptAt: 1_000_000 - 3_000, now: 1_000_000, trigger: "editor-save" }),
    )
    expect(decision.verdict).toBe("wait")
    expect(decision.waitMs).toBe(SAVE_DEBOUNCE_MS - 3_000)
  })

  it("攒够时间去抖时间后放行", () => {
    const decision = decideAutoRun(
      input({ lastAttemptAt: 1_000_000 - SAVE_DEBOUNCE_MS, now: 1_000_000, trigger: "editor-save" }),
    )
    expect(decision.verdict).toBe("run")
  })

  it("聚焦触发的门槛比保存高（切窗口不该每次都传）", () => {
    // 30 秒前刚同步过：保存触发应该放行，聚焦触发还要等。
    const lastAttemptAt = 1_000_000 - 30_000
    expect(decideAutoRun(input({ lastAttemptAt, trigger: "editor-save" })).verdict).toBe("run")
    const focus = decideAutoRun(input({ lastAttemptAt, trigger: "window-focus" }))
    expect(focus.verdict).toBe("wait")
    expect(focus.waitMs).toBe(FOCUS_THROTTLE_MS - 30_000)
  })

  it("刚连上网盘时立刻跑（不用等去抖）", () => {
    expect(decideAutoRun(input({ lastAttemptAt: 1_000_000, trigger: "first-connect" })).verdict).toBe("run")
  })

  it("失败后退避：1 分钟内不重试，到点放行", () => {
    const lastAttemptAt = 1_000_000 - 30_000
    const waiting = decideAutoRun(input({ lastAttemptAt, consecutiveFailures: 1 }))
    expect(waiting.verdict).toBe("wait")
    expect(waiting.waitMs).toBe(RETRY_BASE_MS - 30_000)

    const ready = decideAutoRun(
      input({ lastAttemptAt: 1_000_000 - RETRY_BASE_MS, consecutiveFailures: 1 }),
    )
    expect(ready.verdict).toBe("run")
  })

  it("需要用户动手的错误，自动触发直接停手", () => {
    for (const code of ["remote.missing", "webdav.reconnect", "auth.expired", "folder.not-writable"]) {
      const decision = decideAutoRun(
        input({ lastAttemptAt: 1_000_000 - 10 * RETRY_BASE_MS, consecutiveFailures: 1, lastErrorCode: code }),
      )
      expect(decision.verdict, code).toBe("needs-user")
    }
  })

  it("网络类错误仍会自动重试（这类会自己好）", () => {
    const decision = decideAutoRun(
      input({ lastAttemptAt: 1_000_000 - RETRY_BASE_MS, consecutiveFailures: 1, lastErrorCode: "net.offline" }),
    )
    expect(decision.verdict).toBe("run")
  })
})

describe("backoffFor", () => {
  it("按次数翻倍，并有上限", () => {
    expect(backoffFor(0)).toBe(0)
    expect(backoffFor(1)).toBe(RETRY_BASE_MS)
    expect(backoffFor(2)).toBe(RETRY_BASE_MS * 2)
    expect(backoffFor(3)).toBe(RETRY_BASE_MS * 4)
    expect(backoffFor(100)).toBe(RETRY_MAX_MS)
  })
})

describe("baseIntervalFor", () => {
  it("三种触发各有各的门槛", () => {
    expect(baseIntervalFor("editor-save")).toBe(SAVE_DEBOUNCE_MS)
    expect(baseIntervalFor("window-focus")).toBe(FOCUS_THROTTLE_MS)
    expect(baseIntervalFor("first-connect")).toBe(0)
    expect(FOCUS_THROTTLE_MS).toBeGreaterThan(SAVE_DEBOUNCE_MS)
  })
})
