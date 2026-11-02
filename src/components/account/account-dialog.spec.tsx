// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { resetAccountStoreForTests, useAccountStore, type AccountStoreState } from "@/stores/account-store"
import { clearLegalConsent } from "@/lib/account/legal-consent"
import { AccountDialog } from "./account-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const USER = {
  id: 12,
  email: "writer@example.com",
  displayName: "青禾",
  createdAt: 1_793_000_000,
  avatarUpdatedAt: null,
}

const SESSION = {
  baseUrl: "https://account.test",
  accessToken: "access-token",
  accessExpiresAt: 1_793_000_900,
  refreshToken: "refresh-token",
  refreshExpiresAt: 1_800_776_000,
  user: USER,
  savedAt: 1_793_000_000,
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
let login: ReturnType<typeof vi.fn<AccountStoreState["login"]>>
let register: ReturnType<typeof vi.fn<AccountStoreState["register"]>>
let sendCode: ReturnType<typeof vi.fn<AccountStoreState["sendCode"]>>
let resetPassword: ReturnType<typeof vi.fn<AccountStoreState["resetPassword"]>>
let logout: ReturnType<typeof vi.fn<AccountStoreState["logout"]>>
let changePassword: ReturnType<typeof vi.fn<AccountStoreState["changePassword"]>>
let setAvatar: ReturnType<typeof vi.fn<AccountStoreState["setAvatar"]>>
let removeAvatar: ReturnType<typeof vi.fn<AccountStoreState["removeAvatar"]>>

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

/**
 * 勾选「同意服务条款与隐私政策」。
 *
 * 需要真正发出请求的用例必须显式调用它 —— 这正是合规门槛的意义：
 * 未勾选时登录请求不该发出，所以不能塞进 beforeEach 里悄悄代劳。
 */
async function acceptLegalTerms() {
  const checkbox = document.querySelector<HTMLInputElement>('[data-ui="account-legal-consent"]')
  expect(checkbox, "同意条款的勾选框必须存在").not.toBeNull()
  await act(async () => {
    checkbox!.click()
  })
}

beforeEach(() => {
  resetAccountStoreForTests()
  /*
   * 清掉「已同意条款」的本地记录。
   *
   * 不清会污染后续用例：同意记录写进 localStorage 后，下一个用例的勾选框初始就是
   * 已勾选（这是真实行为——同意过一次不再重复要求），于是 acceptLegalTerms 里的
   * click 反而变成取消勾选，测试会假失败。每个用例都从「未同意」的干净状态开始。
   */
  clearLegalConsent()
  login = vi.fn<AccountStoreState["login"]>(async () => undefined)
  register = vi.fn<AccountStoreState["register"]>(async () => undefined)
  sendCode = vi.fn<AccountStoreState["sendCode"]>(async () => ({ cooldownSeconds: 60, devCode: "654321" }))
  resetPassword = vi.fn<AccountStoreState["resetPassword"]>(async () => undefined)
  logout = vi.fn<AccountStoreState["logout"]>(async () => undefined)
  changePassword = vi.fn<AccountStoreState["changePassword"]>(async () => undefined)
  setAvatar = vi.fn<AccountStoreState["setAvatar"]>(async () => undefined)
  removeAvatar = vi.fn<AccountStoreState["removeAvatar"]>(async () => undefined)

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
    changePassword,
    setAvatar,
    removeAvatar,
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

  it("发码后提示检查垃圾箱，未发码时不显示该提示", async () => {
    render()
    await click(buttonByText("注册"))
    await setInput("account-email", "writer@example.com")

    // 还没点获取验证码时不应该出现垃圾箱提示。
    expect(document.body.textContent).not.toContain("垃圾箱")

    await click(buttonByText("获取验证码"))

    const hint = document.querySelector(".account-code-hint")
    expect(hint, "code hint").not.toBeNull()
    expect(hint!.textContent).toContain("垃圾箱")
    expect(hint!.textContent).toContain("60")
  })

  it("登录模式不渲染验证码与垃圾箱提示", async () => {
    render()
    await setInput("account-email", "writer@example.com")

    expect(document.querySelector(".account-code-hint")).toBeNull()
    expect(document.body.textContent).not.toContain("垃圾箱")
  })

  it("登录提交中禁用按钮并显示登录中，Promise 结束后恢复", async () => {
    let resolveLogin!: () => void
    login.mockImplementation(() => new Promise<void>((resolve) => {
      resolveLogin = resolve
    }))
    render()
    await setInput("account-email", "writer@example.com")
    await setInput("account-password", "password123")
    await acceptLegalTerms()

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

  it("条款在软件内可读：点击《服务条款》打开阅读器，不需要网络", async () => {
    render()

    const openTerms = document.querySelector<HTMLButtonElement>('[data-ui="open-legal-terms"]')
    expect(openTerms, "条款链接必须是可点的按钮（在软件内打开）").not.toBeNull()

    await act(async () => {
      openTerms!.click()
    })

    const dialog = document.querySelector('[data-ui="legal-document-dialog"]')
    expect(dialog, "应打开软件内的条款阅读器").not.toBeNull()
    // 正文必须真的渲染出来（不是空壳），且覆盖到 AI 免责这个核心条款。
    expect(dialog!.textContent).toContain("服务条款")
    expect(dialog!.textContent).toContain("人工智能模型")
  })

  it("软件内条款把 ** 渲染成加粗，不露星号（真实截图里的问题）", async () => {
    render()

    const openTerms = document.querySelector<HTMLButtonElement>('[data-ui="open-legal-terms"]')
    await act(async () => {
      openTerms!.click()
    })

    const dialog = document.querySelector('[data-ui="legal-document-dialog"]')
    expect(dialog).not.toBeNull()
    // 关键：正文里不能再出现 markdown 的 ** 标记。
    expect(dialog!.textContent).not.toContain("**")
    // 但加粗的语义要保留（用 strong 元素承载）。
    expect(dialog!.querySelectorAll("strong").length).toBeGreaterThan(0)
  })

  it("条款联系方式使用真实可用邮箱", async () => {
    render()

    const openTerms = document.querySelector<HTMLButtonElement>('[data-ui="open-legal-terms"]')
    await act(async () => {
      openTerms!.click()
    })

    const text = document.querySelector('[data-ui="legal-document-dialog"]')!.textContent ?? ""
    expect(text).toContain("mochocyang@gmail.com")
    // 那三个地址实际收不到信，不能留在条款里。
    expect(text).not.toContain("support@qmai.pro")
    expect(text).not.toContain("privacy@qmai.pro")
    expect(text).not.toContain("legal@qmai.pro")
  })

  it("隐私政策同样可在软件内打开", async () => {
    render()

    const openPrivacy = document.querySelector<HTMLButtonElement>('[data-ui="open-legal-privacy"]')
    expect(openPrivacy).not.toBeNull()

    await act(async () => {
      openPrivacy!.click()
    })

    const dialog = document.querySelector('[data-ui="legal-document-dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.textContent).toContain("隐私政策")
  })

  it("登录页只保留软件内入口：不再有「在线版本」那行外链", async () => {
    render()

    // 需求：删掉在线版本入口。
    expect(document.querySelector(".account-legal-online")).toBeNull()
    expect(document.body.textContent).not.toContain("在线版本")
  })

  it("存在「记住密码」勾选框，且只在登录模式显示", async () => {
    render()

    const remember = document.querySelector<HTMLInputElement>('[data-ui="account-remember-password"]')
    expect(remember, "登录模式应有记住密码勾选框").not.toBeNull()
    expect(document.body.textContent).toContain("记住密码")

    // 注册模式不该有：那里没有「下次登录」这回事。
    await click(buttonByText("注册"))
    expect(document.querySelector('[data-ui="account-remember-password"]')).toBeNull()
  })

  it("未勾选同意条款时，登录请求根本不发出，并给出中文提示", async () => {
    render()
    await setInput("account-email", "writer@example.com")
    await setInput("account-password", "password123")

    await act(async () => {
      submitButton().click()
    })

    // 关键断言：不是「提示了但照样登录」，而是请求一次都没发出。
    expect(login).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("请先阅读并勾选同意")
  })

  it("勾选同意后登录正常发出，且同意记录落盘", async () => {
    render()
    await setInput("account-email", "writer@example.com")
    await setInput("account-password", "password123")
    await acceptLegalTerms()

    await act(async () => {
      submitButton().click()
    })

    expect(login).toHaveBeenCalledWith({ email: "writer@example.com", password: "password123" })
    // 留痕：下次打开不再要求重复同意。
    expect(localStorage.getItem("qmai.legalConsent")).not.toBeNull()
  })

  it("重置密码不需要勾选同意：否则用户拿不回自己的账号", async () => {
    useAccountStore.getState().setAuthMode("reset")
    render()
    await setInput("account-email", "writer@example.com")
    await setInput("account-code", "123456")
    await setInput("account-password", "newpassword123")

    await submitForm()

    expect(resetPassword).toHaveBeenCalled()
  })

  it("重置密码表单不渲染同意勾选框", async () => {
    useAccountStore.getState().setAuthMode("reset")
    render()

    expect(document.querySelector('[data-ui="account-legal-consent"]')).toBeNull()
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
    await acceptLegalTerms()

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
    expect(notice?.textContent).toBe("账号服务暂时不可用，已保留本地登录状态；云同步稍后再试。")
  })

  it("已登录时可用修改密码入口进入改密面板", async () => {
    useAccountStore.setState({ status: "authenticated", user: USER, session: SESSION })
    render()

    expect(document.querySelector("#account-current-password")).toBeNull()

    await click(buttonByText("修改密码"))

    expect(document.querySelector("#account-current-password")).not.toBeNull()
    expect(document.querySelector("#account-new-password")).not.toBeNull()
    expect(document.querySelector("#account-confirm-password")).not.toBeNull()
  })

  it("改密表单校验两次输入一致，并调用 changePassword", async () => {
    useAccountStore.setState({ status: "authenticated", user: USER, session: SESSION })
    render()
    await click(buttonByText("修改密码"))

    await setInput("account-current-password", "old-password")
    await setInput("account-new-password", "new-password-1")
    await setInput("account-confirm-password", "new-password-2")

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".account-form button[type=submit]")!.click()
    })

    expect(changePassword).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("两次输入的新密码不一致")

    await setInput("account-confirm-password", "new-password-1")
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".account-form button[type=submit]")!.click()
    })

    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: "old-password",
      newPassword: "new-password-1",
    })
  })

  it("改密成功后返回账号面板", async () => {
    useAccountStore.setState({ status: "authenticated", user: USER, session: SESSION })
    render()
    await click(buttonByText("修改密码"))

    await setInput("account-current-password", "old-password")
    await setInput("account-new-password", "new-password-1")
    await setInput("account-confirm-password", "new-password-1")
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".account-form button[type=submit]")!.click()
    })

    expect(changePassword).toHaveBeenCalledTimes(1)
    expect(document.querySelector("#account-current-password")).toBeNull()
  })

  it("已登录时有头像上传入口，无头像时显示上传文案", () => {
    useAccountStore.setState({ status: "authenticated", user: USER, session: SESSION })
    render()

    expect(buttonByText("上传头像")).not.toBeUndefined()
    expect(document.querySelector(".account-avatar-button")).not.toBeNull()
    // 没有头像时不该出现「移除头像」。
    expect([...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "移除头像")).toBe(false)
  })

  it("有头像时显示更换与移除，移除调用 removeAvatar", async () => {
    useAccountStore.setState({
      status: "authenticated",
      user: { ...USER, avatarUpdatedAt: 1793000000 },
      session: SESSION,
    })
    render()

    expect(buttonByText("更换头像")).not.toBeUndefined()

    await click(buttonByText("移除头像"))

    expect(removeAvatar).toHaveBeenCalledTimes(1)
  })
})