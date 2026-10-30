import type { SyncEntry } from "./types"

/**
 * 「失败已读」机制。
 *
 * 用户的原话：红点一直挂着，对强迫症很致命。所以：
 *   · 点下拉里的「知道了」/「查看全部」= 已读，记下一个时间戳；
 *   · 红点与红字只统计**比这个时间戳更新**的失败；
 *   · 新失败出现才会再亮。
 *
 * 只存在 localStorage：这是一个"我看到了"的本地标记，不需要跟到别的设备，
 * 也不该占后端配置的位置。
 */
const STORAGE_KEY = "qmai:cloud-sync:failures-seen-at"

export function readSeenAt(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return 0
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  } catch {
    return 0
  }
}

export function markFailuresSeen(at: number = Date.now()): number {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(at))
  } catch {
    // 隐私模式 / 存储被禁用：功能退化成"每次都算新失败"，不影响同步本身。
  }
  return at
}

export function clearSeenAt(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 同上，失败不致命。
  }
}

/**
 * 只数「上次查看之后」才出现的失败。
 *
 * 为什么按时间而不是按 id：历史条目上限 200 条，滚掉旧的以后 id 集合会变，
 * 按 id 比对会出现"旧的消失了、红点还在"的错乱。时间戳只增不减，语义稳定。
 */
export function unreadFailures(entries: SyncEntry[], seenAt: number): SyncEntry[] {
  return entries.filter((entry) => !entry.ok && entry.at > seenAt)
}

/**
 * 标记已读并返回新的未读失败数（0）。
 *
 * 调用方拿到 0 后可直接把它写进 runtime，红点立刻消失，
 * 不必等下一次 `refreshHistory`。
 */
export function markSeenAndCount(entries: SyncEntry[]): { seenAt: number; remaining: number } {
  const seenAt = markFailuresSeen()
  return { seenAt, remaining: unreadFailures(entries, seenAt).length }
}
