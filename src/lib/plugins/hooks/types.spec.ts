/**
 * 类型契约本身的测试。
 *
 * 默认超时表不是"文档里的数字"，而是宿主与 Rust 侧共用的契约：任一格数字漂移，
 * 超时预算就悄悄变成另一个值 —— 这种漂移没有任何编译错误来提醒，只能靠断言钉住。
 */
import { describe, expect, it } from "vitest"
import {
  HOOK_DEFAULT_TIMEOUT_MS,
  HOOK_EVENTS,
  OBSERVER_EVENTS,
  isHookEvent,
  isObserverEvent,
  resolveHookTimeoutMs,
} from "./types"

describe("HOOK_DEFAULT_TIMEOUT_MS", () => {
  it("四个组的预算与设计 §5.3 一致", () => {
    expect(HOOK_DEFAULT_TIMEOUT_MS.beforeLlmRequest).toBe(8_000)
    expect(HOOK_DEFAULT_TIMEOUT_MS.afterLlmResponse).toBe(8_000)
    expect(HOOK_DEFAULT_TIMEOUT_MS.beforeChapterDraft).toBe(15_000)
    expect(HOOK_DEFAULT_TIMEOUT_MS.afterChapterDraft).toBe(15_000)
    expect(HOOK_DEFAULT_TIMEOUT_MS.beforeReview).toBe(15_000)
    expect(HOOK_DEFAULT_TIMEOUT_MS.afterReview).toBe(15_000)
    expect(HOOK_DEFAULT_TIMEOUT_MS.beforePolish).toBe(15_000)
    expect(HOOK_DEFAULT_TIMEOUT_MS.afterPolish).toBe(15_000)
    expect(HOOK_DEFAULT_TIMEOUT_MS.onLlmUsage).toBe(2_000)
    expect(HOOK_DEFAULT_TIMEOUT_MS.onChapterCompleted).toBe(2_000)
  })

  it("每个事件都有默认值（新增事件时不会漏）", () => {
    for (const event of HOOK_EVENTS) {
      expect(typeof HOOK_DEFAULT_TIMEOUT_MS[event]).toBe("number")
      expect(HOOK_DEFAULT_TIMEOUT_MS[event]).toBeGreaterThan(0)
    }
    expect(HOOK_EVENTS).toHaveLength(10)
  })
})

describe("观测事件", () => {
  it("只有用量与章节完成两个是只读事件", () => {
    expect([...OBSERVER_EVENTS]).toEqual(["onLlmUsage", "onChapterCompleted"])
    expect(isObserverEvent("onLlmUsage")).toBe(true)
    expect(isObserverEvent("onChapterCompleted")).toBe(true)
    expect(isObserverEvent("afterLlmResponse")).toBe(false)
  })
})

describe("isHookEvent", () => {
  it("只认已知事件名", () => {
    expect(isHookEvent("beforePolish")).toBe(true)
    expect(isHookEvent("before_polish")).toBe(false)
    expect(isHookEvent(undefined)).toBe(false)
  })
})

describe("resolveHookTimeoutMs 的优先级", () => {
  it("hook.timeoutMs > override > 事件默认值", () => {
    expect(resolveHookTimeoutMs("afterReview", 1_000, { afterReview: 2_000 })).toBe(1_000)
    expect(resolveHookTimeoutMs("afterReview", undefined, { afterReview: 2_000 })).toBe(2_000)
    expect(resolveHookTimeoutMs("afterReview", undefined, undefined)).toBe(15_000)
  })

  it("非法值按没写处理（0 / 负数 / NaN 都不会变成\"立即超时\"或\"永不超时\"）", () => {
    expect(resolveHookTimeoutMs("onLlmUsage", 0, undefined)).toBe(2_000)
    expect(resolveHookTimeoutMs("onLlmUsage", -1, undefined)).toBe(2_000)
    expect(resolveHookTimeoutMs("onLlmUsage", Number.NaN, undefined)).toBe(2_000)
    expect(resolveHookTimeoutMs("onLlmUsage", Number.POSITIVE_INFINITY, undefined)).toBe(2_000)
  })
})
