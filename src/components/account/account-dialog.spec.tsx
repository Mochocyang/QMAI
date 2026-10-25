// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { resetAccountStoreForTests, useAccountStore } from "@/stores/account-store"
import { AccountDialog } from "./account-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const USER = {
  id: 12,
  email: "writer@example.com",
  displayName: "青禾",
  createdAt: 1_793_000_000,
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

let host: HTMLDivElement
let root: Root
let login: ReturnType<typeof vi.fn>
let register: ReturnType<typeof vi.fn>
let sendCode: ReturnType<typeof vi.fn>
let resetPassword: ReturnType<typeof vi.fn>
let logout: ReturnType<typeof vi.fn>

function render() {
  act(() => {
    root.render(<AccountDialog />)
  })
}

function input(id: string): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>(`#${id}`)
  expect(element, id).not.toBeNull()
  return element!
}

function buttonByText(label: string): HTMLButtonElement {
  const element = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label,
  )
  expect(element, label).not.toBeUndefined()
  return element!
}

function submitButton(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(".account-dialog .account-submit")
  expect(element).not.toBeNull()
  return element!
}

async function setInput(id: string, value: string) {
  await act(async () => {
    const element = input(id)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
  })
}

async function submitForm() {
  await act(async () => {
    document.querySelector<HTMLFormElement>(".account-form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    )
  })
}

beforeEach(() => {
  resetAccountStoreForTests()
  login = vi.fn(async () => undefined)
  register = vi.fn(async () => undefined)
  sendCode = vi.fn(async () => ({ cooldownSeconds: 60, devCode: "654321" }))
  resetPassword = vi.fn(async () => undefined)
  logout = vi.fn(async () => undefined)

  useAccountStore.setState({
    dialogOpen: true,
    authMode: "login",
    status: "anonymous",
    user: null,
    session: null,
    error: null,
    login,
    register,
    sendCode,
    resetPassword,
    logout,
  })

  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.querySelectorAll("[data-slot='dialog-portal']").forEach((node) => node.remove())
  vi.restoreAllMocks()
  resetAccountStoreForTests()
})

describe("AccountDialog", () => {
  it("空表单提交显示中文错误，且不调用任何账号动作", async () => {
    render()

    await act(async () => {
      submitButton().click()
    })

    expect(document.querySelector('[role="alert"]')?.textContent).toBe("请输入有效的邮箱地址。")
    expect(input("account-email").getAttribute("aria-invalid")).toBe("true")
    expect(input("account-email").getAttribute("aria-describedby")).toBe("account-error")
    expect(login).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
    expect(sendCode).not.toHaveBeenCalled()
    expect(resetPassword).not.toHaveBeenCalled()
  })

  it("注册模式获取验证码调用 register 用途，并显示开发码与 60 秒倒计时", async () => {
    render()
    await click(buttonByText("注册"))
    await setInput("account-email", "Writer@Example.com")

    await click(buttonByText("获取验证码"))

    expect(sendCode).toHaveBeenCalledWith("writer@example.com", "register")
    expect(document.body.textContent).toContain("开发模式验证码：654321")
    expect(buttonByText("60 秒后重试")).not.toBeUndefined()
    expect(buttonByText("注册并登录")).not.toBeUndefined()
  })

  it("登录提交中禁用按钮并显示登录中，Promise 结束后恢复", async () => {
    let resolveLogin!: () => void
    login.mockImplementation(() => new Promise<void>((resolve) => {
      resolveLogin = resolve
    }))
    render()
    await setInput("account-email", "writer@example.com")
    await setInput("account-password", "password123")

    await act(async () => {
      submitButton().click()
    })
    expect(submitButton().disabled).toBe(true)
    expect(submitButton().textContent).toContain("登录中…")
    expect(submitButton().getAttribute("aria-busy")).toBe("true")

    await act(async () => {
      resolveLogin()
    })
    expect(submitButton().disabled).toBe(false)
    expect(submitButton().textContent?.trim()).toBe("登录")
    expect(submitButton().getAttribute("aria-busy")).toBeNull()
  })

  it("忘记密码进入 reset，返回登录回到 login，tab 始终只有两个", async () => {
    render()
    await click(buttonByText("忘记密码？"))
    expect(useAccountStore.getState().authMode).toBe("reset")
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(2)
    expect(document.body.textContent).toContain("重置密码")
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
    expect(tabs.every((tab) => tab.getAttribute("aria-controls") === "account-auth-panel")).toBe(true)
    expect(document.querySelector(".account-form")?.id).toBe("account-auth-panel")

    await click(buttonByText("返回登录"))
    expect(useAccountStore.getState().authMode).toBe("login")
  })

  it("reset 表单提交调用 resetPassword", async () => {
    useAccountStore.getState().setAuthMode("reset")
    render()
    await setInput("account-email", "writer@example.com")
    await setInput("account-code", "123456")
    await setInput("account-password", "newpassword123")

    await submitForm()

    expect(resetPassword).toHaveBeenCalledWith({
      email: "writer@example.com",
      code: "123456",
      password: "newpassword123",
    })
    expect(login).not.toHaveBeenCalled()
  })

  it("关闭再打开会清空密码与验证码，保留邮箱", async () => {
    useAccountStore.getState().setAuthMode("register")
    render()
    await setInput("account-email", "writer@example.com")
    await setInput("account-code", "123456")
    await setInput("account-password", "password123")

    await act(async () => {
      useAccountStore.setState({ dialogOpen: false })
    })
    await act(async () => {
      useAccountStore.setState({ dialogOpen: true })
    })

    expect(input("account-email").value).toBe("writer@example.com")
    expect(input("account-code").value).toBe("")
    expect(input("account-password").value).toBe("")
  })

  it("输入法组合期提交不会触发登录，compositionend 后恢复", async () => {
    render()
    await setInput("account-email", "writer@example.com")
    await setInput("account-password", "password123")

    await act(async () => {
      const email = input("account-email")
      email.dispatchEvent(new Event("compositionstart", { bubbles: true }))
      document.querySelector<HTMLFormElement>(".account-form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      )
    })
    expect(login).not.toHaveBeenCalled()

    await act(async () => {
      input("account-email").dispatchEvent(new Event("compositionend", { bubbles: true }))
      document.querySelector<HTMLFormElement>(".account-form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      )
    })
    expect(login).toHaveBeenCalledWith({
      email: "writer@example.com",
      password: "password123",
    })
  })

  it("密码显隐按钮同步 aria-pressed 与输入框类型", async () => {
    render()
    const toggle = document.querySelector<HTMLButtonElement>('button[aria-label="显示密码"]')!
    expect(toggle.getAttribute("aria-pressed")).toBe("false")

    await click(toggle)

    const hidden = document.querySelector<HTMLButtonElement>('button[aria-label="隐藏密码"]')!
    expect(hidden.getAttribute("aria-pressed")).toBe("true")
    expect(input("account-password").type).toBe("text")
  })

  it("关闭后重开不会显示旧请求的错误", async () => {
    const pending = deferred<void>()
    login.mockImplementation(() => pending.promise)
    render()
    await setInput("account-email", "writer@example.com")
    await setInput("account-password", "password123")

    await act(async () => {
      submitButton().click()
    })
    await act(async () => {
      useAccountStore.setState({ dialogOpen: false })
    })
    await act(async () => {
      useAccountStore.setState({ dialogOpen: true })
    })
    await act(async () => {
      pending.reject(new Error("network"))
    })

    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(submitButton().disabled).toBe(false)
  })

  it("关闭后重开不会残留旧验证码倒计时或开发码", async () => {
    const pending = deferred<{ cooldownSeconds: number; devCode?: string }>()
    sendCode.mockImplementation(() => pending.promise)
    useAccountStore.getState().setAuthMode("register")
    render()
    await setInput("account-email", "writer@example.com")

    await click(buttonByText("获取验证码"))
    await act(async () => {
      useAccountStore.setState({ dialogOpen: false })
    })
    await act(async () => {
      useAccountStore.setState({ dialogOpen: true })
    })
    await act(async () => {
      pending.resolve({ cooldownSeconds: 60, devCode: "999999" })
    })

    expect(document.body.textContent).not.toContain("开发模式验证码：999999")
    expect(document.body.textContent).not.toContain("60 秒后重试")
    expect(buttonByText("获取验证码")).not.toBeUndefined()
  })

  it("已登录退出前使用统一确认文案，取消时不清会话", async () => {
    useAccountStore.setState({
      status: "authenticated",
      user: USER,
      sessionUnverified: false,
    })
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    render()

    await click(buttonByText("退出登录"))

    expect(confirm).toHaveBeenCalledWith("退出后这台设备需要重新登录；本地小说和模型配置不会被删除。")
    expect(logout).not.toHaveBeenCalled()
  })

  it("账号服务不可用但保留登录态时显示灰色提示", () => {
    useAccountStore.setState({
      status: "authenticated",
      user: USER,
      sessionUnverified: true,
    })
    render()

    const notice = document.querySelector('[role="status"]')
    expect(notice?.textContent).toBe("账号服务暂时不可用，已保留本地登录状态；会员与云同步稍后再试。")
  })
})
