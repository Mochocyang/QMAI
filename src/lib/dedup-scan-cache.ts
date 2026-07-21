/**
 * Persist duplicate-detection scan results per project so the
 * Maintenance UI can restore candidate groups after restart.
 */
import { readFile, writeFile, fileExists } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { DuplicateGroup } from "@/lib/dedup"

const FILE_NAME = ".qmai/dedup-scan-cache.json"

export interface DedupScanCacheEntry {
  group: DuplicateGroup
  canonicalSlug: string
  skipped: boolean
}

export interface DedupScanCache {
  version: 1
  projectId: string
  scannedAt: number
  scannedPageCount: number | null
  /** Detection model used for the last scan. */
  modelId?: string
  /** Merge model preferred when enqueueing from these results. */
  mergeModelId?: string
  groups: DedupScanCacheEntry[]
}

function cacheFilePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/${FILE_NAME}`
}

function isConfidence(value: unknown): value is DuplicateGroup["confidence"] {
  return value === "high" || value === "medium" || value === "low"
}

function parseEntry(raw: unknown): DedupScanCacheEntry | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const groupRaw = obj.group
  if (!groupRaw || typeof groupRaw !== "object") return null
  const groupObj = groupRaw as Record<string, unknown>
  const slugs = Array.isArray(groupObj.slugs)
    ? groupObj.slugs.filter((s): s is string => typeof s === "string")
    : []
  if (slugs.length < 2) return null
  const reason = typeof groupObj.reason === "string" ? groupObj.reason : ""
  const confidence = isConfidence(groupObj.confidence) ? groupObj.confidence : "low"
  const canonicalSlug =
    typeof obj.canonicalSlug === "string" ? obj.canonicalSlug : slugs[0]
  if (!slugs.includes(canonicalSlug)) return null
  return {
    group: { slugs, reason, confidence },
    canonicalSlug,
    skipped: obj.skipped === true,
  }
}

function parseCache(raw: unknown): DedupScanCache | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  if (obj.version !== 1) return null
  if (typeof obj.projectId !== "string" || !obj.projectId.trim()) return null
  if (typeof obj.scannedAt !== "number" || !Number.isFinite(obj.scannedAt)) return null
  const scannedPageCount =
    obj.scannedPageCount === null
      ? null
      : typeof obj.scannedPageCount === "number" && Number.isFinite(obj.scannedPageCount)
        ? obj.scannedPageCount
        : null
  const groupsRaw = Array.isArray(obj.groups) ? obj.groups : []
  const groups = groupsRaw
    .map(parseEntry)
    .filter((entry): entry is DedupScanCacheEntry => entry !== null)
  const modelId = typeof obj.modelId === "string" ? obj.modelId : undefined
  const mergeModelId =
    typeof obj.mergeModelId === "string" ? obj.mergeModelId : undefined
  return {
    version: 1,
    projectId: obj.projectId,
    scannedAt: obj.scannedAt,
    scannedPageCount,
    modelId,
    mergeModelId,
    groups,
  }
}

export async function loadDedupScanCache(
  projectPath: string,
): Promise<DedupScanCache | null> {
  const filePath = cacheFilePath(projectPath)
  try {
    if (!(await fileExists(filePath))) return null
  } catch {
    return null
  }
  try {
    const content = await readFile(filePath)
    return parseCache(JSON.parse(content))
  } catch {
    return null
  }
}

export async function saveDedupScanCache(
  projectPath: string,
  cache: DedupScanCache,
): Promise<void> {
  await writeFile(cacheFilePath(projectPath), JSON.stringify(cache, null, 2))
}

function groupKey(slugs: readonly string[]): string {
  return [...slugs].map((s) => s.toLowerCase()).sort().join(",")
}

/**
 * Drop a merged candidate group from the on-disk scan cache.
 * Returns true when the cache was rewritten.
 */
export async function removeGroupFromDedupScanCache(
  projectPath: string,
  slugs: readonly string[],
): Promise<boolean> {
  const cached = await loadDedupScanCache(projectPath)
  if (!cached) return false
  const key = groupKey(slugs)
  const remaining = cached.groups.filter((g) => groupKey(g.group.slugs) !== key)
  if (remaining.length === cached.groups.length) return false
  await saveDedupScanCache(projectPath, {
    ...cached,
    groups: remaining,
    scannedAt: Date.now(),
  })
  return true
}
