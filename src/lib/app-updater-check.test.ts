import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * checkForAppUpdate 入口本身的测试。
 *
 * 与 app-updater.test.ts 的分工：那边测 runAppUpdateFlow 的内部逻辑
 * （拿到更新后怎么确认、下载、安装），这边测**入口的守卫与转发** ——
 * 非 Tauri 不跑、非 Windows 不跑、有更新时把版本号带进对话框。
 *
 * 这两层缺一不可：只测内部流程的话，入口即使被整体删掉也不会变红。
 * 但要真正防住"没人调用入口"，还需要 app-updater-wiring.test.ts。
 */

const invokeMock = vi.fn()
const checkMock = vi.fn()
const confirmMock = vi.fn()
const messageMock = vi.fn()
const isTauriMock = vi.fn(() => true)
const isSupportedMock = vi.fn(() => true)

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => checkMock(...args),
}))

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: (...args: unknown[]) => confirmMock(...args),
  message: (...args: unknown[]) => messageMock(...args),
}))

vi.mock("@/lib/platform", () => ({
  isTauri: () => isTauriMock(),
}))

vi.mock("@/lib/app-update-support", () => ({
  isAppAutoUpdateSupported: () => isSupportedMock(),
}))

const { checkForAppUpdate, prefetchAppUpdate } = await import("./app-updater")
const notice = await import("./app-update-notice")

function makeUpdate(version: string) {
  return {
    version,
    body: "修复若干问题",
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
  }
}

beforeEach(() => {
  invokeMock.mockReset()
  // 默认"有新版本"：检查这一步现在由 Rust 的 updater_check 负责，
  // 所以入口测试必须让它给出结论，否则流程在第一步就返回了。
  invokeMock.mockResolvedValue({ version: "0.4.11", notes: null, downloadUrl: null })
  checkMock.mockReset()
  confirmMock.mockReset()
  messageMock.mockReset()
  isTauriMock.mockReset().mockReturnValue(true)
  isSupportedMock.mockReset().mockReturnValue(true)
  notice.resetAppUpdateNoticeForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("checkForAppUpdate", () => {
  it("非 Tauri 环境（浏览器）不发起检查", async () => {
    isTauriMock.mockReturnValue(false)

    await checkForAppUpdate()

    expect(checkMock).not.toHaveBeenCalled()
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it("平台不支持自动更新时（非 Windows）不发起检查", async () => {
    isSupportedMock.mockReturnValue(false)

    await checkForAppUpdate()

    expect(checkMock).not.toHaveBeenCalled()
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it("有新版本时弹窗并把版本号与更新说明带给用户", async () => {
    checkMock.mockResolvedValue(makeUpdate("9.9.9"))
    confirmMock.mockResolvedValue(false) // 用户选「稍后再说」

    await checkForAppUpdate()

    expect(checkMock).toHaveBeenCalledTimes(1)
    expect(confirmMock).toHaveBeenCalledTimes(1)
    const [text, options] = confirmMock.mock.calls[0]
    expect(text).toContain("9.9.9")
    expect(text).toContain("修复若干问题")
    expect(options?.title).toBe("发现新版本")
    // 用户拒绝后不得下载
    expect(messageMock).not.toHaveBeenCalled()
  })

  it("没有新版本时不弹窗", async () => {
    checkMock.mockResolvedValue(null)

    await checkForAppUpdate()

    expect(checkMock).toHaveBeenCalledTimes(1)
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it("检查过程抛错时不向外抛（启动流程不应被更新检查拖垮）", async () => {
    /*
     * 让"检查"这一步抛错。现在真正的检查在 Rust 的 updater_check（invoke），
     * 所以要在 invoke 上抛；同时让插件 check 也抛，模拟两条路全挂。
     */
    invokeMock.mockRejectedValue(new Error("network down"))
    checkMock.mockRejectedValue(new Error("network down"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(checkForAppUpdate()).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalled()
  })

  it("有新版本时记录待更新版本（更新日志的红点来源）", async () => {
    checkMock.mockResolvedValue(makeUpdate("9.9.9"))
    confirmMock.mockResolvedValue(false)

    await checkForAppUpdate()

    expect(notice.getPendingUpdateVersion()).toBe("0.4.11")
  })

  it("已是最新版本时清空待更新版本", async () => {
    invokeMock.mockResolvedValue({ version: null, notes: null, downloadUrl: null })
    notice.setPendingUpdateVersion("0.4.11")

    await checkForAppUpdate()

    expect(notice.getPendingUpdateVersion()).toBe("")
  })

  it("关闭自动提醒时（prompt: false）只记录版本，不弹窗、不下载、不安装", async () => {
    checkMock.mockResolvedValue(makeUpdate("9.9.9"))

    await checkForAppUpdate({ prompt: false })

    expect(notice.getPendingUpdateVersion()).toBe("0.4.11")
    // 连插件的 check 都不该调：它只是拿安装句柄用的
    expect(checkMock).not.toHaveBeenCalled()
    expect(confirmMock).not.toHaveBeenCalled()
    expect(messageMock).not.toHaveBeenCalled()
  })
})

describe("prefetchAppUpdate", () => {
  it("有新版本时把安装包预下载到应用数据目录", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "updater_check") {
        return { version: "4.1.2", notes: null, downloadUrl: "https://example.com/a.exe" }
      }
      if (command === "updater_download_package") {
        return "C:/data/updates/QMaiWrite-update.exe"
      }
      return null
    })

    await prefetchAppUpdate()

    expect(invokeMock).toHaveBeenCalledWith("updater_download_package", {
      releaseUrl: "https://example.com/a.exe",
      version: "4.1.2",
      persist: true,
    })
    expect(notice.getPendingUpdatePath()).toBe("C:/data/updates/QMaiWrite-update.exe")
    expect(notice.getPendingUpdateReadyVersion()).toBe("4.1.2")
    expect(notice.getPendingUpdateVersion()).toBe("4.1.2")
  })

  it("同版本已预下载完成时不重复下载", async () => {
    notice.markPrefetchReady("4.1.2", "C:/data/updates/QMaiWrite-update.exe")
    invokeMock.mockResolvedValue({ version: "4.1.2", notes: null, downloadUrl: "https://example.com/a.exe" })

    await prefetchAppUpdate()

    expect(invokeMock).not.toHaveBeenCalledWith("updater_download_package", expect.anything())
  })

  it("下载失败时不弹任何对话框，只记录状态", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "updater_check") {
        return { version: "4.1.2", notes: null, downloadUrl: "https://example.com/a.exe" }
      }
      throw new Error("network down")
    })

    await expect(prefetchAppUpdate()).resolves.toBeUndefined()

    expect(confirmMock).not.toHaveBeenCalled()
    expect(messageMock).not.toHaveBeenCalled()
    expect(notice.getAppUpdateNoticeSnapshot().prefetch.status).toBe("error")
    expect(warn).toHaveBeenCalled()
  })

  it("非 Tauri 环境不发起预下载", async () => {
    isTauriMock.mockReturnValue(false)

    await prefetchAppUpdate()

    expect(invokeMock).not.toHaveBeenCalled()
  })
})

  /*
   * 这里**故意没有**"并发调用只检查一次（updateCheckStarted 守卫）"的用例。
   *
   * 我写过一版，它是假绿的，必须留个记录免得有人再加回来：
   * 该用例需要同时发起两次 checkForAppUpdate()，而函数内部是
   * `await Promise.all([import("@tauri-apps/plugin-updater"), ...])`。
   * 实测在本仓库的 vitest 5.0.1 下，**并发** import 同一个被 vi.mock 的模块
   * 并不原子 —— 其中一次会拿到**真实模块**：
   *
   *   Promise.all([import(m), import(m)])  →
   *     a.check = (...args) => checkMock(...args)      ← mock
   *     b.check = async function check(options) {...}  ← 真实模块
   *     a.check === b.check 为 false
   *
   * 真实模块在 node 环境里会抛 `ReferenceError: window is not defined`，
   * 而 checkForAppUpdate 会把它 catch 掉并 console.warn。于是"第二次调用被
   * 守卫挡住"和"第二次调用落到真实模块上炸了"这两种完全不同的情形，
   * 在断言看来一模一样 —— 去掉 updateCheckStarted 守卫，用例照样通过。
   *
   * 预热一次 import 也无效（预热后并发仍会出现 a===b 为 false）。
   * 所以守卫目前**没有测试覆盖**，这是已知缺口，不是遗漏。
   * 要覆盖它需要把守卫抽成可注入的纯函数，或换掉这层 mock 策略 ——
   * 两者都超出本次修复范围，而一个假绿的用例比没有用例更糟：
   * 它提供的正是让这个 bug 潜伏 6 个版本的虚假信心。
   */
