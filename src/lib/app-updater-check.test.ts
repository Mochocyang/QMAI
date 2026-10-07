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

const checkMock = vi.fn()
const confirmMock = vi.fn()
const messageMock = vi.fn()
const isTauriMock = vi.fn(() => true)
const isSupportedMock = vi.fn(() => true)

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

const { checkForAppUpdate } = await import("./app-updater")

function makeUpdate(version: string) {
  return {
    version,
    body: "修复若干问题",
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
  }
}

beforeEach(() => {
  checkMock.mockReset()
  confirmMock.mockReset()
  messageMock.mockReset()
  isTauriMock.mockReset().mockReturnValue(true)
  isSupportedMock.mockReset().mockReturnValue(true)
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
    checkMock.mockRejectedValue(new Error("network down"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(checkForAppUpdate()).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalled()
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
})
