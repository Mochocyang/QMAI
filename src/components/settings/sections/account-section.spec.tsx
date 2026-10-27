// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { resetAccountStoreForTests, useAccountStore } from "@/stores/account-store"
import { AccountSection } from "./account-section"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const USER = {
  id: 12,
  email: "writer@example.com",
  displayName: "青禾",
  createdAt: 1_793_000_000,
}

let host: HTMLDivElement
let root: Root

function render() {
  act(() => {
    root.render(<AccountSection />)
  })
}

function textButton(label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label,
  )
  expect(button, label).not.toBeUndefined()
  return button!
}

beforeEach(() => {
  resetAccountStoreForTests()
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  resetAccountStoreForTests()
})

describe("AccountSection", () => {
  it("匿名时说明本地写作不受影响，并提供登录与注册入口", async () => {
    useAccountStore.setState({ status: "anonymous", user: null, dialogOpen: false })
    render()

    expect(host.querySelector('[data-ui="account-section"]')).not.toBeNull()
    expect(host.textContent).toContain("登录青幕账号，会员权益与后续云服务会记在这个账号下。不登录也可以正常写作。")
    expect(host.textContent).not.toContain("会员已开通")

    await act(async () => textButton("登录").click())
    expect(useAccountStore.getState().dialogOpen).toBe(true)
    expect(useAccountStore.getState().authMode).toBe("login")

    await act(async () => textButton("注册").click())
    expect(useAccountStore.getState().authMode).toBe("register")
  })

  it("已登录时显示账号、注册日期与退出登录，不伪造会员已开通", async () => {
    useAccountStore.setState({ status: "authenticated", user: USER, session: null })
    vi.spyOn(window, "confirm").mockReturnValue(true)
    render()

    expect(host.textContent).toContain("青禾")
    expect(host.textContent).toContain("writer@example.com")
    expect(host.textContent).toContain(new Date(USER.createdAt * 1000).toLocaleDateString("zh-CN"))
    expect(host.textContent).toContain("会员功能即将上线")
    expect(host.textContent).not.toContain("会员已开通")

    await act(async () => textButton("退出登录").click())
    expect(window.confirm).toHaveBeenCalledWith("退出后这台设备需要重新登录；本地小说和模型配置不会被删除。")
    expect(useAccountStore.getState().status).toBe("anonymous")
    expect(useAccountStore.getState().user).toBeNull()
    expect(host.textContent).toContain("登录青幕账号，会员权益与后续云服务会记在这个账号下")
  })

  it("账号状态尚未读取时显示加载说明", () => {
    useAccountStore.setState({ status: "booting", user: null })
    render()
    expect(host.textContent).toContain("正在读取账号状态…")
    expect(host.querySelector("button")).toBeNull()
  })

  it("账号服务暂时不可用但保留登录态时显示灰色提示", () => {
    useAccountStore.setState({
      status: "authenticated",
      user: USER,
      sessionUnverified: true,
    })
    render()

    expect(host.textContent).toContain("账号服务暂时不可用，已保留本地登录状态；会员与云同步稍后再试。")
    expect(host.querySelector('[role="status"]')).not.toBeNull()
  })
})
