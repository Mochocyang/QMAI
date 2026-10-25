/**
 * 账号全局状态（zustand）。
 *
 * 顶栏、设置页、登录弹窗都只读这一份状态，避免三处各自请求导致登录态
 * 不一致。这里不发 toast、不碰 React：错误写进 `error`，由 UI 就近显示。
 *
 * 本地优先：启动续期遇到断网/5xx 时保留缓存用户，不因账号服务不可用
 * 把作者登出；只有 401/403（refresh 失效、账号停用）才清会话。
 */

import { create } from "zustand"

import {
  loginAccount,
  logoutAccount,
  refreshAccountSession,
  registerAccount,
  resetAccountPassword,
  resolveAccountBaseUrl,
  sendCode as requestSendCode,
} from "@/lib/account/api"
import { accountErrorMessage, isAccountApiError } from "@/lib/account/errors"
import {
  clearAccountSession,
  createStoredSession,
  loadAccountSession,
  saveAccountSession,
} from "@/lib/account/session"
import type {
  AccountAuthMode,
  AccountStatus,
  AccountUser,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  SendCodeResult,
  StoredAccountSession,
} from "@/lib/account/types"

export interface AccountStoreState {
  status: AccountStatus
  user: AccountUser | null
  session: StoredAccountSession | null
  dialogOpen: boolean
  authMode: AccountAuthMode
  error: string | null
  bootstrapped: boolean

  /** 启动时只跑一次：有本地会话就静默续期。 */
  bootstrap: () => Promise<void>
  login: (input: LoginInput) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  sendCode: (email: string, purpose: "register" | "reset") => Promise<SendCodeResult>
  resetPassword: (input: ResetPasswordInput) => Promise<void>
  logout: () => Promise<void>
  /** 主动续期；无会话返回 null，401 清会话，网络错误保留会话并抛出。 */
  refreshSession: () => Promise<StoredAccountSession | null>

  openDialog: (mode?: AccountAuthMode) => void
  closeDialog: () => void
  setAuthMode: (mode: AccountAuthMode) => void
  clearError: () => void
}

const INITIAL_ACCOUNT_STATE = {
  status: "idle" as AccountStatus,
  user: null,
  session: null,
  dialogOpen: false,
  authMode: "login" as AccountAuthMode,
  error: null,
  bootstrapped: false,
}

/** 并发调用 bootstrap 时共用同一次续期，避免重复轮换 refresh token。 */
let bootstrapPromise: Promise<void> | null = null

/** refresh 明确被服务端拒绝时才需要清本地；断网/5xx 都保留。 */
function isSessionRejected(error: unknown): boolean {
  if (!isAccountApiError(error)) return false
  return error.status === 401
    || error.status === 403
    || error.code === "INVALID_REFRESH"
    || error.code === "TOKEN_EXPIRED"
    || error.code === "ACCOUNT_DISABLED"
}

export const useAccountStore = create<AccountStoreState>()((set, get) => ({
  ...INITIAL_ACCOUNT_STATE,

  bootstrap: async () => {
    if (bootstrapPromise) return bootstrapPromise
    if (get().bootstrapped) return

    bootstrapPromise = (async () => {
      const stored = loadAccountSession()
      if (!stored) {
        set({
          status: "anonymous",
          user: null,
          session: null,
          error: null,
          bootstrapped: true,
        })
        return
      }

      // 先把缓存用户顶上，断网时界面仍显示已登录。
      set({ status: "booting", user: stored.user, session: stored })

      try {
        const payload = await refreshAccountSession(stored.baseUrl, stored.refreshToken)
        const next = createStoredSession(stored.baseUrl, payload)
        saveAccountSession(next)
        set({
          status: "authenticated",
          user: next.user,
          session: next,
          error: null,
          bootstrapped: true,
        })
      } catch (error) {
        if (isSessionRejected(error)) {
          clearAccountSession()
          set({
            status: "anonymous",
            user: null,
            session: null,
            error: null,
            bootstrapped: true,
          })
          return
        }

        set({
          status: "authenticated",
          user: stored.user,
          session: stored,
          error: null,
          bootstrapped: true,
        })
      }
    })()

    try {
      await bootstrapPromise
    } finally {
      bootstrapPromise = null
    }
  },

  login: async (input) => {
    const baseUrl = resolveAccountBaseUrl()
    set({ status: "booting", error: null })

    try {
      const payload = await loginAccount(baseUrl, {
        email: input.email,
        password: input.password,
        ...(input.deviceLabel === undefined ? {} : { deviceLabel: input.deviceLabel }),
      })
      const session = createStoredSession(baseUrl, payload)
      saveAccountSession(session)

      set({
        status: "authenticated",
        user: session.user,
        session,
        dialogOpen: false,
        error: null,
        bootstrapped: true,
      })
    } catch (error) {
      set({
        status: "anonymous",
        user: null,
        session: null,
        error: accountErrorMessage(error),
      })
      throw error
    }
  },

  register: async (input) => {
    const baseUrl = resolveAccountBaseUrl()
    set({ status: "booting", error: null })

    try {
      const payload = await registerAccount(baseUrl, input)
      const session = createStoredSession(baseUrl, payload)
      saveAccountSession(session)

      set({
        status: "authenticated",
        user: session.user,
        session,
        dialogOpen: false,
        error: null,
        bootstrapped: true,
      })
    } catch (error) {
      set({
        status: "anonymous",
        user: null,
        session: null,
        error: accountErrorMessage(error),
      })
      throw error
    }
  },

  sendCode: async (email, purpose) => {
    try {
      const result = await requestSendCode(resolveAccountBaseUrl(), email, purpose)
      set({ error: null })
      return result
    } catch (error) {
      set({ error: accountErrorMessage(error) })
      throw error
    }
  },

  resetPassword: async (input) => {
    try {
      await resetAccountPassword(resolveAccountBaseUrl(), input)
      clearAccountSession()
      set({
        status: "anonymous",
        user: null,
        session: null,
        authMode: "login",
        dialogOpen: true,
        error: null,
      })
    } catch (error) {
      set({ error: accountErrorMessage(error) })
      throw error
    }
  },

  logout: async () => {
    const session = get().session
    if (session) {
      try {
        await logoutAccount(session.baseUrl, session.refreshToken)
      } catch {
        // 退出登录的本地清理优先：接口失败也要能退出。
      }
    }

    clearAccountSession()
    set({
      status: "anonymous",
      user: null,
      session: null,
      dialogOpen: false,
      error: null,
    })
  },

  refreshSession: async () => {
    const session = get().session
    if (!session) return null

    try {
      const payload = await refreshAccountSession(session.baseUrl, session.refreshToken)
      const next = createStoredSession(session.baseUrl, payload)
      saveAccountSession(next)
      set({
        status: "authenticated",
        user: next.user,
        session: next,
        error: null,
      })
      return next
    } catch (error) {
      if (isSessionRejected(error)) {
        clearAccountSession()
        set({
          status: "anonymous",
          user: null,
          session: null,
        })
        return null
      }
      // 断网/5xx：保留本地会话，交给调用方提示或下次重试。
      throw error
    }
  },

  openDialog: (mode = "login") => {
    set({ dialogOpen: true, authMode: mode, error: null })
  },

  closeDialog: () => {
    set({ dialogOpen: false, error: null })
  },

  setAuthMode: (mode) => {
    set({ authMode: mode, error: null })
  },

  clearError: () => {
    set({ error: null })
  },
}))

/** 测试用：重置 store 与 bootstrap 去重标记；不触碰 localStorage。 */
export function resetAccountStoreForTests(): void {
  bootstrapPromise = null
  useAccountStore.setState({ ...INITIAL_ACCOUNT_STATE })
}
