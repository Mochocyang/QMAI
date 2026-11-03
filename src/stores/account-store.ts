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
  changeAccountPassword,
  deleteAccount,
  deleteAccountAvatar,
  loginAccount,
  logoutAccount,
  refreshAccountSession,
  registerAccount,
  resetAccountPassword,
  resolveAccountBaseUrl,
  sendCode as requestSendCode,
  updateAccountProfile,
  uploadAccountAvatar,
} from "@/lib/account/api"
import { AccountApiError, accountErrorMessage, isAccountApiError } from "@/lib/account/errors"
import {
  clearAccountSession,
  createStoredSession,
  hydrateAccountSession,
  isAccessTokenFresh,
  loadAccountSession,
  saveAccountSession,
} from "@/lib/account/session"
import type {
  AccountAuthMode,
  AccountAuthPayload,
  AccountStatus,
  AccountUser,
  AvatarUpload,
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  SendCodeResult,
  StoredAccountSession,
} from "@/lib/account/types"

/*
 * 「我的模型设置」列表按登录态显示的实现入口（归档/恢复/归属账本）都在
 * `lib/model-sync/account-hook`。这里用动态 import：账号 store 被顶栏、
 * 设置页、启动流程多处引用，把同步模块静态拉进来会让首屏多背上整套
 * 加密代码（crypto + 压缩 + Tauri secret）。
 *
 * 归档/恢复失败一律吞掉：登录与退出是用户的权利，本地模型整理只是顺带，
 * 整理坏了下次同步会补做，绝不能把账号操作卡住。
 */

/**
 * 退出登录后对本地模型列表做两步整理（后台执行，不阻塞退出）：
 *  1. 摘掉内置中转 provider，否则下拉框留着「选了就 401」的死选项；
 *  2. 把账本里属于该账号的条目加密归档，移出列表。
 *
 * 两步**必须串行**，这是容易踩的坑：它们都重写同一份 providerConfigs。
 * 并行时归档可能先读到「还带着内置模型」的旧快照，写回时把第 1 步的
 * 摘除又冲掉 —— 症状是退出后内置模型偶尔阴魂不散。
 */
function runLogoutModelCleanup(epochAtLogout: number, accountEmail: string | undefined): void {
  void import("@/lib/builtin-models/auto-sync")
    /*
     * 两步都核对会话代次：这条链在后台跑（退出不能等磁盘/加密），
     * 用户完全可能在它跑到某一步之前**又重新登录**了。
     * 那时活动配置里是刚登记/恢复好的模型，照常继续就会把它们再收走 ——
     * 症状是「重新登录后模型又不见了」，备份也被无意义地重复覆盖。
     * 登录/注册/退出都会 bump 代次，代次一变就说明这次退出的整理已过期。
     */
    .then(({ syncBuiltinModels }) => (sessionEpoch === epochAtLogout ? syncBuiltinModels(null) : undefined))
    .then(() => {
      if (sessionEpoch !== epochAtLogout || !accountEmail) return 0
      return import("@/lib/model-sync/account-hook").then(({ archiveOnLogout }) => archiveOnLogout(accountEmail))
    })
    .then((count) => {
      if (count > 0) console.info(`[model-archive] 退出登录已归档 ${count} 个账号模型`)
    })
    .catch((error) => console.warn("[model-archive] 退出整理模型失败（不影响退出）:", error))
}

/** 没登录也跑一遍：按账本兜底归档（续期失效、老版本升级上来的情况）。 */
function fireArchiveOrphan(): void {
  void import("@/lib/model-sync/account-hook")
    .then(({ archiveAllOwnedModels }) => archiveAllOwnedModels())
    .catch((error) => console.warn("[model-archive] 兜底归档失败:", error))
}

/**
 * 登录/注册后的模型整理：登记内置中转 provider，再恢复该账号的本机归档。
 *
 * 两步**必须串行**（与退出链同样的纪律）：它们都重写同一份 providerConfigs，
 * 并行时后写的一方会把自己的读取快照之前的状态覆盖回去 —— 症状是
 * 「登录后内置模型出现，但归档的账号模型没回来」（或反之）。
 *
 * 恢复前核对会话代次：期间用户可能又退出/换号，迟到的一步不能作用在别的会话上。
 * 全程吞掉异常：登录已经成功，读不出本地归档不该把登录卡住。
 */
async function runLoginModelSetup(session: StoredAccountSession): Promise<void> {
  const epochAtStart = sessionEpoch
  try {
    const { syncBuiltinModels } = await import("@/lib/builtin-models/auto-sync")
    await syncBuiltinModels(session)
  } catch (error) {
    console.error("[builtin] 动态加载失败:", error)
  }
  if (sessionEpoch !== epochAtStart) return
  const count = await restoreHiddenModelsFor(session.user.email)
  if (count > 0) console.info(`[model-archive] 已恢复 ${count} 个账号模型`)
}

/**
 * 注销成功后的本机清理：摘内置 → 归档该账号模型 → **销毁**本机一切秘密。
 *
 * 注销 = 数据主体已删除，本机不该继续留着它的任何东西。先归档再销毁的
 * 净效果是「活动列表里的账号模型 + 本机备份」一起消失，而本机自配的
 * 条目不受影响；只做销毁不先归档的话，那些模型会以「无归属」身份继续
 * 显示，等于注销了账号却还留着它的 API Key。
 *
 * 最后一步 purgeLocalAccountSecrets 还负责删掉「记住密码」凭据与系统仓库里的
 * 同步密码/数据密钥：注销确认框承诺「密码将被永久删除」，30 天免输规则只
 * 适用于退出登录（用户 2026-11-03 确认口径：注销时连本机凭据一起清）。
 *
 * 云端删除失败时走不到这里（deleteAccount 的 await 已抛出）：
 * 本机一概不动，用户还能重试，也不至于"本地没了、云端还活着"。
 */
function runDeleteAccountModelCleanup(epochAtDelete: number, accountEmail: string | undefined): void {
  void import("@/lib/builtin-models/auto-sync")
    .then(({ syncBuiltinModels }) => (sessionEpoch === epochAtDelete ? syncBuiltinModels(null) : undefined))
    .then(() => {
      if (sessionEpoch !== epochAtDelete || !accountEmail) return
      return import("@/lib/model-sync/account-hook").then(async ({ archiveOnLogout, purgeLocalAccountSecrets }) => {
        await archiveOnLogout(accountEmail)
        await purgeLocalAccountSecrets(accountEmail)
      })
    })
    .catch((error) => console.warn("[model-archive] 注销后清理失败（不影响注销结果）:", error))
}

async function restoreHiddenModelsFor(account: string): Promise<number> {
  try {
    const { restoreHiddenModelsForAccount } = await import("@/lib/model-sync/account-hook")
    return await restoreHiddenModelsForAccount(account)
  } catch (error) {
    console.warn("[model-archive] 恢复账号模型失败:", error)
    return 0
  }
}


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
  /**
   * 打开弹窗时是否直接进入「修改密码」面板。
   * 设置页的「修改密码」按钮用它一步跳到目标界面。
   */
  passwordPanelRequested: boolean

  /** 启动时只跑一次：有本地会话就静默续期。 */
  bootstrap: () => Promise<void>
  login: (input: LoginInput) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  sendCode: (email: string, purpose: "register" | "reset") => Promise<SendCodeResult>
  resetPassword: (input: ResetPasswordInput) => Promise<void>
  logout: () => Promise<void>
  /** 注销账号：服务端删除全部数据，本地同步清空。需当前密码确认。 */
  deleteAccount: (password: string) => Promise<void>
  /** 已登录改密；成功后其它设备会话被撤销，当前设备保持登录。 */
  changePassword: (input: ChangePasswordInput) => Promise<void>
  /** 上传新头像；成功后本地用户信息与磁盘会话同步更新。 */
  setAvatar: (upload: AvatarUpload) => Promise<void>
  /** 删除头像。 */
  removeAvatar: () => Promise<void>
  /**
   * 改昵称（服务端限制每月一次）。
   *
   * 成功后同时更新内存与本地会话：`displayNameUpdatedAt` 也来自服务端，
   * 客户端据此显示「下次可修改时间」，不自己算账。
   */
  rename: (displayName: string) => Promise<AccountUser>
  /** 主动续期；无会话返回 null，401 清会话，网络错误保留会话并抛出。 */
  refreshSession: () => Promise<StoredAccountSession | null>
  /**
   * 恢复某账号在本机加密归档的模型（登录成功后调用）。
   *
   * 返回恢复的条目数；任何失败都吞掉返回 0 —— 登录绝不能被一个
   * 损坏的本地缓存卡住。实现见 `lib/model-sync/account-hook`。
   */
  restoreHiddenModels: (account: string) => Promise<number>
  /** 只替换本地会话（例如补签网关卡后），不触发网络请求。 */
  replaceSession: (session: StoredAccountSession) => void
  /** 规格动作名：续期并吞掉错误，供「重试/下次打开账号页」使用。 */
  refresh: () => Promise<void>

  openDialog: (mode?: AccountAuthMode) => void
  /** 打开弹窗并直接进入修改密码面板（已登录时使用）。 */
  openPasswordPanel: () => void
  /** 消费一次「进入改密面板」的请求，避免重复打开。 */
  clearPasswordPanelRequest: () => void
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
  passwordPanelRequested: false,
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
      /*
       * 先把加密存储里的会话读进内存（Tauri 走 DPAPI）。必须在这句之前
       * 调 loadAccountSession()：Tauri 下它在未 hydrate 时返回 null，
       * 否则会把「有登录态」误判成未登录、顺带把模型归档错。
       */
      await hydrateAccountSession()
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
        // 启动即未登录：兜底归档账本里仍挂在账号名下的模型（老版本升上来、
        // 或上次退出时归档失败的残留），否则用户会看到「没登录却显示账号模型」。
        fireArchiveOrphan()
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

        const next = createStoredSession(stored.baseUrl, payload, stored.netcard)
        saveAccountSession(next)
        set({
          status: "authenticated",
          user: next.user,
          session: next,
          error: null,
          sessionUnverified: false,
          bootstrapped: true,
        })

        // 启动续期成功＝这台机器仍是该账号的登录态：走与登录同一条整备链
        // （登记内置 provider、恢复该账号归档）。没有归档时恢复是空操作，
        // 不会重复塞东西；否则「开机就显示着列表、退出再登录才少一批」。
        void runLoginModelSetup(next)
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
          // 续期被判失效 = 这台机器已经不算登录态：同样要把账号模型收进备份。
          fireArchiveOrphan()
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

      // 登录后把模型列表整备到位：内置中转 provider → 恢复该账号的本机归档。
      // 后台执行、串行、带代次守卫，见 runLoginModelSetup 注释。
      void runLoginModelSetup(session)
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

      // 注册与登录走同一条模型整备链：登记内置中转 provider、恢复该邮箱
      // 可能存在的归档（用户注销后重新注册、换机器重装的情况）。
      void runLoginModelSetup(session)
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

  /**
   * 注销账号。
   *
   * 顺序：先在服务端删数据，成功后才清本地会话。
   * 反过来的话，本地已登出、服务端却还在——用户会以为注销成功，
   * 实际上账号仍然存在，下一页设备还能登录。
   *
   * 失败时不动本地状态，让用户能看到错误并重试（比如密码输错）。
   */
  deleteAccount: async (password) => {
    const session = get().session
    if (!session) throw new Error("尚未登录")
    await deleteAccount(session.baseUrl, session.accessToken, password)
    const epochAtDelete = bumpSessionEpoch()
    // 归档键必须在清 user 之前取：set 之后 get().user 已是 null。
    const accountEmail = get().user?.email
    clearAccountSession()
    set({
      status: "anonymous",
      user: null,
      session: null,
      dialogOpen: false,
      error: null,
      sessionUnverified: false,
    })
    // 注销成功 = 数据主体已删除：本机同样不能留着它的模型与归档。
    // 为什么先归档再销毁、为什么云端失败时一概不动，见 helper 注释。
    runDeleteAccountModelCleanup(epochAtDelete, accountEmail)
  },
  logout: async () => {
    // 先让所有在途 refresh 失效，再同步清本地；退出不等网络。
    const epochAtLogout = bumpSessionEpoch()
    /*
     * 启动竞态兜底：bootstrap 现在要先 await hydrateAccountSession() 才能把
     * 会话从加密存储读进内存（Tauri 下 DPAPI 是异步的），于是「启动瞬间就点
     * 退出」存在一个 session 还没就位的窗口。以前 bootstrap 同步读 localStorage，
     * 这个窗口不存在；不加兜底就会漏掉 `logoutAccount`（云端会话不撤销）。
     * hydrate 幂等，bootstrap 正在等同一个 Promise。
     */
    if (!get().session) await hydrateAccountSession()
    const session = get().session ?? loadAccountSession()
    // 归档键必须在清 user 之前取：set 之后 get().user 已是 null。
    const accountEmail = get().user?.email
    clearAccountSession()
    set({
      status: "anonymous",
      user: null,
      session: null,
      dialogOpen: false,
      error: null,
      sessionUnverified: false,
    })

    // 本地模型整理（内置摘除 → 账号模型归档），串行见 fireLogoutModelCleanup 注释。
    runLogoutModelCleanup(epochAtLogout, accountEmail)

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

  changePassword: async (input) => {
    const session = get().session
    if (!session) throw new AccountApiError("TOKEN_EXPIRED")

    try {
      await changeAccountPassword(
        session.baseUrl,
        session.accessToken,
        session.refreshToken,
        input,
      )
      // 改密不影响当前设备的 access/refresh，只需清掉界面上的错误。
      set({ error: null })
    } catch (error) {
      set({ error: accountErrorMessage(error) })
      throw error
    }
  },

  setAvatar: async (upload) => {
    const session = get().session
    if (!session) throw new AccountApiError("TOKEN_EXPIRED")

    try {
      const user = await uploadAccountAvatar(session.baseUrl, session.accessToken, upload)
      const next: StoredAccountSession = { ...session, user }
      saveAccountSession(next)
      set({ user, session: next, error: null })
    } catch (error) {
      set({ error: accountErrorMessage(error) })
      throw error
    }
  },

  rename: async (displayName) => {
    let session = get().session
    if (!session) throw new AccountApiError("TOKEN_EXPIRED")
    // token 快过期时先续期，避免"明明登录着却改不了名"
    if (!isAccessTokenFresh(session)) {
      session = (await get().refreshSession()) ?? session
    }

    try {
      const user = await updateAccountProfile(session.baseUrl, session.accessToken, displayName)
      const next: StoredAccountSession = { ...session, user }
      saveAccountSession(next)
      set({ user, session: next, error: null })
      return user
    } catch (error) {
      set({ error: accountErrorMessage(error) })
      throw error
    }
  },

  removeAvatar: async () => {
    const session = get().session
    if (!session) throw new AccountApiError("TOKEN_EXPIRED")

    try {
      await deleteAccountAvatar(session.baseUrl, session.accessToken)
      const user: AccountUser = { ...session.user, avatarUpdatedAt: null }
      const next: StoredAccountSession = { ...session, user }
      saveAccountSession(next)
      set({ user, session: next, error: null })
    } catch (error) {
      set({ error: accountErrorMessage(error) })
      throw error
    }
  },

  replaceSession: (session: StoredAccountSession) => {
    set({ session, user: session.user })
  },

  /**
   * 恢复某账号在本机加密归档的模型。
   *
   * 失败一律返回 0：登录已经成功，不该被一个读不出来的本地缓存卡住。
   * 恢复成功后界面立刻能看到这些模型 —— 归档条目本来就是这个账号自己的配置。
   */
  restoreHiddenModels: async (account) => restoreHiddenModelsFor(account),

  refreshSession: async () => {
    const epochAtStart = sessionEpoch
    /*
     * 与 logout 同因的启动竞态兜底：会话可能还没被 bootstrap 从加密存储
     * 读进内存。这里只把会话顶上（不改 status，收敛由 bootstrap 负责），
     * 续期本身仍走 sharedRefresh 单飞，所以和 bootstrap 并发时只发一次请求。
     */
    if (!get().session) {
      await hydrateAccountSession()
      const restored = loadAccountSession()
      if (restored && !get().session) set({ session: restored, user: restored.user })
    }
    const session = get().session
    if (!session) return null

    try {
      const payload = await sharedRefresh(session.baseUrl, session.refreshToken)
      if (epochAtStart !== sessionEpoch) return null

      const next = createStoredSession(session.baseUrl, payload, session.netcard)
      saveAccountSession(next)
      set({
        status: "authenticated",
        user: next.user,
        session: next,
        error: null,
        sessionUnverified: false,
      })

      // 续期成功：走与登录同一条整备链 —— 既顺手校验内置模型清单
      // （卡被吊销或换账号时这里会同步过来），也覆盖「bootstrap 时断网
      // 只保留了缓存会话、这次才续上」的恢复场景。
      // 没有归档时恢复是空操作（信封不存在直接返回 0），不会重复塞东西。
      void runLoginModelSetup(next)
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
        // 会话被服务端判失效 = 这台机器已不算登录：把账号模型收进备份，
        // 否则设置页会在「未登录」状态下继续显示账号的模型。
        fireArchiveOrphan()
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
    set({ dialogOpen: true, authMode: mode, error: null, passwordPanelRequested: false })
  },

  openPasswordPanel: () => {
    // 只有已登录才需要改密面板；未登录时退回普通登录弹窗。
    if (get().status !== "authenticated" || !get().session) {
      set({ dialogOpen: true, authMode: "login", error: null, passwordPanelRequested: false })
      return
    }
    set({ dialogOpen: true, error: null, passwordPanelRequested: true })
  },

  clearPasswordPanelRequest: () => {
    set({ passwordPanelRequested: false })
  },

  closeDialog: () => {
    set({ dialogOpen: false, error: null, passwordPanelRequested: false })
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
