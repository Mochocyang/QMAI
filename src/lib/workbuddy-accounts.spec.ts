/**
 * WorkBuddy 账号 IPC 封装的单元测试。
 *
 * 只测「契约」：调用名、参数形状、三态收敛、取消与超时。真正的网络与落库
 * 都在 Rust 侧（`src-tauri/src/workbuddy/*` 有各自的单测），这里 mock 掉 IPC。
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const invokeMock = vi.fn()
let tauri = true

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock("@/lib/platform", () => ({
  isTauri: () => tauri,
}))

import {
  cancelWorkbuddyLogin,
  importWorkbuddyCredential,
  listWorkbuddyAccounts,
  pollWorkbuddyLogin,
  startWorkbuddyLogin,
  waitForLogin,
} from "./workbuddy-accounts"

describe("workbuddy-accounts IPC", () => {
  beforeEach(() => {
    invokeMock.mockReset()
    tauri = true
  })

  it("开始登录默认用 workbuddy + 内嵌窗口", async () => {
    invokeMock.mockResolvedValue({
      state: "s1",
      authUrl: "https://copilot.tencent.com/login?state=s1",
      provider: "workbuddy",
      edition: "cn",
      mode: "embedded",
    })

    const start = await startWorkbuddyLogin()

    expect(invokeMock).toHaveBeenCalledWith("workbuddy_login_start", {
      provider: "workbuddy",
      mode: "embedded",
    })
    expect(start.state).toBe("s1")
  })

  it("可以指定系统浏览器", async () => {
    invokeMock.mockResolvedValue({
      state: "s2",
      authUrl: "https://x",
      provider: "workbuddy",
      edition: "cn",
      mode: "external",
    })

    await startWorkbuddyLogin({ mode: "external" })

    expect(invokeMock).toHaveBeenCalledWith("workbuddy_login_start", {
      provider: "workbuddy",
      mode: "external",
    })
  })

  it("轮询把状态原样交给调用方", async () => {
    invokeMock.mockResolvedValue({ status: "pending" })

    await expect(pollWorkbuddyLogin("s1")).resolves.toEqual({ status: "pending" })
    expect(invokeMock).toHaveBeenCalledWith("workbuddy_login_wait", { loginState: "s1" })
  })

  it("waitForLogin 在 ready 时返回账号", async () => {
    invokeMock
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({
        status: "ready",
        account: { uidTail: "abcdef", nickname: "小明" },
        accounts: { accounts: [], count: 0 },
      })

    const result = await waitForLogin("s1", { intervalMs: 1 })

    expect(result.status).toBe("ready")
    expect(result.account.nickname).toBe("小明")
  })

  it("waitForLogin 把 failed 变成可 catch 的错误", async () => {
    invokeMock.mockResolvedValue({ status: "failed", error: "登录成功但拿不到账号标识" })

    await expect(waitForLogin("s1", { intervalMs: 1 })).rejects.toThrow("拿不到账号标识")
  })

  it("waitForLogin 把 canceled 与 expired 分开报告", async () => {
    invokeMock.mockResolvedValue({ status: "canceled" })
    await expect(waitForLogin("s1", { intervalMs: 1 })).rejects.toThrow("登录已取消")

    invokeMock.mockResolvedValue({ status: "expired" })
    await expect(waitForLogin("s1", { intervalMs: 1 })).rejects.toThrow("已过期")
  })

  it("waitForLogin 支持外部取消", async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      waitForLogin("s1", { intervalMs: 1, signal: controller.signal }),
    ).rejects.toThrow("登录已取消")
  })

  it("取消登录带上 state", async () => {
    invokeMock.mockResolvedValue(true)
    await expect(cancelWorkbuddyLogin("s9")).resolves.toBe(true)
    expect(invokeMock).toHaveBeenCalledWith("workbuddy_login_cancel", { loginState: "s9" })
  })

  it("导入凭证把文本原样传给后端", async () => {
    invokeMock.mockResolvedValue({
      account: { id: "user-u1", nickname: "n", uidTail: "u1", edition: "cn", editionLabel: "国内版" },
      accounts: { accounts: [], count: 1 },
    })

    await importWorkbuddyCredential('{"accessToken":"A","uid":"u1"}')

    expect(invokeMock).toHaveBeenCalledWith("workbuddy_import_file", {
      content: '{"accessToken":"A","uid":"u1"}',
      provider: "workbuddy",
    })
  })

  it("账号列表直接透传后端视图", async () => {
    invokeMock.mockResolvedValue({ accounts: [], count: 0 })
    await expect(listWorkbuddyAccounts()).resolves.toEqual({ accounts: [], count: 0 })
  })

  it("非桌面端给出明确错误而不是调用 IPC", async () => {
    tauri = false

    await expect(listWorkbuddyAccounts()).rejects.toThrow("仅桌面端可用")
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
