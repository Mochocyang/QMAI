/**
 * 「退出登录把账号模型收进本机加密备份、登录后恢复」的编排层。
 *
 * 界面文案要表达的是「你的模型没有丢，只是属于那个账号」，这句话成立的前提
 * 是备份真的存在、能找回、且不会串号。这里就是那半句的实现。
 *
 * ── 加密为什么用一次性数据密钥，而不是同步密码 ──
 *
 * 恢复发生在「刚登录」的时刻，此时用户还没输过同步密码（同步密码只在开启
 * 同步时设置），拿它派生密钥会让备份永远读不出来。
 * 所以备份用一个随机数据密钥加密；密钥本身交给 `secret_set`
 * （Windows 上走 DPAPI，绑定当前系统用户），磁盘上只有密文。
 *
 * 不写成「明文 + 文件权限」：配置里含 API Key，一个 JSON 文件躺在
 * `%APPDATA%` 里会被同步盘、备份软件、截图工具间接带走。
 *
 * ── 按账号隔离 ──
 *
 * 备份以账号邮箱为键：登录 B 不会把 A 的配置灌进来。删掉账号
 * （注销数据主体）时由 `pruneHiddenBackup` 移除对应条目。
 */

import {
  decryptHiddenBackup,
  encryptHiddenBackup,
  ledgerAfterLogin,
  splitForLedger,
  type HiddenBackup,
  type OwnershipLedger,
} from "./ownership"

/** 编排所需的全部 IO（生产由 model-sync-store 注入，单测用内存实现）。 */
export interface HiddenBackupIo {
  now(): number
  loadConfigs(): Promise<Record<string, unknown>>
  saveConfigs(configs: Record<string, unknown>): Promise<void>
  loadLedger(): Promise<OwnershipLedger>
  saveLedger(ledger: OwnershipLedger): Promise<void>
  /** account → 加密信封。 */
  loadBackups(): Promise<Record<string, string>>
  saveBackups(backups: Record<string, string>): Promise<void>
  /** 本机数据密钥（首次调用时生成并持久）。 */
  backupKey(): Promise<string>
}

/**
 * 把当前账号在活动配置里的条目收进加密备份。
 *
 * 返回归档的条目数（0 表示什么都没做——不写空备份、不动配置）。
 * 已有备份会被**替换**而不是叠加：一次登录期间用户的增删改都以最新
 * 这份为准，叠加会把用户已删除的模型在下次登录时复活。
 */
export async function archiveForLogout(io: HiddenBackupIo, account: string): Promise<number> {
  const [configs, ledger] = await Promise.all([io.loadConfigs(), io.loadLedger()])
  const { archive, keep } = splitForLedger(configs, ledger, account)
  const ids = Object.keys(archive)
  if (ids.length === 0) return 0

  const key = await io.backupKey()
  const envelope = await encryptHiddenBackup(
    { account, savedAt: io.now(), entries: archive } satisfies HiddenBackup,
    key,
  )

  const backups = await io.loadBackups()
  await io.saveBackups({ ...backups, [account]: envelope })
  await io.saveConfigs(keep)
  // 归档后账本清掉这些条目：它们已不在活动配置里，留着记录只会在
  // 「本机自配」与「已归档」之间制造二义（重新登录时会由认领逻辑重建）。
  const nextLedger: OwnershipLedger = { ...ledger }
  for (const id of ids) delete nextLedger[id]
  await io.saveLedger(nextLedger)
  return ids.length
}

/**
 * 未登录状态下的兜底归档：按账本里的**每个**归属账号分别归档。
 *
 * 除了点「退出登录」，还有两条路径会让未登录设备留着账号模型：
 *   · 登录态过期（refresh 失败）自动回到未登录，没有人走退出流程；
 *   · 老版本升级上来时配置里有账号同步的模型，但从未归档。
 * 归属不同账号的条目必须**各归各的信封**：混成一份的话，
 * 登录 A 会把 B 的 API Key 也恢复出来。
 *
 * 没有归属记录的条目原样留在活动配置里 —— 那是本机自配，
 * 未登录也要可见可用（这是产品明确保留的能力，不是遗漏）。
 */
export async function archiveOwnedModels(io: HiddenBackupIo): Promise<number> {
  const [configs, ledger, backups] = await Promise.all([io.loadConfigs(), io.loadLedger(), io.loadBackups()])
  // 账本里出现过的每个账号都要处理，包括当前活动配置里已经没有其条目、
  // 但账本还记着的（残留记录：清掉它们，否则界面上的提示会虚报数量）。
  const accounts = [...new Set(Object.values(ledger))]
  if (accounts.length === 0) return 0

  const key = await io.backupKey()
  const nextBackups = { ...backups }
  const nextLedger: OwnershipLedger = {}
  let active = configs
  let archivedTotal = 0

  for (const account of accounts) {
    const { archive, keep } = splitForLedger(active, ledger, account)
    const ids = Object.keys(archive)
    if (ids.length === 0) continue
    nextBackups[account] = await encryptHiddenBackup(
      { account, savedAt: io.now(), entries: archive } satisfies HiddenBackup,
      key,
    )
    active = keep
    archivedTotal += ids.length
  }

  // 归档过的条目从账本删除（它们已不在活动配置里；重新登录时由认领逻辑重建）。
  for (const [id, owner] of Object.entries(ledger)) {
    if (Object.prototype.hasOwnProperty.call(active, id)) nextLedger[id] = owner
  }

  if (archivedTotal === 0) {
    // 一条都没归档时，若账本有残留记录也要清干净，避免提示数量虚高。
    if (Object.keys(nextLedger).length !== Object.keys(ledger).length) await io.saveLedger(nextLedger)
    return 0
  }
  await io.saveBackups(nextBackups)
  await io.saveConfigs(active)
  await io.saveLedger(nextLedger)
  return archivedTotal
}

/**
 * 登录后恢复该账号的备份。
 *
 * 信封是**一次性**的：成功解出并合并后立刻删除。留着它，下次登录就会把
 * 用户后来删掉的模型再塞回来（备份停留在归档那一刻）。
 * 冲突时备份侧的值优先 —— 备份来自这个账号自己，比这台机器上碰巧同 id 的
 * 本机条目更该赢（决策②「登录以账号数据为准」）。
 *
 * 解密失败按「没有备份」处理，绝不抛错：用户只是登录，不该被一个损坏的
 * 本地缓存卡住。
 */
export async function restoreForLogin(io: HiddenBackupIo, account: string): Promise<number> {
  const backups = await io.loadBackups()
  const envelope = backups[account]
  if (!envelope) return 0

  const [key, configs, ledger] = await Promise.all([io.backupKey(), io.loadConfigs(), io.loadLedger()])
  const backup = await decryptHiddenBackup(envelope, key)
  if (!backup || backup.account !== account || Object.keys(backup.entries).length === 0) {
    // 损坏或空归档：消费掉，避免每次登录都白解一遍。
    const rest = { ...backups }
    delete rest[account]
    await io.saveBackups(rest)
    return 0
  }

  const ids = Object.keys(backup.entries)
  await io.saveConfigs({ ...configs, ...backup.entries })
  await io.saveLedger(ledgerAfterLoginOwned(ledger, account, ids))
  const rest = { ...backups }
  delete rest[account]
  await io.saveBackups(rest)
  return ids.length
}

/**
 * 恢复条目的归属记给当前账号（已记别人的也改记）。
 *
 * 与 `ledgerAfterLogin` 的「不抢别人归属」相反，这里是刻意的：备份信封
 * 本身就是这个账号归档的，内容必然属于它。若还挂着上一台机器登录的
 * 别的账号，退出当前账号时这些模型就不会被归档，用户会看到「明明同步过，
 * 退出后却留在本机」的矛盾状态。
 */
function ledgerAfterLoginOwned(ledger: OwnershipLedger, account: string, ids: string[]): OwnershipLedger {
  const next = ledgerAfterLogin(ledger, account, ids)
  for (const id of ids) next[id] = account
  return next
}

/**
 * 未登录界面提示的数据源：本机还有多少个被备份起来的模型。
 *
 * 必须真去解一遍才能数出来（条目名在密文里）。这是刻意的取舍：
 * 把条目数存成明文就等于泄露「这个账号配过哪些模型」——一个
 * 一眼能看出用户是谁、用了什么的指纹。读一次不频繁（只在未登录
 * 且存在归档文件时），换来的是磁盘上除了密文什么都不留。
 */
export async function countHiddenModels(io: HiddenBackupIo): Promise<number> {
  const [backups, key] = await Promise.all([io.loadBackups(), io.backupKey()])
  let total = 0
  for (const envelope of Object.values(backups)) {
    const backup = await decryptHiddenBackup(envelope, key)
    if (backup) total += Object.keys(backup.entries).length
  }
  return total
}

/** 同步成功的条目登记为「属于当前账号」，退出时才知道该归档谁。 */
export function markSyncedOwnership(
  ledger: OwnershipLedger,
  account: string,
  ids: string[],
): OwnershipLedger {
  const next: OwnershipLedger = { ...ledger }
  for (const id of ids) next[id] = account
  return next
}

/** 注销账号时清掉它留下的备份（数据主体删除义务延伸到这里）。 */
export async function pruneHiddenBackup(io: HiddenBackupIo, account: string): Promise<void> {
  const backups = await io.loadBackups()
  if (!(account in backups)) return
  const next = { ...backups }
  delete next[account]
  await io.saveBackups(next)
  const ledger = await io.loadLedger()
  const pruned: OwnershipLedger = {}
  for (const [id, owner] of Object.entries(ledger)) {
    if (owner !== account) pruned[id] = owner
  }
  await io.saveLedger(pruned)
}
