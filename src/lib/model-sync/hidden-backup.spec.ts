import { describe, expect, it } from "vitest"

import type { OwnershipLedger } from "./ownership"
import {
  archiveForLogout,
  archiveOwnedModels,
  countHiddenModels,
  markSyncedOwnership,
  restoreForLogin,
  type HiddenBackupIo,
} from "./hidden-backup"

/**
 * 「退出登录把账号模型收进本机加密备份 / 登录时恢复」的编排。
 *
 * IO 全部用内存假实现，加密走真实 `crypto.ts`（PBKDF2 默认参数实测
 * 一次 0.4 秒左右，单测可以承受；用假加密就等于没验证「备份真的不含明文」）。
 *
 * 行为约定（与用户确认的四条决策对应）：
 * · 登录时：先恢复该账号的备份，再照常走云端同步；
 * · 退出时：账本记为该账号的条目移出列表、加密归档；本机自配留下（决策④）；
 * · 备份按账号隔离：A 账号的归档只会在 A 登录时恢复；
 * · 界面在没有登录且有归档时显示提示文案（本模块只负责数据，文案在组件层）。
 */

const ACCOUNT = "writer@example.com"

interface Harness {
  io: HiddenBackupIo
  configs: Record<string, unknown>
  ledger: OwnershipLedger
  backups: Record<string, string>
  savedConfigs: number
}

function createHarness(initial: {
  configs?: Record<string, unknown>
  ledger?: OwnershipLedger
  backups?: Record<string, string>
} = {}): Harness {
  const h: Harness = {
    configs: { ...(initial.configs ?? {}) },
    ledger: { ...(initial.ledger ?? {}) },
    backups: { ...(initial.backups ?? {}) },
    savedConfigs: 0,
    io: {
      now: () => 1_700_000_000_000,
      loadConfigs: async () => h.configs,
      saveConfigs: async (next) => {
        h.configs = next
        h.savedConfigs += 1
      },
      loadLedger: async () => h.ledger,
      saveLedger: async (next) => {
        h.ledger = next
      },
      loadBackups: async () => h.backups,
      saveBackups: async (next) => {
        h.backups = next
      },
      // 真随机密钥走注入：这里给固定值，真实实现用 secret 仓库。
      backupKey: async () => "unit-test-backup-key-0123456789",
    },
  }
  return h
}

describe("archiveForLogout（退出登录）", () => {
  it("账本记为该账号的条目移出活动配置并归档", async () => {
    const h = createHarness({
      configs: {
        openai: { apiKey: "sk-a" },
        deepseek: { apiKey: "sk-b" },
        "custom-local": { apiKey: "sk-c" },
      },
      ledger: { openai: ACCOUNT, deepseek: ACCOUNT },
    })

    const archived = await archiveForLogout(h.io, ACCOUNT)

    expect(archived).toBe(2)
    // 活动配置里只剩本机自配的条目。
    expect(Object.keys(h.configs)).toEqual(["custom-local"])
    // 归档按账号存了一份信封。
    expect(Object.keys(h.backups)).toEqual([ACCOUNT])
  })

  it("归档的信封不含明文 API Key", async () => {
    const h = createHarness({
      configs: { openai: { apiKey: "sk-do-not-leak" } },
      ledger: { openai: ACCOUNT },
    })

    await archiveForLogout(h.io, ACCOUNT)

    expect(h.backups[ACCOUNT]).not.toContain("sk-do-not-leak")
  })

  it("没有属于该账号的条目时不写备份、不动配置", async () => {
    const h = createHarness({ configs: { custom: { apiKey: "k" } }, ledger: {} })

    const archived = await archiveForLogout(h.io, ACCOUNT)

    expect(archived).toBe(0)
    expect(h.backups).toEqual({})
    expect(h.savedConfigs).toBe(0)
  })

  it("重复退出不叠加：同一账号再次归档只有当次活动条目", async () => {
    const h = createHarness({
      configs: { openai: { apiKey: "sk-a" } },
      ledger: { openai: ACCOUNT },
    })

    await archiveForLogout(h.io, ACCOUNT)
    // 活动配置已空；再退一次不应产生新归档、也不报错。
    const again = await archiveForLogout(h.io, ACCOUNT)

    expect(again).toBe(0)
  })
})

describe("restoreForLogin（登录）", () => {
  it("恢复该账号的备份：条目回到活动配置、信封被消费、账本认领", async () => {
    const h = createHarness({
      configs: { openai: { apiKey: "sk-stale-local" } },
      ledger: {},
    })
    // 先归档一次，拿到真实信封。
    h.ledger = { openai: ACCOUNT }
    await archiveForLogout(h.io, ACCOUNT)
    expect(h.configs).toEqual({})

    const restored = await restoreForLogin(h.io, ACCOUNT)

    expect(restored).toBe(1)
    expect(h.configs.openai).toEqual({ apiKey: "sk-stale-local" })
    // 同 id 冲突时备份优先（决策②：账号数据为准）。
    // 信封是一次性的：恢复后删除，避免下次登录重复塞回旧版本。
    expect(h.backups[ACCOUNT]).toBeUndefined()
    expect(h.ledger.openai).toBe(ACCOUNT)
  })

  it("别的账号的备份不会被恢复（登录 B 不动 A 的归档）", async () => {
    // 先让 A 把 openai 归档出去：A 的活动配置里得有这条，且账本记着归属。
    const h = createHarness({
      configs: { openai: { apiKey: "sk-a" } },
      ledger: { openai: ACCOUNT },
    })
    await archiveForLogout(h.io, ACCOUNT)
    expect(h.configs).toEqual({})

    const restored = await restoreForLogin(h.io, "someone-else@example.com")

    expect(restored).toBe(0)
    expect(h.configs).toEqual({})
    expect(h.backups[ACCOUNT]).toBeTruthy()
  })

  it("没有该账号的备份时返回 0 且不动任何东西", async () => {
    const h = createHarness({ configs: { custom: { apiKey: "k" } } })

    const restored = await restoreForLogin(h.io, ACCOUNT)

    expect(restored).toBe(0)
    expect(Object.keys(h.configs)).toEqual(["custom"])
    expect(h.savedConfigs).toBe(0)
  })

  it("备份信封损坏时安全跳过，不阻塞登录", async () => {
    const h = createHarness({ backups: { [ACCOUNT]: "{not valid json" } })

    await expect(restoreForLogin(h.io, ACCOUNT)).resolves.toBe(0)
    expect(h.configs).toEqual({})
  })
})

describe("archiveOwnedModels（启动/引导后发现未登录）", () => {
  /*
   * 除了「点退出登录」，还有两条路径会让未登录状态下留着账号模型：
   *   · 登录态过期（refresh 失败）自动回到未登录，没人调用退出流程；
   *   · 老版本升上来时，配置里已经有从账号同步来的模型，但从未归档过。
   * 这两种情况都要按**账本里的归属**分别归档，否则用户会看到
   * 「没登录却显示着账号的模型」，与产品约定矛盾。
   */
  it("按归属账号分别归档，而不是混成一份", async () => {
    const h = createHarness({
      configs: { openai: { apiKey: "sk-a" }, deepseek: { apiKey: "sk-b" } },
      ledger: { openai: ACCOUNT, deepseek: "other@example.com" },
    })

    const archived = await archiveOwnedModels(h.io)

    expect(archived).toBe(2)
    expect(Object.keys(h.backups).sort()).toEqual(["other@example.com", ACCOUNT])
    // 两个账号各自成一份，互不混入：登录 A 不会看到 B 的 Key。
    expect(h.configs).toEqual({})
  })

  it("没有归属记录的条目留在界面上（本机自配不因未登录被隐藏）", async () => {
    const h = createHarness({
      configs: { openai: { apiKey: "sk-a" }, "custom-local": { apiKey: "sk-c" } },
      ledger: { openai: ACCOUNT },
    })

    const archived = await archiveOwnedModels(h.io)

    expect(archived).toBe(1)
    expect(Object.keys(h.configs)).toEqual(["custom-local"])
  })

  it("账本为空时什么都不做：不写空备份、不动配置", async () => {
    const h = createHarness({ configs: { custom: { apiKey: "k" } }, ledger: {} })

    await expect(archiveOwnedModels(h.io)).resolves.toBe(0)
    expect(h.backups).toEqual({})
    expect(h.savedConfigs).toBe(0)
  })
})

describe("countHiddenModels（提示文案的数据源）", () => {
  it("有归档时数出条目总数", async () => {
    const h = createHarness({
      configs: { openai: { apiKey: "a" }, deepseek: { apiKey: "b" } },
      ledger: { openai: ACCOUNT, deepseek: ACCOUNT },
    })
    await archiveForLogout(h.io, ACCOUNT)

    await expect(countHiddenModels(h.io)).resolves.toBe(2)
  })

  it("没有归档时是 0（未登录但从未同步过的用户不该看到提示）", async () => {
    const h = createHarness()

    await expect(countHiddenModels(h.io)).resolves.toBe(0)
  })
})

describe("markSyncedOwnership（同步成功的条目归当前账号）", () => {
  it("推送上去的条目记在该账号名下", () => {
    const ledger = markSyncedOwnership({}, ACCOUNT, ["openai", "deepseek"])

    expect(ledger).toEqual({ openai: ACCOUNT, deepseek: ACCOUNT })
  })

  it("云端就是该账号的数据：已记给别人也改记为当前账号", () => {
    /*
     * 与 ledgerAfterLogin 的「不抢别人归属」相反是刻意的：这里的输入是
     * **正在从该账号云端同步下来的内容**，它属于当前账号是确定的。
     * 上一台机器登录过 A、这一台登录 B 后从 B 的云端拉到同名 provider 时，
     * 若还挂着 A 的归属，退出 B 就不会归档它，B 的账号数据会漏显。
     */
    const before: OwnershipLedger = { openai: "a@example.com" }

    const ledger = markSyncedOwnership(before, ACCOUNT, ["openai"])

    expect(ledger.openai).toBe(ACCOUNT)
  })
})
