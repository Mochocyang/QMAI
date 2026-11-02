// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 同步写回本机时登记「归属账号」。
 *
 * 这是整套设计的闭环点：退出登录靠账本（provider id → 账号邮箱）才知道
 * 该归档哪些条目。如果同步拉下来的模型不登记归属，账本永远是空的，
 * 退出时无东西可归档 —— 「未登录显示账号模型」的 bug 原样存在。
 *
 * 选择 saveConfigs 这个单一咽喉点而不是散在 enable/syncNow/心跳各处：
 * 所有把云端内容写进本地的路径（拉取合并、从云端恢复）都必经这里，
 * 漏挂的概率为零。
 */

vi.mock("@/lib/model-sync/account-hook", () => ({
  markSyncedOwnershipForAccount: vi.fn(async () => undefined),
  pruneHiddenBackupForAccount: vi.fn(async () => undefined),
}))

import { markSyncedOwnershipForAccount } from "@/lib/model-sync/account-hook"
import { resetAccountStoreForTests, useAccountStore } from "./account-store"
import { markSyncedOwnershipAfterWrite } from "./model-sync-store"

const markMock = vi.mocked(markSyncedOwnershipForAccount)

beforeEach(() => {
  localStorage.clear()
  resetAccountStoreForTests()
  markMock.mockClear()
})

describe("markSyncedOwnershipAfterWrite", () => {
  it("已登录：以当前账号邮箱登记", async () => {
    useAccountStore.setState({
      status: "authenticated",
      user: { id: 1, email: "writer@example.com", displayName: "W", createdAt: 1, avatarUpdatedAt: null, displayNameUpdatedAt: null },
      session: null,
    })

    await markSyncedOwnershipAfterWrite()

    expect(markMock).toHaveBeenCalledWith("writer@example.com")
  })

  it("未登录：什么都不登记（不能把本机配置挂到不存在的账号上）", async () => {
    useAccountStore.setState({ status: "anonymous", user: null, session: null })

    await markSyncedOwnershipAfterWrite()

    expect(markMock).not.toHaveBeenCalled()
  })

  it("登记失败静默：同步本身已成功，不能因归属记账报错", async () => {
    useAccountStore.setState({
      status: "authenticated",
      user: { id: 1, email: "writer@example.com", displayName: "W", createdAt: 1, avatarUpdatedAt: null, displayNameUpdatedAt: null },
      session: null,
    })
    markMock.mockRejectedValueOnce(new Error("磁盘写入失败"))

    await expect(markSyncedOwnershipAfterWrite()).resolves.toBeUndefined()
  })
})
