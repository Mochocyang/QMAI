/**
 * Persistence for foreshadowing cleanup: scan cache, keep whitelist, model prefs.
 */
import { readFile, writeFile, fileExists } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import {
  keepKey,
  type CleanupIssue,
  type CleanupIssueKind,
} from "@/lib/foreshadowing-cleanup"

const SCAN_CACHE_FILE = ".qmai/foreshadowing-scan-cache.json"
const KEEP_FILE = ".qmai/foreshadowing-keep.json"
const MODELS_FILE = ".qmai/foreshadowing-cleanup-models.json"

export interface ForeshadowingCleanupScanEntry {
  issue: CleanupIssue
  /** For duplicate: user-selected canonical id */
  canonicalId: string
  skipped: boolean
}

export interface ForeshadowingCleanupScanCache {
  version: 1
  projectId: string
  scannedAt: number
  scannedItemCount: number | null
  currentChapter: number | null
  modelId?: string
  applyModelId?: string
  issues: ForeshadowingCleanupScanEntry[]
}

export interface ForeshadowingCleanupModelPrefs {
  detectModelId?: string
  applyModelId?: string
}

function cachePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/${SCAN_CACHE_FILE}`
}

function keepPath(projectPath: string): string {
  return `${normalizePath(projectPath)}/${KEEP_FILE}`
}

function modelsPath(projectPath: string): string {
  return `${normalizePath(projectPath)}/${MODELS_FILE}`
}

function isConfidence(value: unknown): value is CleanupIssue["confidence"] {
  return value === "high" || value === "medium" || value === "low"
}

function isKind(value: unknown): value is CleanupIssueKind {
  return value === "duplicate" || value === "noise" || value === "stale"
}

function parseIssue(raw: unknown): CleanupIssue | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  if (!isKind(obj.kind)) return null
  const ids = Array.isArray(obj.ids)
    ? obj.ids.filter((s): s is string => typeof s === "string")
    : []
  if (obj.kind === "duplicate" && ids.length < 2) return null
  if ((obj.kind === "noise" || obj.kind === "stale") && ids.length !== 1) return null
  const reason = typeof obj.reason === "string" ? obj.reason : ""
  const confidence = isConfidence(obj.confidence) ? obj.confidence : "low"
  const canonicalId =
    typeof obj.canonicalId === "string" ? obj.canonicalId : undefined
  return {
    kind: obj.kind,
    ids,
    canonicalId:
      obj.kind === "duplicate"
        ? canonicalId && ids.includes(canonicalId)
          ? canonicalId
          : ids[0]
        : undefined,
    reason,
    confidence,
  }
}

function parseEntry(raw: unknown): ForeshadowingCleanupScanEntry | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const issue = parseIssue(obj.issue)
  if (!issue) return null
  const canonicalId =
    typeof obj.canonicalId === "string"
      ? obj.canonicalId
      : issue.canonicalId || issue.ids[0]
  return {
    issue,
    canonicalId,
    skipped: obj.skipped === true,
  }
}

export async function loadForeshadowingCleanupScanCache(
  projectPath: string,
): Promise<ForeshadowingCleanupScanCache | null> {
  const filePath = cachePath(projectPath)
  try {
    if (!(await fileExists(filePath))) return null
  } catch {
    return null
  }
  try {
    const raw = JSON.parse(await readFile(filePath)) as Record<string, unknown>
    if (raw.version !== 1) return null
    if (typeof raw.projectId !== "string" || !raw.projectId.trim()) return null
    if (typeof raw.scannedAt !== "number") return null
    const issuesRaw = Array.isArray(raw.issues) ? raw.issues : []
    const issues = issuesRaw
      .map(parseEntry)
      .filter((e): e is ForeshadowingCleanupScanEntry => e !== null)
    return {
      version: 1,
      projectId: raw.projectId,
      scannedAt: raw.scannedAt,
      scannedItemCount:
        typeof raw.scannedItemCount === "number" ? raw.scannedItemCount : null,
      currentChapter:
        typeof raw.currentChapter === "number" ? raw.currentChapter : null,
      modelId: typeof raw.modelId === "string" ? raw.modelId : undefined,
      applyModelId:
        typeof raw.applyModelId === "string" ? raw.applyModelId : undefined,
      issues,
    }
  } catch {
    return null
  }
}

export async function saveForeshadowingCleanupScanCache(
  projectPath: string,
  cache: ForeshadowingCleanupScanCache,
): Promise<void> {
  await writeFile(cachePath(projectPath), JSON.stringify(cache, null, 2))
}

export async function removeIssueFromForeshadowingScanCache(
  projectPath: string,
  issue: CleanupIssue,
): Promise<void> {
  const cache = await loadForeshadowingCleanupScanCache(projectPath)
  if (!cache) return
  const key = keepKey(issue.ids) + ":" + issue.kind
  cache.issues = cache.issues.filter(
    (e) => keepKey(e.issue.ids) + ":" + e.issue.kind !== key,
  )
  await saveForeshadowingCleanupScanCache(projectPath, cache)
}

/** Drop multiple candidate cards (e.g. after bulk noise/stale cleanup). */
export async function removeIssuesFromForeshadowingScanCache(
  projectPath: string,
  issues: readonly CleanupIssue[],
): Promise<void> {
  if (issues.length === 0) return
  const cache = await loadForeshadowingCleanupScanCache(projectPath)
  if (!cache) return
  const drop = new Set(issues.map((i) => keepKey(i.ids) + ":" + i.kind))
  cache.issues = cache.issues.filter(
    (e) => !drop.has(keepKey(e.issue.ids) + ":" + e.issue.kind),
  )
  await saveForeshadowingCleanupScanCache(projectPath, cache)
}

export async function loadForeshadowingKeep(
  projectPath: string,
): Promise<string[][]> {
  const filePath = keepPath(projectPath)
  try {
    if (!(await fileExists(filePath))) return []
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(await readFile(filePath))
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (g): g is string[] =>
        Array.isArray(g) && g.every((s) => typeof s === "string"),
    )
  } catch {
    return []
  }
}

export async function addForeshadowingKeep(
  projectPath: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return
  const list = await loadForeshadowingKeep(projectPath)
  const normNew = keepKey(ids)
  for (const existing of list) {
    if (keepKey(existing) === normNew) return
  }
  list.push([...ids].sort())
  await writeFile(keepPath(projectPath), JSON.stringify(list, null, 2))
}

export async function loadForeshadowingCleanupModelPrefs(
  projectPath: string,
): Promise<ForeshadowingCleanupModelPrefs | null> {
  const filePath = modelsPath(projectPath)
  try {
    if (!(await fileExists(filePath))) return null
  } catch {
    return null
  }
  try {
    const obj = JSON.parse(await readFile(filePath)) as Record<string, unknown>
    return {
      detectModelId:
        typeof obj.detectModelId === "string"
          ? obj.detectModelId.trim() || undefined
          : undefined,
      applyModelId:
        typeof obj.applyModelId === "string"
          ? obj.applyModelId.trim() || undefined
          : undefined,
    }
  } catch {
    return null
  }
}

export async function saveForeshadowingCleanupModelPrefs(
  projectPath: string,
  prefs: ForeshadowingCleanupModelPrefs,
): Promise<void> {
  await writeFile(
    modelsPath(projectPath),
    JSON.stringify(
      {
        detectModelId: prefs.detectModelId?.trim() || undefined,
        applyModelId: prefs.applyModelId?.trim() || undefined,
      },
      null,
      2,
    ),
  )
}
