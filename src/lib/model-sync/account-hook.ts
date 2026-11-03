/**
 * 账号模型归档的组装层：把纯逻辑（hidden-backup）接到真实 IO 上。
 *
 * 各存储位置：
 * · 账本（provider id → 归属账号）：`model-ownership-ledger`，普通 JSON。
 *   邮箱本身不算高敏（本机其他数据也都在），单独加密只会让排错变难。
 * · 归档信封：`model-hidden-backups`，值都是**已加密**的字符串，
 *   磁盘上不存在任何 API Key 明文。
 * · 数据密钥：系统加密仓库 `model-backup-key`（Windows DPAPI，绑定当前
 *   系统用户）。密钥不在 JSON 文件里，文件被拷走也解不开。
 *
 * 为什么数据密钥不用「同步密码」派生：恢复发生在刚登录的时刻，
 * 那时用户没有输过同步密码，拿不到派生材料；随机生成的数据密钥
 * 交给 DPAPI 保管，是「不需要用户参与」和「不落盘明文」之间唯一两头都
 * 成立的方案。
 */

import { getStore } from "@/lib/web-store"
import { isTauri } from "@/lib/platform"
import { BACKUP_KEY_SECRET_NAME, SYNC_PASSWORD_SECRET_NAME } from "@/lib/model-sync/secret-names"
import { useWikiStore, type ProviderConfigs } from "@/stores/wiki-store"
import { loadProviderConfigs, saveProviderConfigs } from "@/lib/project-store"

import {
  archiveForLogout,
  archiveOwnedModels,
  countHiddenModels,
  restoreForLogin,
  markSyncedOwnership,
  pruneHiddenBackup,
  type HiddenBackupIo,
} from "./hidden-backup"
import type { OwnershipLedger } from "./ownership"

const LEDGER_KEY = "model-ownership-ledger"
const BACKUPS_KEY = "model-hidden-backups"

async function readSecret(name: string): Promise<string | null> {
  if (!isTauri()) return null
  const { invoke } = await import("@tauri-apps/api/core")
  const value = await invoke<string | null>("secret_get", { name })
  return value && value.length > 0 ? value : null
}

async function writeSecret(name: string, value: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("secret_set", { name, value })
}

/**
 * 取（或首次生成）备份数据密钥。
 *
 * 生成后立刻写进系统加密仓库；浏览器环境（非 Tauri）没有安全仓库，
 * 直接抛错 —— 上层的登录/退出流程都会 catch 归档失败，不影响账号操作。
 */
async function backupKey(): Promise<string> {
  const existing = await readSecret(BACKUP_KEY_SECRET_NAME)
  if (existing) return existing
  if (!isTauri()) throw new Error("当前环境不支持加密备份模型配置。")
  const fresh = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
  await writeSecret(BACKUP_KEY_SECRET_NAME, fresh)
  return fresh
}

async function loadLedger(): Promise<OwnershipLedger> {
  try {
    const store = await getStore()
    const raw = await store.get<unknown>(LEDGER_KEY)
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
    const out: OwnershipLedger = {}
    for (const [id, owner] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof owner === "string" && owner.includes("@")) out[id] = owner
    }
    return out
  } catch {
    return {}
  }
}

async function saveLedger(ledger: OwnershipLedger): Promise<void> {
  const store = await getStore()
  await store.set(LEDGER_KEY, ledger)
  await store.save()
}

async function loadBackups(): Promise<Record<string, string>> {
  try {
    const store = await getStore()
    const raw = await store.get<unknown>(BACKUPS_KEY)
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
    const out: Record<string, string> = {}
    for (const [account, envelope] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof envelope === "string") out[account] = envelope
    }
    return out
  } catch {
    return {}
  }
}

async function saveBackups(backups: Record<string, string>): Promise<void> {
  const store = await getStore()
  await store.set(BACKUPS_KEY, backups)
  await store.save()
}

function createIo(): HiddenBackupIo {
  return {
    now: () => Date.now(),
    loadConfigs: async () => {
      // 以磁盘为准再对齐内存：退出/登录时可能还没人打开过设置页，
      // wiki-store 里是空的，只读 store 会漏归档。
      const fromDisk = (await loadProviderConfigs()) ?? useWikiStore.getState().providerConfigs
      return fromDisk as Record<string, unknown>
    },
    saveConfigs: async (configs) => {
      const typed = configs as ProviderConfigs
      await saveProviderConfigs(typed)
      useWikiStore.getState().setProviderConfigs(typed)
    },
    loadLedger,
    saveLedger,
    loadBackups,
    saveBackups,
    backupKey,
  }
}

/**
 * 退出登录：归档该账号在活动配置里的模型。
 *
 * 失败要冒泡给调用方记日志（账号 store 那边 catch），绝不冒到退出流程本身。
 */
export async function archiveOnLogout(account: string): Promise<number> {
  return archiveForLogout(createIo(), account)
}

/** 未登录兜底（启动/登录态过期）：按账本里每个归属账号分别归档。 */
export async function archiveAllOwnedModels(): Promise<number> {
  return archiveOwnedModels(createIo())
}

/** 登录后恢复该账号的加密备份；返回恢复条数（无备份/失败都是 0）。 */
export async function restoreHiddenModelsForAccount(account: string): Promise<number> {
  try {
    return await restoreForLogin(createIo(), account)
  } catch {
    // 备份损坏、环境不支持安全仓库：当作没有备份。登录绝不能被本地缓存卡住。
    return 0
  }
}

/** 未登录界面提示的数据源：本机被归档的模型总数（0 时不显示提示）。 */
export async function countHiddenModelsForNotice(): Promise<number> {
  try {
    return await countHiddenModels(createIo())
  } catch {
    return 0
  }
}

/**
 * 同步成功后把当前活动配置里的条目登记给该账号。
 *
 * 这些条目正是从该账号云端合并下来的，归属必须记准：否则退出登录时
 * 它们不会被归档，用户会看到「没登录却留着账号模型」。
 */
export async function markSyncedOwnershipForAccount(account: string): Promise<void> {
  try {
    const [configs, ledger] = await Promise.all([createIo().loadConfigs(), loadLedger()])
    await saveLedger(markSyncedOwnership(ledger, account, Object.keys(configs)))
  } catch {
    // 记不上归属的后果只是退出时不归档（下次同步还会补记），不值得为它报错。
  }
}

/**
 * 注销成功后，销毁本机一切与该账号相关的秘密。
 *
 * 注销确认框向用户承诺「账号、密码…将被永久删除」。退出登录不清这些是
 * 产品规则（30 天内免输）；注销不同——账号已不存在，本机继续留着能解出
 * 密码、同步密码、模型备份的东西，既违背弹窗承诺，也是删除义务没兑现。
 * 清四处：
 *   1. 「记住密码」的 DPAPI 凭据（邮箱+密码）；
 *   2. 系统仓库里的同步密码；
 *   3. 系统仓库里的备份数据密钥（清掉后即使备份文件有残留也解不开）；
 *   4. 该账号的模型备份 + 账本归属（pruneHiddenBackup）。
 *
 * 任何一步失败都吞掉：云端删除已经成功（调用方保证），本机残留不该
 * 反过来把注销报成失败；密钥清不掉时第 4 步至少已让备份不可用。
 */
export async function purgeLocalAccountSecrets(account: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core")
  const bestEffort = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
    } catch {
      // 尽力而为，见顶部注释。
    }
  }
  await bestEffort(() => invoke("account_credential_clear"))
  await bestEffort(() => invoke("secret_clear", { name: SYNC_PASSWORD_SECRET_NAME }))
  await bestEffort(() => invoke("secret_clear", { name: BACKUP_KEY_SECRET_NAME }))
  await bestEffort(() => pruneHiddenBackup(createIo(), account))
}
