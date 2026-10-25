/**
 * 账号全局状态（zustand）。
 *
 * 顶栏、设置页、登录弹窗都只读这一份状态，避免三处各自请求导致登录态
 * 不一致。这里不发 toast、不碰 React：错误写进 `error`，由 UI 就近显示。
 *
 * 本地优先：启动续期遇到断网/5xx 时保留缓存用户，不因账号服务不可用
 * 把作者登出；只有 401（refresh 失效）或服务端明确 ACCOUNT_DISABLED 才清会话。
 *
 * 续期范围：首版仅在启动/bootstrap 时静默续期；会员接口接入时再补
 * 「业务请求 401 → 续期一次并重放」的通用逻辑。
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
  AccountAuthPayload,
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
  /** 启动/续期失败但保留了缓存会话，设置页可据此显示「服务暂时不可用」。 */
  sessionUnverified: boolean

  /** 启动时只跑一次：有本地会话就静默续期。 */
  bootstrap: () => Promise<void>
  login: (input: LoginInput) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  sendCode: (email: string, purpose: "register" | "reset") => Promise<SendCodeResult>
  resetPassword: (input: ResetPasswordInput) => Promise<void>
  logout: () => Promise<void>
  /** 主动续期；无会话返回 null，401 清会话，网络错误保留会话并抛出。 */
  refreshSession: () => Promise<StoredAccountSession | null>
  /** 规格动作名：续期并吞掉错误，供「重试/下次打开账号页」使用。 */
  refresh: () => Promise<void>

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
  sessionUnverified: false,
}

/** 并发调用 bootstrap 时共用同一次续期，避免重复轮换 refresh token。 */
let bootstrapPromise: Promise<void> | null = null

/**
 * 登录态代次：logout/login/register/reset 都会 +1。任何在途 refresh
 * 完成时必须核对代次，避免把已退出/新登录的会话又覆盖回去。
 */
let sessionEpoch = 0

/** bootstrap 与 refreshSession 共用的单飞续期，按 refresh token 去重。 */
let refreshInFlight: {
  refreshToken: string
  promise: Promise<AccountAuthPayload>
} | null = null

function bumpSessionEpoch(): number {
  sessionEpoch += 1
  return sessionEpoch
}

function sharedRefresh(baseUrl: string, refreshToken: string): Promise<AccountAuthPayload> {
  if (refreshInFlight?.refreshToken === refreshToken) return refreshInFlight.promise

  let promise: Promise<AccountAuthPayload>
  promise = refreshAccountSession(baseUrl, refreshToken).finally(() => {
    if (refreshInFlight?.promise === promise) refreshInFlight = null
  })
  refreshInFlight = { refreshToken, promise }
  return promise
}

/** 只有明确的登录态失效才清本地；断网/5xx 都保留。 */
function isSessionRejected(error: unknown): boolean {
  if (!isAccountApiError(error)) return false
  return error.status === 401
    || error.code === "INVALID_REFRESH"
    || error.code === "TOKEN_EXPIRED"
    || error.code === "ACCOUNT_DISABLED"
}

export const useAccountStore = create<AccountStoreState>()((set, get) => ({
  ...INITIAL_ACCOUNT_STATE,

  bootstrap: async () => {
    if (bootstrapPromise) return bootstrapPromise
    if (get().bootstrapped) return

    const epochAtStart = sessionEpoch
    bootstrapPromise = (async () => {
      const stored = loadAccountSession()
      if (!stored) {
        set({
          status: "anonymous",
          user: null,
          session: null,
          error: null,
          sessionUnverified: false,
          bootstrapped: true,
        })
        return
      }

      // 先把缓存用户顶上，断网时界面仍显示已登录。
      set({ status: "booting", user: stored.user, session: stored })

      const stillOwnsSession = (): boolean =>
        epochAtStart === sessionEpoch && get().session?.refreshToken === stored.refreshToken

      try {
        const payload = await sharedRefresh(stored.baseUrl, stored.refreshToken)
        if (!stillOwnsSession()) {
          set({ bootstrapped: true })
          return
        }

        const next = createStoredSession(stored.baseUrl, payload)
        saveAccountSession(next)
        set({
          status: "authenticated",
          user: next.user,
          session: next,
          error: null,
          sessionUnverified: false,
          bootstrapped: true,
        })
      } catch (error) {
        if (!stillOwnsSession()) {
          set({ bootstrapped: true })
          return
        }

        if (isSessionRejected(error)) {
          clearAccountSession()
          set({
            status: "anonymous",
            user: null,
            session: null,
            error: null,
            sessionUnverified: false,
            bootstrapped: true,
          })
          return
        }

        set({
          status: "authenticated",
          user: stored.user,
          session: stored,
          error: null,
          sessionUnverified: true,
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
    const epochAtStart = bumpSessionEpoch()
    const baseUrl = resolveAccountBaseUrl()
    set({ status: "booting", error: null })

    try {
      const payload = await loginAccount(baseUrl, {
        email: input.email,
        password: input.password,
        ...(input.deviceLabel === undefined ? {} : { deviceLabel: input.deviceLabel }),
      })
      // 请求期间如果已退出或又发起了另一次登录，旧响应不能回写。
      if (epochAtStart !== sessionEpoch) return

      const session = createStoredSession(baseUrl, payload)
      saveAccountSession(session)

      set({
        status: "authenticated",
        user: session.user,
        session,
        dialogOpen: false,
        error: null,
        sessionUnverified: false,
        bootstrapped: true,
      })
    } catch (error) {
      if (epochAtStart !== sessionEpoch) throw error
      // 登录失败不能留下旧磁盘会话，否则下次启动会悄悄恢复另一个身份。
      clearAccountSession()
      set({
        status: "anonymous",
        user: null,
        session: null,
        error: accountErrorMessage(error),
        sessionUnverified: false,
      })
      throw error
    }
  },

  register: async (input) => {
    const epochAtStart = bumpSessionEpoch()
    const baseUrl = resolveAccountBaseUrl()
    set({ status: "booting", error: null })

    try {
      const payload = await registerAccount(baseUrl, input)
      if (epochAtStart !== sessionEpoch) return

      const session = createStoredSession(baseUrl, payload)
      saveAccountSession(session)

      set({
        status: "authenticated",
        user: session.user,
        session,
        dialogOpen: false,
        error: null,
        sessionUnverified: false,
        bootstrapped: true,
      })
    } catch (error) {
      if (epochAtStart !== sessionEpoch) throw error
      clearAccountSession()
      set({
        status: "anonymous",
        user: null,
        session: null,
        error: accountErrorMessage(error),
        sessionUnverified: false,
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
    const epochAtStart = bumpSessionEpoch()
    try {
      await resetAccountPassword(resolveAccountBaseUrl(), input)
      if (epochAtStart !== sessionEpoch) return

      clearAccountSession()
      set({
        status: "anonymous",
        user: null,
        session: null,
        authMode: "login",
        dialogOpen: true,
        error: null,
        sessionUnverified: false,
      })
    } catch (error) {
      if (epochAtStart === sessionEpoch) set({ error: accountErrorMessage(error) })
      throw error
    }
  },

  logout: async () => {
    // 先让所有在途 refresh 失效，再同步清本地；退出不等网络。
    bumpSessionEpoch()
    const session = get().session
    clearAccountSession()
    set({
      status: "anonymous",
      user: null,
      session: null,
      dialogOpen: false,
      error: null,
      sessionUnverified: false,
    })

    if (session) {
      // 旧 token 可能已被在途 refresh 轮换；先尽力撤销旧 token，再等轮换结果撤销新 token。
      void logoutAccount(session.baseUrl, session.refreshToken).catch(() => undefined)
      const pendingRefresh = refreshInFlight
      if (pendingRefresh) {
        void pendingRefresh.promise
          .then((payload) => logoutAccount(session.baseUrl, payload.refreshToken))
          .catch(() => undefined)
      }
    }
  },

  refreshSession: async () => {
    const epochAtStart = sessionEpoch
    const session = get().session
    if (!session) return null

    try {
      const payload = await sharedRefresh(session.baseUrl, session.refreshToken)
      if (epochAtStart !== sessionEpoch) return null

      const next = createStoredSession(session.baseUrl, payload)
      saveAccountSession(next)
      set({
        status: "authenticated",
        user: next.user,
        session: next,
        error: null,
        sessionUnverified: false,
      })
      return next
    } catch (error) {
      if (epochAtStart !== sessionEpoch) return null

      if (isSessionRejected(error)) {
        clearAccountSession()
        set({
          status: "anonymous",
          user: null,
          session: null,
          sessionUnverified: false,
        })
        return null
      }

      // 断网/5xx：保留本地会话，标记待确认，交给调用方提示或下次重试。
      set({ sessionUnverified: true })
      throw error
    }
  },

  refresh: async () => {
    try {
      await get().refreshSession()
    } catch {
      // 规格动作 `refresh()` 不向 UI 抛错；要处理错误用 refreshSession。
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

/** 测试用：重置 store、单飞续期与代次；不触碰 localStorage。 */
export function resetAccountStoreForTests(): void {
  bootstrapPromise = null
  refreshInFlight = null
  sessionEpoch = 0
  useAccountStore.setState({ ...INITIAL_ACCOUNT_STATE })
}
