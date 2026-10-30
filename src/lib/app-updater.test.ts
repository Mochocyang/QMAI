import { beforeEach, describe, expect, it, vi } from "vitest"

/*
 * `runAppUpdateFlow` 现在先调 Rust 的 `updater_check`（多通道择优），
 * 再拿插件句柄去安装。测试必须替身化 `invoke`，否则第一步就抛。
 * 每个用例通过 `invokeMock` 决定"有没有新版本"。
 */
const invokeMock = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

import { runAppUpdateFlow } from "./app-updater"

beforeEach(() => {
  invokeMock.mockReset()
  // 默认"有新版本"；"没有新版本"的用例会自己覆盖。
  invokeMock.mockResolvedValue({ version: "0.4.11", notes: "修复自动更新", downloadUrl: null })
})

describe("runAppUpdateFlow", () => {
  it("没有新版本时不弹窗也不安装", async () => {
    invokeMock.mockResolvedValue({ version: null, notes: null, downloadUrl: null })
    const check = vi.fn().mockResolvedValue(null)
    const confirm = vi.fn()
    const message = vi.fn()

    await runAppUpdateFlow({
      isTauri: true,
      check,
      confirm,
      message,
    })

    /*
     * 关键断言：没有新版本时**不该**再调插件的 check()。
     *
     * 曾经这里断言"调了一次"——那正是 bug：插件命令层吃的是编译期 endpoints
     * （只有 GitHub 直连），国内每次都要白等一次超时，用户看到的就是"检查更新失败"。
     * 现在检查这一步完全由 updater_check（镜像优先）负责，没新版就直接返回。
     */
    expect(check).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    expect(message).not.toHaveBeenCalled()
  })

  it("用户确认后下载并安装更新", async () => {
    const download = vi.fn().mockResolvedValue(undefined)
    // install 抛出正常退出错误，软件在安装过程中重启属于预期行为
    const install = vi.fn().mockRejectedValue(new Error("process exited with code 0"))
    const check = vi.fn().mockResolvedValue({
      version: "0.4.11",
      body: "修复自动更新与发布流程",
      download,
      install,
    })
    const confirm = vi.fn().mockResolvedValue(true)
    const message = vi.fn().mockResolvedValue("Ok")

    await runAppUpdateFlow({
      isTauri: true,
      check,
      confirm,
      message,
    })

    expect(confirm).toHaveBeenCalledTimes(2) // 一次确认下载，一次确认安装
    expect(message).toHaveBeenCalledTimes(1) // 仅下载提示
    expect(download).toHaveBeenCalledTimes(1)
    expect(install).toHaveBeenCalledTimes(1)
  })

  it("安装失败时显示错误提示", async () => {
    const download = vi.fn().mockResolvedValue(undefined)
    const install = vi.fn().mockRejectedValue(new Error("permission denied"))
    const check = vi.fn().mockResolvedValue({
      version: "0.4.11",
      body: "修复自动更新与发布流程",
      download,
      install,
    })
    const confirm = vi.fn().mockResolvedValue(true)
    const message = vi.fn().mockResolvedValue("Ok")

    await runAppUpdateFlow({
      isTauri: true,
      check,
      confirm,
      message,
    })

    expect(confirm).toHaveBeenCalledTimes(2)
    expect(message).toHaveBeenCalledTimes(2) // 下载提示 + 安装失败提示
    expect(download).toHaveBeenCalledTimes(1)
    expect(install).toHaveBeenCalledTimes(1)
  })

  it("下载失败时显示错误提示并不安装", async () => {
    const download = vi.fn().mockRejectedValue(new Error("network error"))
    const install = vi.fn()
    const check = vi.fn().mockResolvedValue({
      version: "0.4.11",
      body: "修复自动更新与发布流程",
      download,
      install,
    })
    const confirm = vi.fn().mockResolvedValue(true)
    const message = vi.fn().mockResolvedValue("Ok")

    await runAppUpdateFlow({
      isTauri: true,
      check,
      confirm,
      message,
    })

    expect(confirm).toHaveBeenCalledTimes(1) // 仅确认下载
    expect(message).toHaveBeenCalledTimes(2) // 下载提示 + 下载失败提示
    expect(download).toHaveBeenCalledTimes(1)
    expect(install).not.toHaveBeenCalled()
  })
})
