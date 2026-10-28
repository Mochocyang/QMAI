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
    expect(host.textContent).toContain("登录青幕账号，云同步与后续服务会记在这个账号下。不登录也可以正常写作。")
    expect(host.textContent).not.toContain("会员")

    await act(async () => textButton("登录").click())
    expect(useAccountStore.getState().dialogOpen).toBe(true)
    expect(useAccountStore.getState().authMode).toBe("login")

    await act(async () => textButton("注册").click())
    expect(useAccountStore.getState().authMode).toBe("register")
  })

  it("已登录时显示账号、注册日期与退出登录，不显示会员字样", async () => {
    useAccountStore.setState({ status: "authenticated", user: USER, session: null })
    vi.spyOn(window, "confirm").mockReturnValue(true)
    render()

    expect(host.textContent).toContain("青禾")
    expect(host.textContent).toContain("writer@example.com")
    expect(host.textContent).toContain(new Date(USER.createdAt * 1000).toLocaleDateString("zh-CN"))
    expect(host.textContent).not.toContain("会员功能即将上线")
    expect(host.textContent).not.toContain("会员")

    await act(async () => textButton("退出登录").click())
    expect(window.confirm).toHaveBeenCalledWith("退出后这台设备需要重新登录；本地小说和模型配置不会被删除。")
    expect(useAccountStore.getState().status).toBe("anonymous")
    expect(useAccountStore.getState().user).toBeNull()
    expect(host.textContent).toContain("登录青幕账号，云同步与后续服务会记在这个账号下")
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

    expect(host.textContent).toContain("账号服务暂时不可用，已保留本地登录状态；云同步稍后再试。")
    expect(host.querySelector('[role="status"]')).not.toBeNull()
  })
})

describe("昵称修改（每月一次）", () => {
  it("可以改昵称：点铅笔 → 输入 → 回车，调用 store 的 rename", async () => {
    useAccountStore.setState({ status: "authenticated", user: USER, session: null })
    const rename = vi.fn(async (next: string) => ({ ...USER, displayName: next, displayNameUpdatedAt: 1 }))
    useAccountStore.setState({ rename } as never)
    render()

    const pencil = host.querySelector<HTMLButtonElement>('button[aria-label="修改昵称"]')!
    expect(pencil).toBeTruthy()
    act(() => pencil.click())

    const input = host.querySelector<HTMLInputElement>('input[aria-label="昵称"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    act(() => {
      setter.call(input, "新名字")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })

    expect(rename).toHaveBeenCalledWith("新名字")
  })

  it("冷却期内不显示铅笔，并提示下次可修改日期", () => {
    const updatedAt = Math.floor(Date.now() / 1000) - 5 * 24 * 60 * 60 // 5 天前改过
    useAccountStore.setState({
      status: "authenticated",
      user: { ...USER, displayNameUpdatedAt: updatedAt },
      session: null,
    })
    render()

    expect(host.querySelector('button[aria-label="修改昵称"]')).toBeNull()
    expect(host.textContent).toContain("昵称下次可修改")
  })

  it("服务端返回 NAME_LOCKED 时给出中文提示", async () => {
    useAccountStore.setState({ status: "authenticated", user: USER, session: null })
    const { AccountApiError } = await import("@/lib/account/errors")
    const rename = vi.fn(async () => {
      throw new AccountApiError("NAME_LOCKED")
    })
    useAccountStore.setState({ rename } as never)
    render()

    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="修改昵称"]')!.click())
    const input = host.querySelector<HTMLInputElement>('input[aria-label="昵称"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    act(() => {
      setter.call(input, "另一个名字")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })

    expect(host.textContent).toContain("昵称每个月只能修改一次")
  })
})