import { describe, expect, it, vi } from "vitest"
import { runAppUpdateFlow } from "./app-updater"

describe("runAppUpdateFlow", () => {
  it("没有新版本时不弹窗也不安装", async () => {
    const check = vi.fn().mockResolvedValue(null)
    const confirm = vi.fn()
    const message = vi.fn()

    await runAppUpdateFlow({
      isTauri: true,
      check,
      confirm,
      message,
    })

    expect(check).toHaveBeenCalledTimes(1)
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
