/**
 * 设备额度逻辑单测：用假 D1 验证「一台设备最多 N 个账号」的核心判定。
 *
 * 线上实测需要一个能收到验证码的邮箱，不适合自动化；所以把逻辑抽出来直接测。
 */

import { describe, expect, it } from "vitest"
import { checkDeviceQuota, DEFAULT_MAX_ACCOUNTS_PER_DEVICE, maxAccountsPerDevice } from "../src/device"

/** 极简假 D1：只支持 checkDeviceQuota 用到的 COUNT 查询。 */
function fakeDb(boundCount: number) {
  return {
    prepare() {
      return {
        bind() {
          return this
        },
        async first() {
          return { n: boundCount }
        },
        async all() {
          return { results: [] }
        },
        async run() {
          return { success: true }
        },
      }
    },
  } as never
}

function envWith(boundCount: number, limit?: string) {
  return { DB: fakeDb(boundCount), MAX_ACCOUNTS_PER_DEVICE: limit } as never
}

describe("maxAccountsPerDevice", () => {
  it("默认 3", () => {
    expect(maxAccountsPerDevice(envWith(0))).toBe(DEFAULT_MAX_ACCOUNTS_PER_DEVICE)
    expect(DEFAULT_MAX_ACCOUNTS_PER_DEVICE).toBe(3)
  })

  it("可被环境变量覆盖", () => {
    expect(maxAccountsPerDevice(envWith(0, "5"))).toBe(5)
    expect(maxAccountsPerDevice(envWith(0, "1"))).toBe(1)
  })

  it("非法值回落默认（0 / 负数 / 非数字都不生效，避免误配成全员禁注册）", () => {
    expect(maxAccountsPerDevice(envWith(0, "0"))).toBe(3)
    expect(maxAccountsPerDevice(envWith(0, "-1"))).toBe(3)
    expect(maxAccountsPerDevice(envWith(0, "abc"))).toBe(3)
  })
})

describe("checkDeviceQuota", () => {
  it("已绑 0 个 → 放行", async () => {
    const result = await checkDeviceQuota(envWith(0), "a".repeat(32))
    expect(result.allowed).toBe(true)
    expect(result.count).toBe(0)
    expect(result.limit).toBe(3)
  })

  it("已绑 2 个 → 还能再绑一个（放行）", async () => {
    const result = await checkDeviceQuota(envWith(2), "a".repeat(32))
    expect(result.allowed).toBe(true)
  })

  it("已绑 3 个 → 达到上限，拒绝", async () => {
    const result = await checkDeviceQuota(envWith(3), "a".repeat(32))
    expect(result.allowed).toBe(false)
    expect(result.count).toBe(3)
    expect(result.limit).toBe(3)
  })

  it("已绑 5 个 → 拒绝（超过上限也算超）", async () => {
    const result = await checkDeviceQuota(envWith(5), "a".repeat(32))
    expect(result.allowed).toBe(false)
  })
})
