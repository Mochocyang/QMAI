// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 注销账号时的本机秘密彻底清除（用户 2026-11-03 确认的产品口径）。
 *
 * 注销确认框承诺「账号、密码、头像、云端模型配置将被永久删除」，但此前
 * 本机留着三样能还原使用痕迹的秘密：
 *   · 「记住密码」凭据（邮箱+密码，DPAPI，最长 30 天）；
 *   · 模型同步密码与备份数据密钥（secret 仓库）；
 *   · 按账号隔离的模型加密备份。
 * 退出登录不清它们是产品规则（30 天免输）；**注销不同**——账号都不存在了，
 * 本机继续留着可解密的凭据既违背弹窗里的承诺，也是条款里的删除义务没兑现。
 * 所以注销成功 = 这些一并销毁。
 *
 * prune 的纯逻辑在 hidden-backup.spec 已验证；这里验组装层真的把四个出口都打了。
 */

const store = new Map<string, unknown>()
const invokeMock = vi.hoisted(() => vi.fn(async () => undefined))

const ACCOUNT = "writer@example.com"
const OTHER = "someone-else@example.com"

vi.mock("@/lib/platform", () => ({ isTauri: vi.fn(() => true) }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))
vi.mock("@/lib/web-store", () => ({
  getStore: vi.fn(async () => ({
    get: async (key: string) => store.get(key),
    set: async (key: string, value: unknown) => void store.set(key, value),
    save: async () => undefined,
  })),
}))
// 备份信封是加密 JSON；prune 只按账号键删除、从不解密，测试不需要真实密文。
vi.mock("@/lib/model-sync/crypto", () => ({
  encryptModelConfig: async () => "{}",
  decryptModelConfig: async () => JSON.stringify({ account: ACCOUNT, savedAt: 0, entries: {} }),
  createSyncSalt: () => "c2FsdA==",
  SyncPasswordError: class extends Error {},
}))
vi.mock("@/lib/project-store", () => ({
  loadProviderConfigs: async () => ({}),
  saveProviderConfigs: async () => undefined,
  loadRerankConfig: async () => null,
  loadEmbeddingConfig: async () => null,
  saveRerankConfig: async () => undefined,
  saveEmbeddingConfig: async () => undefined,
}))
vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: { getState: () => ({ providerConfigs: {}, setProviderConfigs: () => undefined }) },
}))

beforeEach(() => {
  store.clear()
  invokeMock.mockClear()
  // 两个账号各有一份备份、账本各有归属条目：只有 ACCOUNT 的被清，OTHER 不动。
  store.set("model-hidden-backups", { [ACCOUNT]: "envelope-a", [OTHER]: "envelope-b" })
  store.set("model-ownership-ledger", { openai: ACCOUNT, deepseek: OTHER })
})

describe("purgeLocalAccountSecrets", () => {
  it("删掉该账号的备份与账本归属，别人的不动", async () => {
    const { purgeLocalAccountSecrets } = await import("./account-hook")

    await purgeLocalAccountSecrets(ACCOUNT)

    const backups = store.get("model-hidden-backups") as Record<string, string>
    expect(backups[ACCOUNT]).toBeUndefined()
    expect(backups[OTHER]).toBe("envelope-b")

    const ledger = store.get("model-ownership-ledger") as Record<string, string>
    expect(ledger.openai).toBeUndefined()
    expect(ledger.deepseek).toBe(OTHER)
  })

  it("清掉记住的登录凭据 + 同步密码 + 备份数据密钥", async () => {
    const { purgeLocalAccountSecrets } = await import("./account-hook")

    await purgeLocalAccountSecrets(ACCOUNT)

    const names = invokeMock.mock.calls.map((call) => call[0])
    // 「记住密码」的 DPAPI 文件（account_credential_clear）。
    expect(names).toContain("account_credential_clear")
    // secret 仓库里的两把钥匙：同步密码、备份数据密钥。
    const clearedSecrets = invokeMock.mock.calls
      .filter((call) => call[0] === "secret_clear")
      .map((call) => (call[1] as { name: string }).name)
    expect(clearedSecrets).toContain("model-sync-password")
    expect(clearedSecrets).toContain("model-backup-key")
  })

  it("任何一步失败都不抛出：云端已删成功，本机残留不该反咬报错", async () => {
    invokeMock.mockRejectedValue(new Error("仓库不可用"))
    const { purgeLocalAccountSecrets } = await import("./account-hook")

    await expect(purgeLocalAccountSecrets(ACCOUNT)).resolves.toBeUndefined()
  })
})
