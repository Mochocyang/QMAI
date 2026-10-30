import type { SyncBatch, SyncEntry } from "./types"
import { providerLabel } from "./providers"

/**
 * 把「哪些盘失败了、各几项」汇总成一句人话。
 *
 * 为什么需要它：以前只显示「有 N 项同步失败」，用户不知道是哪个盘坏了。
 * 多网盘并存时这一点尤其要命——GitHub 失败和网盘本地文件夹失败，
 * 处理方式完全不同（前者可能是网络/授权，后者可能是目录被占用）。
 *
 * 失败条目的 provider 挂在**批次**上（每批次只对应一个目标），
 * 所以这里要按 batchId 反查，不能看条目自己。
 */
export interface FailureGroup {
  provider: string | null
  label: string
  count: number
}

export function groupFailuresByProvider(
  batches: SyncBatch[],
  entries: SyncEntry[],
): FailureGroup[] {
  const providerByBatch = new Map<string, string | null>()
  for (const batch of batches) providerByBatch.set(batch.batchId, batch.provider ?? null)

  const counts = new Map<string, number>()
  for (const entry of entries) {
    if (entry.ok) continue
    const provider = providerByBatch.get(entry.batchId) ?? null
    const key = provider ?? ""
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([key, count]) => ({
      provider: key === "" ? null : key,
      label: key === "" ? "未知网盘" : providerLabel(key as never),
      count,
    }))
    // 失败多的排前面：用户最该先看那个。
    .sort((left, right) => right.count - left.count)
}

/** 一句话总结：「GitHub 同步失败（3 项）；坚果云同步失败（1 项）」。 */
export function describeFailures(groups: FailureGroup[]): string {
  if (groups.length === 0) return ""
  return groups.map((group) => `${group.label}同步失败（${group.count} 项）`).join("；")
}
