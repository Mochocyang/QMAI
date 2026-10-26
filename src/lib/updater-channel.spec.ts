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


describe("更新端点配置", () => {
  it("镜像排在直连前面，直连永远垫底兜底", async () => {
    /*
     * 用户就卡在"检查更新 20 秒无反应"上。实测同一网络：
     *   镜像 gh-proxy  1.6s 成功
     *   直连           8s 超时（更早实测过连续 3 次 20s 超时）
     * 而 tauri-plugin-updater 会按 endpoints 顺序逐个尝试、失败换下一个
     * （见 crate 源码 updater.rs 的 `for url in &self.endpoints`），
     * 所以顺序必须"快的镜像在前、直连最后"。
     */
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const conf = JSON.parse(
      readFileSync(resolve(__dirname, "../../src-tauri/tauri.conf.json"), "utf8"),
    )
    const endpoints: string[] = conf.plugins.updater.endpoints
    expect(endpoints.length).toBeGreaterThanOrEqual(2)

    const mirrorIndexes = endpoints
      .map((url, index) => ({ url, index }))
      .filter((item) => !item.url.startsWith("https://github.com/"))
      .map((item) => item.index)
    expect(mirrorIndexes.length).toBeGreaterThan(0)

    const directIndex = endpoints.findIndex((url) => url.startsWith("https://github.com/"))
    expect(directIndex).toBeGreaterThan(-1)
    for (const index of mirrorIndexes) {
      expect(index).toBeLessThan(directIndex)
    }

    // pubkey 必须还在：镜像能加速，但**不能**让镜像有机会替换安装包。
    expect(conf.plugins.updater.pubkey).toBeTruthy()
  })
})


describe("检查更新走自建多通道", () => {
  it("changelog 的检查更新调用 updater_check，而不是直接用插件的 check()", async () => {
    /*
     * 插件命令层的 check **不接受运行时 endpoints**，只能吃编译期写死的那份。
     * 一旦某个镜像挂了就得重新发版。所以检查这一步必须走 Rust 的 updater_check
     * （它用 ChannelTable::effective()，内置表 + 远程覆盖）。
     */
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const text = readFileSync(resolve(__dirname, "changelog-update-session.ts"), "utf8")
    expect(text).toContain('invoke<{')
    expect(text).toContain('"updater_check"')
    // 安装包改用多源分段下载（官网直链 → 反代 → 直连，每个源内 8 段并发）。
    // 这是唯一能把 58 KB/s 的 GitHub 直连救回来的手段。
    expect(text).toContain('"updater_download_package"')
    expect(text).toContain("subscribeDownloadProgress")
  })
})
