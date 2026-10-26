// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))
vi.mock("@/lib/platform", () => ({ isTauri: () => true }))

import { resolveUpdateChannel } from "./updater-channel"

describe("解析更新通道", () => {
  it("取第一条带 manifestUrl 的通道", async () => {
    invokeMock.mockResolvedValue([
      { channelId: "jsdelivr", label: "加速通道 C", manifestUrl: null, rttMs: null },
      { channelId: "ghproxy-net", label: "加速通道 A", manifestUrl: "https://a/latest.json", rttMs: 210 },
      { channelId: "direct", label: "直连", manifestUrl: "https://d/latest.json", rttMs: 900 },
    ])
    const plan = await resolveUpdateChannel()
    expect(plan?.channelId).toBe("ghproxy-net")
    expect(plan?.manifestUrl).toBe("https://a/latest.json")
    expect(plan?.rttMs).toBe(210)
  })

  it("全部通道都没有 manifestUrl 时返回 null，让调用方退回官方端点", async () => {
    invokeMock.mockResolvedValue([
      { channelId: "ghproxy-net", label: "A", manifestUrl: null, rttMs: null },
      { channelId: "direct", label: "直连", manifestUrl: null, rttMs: null },
    ])
    expect(await resolveUpdateChannel()).toBeNull()
  })

  it("命令报错也不抛，返回 null", async () => {
    invokeMock.mockRejectedValue(new Error("boom"))
    expect(await resolveUpdateChannel()).toBeNull()
  })

  it("返回空数组时返回 null", async () => {
    invokeMock.mockResolvedValue([])
    expect(await resolveUpdateChannel()).toBeNull()
  })

  it("脏数据不会让调用方崩：缺字段的项被跳过", async () => {
    invokeMock.mockResolvedValue([
      { channelId: "bad" },
      { channelId: "ok", label: "好好", manifestUrl: "https://ok/latest.json", rttMs: 5 },
    ])
    const plan = await resolveUpdateChannel()
    expect(plan?.channelId).toBe("ok")
  })
})
