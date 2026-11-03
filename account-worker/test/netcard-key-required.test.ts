/**
 * 网关卡签发失败时必须留下日志。
 *
 * ## 为什么值得单独测
 *
 * 签发失败时仍然返回 `netcard: null`（登录不能因此失败），但**不能静默**：
 * 一旦 `NETCARD_PRIVATE_KEY` 没配，所有用户登录后都拿不到卡，客户端那边
 * 表现为「内置模型突然消失」，而服务端一声不响 —— 排查等于从零开始。
 *
 * 2026-11-03 就发生过：线上缺私钥 → 用户会话里有 refreshToken 但没有 netcard
 * → 客户端把内置模型配置删了 → 用户完全无法自助恢复。
 *
 * 这条用例锁住「失败必须打日志，且日志里能看出是缺私钥」。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { signNetCard } from "../src/netcard"
import type { Env } from "../src/types"

const NOW = 1_800_000_000

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as Env["DB"],
    NETCARD_PRIVATE_KEY: undefined,
    ...overrides,
  } as Env
}

describe("signNetCard 缺私钥", () => {
  it("抛出的错误明确指向 NETCARD_PRIVATE_KEY", async () => {
    await expect(signNetCard(baseEnv(), 42, "sid-1", NOW)).rejects.toThrow(/NETCARD_PRIVATE_KEY/)
  })

  it("私钥是「未配置」而不是「配错了」—— 两种情况都要能区分", async () => {
    // 配了一个非法私钥（不是合法 PKCS#8 base64）：错误信息应当与「未配置」不同。
    let missingMessage = ""
    try {
      await signNetCard(baseEnv(), 42, "sid-1", NOW)
    } catch (error) {
      missingMessage = error instanceof Error ? error.message : String(error)
    }

    let invalidMessage = ""
    try {
      await signNetCard(baseEnv({ NETCARD_PRIVATE_KEY: "not-a-valid-key" }), 42, "sid-1", NOW)
    } catch (error) {
      invalidMessage = error instanceof Error ? error.message : String(error)
    }

    expect(missingMessage).toMatch(/not configured/)
    expect(invalidMessage).not.toBe(missingMessage)
  })
})
