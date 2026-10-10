/*
 * 备份涉及的 localStorage 命名空间前缀。
 *
 * ── 为什么必须是一份共用常量 ──
 * 导出端 (`export.ts`) 决定"往 zip 里装哪些键"，
 * 导入端 (`import.ts`) 决定"清空哪些键再写回"。
 * 这两张表此前是**各写各的、内容相同的两份字面量**：
 * 一旦有人只改一边，就会出现"清掉的键备份里根本没有"——
 * 也就是导入之后用户的偏好被清空且无法恢复。共用一份静态数组从根上消除这种漂移。
 */
export const BACKUP_LS_PREFIXES = ["qmai", "lk-", "qm-uitest-"] as const

/**
 * 返回键所属的备份命名空间；不属于任何命名空间时返回 null。
 *
 * 为什么要分组而不是笼统判断"是不是备份键"：见 `planLocalStorageReplacement`。
 */
export function backupPrefixGroupOf(key: string): string | null {
  return BACKUP_LS_PREFIXES.find((prefix) => key.startsWith(prefix)) ?? null
}

/**
 * 计算导入时要清除的 localStorage 键。
 *
 * ── 为什么不能无脑清空全部备份键 ──
 * `qm-uitest-` 这一组是本轮才纳入备份的（皮肤、书架索引 `qm-uitest-library`）。
 * 用户拿**旧版本导出的备份**来恢复时，那份 zip 里根本没有 `qm-uitest-*` 键，
 * 但 `replaceLocalStorage` 仍会是 true。若照当前前缀表一律清空，
 * 后果是：备份里没有的东西被删掉、且填不回来 —— 书架索引一旦丢失，
 * 用户看到的是"所有书都不见了"（文件其实还在磁盘上）。
 *
 * 所以清除粒度是**命名空间**：
 *   · 备份里带了这一组的键 → 整组替换（包括"备份里就是空的"这种忠实状态）；
 *   · 备份里完全没有这一组 → 整组保留，一个键都不动（旧备份的安全通道）。
 */
export function planLocalStorageReplacement(
  currentKeys: string[],
  backupData: Record<string, string>,
): string[] {
  const carriedGroups = new Set<string>()
  for (const key of Object.keys(backupData)) {
    const group = backupPrefixGroupOf(key)
    if (group) carriedGroups.add(group)
  }

  return currentKeys.filter((key) => {
    const group = backupPrefixGroupOf(key)
    return group !== null && carriedGroups.has(group)
  })
}
