// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 「登录 / 退出 / 启动 / 注销」与「账号模型归档」的接线。
 *
 * 行为契约（与用户确认的设计一一对应）：
 * · 登录、注册、启动续期成功：先登记内置中转 provider，再恢复该账号
 *   在本机的加密备份 —— 两步**必须串行**，它们都重写同一份
 *   providerConfigs，并行会互相冲掉对方的写入；
 * · 退出登录：按账本把该账号的模型移出列表并加密归档；
 * · 未登录（启动没有会话 / 续期被拒）：按账本兜底归档；
 * · 注销账号：先归档再销毁归档（数据主体已删除，本机连密文都不该留）；
 *   云端删除失败时本机一概不动；
 * · 迟到的整理要作废：退出的后台链跑到一半时用户又重新登录了，
 *   继续归档会把刚恢复出来的模型再收走（「重新登录后模型又不见了」）。
 *
 * 归档/恢复/计数/销毁的真实逻辑（真加密、按账号隔离、信封一次性消费）
 * 在 hidden-backup.spec.ts 已验证；这里只锁「什么时机、什么账号、
 * 什么顺序」调用它们，所以 mock 的是组装薄层 account-hook。
 */

vi.mock("@/lib/model-sync/account-hook", () => ({
  archiveOnLogout: vi.fn(async () => 2),
  restoreHiddenModelsForAccount: vi.fn(async () => 1),
  archiveAllOwnedModels: vi.fn(async () => 3),
  purgeLocalAccountSecrets: vi.fn(async () => undefined),
  markSyncedOwnershipForAccount: vi.fn(async () => undefined),
}))

const syncBuiltinMock = vi.hoisted(() => vi.fn(async (_session: unknown) => undefined))
vi.mock("@/lib/builtin-models/auto-sync", () => ({ syncBuiltinModels: syncBuiltinMock }))

vi.mock("@/lib/account/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/account/api")>()
  return {
    ...actual,
    loginAccount: vi.fn(),
    registerAccount: vi.fn(),
    refreshAccountSession: vi.fn(),
    logoutAccount: vi.fn(),
    deleteAccount: vi.fn(),
  }
})

import { deleteAccount, loginAccount, logoutAccount, refreshAccountSession, registerAccount } from "@/lib/account/api"
import { AccountApiError } from "@/lib/account/errors"
import { createStoredSession, saveAccountSession } from "@/lib/account/session"
import type { AccountAuthPayload, AccountUser } from "@/lib/account/types"
import {
  archiveAllOwnedModels,
  archiveOnLogout,
  purgeLocalAccountSecrets,
  restoreHiddenModelsForAccount,
} from "@/lib/model-sync/account-hook"
import { resetAccountStoreForTests, useAccountStore } from "./account-store"

const archiveMock = vi.mocked(archiveOnLogout)
const restoreMock = vi.mocked(restoreHiddenModelsForAccount)
const archiveAllMock = vi.mocked(archiveAllOwnedModels)
const purgeMock = vi.mocked(purgeLocalAccountSecrets)

const ACCOUNT = "writer@example.com"

function accountUser(email = ACCOUNT): AccountUser {
  return { id: 1, email, displayName: "W", createdAt: 1793000000, avatarUpdatedAt: null, displayNameUpdatedAt: null }
}

function authPayload(email = ACCOUNT): AccountAuthPayload {
  return {
    user: accountUser(email),
    accessToken: "access",
    accessExpiresAt: 1793000900,
    refreshToken: "refresh",
    refreshExpiresAt: 1800776000,
  }
}

function authenticatedAs(email = ACCOUNT): void {
  useAccountStore.setState({
    status: "authenticated",
    user: accountUser(email),
    session: createStoredSession("https://account.qmai.pro", authPayload(email)),
  })
}

/** 磁盘上放一份可续期的会话：让 bootstrap / refreshSession 真的往下走。 */
function seedStoredSession(email = ACCOUNT): void {
  saveAccountSession(createStoredSession("https://account.qmai.pro", authPayload(email)))
}

/**
 * 只卡住「退出链」的内置摘除那一步，登录链照常放行。
 *
 * 为什么按参数判别而不是 mockImplementationOnce：两条链都会调
 * `syncBuiltinModels`，谁先跑到取决于动态 import 的恢复顺序；
 * 用「第一次调用」装闩会卡错那条链 —— 症状是测试里 restore 从没发生、
 * 断言却侥幸通过（这份测试真的踩过一次，别再用 once）。
 * 退出传 null、登录传 session，是稳定可辨的特征。
 */
function gateLogoutBuiltin(): () => void {
  let release = (): void => {}
  syncBuiltinMock.mockImplementation((target) => {
    if (target === null) return new Promise<void>((resolve) => { release = resolve })
    return Promise.resolve()
  })
  return () => release()
}

beforeEach(() => {
  localStorage.clear()
  resetAccountStoreForTests()
  archiveMock.mockClear()
  restoreMock.mockClear()
  archiveAllMock.mockClear()
  purgeMock.mockClear()
  syncBuiltinMock.mockReset()
  syncBuiltinMock.mockImplementation(async () => undefined)
  vi.mocked(loginAccount).mockReset()
  vi.mocked(registerAccount).mockReset()
  vi.mocked(refreshAccountSession).mockReset()
  vi.mocked(deleteAccount).mockReset()
  // 撤销旧 token 是「尽力而为」，mock 必须返回 promise：返回 undefined
  // 会让 logout 里的 .catch 当场炸掉，掩盖真正要测的归档行为。
  vi.mocked(logoutAccount).mockReset()
  vi.mocked(logoutAccount).mockResolvedValue(undefined as never)
})

describe("登录系路径都恢复该账号的归档", () => {
  it("login：先登记内置、再恢复归档（写同一份 configs，必须串行）", async () => {
    vi.mocked(loginAccount).mockResolvedValue(authPayload())

    await useAccountStore.getState().login({ email: ACCOUNT, password: "password123" })

    // 整备链在后台跑（登录不能等磁盘/加密），测试里等它完成。
    await vi.waitFor(() => expect(restoreMock).toHaveBeenCalledWith(ACCOUNT))
    expect(syncBuiltinMock).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ email: ACCOUNT }) }))
    expect(syncBuiltinMock.mock.invocationCallOrder[0]).toBeLessThan(restoreMock.mock.invocationCallOrder[0])
  })

  it("register：新注册的邮箱也走恢复（注销后重注册不该丢老配置）", async () => {
    vi.mocked(registerAccount).mockResolvedValue(authPayload("new@example.com"))

    await useAccountStore.getState().register({ email: "new@example.com", code: "123456", password: "password123" })

    await vi.waitFor(() => expect(restoreMock).toHaveBeenCalledWith("new@example.com"))
  })

  it("启动续期成功：恢复账号归档（否则开机看到的列表比登录后少）", async () => {
    seedStoredSession()
    vi.mocked(refreshAccountSession).mockResolvedValue(authPayload())

    await useAccountStore.getState().bootstrap()

    await vi.waitFor(() => expect(restoreMock).toHaveBeenCalledWith(ACCOUNT))
  })

  it("主动续期成功：同样恢复一次", async () => {
    // 先装好续期返回值：bootstrap 与 refreshSession 都要成功走到「已登录」分支。
    vi.mocked(refreshAccountSession).mockResolvedValue(authPayload())
    seedStoredSession()
    await useAccountStore.getState().bootstrap()
    await vi.waitFor(() => expect(restoreMock).toHaveBeenCalled())
    restoreMock.mockClear()

    await expect(useAccountStore.getState().refreshSession()).resolves.not.toBeNull()

    await vi.waitFor(() => expect(restoreMock).toHaveBeenCalledWith(ACCOUNT))
  })

  it("restoreHiddenModels 吞掉失败返回 0：登录不该被本地缓存卡住", async () => {
    restoreMock.mockRejectedValueOnce(new Error("解密失败"))

    await expect(useAccountStore.getState().restoreHiddenModels(ACCOUNT)).resolves.toBe(0)
  })
})

describe("退出登录归档账号模型", () => {
  it("logout：以当前账号邮箱归档，且排在摘内置之后", async () => {
    authenticatedAs()

    await useAccountStore.getState().logout()

    await vi.waitFor(() => expect(archiveMock).toHaveBeenCalledWith(ACCOUNT))
    expect(syncBuiltinMock).toHaveBeenCalledWith(null)
    expect(syncBuiltinMock.mock.invocationCallOrder[0]).toBeLessThan(archiveMock.mock.invocationCallOrder[0])
  })

  it("未登录时退出不归档（没有账号可归档）", async () => {
    await useAccountStore.getState().logout()

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(archiveMock).not.toHaveBeenCalled()
  })

  it("归档异常不阻塞退出：状态照常回到未登录", async () => {
    archiveMock.mockRejectedValueOnce(new Error("备份写入失败"))
    authenticatedAs()

    await expect(useAccountStore.getState().logout()).resolves.toBeUndefined()
    expect(useAccountStore.getState().status).toBe("anonymous")
  })

  it("退出后马上重新登录：迟到的归档作废，不能把刚恢复的模型再收走", async () => {
    /*
     * 真实场景：误点退出后立刻重新登录。退出的整理在后台跑，
     * 可能在新登录恢复完之后才走到归档那一步；那时活动配置里正是
     * 刚恢复出来的账号模型，照常归档就会把它们又收走。
     */
    authenticatedAs()
    const releaseBuiltin = gateLogoutBuiltin()

    await useAccountStore.getState().logout()
    // 退出链必须真的停在「摘内置」，否则后面的断言只是时序运气。
    await vi.waitFor(() => expect(syncBuiltinMock).toHaveBeenCalledWith(null))

    vi.mocked(loginAccount).mockResolvedValue(authPayload())
    await useAccountStore.getState().login({ email: ACCOUNT, password: "password123" })
    await vi.waitFor(() => expect(restoreMock).toHaveBeenCalledWith(ACCOUNT))

    // 放行迟到的退出链：会话代次已因登录变化，归档必须整段跳过。
    releaseBuiltin()
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(archiveMock).not.toHaveBeenCalled()
    expect(useAccountStore.getState().status).toBe("authenticated")
  })

  it("守卫不伤正常路径：登录后不再登录时，归档照常执行", async () => {
    authenticatedAs()

    await useAccountStore.getState().logout()

    await vi.waitFor(() => expect(archiveMock).toHaveBeenCalledTimes(1))
  })
})

describe("未登录时兜底归档", () => {
  it("启动没有本地会话：按账本归档一次", async () => {
    await useAccountStore.getState().bootstrap()

    await vi.waitFor(() => expect(archiveAllMock).toHaveBeenCalledTimes(1))
  })

  it("重复 bootstrap 只归档一次（引导只跑一次）", async () => {
    await useAccountStore.getState().bootstrap()
    await useAccountStore.getState().bootstrap()
    await vi.waitFor(() => expect(archiveAllMock).toHaveBeenCalled())

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(archiveAllMock).toHaveBeenCalledTimes(1)
  })

  it("续期被服务端判失效：清会话的同时归档", async () => {
    seedStoredSession()
    vi.mocked(refreshAccountSession).mockRejectedValue(new AccountApiError("TOKEN_EXPIRED"))

    await useAccountStore.getState().bootstrap()

    expect(useAccountStore.getState().status).toBe("anonymous")
    await vi.waitFor(() => expect(archiveAllMock).toHaveBeenCalledTimes(1))
  })

  it("断网保留会话：不归档（用户仍是登录态）", async () => {
    seedStoredSession()
    vi.mocked(refreshAccountSession).mockRejectedValue(new AccountApiError("NETWORK"))

    await useAccountStore.getState().bootstrap()

    expect(useAccountStore.getState().status).toBe("authenticated")
    expect(archiveAllMock).not.toHaveBeenCalled()
  })

  it("refreshSession 被拒时归档、网络错误时不归档", async () => {
    authenticatedAs()
    vi.mocked(refreshAccountSession).mockRejectedValue(new AccountApiError("TOKEN_EXPIRED"))

    await expect(useAccountStore.getState().refreshSession()).resolves.toBeNull()
    await vi.waitFor(() => expect(archiveAllMock).toHaveBeenCalledTimes(1))

    authenticatedAs()
    vi.mocked(refreshAccountSession).mockRejectedValue(new AccountApiError("NETWORK"))

    await expect(useAccountStore.getState().refreshSession()).rejects.toThrow()
    expect(archiveAllMock).toHaveBeenCalledTimes(1)
  })
})

describe("注销账号彻底移除本机痕迹", () => {
  it("注销成功：先归档再销毁归档（活动模型与备份一起消失）", async () => {
    vi.mocked(deleteAccount).mockResolvedValue(undefined as never)
    authenticatedAs()

    await useAccountStore.getState().deleteAccount("password123")

    await vi.waitFor(() => expect(purgeMock).toHaveBeenCalledWith(ACCOUNT))
    expect(archiveMock).toHaveBeenCalledWith(ACCOUNT)
    expect(archiveMock.mock.invocationCallOrder[0]).toBeLessThan(purgeMock.mock.invocationCallOrder[0])
  })

  it("云端删除失败：本机一概不动（用户还能重试，不至于本地没了云端还在）", async () => {
    vi.mocked(deleteAccount).mockRejectedValue(new AccountApiError("WRONG_PASSWORD"))
    authenticatedAs()

    await expect(useAccountStore.getState().deleteAccount("bad")).rejects.toThrow()

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(archiveMock).not.toHaveBeenCalled()
    expect(purgeMock).not.toHaveBeenCalled()
  })
})