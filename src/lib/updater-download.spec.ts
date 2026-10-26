// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

import { downloadViaChannel } from "./updater-download"
import type { UpdateChannelPlanItem } from "./updater-channel"

const RELEASE_URL = "https://github.com/Mochocyang/QMAI/releases/download/v4.3.1/QMAI_4.3.1_x64-setup.exe"

function planWith(manifestPrefix: string | null | undefined): UpdateChannelPlanItem {
  return {
    channelId: "ghproxy-net",
    label: "加速通道 A",
    manifestUrl: "https://ghproxy.net/https://github.com/x/latest.json",
    manifestPrefix,
    rttMs: 120,
  }
}

describe("通过通道下载更新包", () => {
  it("有镜像前缀时拼出通道地址并返回字节", async () => {
    invokeMock.mockResolvedValue([1, 2, 3])

    const bytes = await downloadViaChannel(planWith("https://ghproxy.net/"), RELEASE_URL)

    expect(invokeMock).toHaveBeenCalledWith("updater_download_bytes", {
      url: `https://ghproxy.net/${RELEASE_URL}`,
    })
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(bytes ?? [])).toEqual([1, 2, 3])
  })

  it("空前缀（直连）时原样使用地址，不能被当成「没有前缀」", async () => {
    invokeMock.mockResolvedValue([7])

    const bytes = await downloadViaChannel(planWith(""), RELEASE_URL)

    // 空前缀与 null 语义完全不同：前者是「直连、原样用」，后者是「这条通道不支持」。
    expect(invokeMock).toHaveBeenCalledWith("updater_download_bytes", { url: RELEASE_URL })
    expect(Array.from(bytes ?? [])).toEqual([7])
  })

  it("前缀为 null（jsDelivr 这类不支持 release 资产的通道）时返回 null", async () => {
    const bytes = await downloadViaChannel(planWith(null), RELEASE_URL)

    expect(bytes).toBeNull()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it("没有计划时返回 null，让调用方退回插件下载", async () => {
    expect(await downloadViaChannel(null, RELEASE_URL)).toBeNull()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it("计划里缺 manifestPrefix 字段（旧版 Rust）时也返回 null，而不是崩", async () => {
    expect(await downloadViaChannel(planWith(undefined), RELEASE_URL)).toBeNull()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it("命令报错时返回 null（降级），不让更新彻底失败", async () => {
    invokeMock.mockRejectedValue(new Error("不允许的下载地址"))

    await expect(downloadViaChannel(planWith("https://ghproxy.net/"), RELEASE_URL)).resolves.toBeNull()
  })

  it("命令返回空数据时按失败处理", async () => {
    // 空字节流装不出一个安装包；静默把它交给安装步骤只会得到一个更费解的报错。
    invokeMock.mockResolvedValue([])

    expect(await downloadViaChannel(planWith("https://ghproxy.net/"), RELEASE_URL)).toBeNull()
  })

  it("原始地址为空时不去请求", async () => {
    expect(await downloadViaChannel(planWith("https://ghproxy.net/"), "")).toBeNull()
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
