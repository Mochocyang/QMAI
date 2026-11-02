/**
 * 模型配置的「账号归属」层：决定登录 / 未登录两种状态下，
 * 「我的模型设置」列表各显示什么。
 *
 * ── 要解决的问题 ──
 *
 * 列表此前直接渲染本地 `providerConfigs`（谁配的都在），导致
 * **未登录也显示模型配置** —— 与「登录看账号同步模型、未登录为空」
 * 的产品预期不符（用户截图指出）。
 *
 * ── 归属靠「账本」而不是在配置里塞标记 ──
 *
 * provider 配置对象在同步上传前会被 `slimProviderValue()` 精简
 * （`service.ts`），未知字段会被削掉；退出登录的备份同样过这条路径。
 * 所以把 `origin` 之类的标记写进配置对象会在往返中丢失。
 * 归属关系单独存一份账本：`provider id → 账号邮箱`。
 *
 * ── 三种状态 ──
 *
 * · 已登录且同步开启：活动配置 = 云端合并结果；账本记着哪些属于该账号。
 * · 已登录但同步关闭：全部是本机自配（`local`），不隐藏 —— 用户明确
 *   选择了不同步，隐藏自己的配置只会像是丢了。
 * · 未登录：账本里属于**任何账号**的条目都不显示，加密收进本机备份；
 *   没有归属记录的条目（本机自配、从未登录时添加）继续显示。
 *
 * ── 备份为什么用同步密码加密 ──
 *
 * 这些条目含 API Key。用同步密码（PBKDF2 + AES-GCM，与云端同步同一套
 * `crypto.ts`）加密后再落盘：文件本身不含明文，换 Windows 账户或把文件
 * 拷走都解不开。同步密码不写盘，因此密钥不在磁盘上。
 * 代价：未设过同步密码的用户退出登录后需要设一次才能完成归档 ——
 * UI 上把这一步说清楚，不静默拒绝。
 */

import { decryptModelConfig, encryptModelConfig } from "./crypto"

/** provider id → 该配置归属的账号邮箱。 */
export type OwnershipLedger = Record<string, string>

export interface HiddenBackup {
  /** 归档时所属账号（恢复时校验，避免把 A 账号的配置塞给 B）。 */
  account: string
  /** 归档时间（毫秒），仅用于展示与排错。 */
  savedAt: number
  /** 原始 provider 配置，未经精简，恢复后字段完整可用。 */
  entries: Record<string, unknown>
}

/**
 * 拆分：属于该账号的进备份，其余留在界面上。
 *
 * 只认账本里明确记为该账号的条目。别的账号的、或没有记录的都留在原地：
 * 前者要等它自己的账号登录时处理，后者本来就是本机自配（决策④保留）。
 */
export function splitForLedger(
  active: Record<string, unknown>,
  ledger: OwnershipLedger,
  account: string,
): { archive: Record<string, unknown>; keep: Record<string, unknown> } {
  const archive: Record<string, unknown> = {}
  const keep: Record<string, unknown> = {}
  for (const [id, value] of Object.entries(active)) {
    if (ledger[id] === account) archive[id] = value
    else keep[id] = value
  }
  return { archive, keep }
}

/**
 * 合并：登录时把本机备份并回活动配置。
 *
 * 同 id 冲突取备份侧的值（决策②「云端/账号数据优先」）。
 * 备份里的条目本来就来自这个账号，比当前机器上碰巧同 id 的东西更可信。
 */
export function mergeRestored<T>(
  current: Record<string, T>,
  restored: Record<string, T>,
): Record<string, T> {
  return { ...current, ...restored }
}

/**
 * 登录成功后认领归属：从备份恢复的条目记在当前账号名下。
 *
 * 已有归属的条目**不改记**——同一台机器先后登录过两个账号时，
 * 后登录的不能把前一个账号的配置认领走（否则那些配置会在下一个
 * 账号登录后被归档到错误的备份里）。
 */
export function ledgerAfterLogin(
  ledger: OwnershipLedger,
  account: string,
  restoredIds: string[],
): OwnershipLedger {
  const next: OwnershipLedger = { ...ledger }
  for (const id of restoredIds) {
    if (!next[id]) next[id] = account
  }
  return next
}

/**
 * 把未登录时保留的本机配置登记为本机条目（返回不变的对象，语义占位）。
 *
 * 之所以需要一个函数：`origin` 判断散落在三处时容易漏；这里明确
 * 「账本里没有记录 = 本机自配」这条规则由调用方依赖。
 */
export function isLocalOwned(ledger: OwnershipLedger, id: string): boolean {
  return !ledger[id]
}

/** 备份信封 + 账号/时间戳一起加密（外层信封本身不含明文账号）。 */
export async function encryptHiddenBackup(backup: HiddenBackup, password: string): Promise<string> {
  return encryptModelConfig(JSON.stringify(backup), password)
}

/**
 * 解密备份。
 *
 * 密码不对 / 信封损坏一律返回 null：调用方按「没有备份」处理，
 * 不能把解密失败冒泡成登录报错（用户只是登录，不该被一个本地缓存卡住）。
 */
export async function decryptHiddenBackup(envelope: string, password: string): Promise<HiddenBackup | null> {
  try {
    const parsed = JSON.parse(await decryptModelConfig(envelope, password)) as Partial<HiddenBackup> | null
    if (!parsed || typeof parsed.account !== "string" || !parsed.entries || typeof parsed.entries !== "object") {
      return null
    }
    return {
      account: parsed.account,
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
      entries: parsed.entries as Record<string, unknown>,
    }
  } catch {
    return null
  }
}
