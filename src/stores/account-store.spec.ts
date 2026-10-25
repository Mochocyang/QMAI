// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/account/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/account/api")>()
  return {
    ...actual,
    sendCode: vi.fn(),
    registerAccount: vi.fn(),
    loginAccount: vi.fn(),
    refreshAccountSession: vi.fn(),
    logoutAccount: vi.fn(),
    fetchAccountMe: vi.fn(),
    resetAccountPassword: vi.fn(),
  }
})

import {
  DEFAULT_ACCOUNT_BASE_URL,
  loginAccount,
  logoutAccount,
  refreshAccountSession,
  registerAccount,
  resetAccountPassword,
  sendCode as requestSendCode,
} from "@/lib/account/api"
import { AccountApiError } from "@/lib/account/errors"
import {
  createStoredSession,
  loadAccountSession,
  saveAccountSession,
} from "@/lib/account/session"
import type {
  AccountAuthPayload,
  AccountUser,
  StoredAccountSession,
} from "@/lib/account/types"
import { resetAccountStoreForTests, useAccountStore } from "./account-store"

function accountUser(overrides: Partial<AccountUser> = {}): AccountUser {
  return {
    id: 12,
    email: "author@example.com",
    displayName: "作者",
    createdAt: 1793000000,
    ...overrides,
  }
}

function authPayload(overrides: Partial<AccountAuthPayload> = {}): AccountAuthPayload {
  return {
    user: accountUser(),
    accessToken: "new-access",
    accessExpiresAt: 1793000900,
    refreshToken: "new-refresh",
    refreshExpiresAt: 1800776000,
    ...overrides,
  }
}

function storedSession(overrides: Partial<StoredAccountSession> = {}): StoredAccountSession {
  return {
    ...createStoredSession("https://stored.test", authPayload({
      accessToken: "old-access",
      refreshToken: "old-refresh",
    })),
    ...overrides,
  }
}

function setAuthenticatedSession(session: StoredAccountSession): void {
  useAccountStore.setState({
    status: "authenticated",
    user: session.user,
    session,
    bootstrapped: true,
  })
}

describe("account store", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    resetAccountStoreForTests()
  })

  describe("bootstrap", () => {
    it("没有本地会话时进入匿名态，并只跑一次", async () => {
      await useAccountStore.getState().bootstrap()

      expect(refreshAccountSession).not.toHaveBeenCalled()
      expect(useAccountStore.getState().status).toBe("anonymous")
      expect(useAccountStore.getState().bootstrapped).toBe(true)

      await useAccountStore.getState().bootstrap()
      expect(refreshAccountSession).not.toHaveBeenCalled()
    })

    it("有本地会话时静默续期并持久化新 token", async () => {
      const stored = storedSession()
      saveAccountSession(stored)
      const payload = authPayload()
      vi.mocked(refreshAccountSession).mockResolvedValue(payload)

      await useAccountStore.getState().bootstrap()

      expect(refreshAccountSession).toHaveBeenCalledWith(stored.baseUrl, stored.refreshToken)
      const state = useAccountStore.getState()
      expect(state.status).toBe("authenticated")
      expect(state.user).toEqual(payload.user)
      expect(state.session?.refreshToken).toBe("new-refresh")
      expect(state.bootstrapped).toBe(true)
      expect(loadAccountSession()?.refreshToken).toBe("new-refresh")
    })

    it("refresh 401 时清会话并回到匿名态", async () => {
      saveAccountSession(storedSession())
      vi.mocked(refreshAccountSession).mockRejectedValue(
        new AccountApiError("INVALID_REFRESH", "登录已失效", 401),
      )

      await useAccountStore.getState().bootstrap()

      expect(useAccountStore.getState().status).toBe("anonymous")
      expect(useAccountStore.getState().user).toBeNull()
      expect(useAccountStore.getState().session).toBeNull()
      expect(useAccountStore.getState().bootstrapped).toBe(true)
      expect(loadAccountSession()).toBeNull()
    })

    it("断网/5xx 时保留缓存会话，不因服务不可用登出", async () => {
      const stored = storedSession()
      saveAccountSession(stored)
      vi.mocked(refreshAccountSession).mockRejectedValue(
        new AccountApiError("NETWORK", "网络异常", 0),
      )

      await useAccountStore.getState().bootstrap()

      expect(useAccountStore.getState().status).toBe("authenticated")
      expect(useAccountStore.getState().session).toEqual(stored)
      expect(useAccountStore.getState().user).toEqual(stored.user)
      expect(loadAccountSession()).toEqual(stored)

      resetAccountStoreForTests()
      vi.mocked(refreshAccountSession).mockRejectedValue(
        new AccountApiError("SERVER_ERROR", "服务不可用", 500),
      )

      await useAccountStore.getState().bootstrap()

      expect(useAccountStore.getState().status).toBe("authenticated")
      expect(useAccountStore.getState().session).toEqual(stored)
      expect(loadAccountSession()).toEqual(stored)
    })
  })

  describe("login / register", () => {
    it("登录成功后保存会话、关闭弹窗并进入已登录态", async () => {
      const payload = authPayload()
      vi.mocked(loginAccount).mockResolvedValue(payload)
      useAccountStore.getState().openDialog("login")

      await useAccountStore.getState().login({
        email: "author@example.com",
        password: "password123",
      })

      expect(loginAccount).toHaveBeenCalledWith(DEFAULT_ACCOUNT_BASE_URL, {
        email: "author@example.com",
        password: "password123",
      })
      const state = useAccountStore.getState()
      expect(state.status).toBe("authenticated")
      expect(state.user).toEqual(payload.user)
      expect(state.session?.refreshToken).toBe("new-refresh")
      expect(state.dialogOpen).toBe(false)
      expect(state.error).toBeNull()
      expect(loadAccountSession()?.accessToken).toBe("new-access")
    })

    it("登录失败进入匿名态、写中文错误并 rethrow", async () => {
      const error = new AccountApiError("INVALID_CREDENTIALS", "邮箱或密码不正确。", 401)
      vi.mocked(loginAccount).mockRejectedValue(error)

      await expect(useAccountStore.getState().login({
        email: "author@example.com",
        password: "wrong-password",
      })).rejects.toBe(error)

      const state = useAccountStore.getState()
      expect(state.status).toBe("anonymous")
      expect(state.user).toBeNull()
      expect(state.session).toBeNull()
      expect(state.error).toBe("邮箱或密码不正确。")
      expect(loadAccountSession()).toBeNull()
    })

    it("注册成功后保存会话并自动登录", async () => {
      const payload = authPayload({
        user: accountUser({ email: "new@example.com", displayName: "新作者" }),
      })
      vi.mocked(registerAccount).mockResolvedValue(payload)

      await useAccountStore.getState().register({
        email: "new@example.com",
        code: "123456",
        password: "password123",
        displayName: "新作者",
      })

      expect(registerAccount).toHaveBeenCalledWith(DEFAULT_ACCOUNT_BASE_URL, {
        email: "new@example.com",
        code: "123456",
        password: "password123",
        displayName: "新作者",
      })
      expect(useAccountStore.getState().status).toBe("authenticated")
      expect(useAccountStore.getState().user?.email).toBe("new@example.com")
      expect(loadAccountSession()?.user.email).toBe("new@example.com")
    })
  })

  describe("sendCode / resetPassword", () => {
    it("sendCode 返回冷却时间与 devCode", async () => {
      vi.mocked(requestSendCode).mockResolvedValue({ cooldownSeconds: 60, devCode: "123456" })

      const result = await useAccountStore.getState().sendCode("author@example.com", "register")

      expect(result).toEqual({ cooldownSeconds: 60, devCode: "123456" })
      expect(requestSendCode).toHaveBeenCalledWith(
        DEFAULT_ACCOUNT_BASE_URL,
        "author@example.com",
        "register",
      )
      expect(useAccountStore.getState().error).toBeNull()
    })

    it("sendCode 失败写错误并 rethrow", async () => {
      const error = new AccountApiError("RATE_LIMITED", "操作太频繁", 429)
      vi.mocked(requestSendCode).mockRejectedValue(error)

      await expect(useAccountStore.getState().sendCode("author@example.com", "register"))
        .rejects.toBe(error)
      expect(useAccountStore.getState().error).toBe("操作太频繁，请稍后再试。")
    })

    it("重置密码成功后清本地会话，回到登录页", async () => {
      saveAccountSession(storedSession())
      setAuthenticatedSession(storedSession())
      vi.mocked(resetAccountPassword).mockResolvedValue(undefined)

      await useAccountStore.getState().resetPassword({
        email: "author@example.com",
        code: "654321",
        password: "new-password",
      })

      const state = useAccountStore.getState()
      expect(state.status).toBe("anonymous")
      expect(state.user).toBeNull()
      expect(state.session).toBeNull()
      expect(state.authMode).toBe("login")
      expect(state.dialogOpen).toBe(true)
      expect(loadAccountSession()).toBeNull()
    })
  })

  describe("logout / refreshSession", () => {
    it("退出登录调用 logout 并清本地会话", async () => {
      const stored = storedSession()
      saveAccountSession(stored)
      setAuthenticatedSession(stored)
      vi.mocked(logoutAccount).mockResolvedValue(undefined)

      await useAccountStore.getState().logout()

      expect(logoutAccount).toHaveBeenCalledWith(stored.baseUrl, stored.refreshToken)
      const state = useAccountStore.getState()
      expect(state.status).toBe("anonymous")
      expect(state.user).toBeNull()
      expect(state.session).toBeNull()
      expect(state.dialogOpen).toBe(false)
      expect(loadAccountSession()).toBeNull()
    })

    it("logout 接口失败也清本地，避免退不出去", async () => {
      const stored = storedSession()
      saveAccountSession(stored)
      setAuthenticatedSession(stored)
      vi.mocked(logoutAccount).mockRejectedValue(new Error("network down"))

      await expect(useAccountStore.getState().logout()).resolves.toBeUndefined()

      expect(useAccountStore.getState().status).toBe("anonymous")
      expect(loadAccountSession()).toBeNull()
    })

    it("refreshSession 无会话直接返回 null", async () => {
      await expect(useAccountStore.getState().refreshSession()).resolves.toBeNull()
      expect(refreshAccountSession).not.toHaveBeenCalled()
    })

    it("refreshSession 401 清会话并返回 null", async () => {
      const stored = storedSession()
      saveAccountSession(stored)
      setAuthenticatedSession(stored)
      vi.mocked(refreshAccountSession).mockRejectedValue(
        new AccountApiError("TOKEN_EXPIRED", "登录已过期", 401),
      )

      await expect(useAccountStore.getState().refreshSession()).resolves.toBeNull()

      expect(useAccountStore.getState().status).toBe("anonymous")
      expect(useAccountStore.getState().session).toBeNull()
      expect(loadAccountSession()).toBeNull()
    })

    it("refreshSession 网络失败保留会话并 rethrow", async () => {
      const stored = storedSession()
      setAuthenticatedSession(stored)
      const error = new AccountApiError("NETWORK", "网络异常", 0)
      vi.mocked(refreshAccountSession).mockRejectedValue(error)

      await expect(useAccountStore.getState().refreshSession()).rejects.toBe(error)

      expect(useAccountStore.getState().session).toEqual(stored)
      expect(useAccountStore.getState().status).toBe("authenticated")
    })
  })

  describe("dialog", () => {
    it("openDialog / setAuthMode / closeDialog 管理弹窗与错误", () => {
      useAccountStore.getState().openDialog("reset")
      expect(useAccountStore.getState().dialogOpen).toBe(true)
      expect(useAccountStore.getState().authMode).toBe("reset")

      useAccountStore.setState({ error: "旧错误" })
      useAccountStore.getState().setAuthMode("register")
      expect(useAccountStore.getState().authMode).toBe("register")
      expect(useAccountStore.getState().error).toBeNull()

      useAccountStore.getState().closeDialog()
      expect(useAccountStore.getState().dialogOpen).toBe(false)
    })
  })
})
