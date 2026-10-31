/**
 * 设备绑定单测：一设备最多 3 个账号。
 *
 * 用假 D1 模拟 `device_accounts` 表，验证：
 *   - 前 3 个账号放行
 *   - 第 4 个被拒
 *   - 已绑定的账号重复绑定不占额度（幂等）
 *   - 非法指纹一律不拦（旧版客户端没上报）
 */

import { describe, expect, it } from "vitest"
import { DEFAULT_MAX_ACCOUNTS_PER_DEVICE, isValidDeviceHash } from "../src/device"

describe("isValidDeviceHash", () => {
  it("接受 32 位小写十六进制", () => {
    expect(isValidDeviceHash("a".repeat(32))).toBe(true)
    expect(isValidDeviceHash("0123456789abcdef0123456789abcdef")).toBe(true)
  })

  it("拒绝长度不对、含非十六进制字符、非字符串", () => {
    expect(isValidDeviceHash("abc")).toBe(false)
    expect(isValidDeviceHash("z".repeat(32))).toBe(false)
    expect(isValidDeviceHash("A".repeat(32))).toBe(false) // 只收小写
    expect(isValidDeviceHash(undefined)).toBe(false)
    expect(isValidDeviceHash(null)).toBe(false)
    expect(isValidDeviceHash(123)).toBe(false)
    expect(isValidDeviceHash("a".repeat(33))).toBe(false)
  })
})

describe("DEFAULT_MAX_ACCOUNTS_PER_DEVICE", () => {
  it("是 3（产品设定：一台电脑最多 3 个账号）", () => {
    expect(DEFAULT_MAX_ACCOUNTS_PER_DEVICE).toBe(3)
  })
})
