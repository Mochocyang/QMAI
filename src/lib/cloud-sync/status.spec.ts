import { describe, expect, it } from "vitest"

import { deriveCloudSyncView, formatSyncAge } from "./status"

const NOW = 1_800_000_000_000

const baseConfig = { enabled: true, connected: true, lastSyncAt: undefined }
const idleRuntime = { running: false }

describe("deriveCloudSyncView", () => {
  it("开关关闭时不渲染状态（图标仍是 CloudOff，供防御性渲染）", () => {
    const view = deriveCloudSyncView({ ...baseConfig, enabled: false }, idleRuntime, NOW)
    expect(view.state).toBe("disabled")
    expect(view.icon).toBe("CloudOff")
    expect(view.badge).toBeNull()
  })

  it("开启但未登录是合法的稳定态，不是错误态", () => {
    const view = deriveCloudSyncView({ ...baseConfig, connected: false }, idleRuntime, NOW)
    expect(view.state).toBe("login-required")
    expect(view.icon).toBe("CloudOff")
    expect(view.badge).toBeNull()
    expect(view.label).toContain("未登录")
  })

  it("已连接且空闲 → ready，图标为 Cloud", () => {
    const view = deriveCloudSyncView(baseConfig, idleRuntime, NOW)
    expect(view.state).toBe("ready")
    expect(view.icon).toBe("Cloud")
    expect(view.badge).toBeNull()
  })

  it("最近一次同步刚成功 → 2 秒内显示 CloudCheck", () => {
    const view = deriveCloudSyncView(baseConfig, { running: false, recentSuccessAt: NOW - 500 }, NOW)
    expect(view.state).toBe("ready")
    expect(view.icon).toBe("CloudCheck")
  })

  it("超过 2 秒后回到常态图标", () => {
    const view = deriveCloudSyncView(baseConfig, { running: false, recentSuccessAt: NOW - 2_001 }, NOW)
    expect(view.icon).toBe("Cloud")
  })

  it("同步中带进度：aria-label 里给 done/total", () => {
    const view = deriveCloudSyncView(baseConfig, { running: true, done: 12, total: 30 }, NOW)
    expect(view.state).toBe("syncing")
    expect(view.icon).toBe("CloudUpload")
    expect(view.label).toContain("12/30")
  })

  it("同步中且总数未知时不输出 0/0", () => {
    const view = deriveCloudSyncView(baseConfig, { running: true }, NOW)
    expect(view.label).not.toContain("0/0")
    expect(view.label).toContain("整理变更")
  })

  it("有失败项 → attention + 红点", () => {
    const view = deriveCloudSyncView(baseConfig, { running: false, failureCount: 3 }, NOW)
    expect(view.state).toBe("attention")
    expect(view.icon).toBe("CloudAlert")
    expect(view.badge).toBe("error")
    expect(view.label).toContain("3")
  })

  it("授权过期 → auth-expired + 黄点", () => {
    const view = deriveCloudSyncView(baseConfig, { running: false, authExpired: true }, NOW)
    expect(view.state).toBe("auth-expired")
    expect(view.badge).toBe("warn")
    expect(view.label).toContain("过期")
  })

  it("优先级：未登录压过授权过期与运行中", () => {
    const view = deriveCloudSyncView(
      { ...baseConfig, connected: false },
      { running: true, authExpired: true, failureCount: 5 },
      NOW,
    )
    expect(view.state).toBe("login-required")
  })

  it("优先级：授权过期压过运行中", () => {
    const view = deriveCloudSyncView(baseConfig, { running: true, authExpired: true }, NOW)
    expect(view.state).toBe("auth-expired")
  })

  it("优先级：运行中压过有失败项（本轮还在跑）", () => {
    const view = deriveCloudSyncView(baseConfig, { running: true, failureCount: 2 }, NOW)
    expect(view.state).toBe("syncing")
  })

  it("就绪文案带上上次同步时间", () => {
    const view = deriveCloudSyncView({ ...baseConfig, lastSyncAt: NOW - 120_000 }, idleRuntime, NOW)
    expect(view.label).toContain("2 分钟前")
  })
})

describe("formatSyncAge", () => {
  it("没有时间戳返回 null", () => {
    expect(formatSyncAge(undefined, NOW)).toBeNull()
    expect(formatSyncAge(0, NOW)).toBeNull()
  })

  it("一分钟内算刚刚", () => {
    expect(formatSyncAge(NOW - 1_000, NOW)).toBe("刚刚")
    expect(formatSyncAge(NOW - 59_000, NOW)).toBe("刚刚")
  })

  it("分钟 / 小时 / 天", () => {
    expect(formatSyncAge(NOW - 5 * 60_000, NOW)).toBe("5 分钟前")
    expect(formatSyncAge(NOW - 3 * 3_600_000, NOW)).toBe("3 小时前")
    expect(formatSyncAge(NOW - 2 * 86_400_000, NOW)).toBe("2 天前")
  })
})
