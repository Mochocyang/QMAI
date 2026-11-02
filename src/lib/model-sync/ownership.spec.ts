import { describe, expect, it } from "vitest"

import {
  decryptHiddenBackup,
  encryptHiddenBackup,
  ledgerAfterLogin,
  mergeRestored,
  splitForLedger,
  type OwnershipLedger,
} from "./ownership"

/**
 * 「模型设置的账号归属」——登录态决定「我的模型设置」列表显示什么。
 *
 * 需求（用户确认的三条决策 + 一条使用边界）：
 * 1. 已登录：列表 = 该账号已同步的模型（登录时拉云端、云端优先合并）。
 * 2. 未登录：列表里没有「属于某账号」的配置——它们被加密收进本机备份，
 *    界面上用一行提示说明「登录原账号后即可恢复显示」。
 * 3. 未登录时「＋添加」仍可用作本机配置（不同步、不隐藏）。
 *
 * 归属靠一份「账本」（provider id → 账号邮箱）判定，而不是在配置对象里
 * 塞标记字段：配置对象整份被精简加密上云（`slimProviderValue` 会丢弃未知字段），
 * 内嵌标记会在往返中被削掉，账本必须独立存放。
 */

const ACCOUNT = "writer@example.com"

describe("splitForLedger（退出登录时拆走账号配置）", () => {
  it("账本里属于该账号的条目进备份，其余留在界面上", () => {
    const active = {
      openai: { apiKey: "sk-account" },
      deepseek: { apiKey: "sk-account-2" },
      "custom-local": { apiKey: "sk-mine" },
    }
    const ledger: OwnershipLedger = { openai: ACCOUNT, deepseek: ACCOUNT }

    const { archive, keep } = splitForLedger(active, ledger, ACCOUNT)

    expect(Object.keys(archive).sort()).toEqual(["deepseek", "openai"])
    // 未登录仍要能用自己的本机配置（决策④：保留添加入口与本机条目）
    expect(Object.keys(keep)).toEqual(["custom-local"])
  })

  it("账本里没有的条目一律保留：本机自配与内置中转不能被误收进备份", () => {
    const active = { custom: { apiKey: "k" }, builtin: { apiKey: "b" } }

    const { archive, keep } = splitForLedger(active, {}, ACCOUNT)

    expect(archive).toEqual({})
    expect(Object.keys(keep).sort()).toEqual(["builtin", "custom"])
  })

  it("账本里属于别的账号的条目不动它（等那个账号登录时处理）", () => {
    const active = { openai: { apiKey: "sk-a" } }
    const ledger: OwnershipLedger = { openai: "other@example.com" }

    const { archive, keep } = splitForLedger(active, ledger, ACCOUNT)

    expect(archive).toEqual({})
    expect(Object.keys(keep)).toEqual(["openai"])
  })
})

describe("mergeRestored（登录时备份并入活动配置）", () => {
  it("同 id 冲突时云端/备份优先（决策②：登录以账号数据为准）", () => {
    const current = { openai: { apiKey: "sk-local", model: "gpt-local" } }
    const restored = { openai: { apiKey: "sk-cloud", model: "gpt-cloud" } }

    const merged = mergeRestored(current, restored)

    expect(merged.openai).toEqual({ apiKey: "sk-cloud", model: "gpt-cloud" })
  })

  it("两边独有的条目都保留（并集，不丢任何一边）", () => {
    const merged = mergeRestored(
      { "custom-a": { apiKey: "a" } },
      { openai: { apiKey: "b" } },
    )

    expect(Object.keys(merged).sort()).toEqual(["custom-a", "openai"])
  })
})

describe("ledgerAfterLogin（恢复的条目认领给当前账号）", () => {
  it("从备份恢复的 provider 在账本里记到该账号名下", () => {
    const ledger = ledgerAfterLogin({}, ACCOUNT, ["openai", "deepseek"])

    expect(ledger).toEqual({ openai: ACCOUNT, deepseek: ACCOUNT })
  })

  it("已有归属的条目不被改记：别人账号的配置不会因本机登录被抢走", () => {
    const before: OwnershipLedger = { github: "other@example.com" }
    const ledger = ledgerAfterLogin(before, ACCOUNT, ["github", "openai"])

    expect(ledger.github).toBe("other@example.com")
    expect(ledger.openai).toBe(ACCOUNT)
  })
})

describe("备份信封（加密保存、错密码拒读）", () => {
  const PASSWORD = "correct horse battery staple"

  it("加密后用同一密码能解回原条目", async () => {
    const envelope = await encryptHiddenBackup({
      account: ACCOUNT,
      savedAt: 1_700_000_000_000,
      entries: { openai: { apiKey: "sk-secret" } },
    }, PASSWORD)

    const backup = await decryptHiddenBackup(envelope, PASSWORD)

    expect(backup?.account).toBe(ACCOUNT)
    expect(backup?.entries.openai).toEqual({ apiKey: "sk-secret" })
  })

  it("换一个同步密码解不开：返回 null，而不是抛错或吐出别人账号的配置", async () => {
    const envelope = await encryptHiddenBackup({
      account: ACCOUNT,
      savedAt: 1_700_000_000_000,
      entries: { openai: { apiKey: "sk-secret" } },
    }, PASSWORD)

    await expect(decryptHiddenBackup(envelope, "wrong password")).resolves.toBeNull()
  })

  it("密文里不能出现明文 API Key", async () => {
    const envelope = await encryptHiddenBackup({
      account: ACCOUNT,
      savedAt: 1_700_000_000_000,
      entries: { openai: { apiKey: "sk-do-not-leak" } },
    }, PASSWORD)

    expect(envelope).not.toContain("sk-do-not-leak")
  })
})
