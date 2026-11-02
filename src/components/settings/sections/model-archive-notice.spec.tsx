// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ModelArchiveNotice } from "./model-archive-notice"

/**
 * 「账号模型已备份」提示（用户点名要的文案）。
 *
 * 场景：用户退出登录（或登录态过期）后，属于账号的模型从列表里消失了。
 * 它们没有丢 —— 加密备份在本机。若界面什么都不说，用户的第一反应是
 * 「软件把我的模型删了」，这正是最初那条投诉的来源。
 *
 * 文案要求（用户给的原句「未登录账号已备份，登录已同步的账号后即可显示」
 * 主语混乱——备份的是模型、不是账号；「已同步的账号」定语别扭。改成：）
 *   「账号的 N 个模型已在本机加密备份，登录该账号后即可恢复显示。」
 * 主语、动作、条件都对得上界面状态。
 */

vi.mock("@/lib/model-sync/account-hook", () => ({
  countHiddenModelsForNotice: vi.fn(async () => 0),
}))

import { countHiddenModelsForNotice } from "@/lib/model-sync/account-hook"
import { resetAccountStoreForTests, useAccountStore } from "@/stores/account-store"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

function render(): void {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<ModelArchiveNotice />))
}

function settle(): Promise<void> {
  return act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function setAccountStatus(status: "anonymous" | "authenticated"): void {
  useAccountStore.setState({
    status,
    user: status === "authenticated"
      ? { id: 1, email: "w@example.com", displayName: "W", createdAt: 1, avatarUpdatedAt: null, displayNameUpdatedAt: null }
      : null,
    session: null,
  })
}

beforeEach(() => {
  localStorage.clear()
  resetAccountStoreForTests()
  vi.mocked(countHiddenModelsForNotice).mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe("ModelArchiveNotice", () => {
  it("未登录且有备份：显示用户要求的文案（数量 + 加密备份 + 登录恢复）", async () => {
    setAccountStatus("anonymous")
    vi.mocked(countHiddenModelsForNotice).mockResolvedValue(3)

    render()
    await settle()

    const text = host.textContent ?? ""
    expect(text).toContain("3 个模型")
    expect(text).toContain("加密备份")
    expect(text).toContain("登录")
    // 用户原句里的错误主语不能复活：备份的不是「账号」。
    expect(text).not.toMatch(/未登录账号已备份/)
  })

  it("点击「立即登录」打开账号弹窗", async () => {
    setAccountStatus("anonymous")
    vi.mocked(countHiddenModelsForNotice).mockResolvedValue(1)

    render()
    await settle()

    const button = host.querySelector<HTMLButtonElement>('[data-ui="model-archive-login"]')
    expect(button).not.toBeNull()
    await act(async () => { button!.click() })

    expect(useAccountStore.getState().dialogOpen).toBe(true)
    expect(useAccountStore.getState().authMode).toBe("login")
  })

  it("没有任何备份时不显示：从未同步过的用户不该看到这句话", async () => {
    setAccountStatus("anonymous")
    vi.mocked(countHiddenModelsForNotice).mockResolvedValue(0)

    render()
    await settle()

    expect(host.textContent).toBe("")
  })

  it("已登录时不查备份也不显示（列表本来就显示着账号模型）", async () => {
    setAccountStatus("authenticated")

    render()
    await settle()

    expect(countHiddenModelsForNotice).not.toHaveBeenCalled()
    expect(host.textContent).toBe("")
  })

  it("计数失败（环境不支持等）时安静隐身，不报错打扰", async () => {
    setAccountStatus("anonymous")
    vi.mocked(countHiddenModelsForNotice).mockRejectedValue(new Error("没有安全仓库"))

    render()
    await settle()

    expect(host.textContent).toBe("")
  })
})
