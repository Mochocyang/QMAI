/**
 * In-memory dedup scan session bridge.
 *
 * Merge completion must remove candidate groups even when the Maintenance
 * UI is unmounted (settings tab switch). The queue calls
 * `removeMergedDedupGroupFromSession` after a successful merge; the
 * Maintenance section registers the live session updater on mount.
 */
export type DedupScanSessionApi = {
  /** Remove a candidate group from the live scan list + persist cache. */
  removeGroup: (slugs: readonly string[]) => void
}

let sessionApi: DedupScanSessionApi | null = null

export function registerDedupScanSessionApi(
  api: DedupScanSessionApi | null,
): void {
  sessionApi = api
}

/** Best-effort live UI update. No-op when Maintenance section is unmounted. */
export function removeMergedDedupGroupFromSession(
  slugs: readonly string[],
): void {
  try {
    sessionApi?.removeGroup(slugs)
  } catch (err) {
    console.error("[Dedup Scan Session] removeGroup failed:", err)
  }
}
