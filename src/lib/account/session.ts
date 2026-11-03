/**
 * 账号登录态的本地持久化。
 *
 * 读取时结构校验、写入失败不阻塞本次会话、坏数据直接删除
 * （避免每次启动都解析同一份垃圾）。
 *
 * ## 存在哪（2026-11-03 起）
 *
 * 真正的落盘位置由 `session-store.ts` 决定：**Tauri 桌面端走系统加密仓库
 * （Windows DPAPI）**，浏览器/测试环境退回 localStorage。会话里有 90 天的
 * refreshToken、10 年的网关卡、15 分钟的 accessToken，此前全是明文 JSON。
 *
 * ## 为什么 API 仍保持同步
 *
 * `loadAccountSession()` / `saveAccountSession()` 有十几处调用，其中不少在
 * 同步路径上（store 的 set 之间）。把它们全改成异步，出错面远大于收益。
 * 做法是「内存为准、异步落盘」：
 *   · `hydrateAccountSession()` 在启动流程里 await 一次，把加密存储读进内存；
 *   · 之后同步读写都打内存；
 *   · 写盘是 fire-and-forget，失败只会导致「重启后要重新登录」（原本的语义）。
 *
 * 未 hydrate 时同步读必须保持旧行为（非 Tauri 直接读 localStorage），
 * 否则既有测试与浏览器预览会突然读不到会话。
 */

import {
  DEFAULT_ACCOUNT_BASE_URL,
  LEGACY_ACCOUNT_BASE_URL,
  normalizeAccountBaseUrl,
  parseAccountBaseUrl,
} from "./api"
import { isTauri } from "@/lib/platform"
import {
  ACCOUNT_SESSION_STORAGE_KEY,
  clearStoredSessionRaw,
  readLegacyPlaintext,
  readStoredSessionRaw,
  removeLegacyPlaintext,
  writeStoredSessionRaw,
} from "./session-store"
import type {
  AccountAuthPayload,
  AccountUser,
  StoredAccountSession,
} from "./types"

export { ACCOUNT_SESSION_STORAGE_KEY }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function toAccountUser(value: unknown): AccountUser | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = record.id
  const email = record.email
  const displayName = record.displayName
  const createdAt = record.createdAt

  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null
  if (!isNonEmptyString(email)) return null
  if (typeof displayName !== "string") return null
  if (!isFiniteNumber(createdAt)) return null

  // 旧版本会话没有这个字段，缺失/非法一律按「无头像」处理，不判坏数据。
  const avatarUpdatedAt =
    isFiniteNumber(record.avatarUpdatedAt) ? record.avatarUpdatedAt : null

  // 昵称上次修改时间同理：老会话没有就按「从未改过」处理。
  const displayNameUpdatedAt =
    isFiniteNumber(record.displayNameUpdatedAt) ? record.displayNameUpdatedAt : null

  // 头像 token：老会话没有这个字段时按「无法拼接头像 URL」处理，界面退回首字母。
  const avatarToken =
    typeof record.avatarToken === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(record.avatarToken)
      ? record.avatarToken
      : null

  return { id, email, displayName, createdAt, avatarUpdatedAt, avatarToken, displayNameUpdatedAt }
}

function toStoredSession(value: unknown): StoredAccountSession | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>

  if (!isNonEmptyString(record.baseUrl)) return null
  if (!isNonEmptyString(record.accessToken)) return null
  if (!isFiniteNumber(record.accessExpiresAt)) return null
  if (!isNonEmptyString(record.refreshToken)) return null
  if (!isFiniteNumber(record.refreshExpiresAt)) return null
  if (!isFiniteNumber(record.savedAt)) return null

  const user = toAccountUser(record.user)
  if (!user) return null

  // 旧数据或 XSS 改写的地址不能静默指向默认服务，直接拒绝整份会话。
  const baseUrl = parseAccountBaseUrl(record.baseUrl)
  if (!baseUrl) return null

  return {
    baseUrl,
    accessToken: record.accessToken,
    accessExpiresAt: record.accessExpiresAt,
    refreshToken: record.refreshToken,
    refreshExpiresAt: record.refreshExpiresAt,
    user,
    savedAt: record.savedAt,
    // 老版本存的会话没有网关卡；没有就当 null，登录后会补上。
    netcard: isNonEmptyString(record.netcard) ? record.netcard : null,
  }
}

function parseStoredSession(raw: string | null): StoredAccountSession | null {
  if (!raw) return null
  try {
    return toStoredSession(JSON.parse(raw))
  } catch {
    return null
  }
}

/** 内存里的当前会话（hydrate 之后同步读取的唯一来源）。 */
let memorySession: StoredAccountSession | null = null
/** 是否已经完成过 hydrate（含"确认没有会话"）。 */
let memoryHydrated = false
let hydration: Promise<void> | null = null

/**
 * 把加密存储里的会话读进内存。**启动流程必须先 await 它一次。**
 *
 * 顺带完成旧数据迁移：升级前会话以明文存在 localStorage，第一次启动时
 * 搬进系统加密仓库再抹掉明文。顺序不能反 —— 先删明文后写新副本会在
 * 中间态丢登录态。
 *
 * 幂等：多次调用共享同一个 Promise。
 */
export async function hydrateAccountSession(): Promise<void> {
  /*
   * 幂等缓存只对 Tauri 有意义：DPAPI 读一次就够了，重复读没有收益。
   * 非 Tauri 分支每次都重新读 localStorage —— 那里没有跨进程的加密仓库，
   * 行为必须与旧版本完全一致（否则测试之间、预览里刷新都会读到旧缓存）。
   */
  if (hydration && isTauri()) return hydration
  hydration = (async () => {
    let raw = await readStoredSessionRaw()

    if (!raw && isTauri()) {
      const legacy = readLegacyPlaintext()
      if (legacy) {
        // 先写新副本，成功后再删明文。
        await writeStoredSessionRaw(legacy)
        raw = legacy
        removeLegacyPlaintext()
      }
    }

    const session = parseStoredSession(raw)
    if (raw && !session) {
      // 坏数据：连存储一起清，避免每次启动都解析同一份垃圾。
      await clearStoredSessionRaw()
    }
    memorySession = session
    memoryHydrated = true
  })()
  return hydration
}

/** 测试用：重置内存缓存（不清存储）。 */
export function resetSessionMemoryForTests(): void {
  memorySession = null
  memoryHydrated = false
  hydration = null
}

export function createStoredSession(
  baseUrl: string,
  payload: AccountAuthPayload,
  /** 已有会话的网关卡：续期时后端通常不回传它（卡跟 session 走、不会变），保留旧值。 */
  previousNetcard: string | null = null,
): StoredAccountSession {
  const netcard =
    typeof payload.netcard === "string" && payload.netcard.length > 0
      ? payload.netcard
      : previousNetcard

  return {
    baseUrl: normalizeAccountBaseUrl(baseUrl),
    accessToken: payload.accessToken,
    accessExpiresAt: payload.accessExpiresAt,
    refreshToken: payload.refreshToken,
    refreshExpiresAt: payload.refreshExpiresAt,
    user: { ...payload.user },
    savedAt: Math.floor(Date.now() / 1000),
    netcard,
  }
}

export function loadAccountSession(): StoredAccountSession | null {
  /*
   * Tauri：内存是唯一真相（hydrate 从 DPAPI 读出来的那份）。
   * 未 hydrate 时返回 null —— 调用方（bootstrap）必须先 await
   * hydrateAccountSession()。若这里退回明文 localStorage，就等于给
   * 加密存储留了个旁路。
   */
  if (isTauri()) {
    if (!memoryHydrated) return null
    return migrateLegacyBaseUrl(memorySession)
  }

  /*
   * 非 Tauri（浏览器预览 / jsdom 测试）：完全走旧路径，每次同步读 localStorage。
   * 这里刻意**不用**内存缓存：没有系统加密仓库，缓存在同一进程内只会让
   * 「写完再读」绕过结构校验，既有测试与预览行为都会变。
   */
  let raw: string | null = null
  try {
    if (typeof localStorage !== "undefined") raw = localStorage.getItem(ACCOUNT_SESSION_STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  const session = parseStoredSession(raw)
  if (!session) {
    try {
      if (typeof localStorage !== "undefined") localStorage.removeItem(ACCOUNT_SESSION_STORAGE_KEY)
    } catch {
      // localStorage 被禁用/配额异常：忽略，调用方按无会话处理。
    }
    return null
  }
  return migrateLegacyBaseUrl(session)
}

/**
 * 老版本把 workers.dev 存成了 baseUrl：国内被 DNS 污染会一直"网络不可用"。
 * 同一个 Worker 换域名不影响令牌有效性，这里直接原地迁移。
 */
function migrateLegacyBaseUrl(session: StoredAccountSession | null): StoredAccountSession | null {
  if (!session) return null
  if (session.baseUrl !== LEGACY_ACCOUNT_BASE_URL) return session
  const migrated: StoredAccountSession = { ...session, baseUrl: DEFAULT_ACCOUNT_BASE_URL }
  saveAccountSession(migrated)
  return migrated
}

export function saveAccountSession(session: StoredAccountSession): void {
  if (isTauri()) {
    memorySession = session
    memoryHydrated = true
  }
  // 异步落盘：失败只影响「重启后要重新登录」，与旧语义一致。
  // 非 Tauri 分支在单次同步调用内就写完了 localStorage，返回值忽略无副作用。
  void writeStoredSessionRaw(JSON.stringify(session))
}

export function clearAccountSession(): void {
  if (isTauri()) {
    memorySession = null
    memoryHydrated = true
  }
  // 两处都清：升级前的明文残留也必须抹掉，否则只是多了一处副本。
  void clearStoredSessionRaw()
}

/** access 是否仍在有效期内（默认提前 60 秒判定过期）。 */
export function isAccessTokenFresh(session: StoredAccountSession, skewSeconds = 60): boolean {
  if (!isFiniteNumber(session.accessExpiresAt)) return false
  return session.accessExpiresAt > Date.now() / 1000 + skewSeconds
}
