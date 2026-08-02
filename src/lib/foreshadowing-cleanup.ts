/**
 * Pure foreshadowing cleanup algorithm (no I/O).
 *
 * Detects three issue kinds via rule pre-filter + LLM:
 *   - duplicate: same clue planted repeatedly → merge
 *   - noise: status broadcast / plot forecast, not a real foreshadow → delete
 *   - stale: real foreshadow abandoned by story direction → mark abandoned
 */

import type { Foreshadowing, ForeshadowingStore } from "@/lib/novel/foreshadowing-tracker"
import { isActiveForeshadowingStatus } from "@/lib/novel/foreshadowing-normalize"

export type CleanupIssueKind = "duplicate" | "noise" | "stale"

export interface CleanupIssue {
  kind: CleanupIssueKind
  /** duplicate: multiple ids; noise/stale: single id */
  ids: string[]
  /** Only for duplicate — which id to keep (user may override) */
  canonicalId?: string
  reason: string
  confidence: "high" | "medium" | "low"
}

export interface ForeshadowingSummary {
  id: string
  name: string
  description: string
  status: string
  plantedChapter: number
  advancedChapters: number[]
  resolvedChapter?: number
}

export type CleanupLlmCall = (
  systemPrompt: string,
  userMessage: string,
  signal?: AbortSignal,
) => Promise<string>

export const NOISE_PATTERN =
  /(预示|暗示|将面临|为后续|埋下伏笔|即将触发|即将展开|持续上升|倒计时|距离\d+|高危区间)/u

export const STALE_PLANTED_CHAPTERS = 20
export const CLEANUP_BATCH_SIZE = 80

export function toForeshadowingSummary(item: Foreshadowing): ForeshadowingSummary {
  return {
    id: item.id,
    name: item.name,
    description: item.description || "",
    status: item.status,
    plantedChapter: item.plantedChapter,
    advancedChapters: [...(item.advancedChapters || [])],
    resolvedChapter: item.resolvedChapter,
  }
}

/** Rule pre-filter: likely noise (status broadcast / plot forecast). */
export function looksLikeNoise(item: ForeshadowingSummary): boolean {
  if (item.status === "resolved" || item.status === "abandoned") return false
  const text = `${item.name} ${item.description}`.trim()
  if (!text) return true
  if (!item.description.trim() && NOISE_PATTERN.test(item.name)) return true
  if (NOISE_PATTERN.test(text) && text.length > 40) return true
  return false
}

/** Rule pre-filter: planted long ago with no advances. */
export function looksLikeStale(
  item: ForeshadowingSummary,
  currentChapter: number,
  threshold = STALE_PLANTED_CHAPTERS,
): boolean {
  if (item.status !== "planted") return false
  if ((item.advancedChapters?.length ?? 0) > 0) return false
  return currentChapter - item.plantedChapter >= threshold
}

export function buildOverview(store: ForeshadowingStore): {
  total: number
  active: number
  resolved: number
  abandoned: number
  planted: number
  advanced: number
  avgPerChapter: number
} {
  const items = store.items
  const active = items.filter((f) => isActiveForeshadowingStatus(f.status)).length
  const resolved = items.filter((f) => f.status === "resolved").length
  const abandoned = items.filter((f) => f.status === "abandoned").length
  const planted = items.filter((f) => f.status === "planted").length
  const advanced = items.filter((f) => f.status === "advanced").length
  const chapters = new Set(items.map((f) => f.plantedChapter).filter((n) => n > 0))
  const avgPerChapter = chapters.size > 0 ? items.length / chapters.size : 0
  return {
    total: items.length,
    active,
    resolved,
    abandoned,
    planted,
    advanced,
    avgPerChapter: Math.round(avgPerChapter * 10) / 10,
  }
}

const DETECTOR_SYSTEM_PROMPT = `你是小说伏笔维护助手。你将收到一份伏笔列表（含 id、名称、说明、状态、埋设章节）。请找出三类问题：

1. duplicate — 同一条线索被反复「新增」，只是措辞不同（例如「世界敌意值」「灰门」「SS-20销毁链」的多种表述）。每组至少 2 个 id。
2. noise — 不是真正的伏笔：状态播报、剧情预告、数值倒计时、「为后续…埋下伏笔」类空话。应删除。
3. stale — 是真正伏笔，但故事方向已变、长期未推进且不再有回收价值。应标记为已放弃（不是删除）。

只输出有效 JSON，不要 markdown 代码块或解释：

{
  "issues": [
    {
      "kind": "duplicate",
      "ids": ["F001", "F002"],
      "canonicalId": "F001",
      "reason": "中文原因",
      "confidence": "high"
    },
    {
      "kind": "noise",
      "ids": ["F010"],
      "reason": "中文原因",
      "confidence": "medium"
    },
    {
      "kind": "stale",
      "ids": ["F020"],
      "reason": "中文原因",
      "confidence": "low"
    }
  ]
}

规则：
- 只使用输入列表中存在的 id。
- duplicate 的 ids 长度 ≥ 2，canonicalId 必须在 ids 中（选最早埋设或描述最完整的）。
- noise / stale 的 ids 长度为 1。
- 同一 id 只能出现在一个 issue 中；优先归入 duplicate，其次 noise，再次 stale。
- 如果没有问题，输出 {"issues": []}。
- reason 必须使用中文。
- confidence: high / medium / low。`

function buildBatchUserMessage(
  summaries: ForeshadowingSummary[],
  currentChapter: number,
  batchIndex: number,
  batchCount: number,
): string {
  const lines = summaries.map((s) => {
    const adv =
      s.advancedChapters.length > 0 ? ` advanced=[${s.advancedChapters.join(",")}]` : ""
    const desc = s.description ? ` desc=${JSON.stringify(s.description.slice(0, 120))}` : ""
    return `- id=${s.id} name=${JSON.stringify(s.name)} status=${s.status} planted=${s.plantedChapter}${adv}${desc}`
  })
  return [
    `## 伏笔批次 ${batchIndex + 1}/${batchCount}（当前约第 ${currentChapter} 章，共 ${summaries.length} 条）`,
    "",
    "规则预筛提示（供参考，最终仍由你判断）：",
    `- 疑似 noise：名称/说明含「预示/暗示/将面临/为后续/埋下伏笔」等模板句式`,
    `- 疑似 stale：status=planted、无 advanced、埋设已超过 ${STALE_PLANTED_CHAPTERS} 章`,
    "",
    ...lines,
    "",
    "只输出 JSON。",
  ].join("\n")
}

function normalizeIssueKey(kind: CleanupIssueKind, ids: string[]): string {
  return `${kind}:${[...ids].map((s) => s.toLowerCase()).sort().join(",")}`
}

export function keepKey(ids: string[]): string {
  return [...ids].map((s) => s.toLowerCase()).sort().join(",")
}

function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fence?.[1]?.trim() || trimmed
  const start = candidate.indexOf("{")
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function parseDetectorResponse(response: string): CleanupIssue[] {
  const parsed = extractJsonObject(response)
  if (!parsed || typeof parsed !== "object") return []
  const issuesRaw = (parsed as { issues?: unknown }).issues
  if (!Array.isArray(issuesRaw)) return []

  const out: CleanupIssue[] = []
  for (const raw of issuesRaw) {
    if (!raw || typeof raw !== "object") continue
    const obj = raw as Record<string, unknown>
    const kind = obj.kind
    if (kind !== "duplicate" && kind !== "noise" && kind !== "stale") continue
    const ids = Array.isArray(obj.ids)
      ? obj.ids.filter((s): s is string => typeof s === "string" && s.trim() !== "")
      : []
    if (kind === "duplicate" && ids.length < 2) continue
    if ((kind === "noise" || kind === "stale") && ids.length !== 1) continue
    const reason = typeof obj.reason === "string" ? obj.reason : ""
    const confidence =
      obj.confidence === "high" || obj.confidence === "medium" || obj.confidence === "low"
        ? obj.confidence
        : "low"
    let canonicalId =
      typeof obj.canonicalId === "string" ? obj.canonicalId : undefined
    if (kind === "duplicate") {
      if (!canonicalId || !ids.includes(canonicalId)) canonicalId = ids[0]
    } else {
      canonicalId = undefined
    }
    out.push({ kind, ids, canonicalId, reason, confidence })
  }
  return out
}

function validateAndFilterIssues(
  issues: CleanupIssue[],
  validIds: Set<string>,
  keepKeys: Set<string>,
): CleanupIssue[] {
  const seenIds = new Set<string>()
  const result: CleanupIssue[] = []

  // Prefer duplicate > noise > stale when id conflicts
  const order: CleanupIssueKind[] = ["duplicate", "noise", "stale"]
  const sorted = [...issues].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind),
  )

  for (const issue of sorted) {
    const ids = issue.ids.filter((id) => validIds.has(id) && !seenIds.has(id))
    if (issue.kind === "duplicate" && ids.length < 2) continue
    if ((issue.kind === "noise" || issue.kind === "stale") && ids.length !== 1) continue
    if (keepKeys.has(keepKey(ids))) continue

    for (const id of ids) seenIds.add(id)

    result.push({
      ...issue,
      ids,
      canonicalId:
        issue.kind === "duplicate"
          ? issue.canonicalId && ids.includes(issue.canonicalId)
            ? issue.canonicalId
            : ids[0]
          : undefined,
    })
  }
  return result
}

/**
 * Rule-only candidates (used when LLM returns nothing, or for unit tests).
 * Does not invent duplicate groups — only noise/stale from heuristics.
 */
export function ruleBasedCleanupIssues(
  summaries: ForeshadowingSummary[],
  currentChapter: number,
  options: { keepKeys?: string[][] } = {},
): CleanupIssue[] {
  const keep = new Set((options.keepKeys ?? []).map((g) => keepKey(g)))
  const issues: CleanupIssue[] = []
  for (const item of summaries) {
    if (!isActiveForeshadowingStatus(item.status)) continue
    if (looksLikeNoise(item)) {
      const ids = [item.id]
      if (!keep.has(keepKey(ids))) {
        issues.push({
          kind: "noise",
          ids,
          reason: "规则：名称/说明像状态播报或剧情预告，不像可回收伏笔",
          confidence: "medium",
        })
      }
      continue
    }
    if (looksLikeStale(item, currentChapter)) {
      const ids = [item.id]
      if (!keep.has(keepKey(ids))) {
        issues.push({
          kind: "stale",
          ids,
          reason: `规则：已埋设超过 ${STALE_PLANTED_CHAPTERS} 章且从未推进`,
          confidence: "low",
        })
      }
    }
  }
  return issues
}

export interface CleanupBatchProgress {
  /** 1-based current batch */
  current: number
  total: number
  /** items in this batch */
  batchSize: number
  /** active foreshadowing count being scanned */
  activeCount: number
  phase: "batch_start" | "batch_done"
}

export async function detectCleanupIssues(
  summaries: ForeshadowingSummary[],
  currentChapter: number,
  llmCall: CleanupLlmCall,
  options: {
    signal?: AbortSignal
    keepKeys?: string[][]
    batchSize?: number
    onBatchProgress?: (progress: CleanupBatchProgress) => void
  } = {},
): Promise<CleanupIssue[]> {
  const active = summaries.filter((s) => isActiveForeshadowingStatus(s.status))
  if (active.length === 0) return []

  const batchSize = options.batchSize ?? CLEANUP_BATCH_SIZE
  const batches: ForeshadowingSummary[][] = []
  for (let i = 0; i < active.length; i += batchSize) {
    batches.push(active.slice(i, i + batchSize))
  }

  const allRaw: CleanupIssue[] = []
  for (let i = 0; i < batches.length; i++) {
    options.signal?.throwIfAborted()
    options.onBatchProgress?.({
      current: i + 1,
      total: batches.length,
      batchSize: batches[i].length,
      activeCount: active.length,
      phase: "batch_start",
    })
    const userMessage = buildBatchUserMessage(
      batches[i],
      currentChapter,
      i,
      batches.length,
    )
    const response = await llmCall(DETECTOR_SYSTEM_PROMPT, userMessage, options.signal)
    allRaw.push(...parseDetectorResponse(response))
    options.onBatchProgress?.({
      current: i + 1,
      total: batches.length,
      batchSize: batches[i].length,
      activeCount: active.length,
      phase: "batch_done",
    })
  }

  const validIds = new Set(active.map((s) => s.id))
  const keep = new Set((options.keepKeys ?? []).map((g) => keepKey(g)))
  const fromLlm = validateAndFilterIssues(allRaw, validIds, keep)

  // Supplement with rule-based noise/stale not already covered
  const covered = new Set(fromLlm.flatMap((i) => i.ids))
  for (const ruleIssue of ruleBasedCleanupIssues(active, currentChapter, {
    keepKeys: options.keepKeys,
  })) {
    if (ruleIssue.ids.every((id) => !covered.has(id))) {
      fromLlm.push(ruleIssue)
      for (const id of ruleIssue.ids) covered.add(id)
    }
  }

  return fromLlm
}

/** Merge duplicate foreshadowings into the canonical item. Mutates store. */
export function applyMergeIssue(
  store: ForeshadowingStore,
  issue: CleanupIssue,
  canonicalId: string,
): ForeshadowingStore {
  if (issue.kind !== "duplicate") {
    throw new Error(`applyMergeIssue expects duplicate, got ${issue.kind}`)
  }
  const canonical = store.items.find((f) => f.id === canonicalId)
  if (!canonical) throw new Error(`Canonical foreshadowing ${canonicalId} not found`)

  const others = issue.ids.filter((id) => id !== canonicalId)
  for (const id of others) {
    const other = store.items.find((f) => f.id === id)
    if (!other) continue
    canonical.plantedChapter = Math.min(canonical.plantedChapter, other.plantedChapter)
    const adv = new Set([
      ...(canonical.advancedChapters || []),
      ...(other.advancedChapters || []),
    ])
    canonical.advancedChapters = [...adv].sort((a, b) => a - b)
    if ((other.description || "").length > (canonical.description || "").length) {
      canonical.description = other.description
    }
    if ((other.name || "").length < (canonical.name || "").length && other.name) {
      // keep shorter name if more like a title — only when substantially shorter
      if (other.name.length <= 18 && other.name.length + 6 < canonical.name.length) {
        canonical.name = other.name
      }
    }
    const chars = new Set([
      ...(canonical.relatedCharacters || []),
      ...(other.relatedCharacters || []),
    ])
    canonical.relatedCharacters = [...chars]
    if (other.status === "advanced" && canonical.status === "planted") {
      canonical.status = "advanced"
    }
    if (other.status === "resolved") {
      canonical.status = "resolved"
      canonical.resolvedChapter = other.resolvedChapter ?? canonical.resolvedChapter
    }
  }

  const drop = new Set(others)
  store.items = store.items.filter((f) => !drop.has(f.id))
  store.lastUpdated = new Date().toISOString()
  return store
}

export type CleanupApplyAction = "merge" | "delete" | "abandon"

/** Default action for each issue kind. */
export function defaultCleanupAction(kind: CleanupIssueKind): CleanupApplyAction {
  if (kind === "duplicate") return "merge"
  if (kind === "noise") return "delete"
  return "abandon"
}

/** Delete the listed foreshadowing ids. Works for noise or "delete all" on duplicates. */
export function applyDeleteIssue(
  store: ForeshadowingStore,
  issue: CleanupIssue,
): ForeshadowingStore {
  const drop = new Set(issue.ids)
  store.items = store.items.filter((f) => !drop.has(f.id))
  store.lastUpdated = new Date().toISOString()
  return store
}

/** Mark listed items as abandoned. Mutates store. */
export function applyAbandonIssue(
  store: ForeshadowingStore,
  issue: CleanupIssue,
  options: { reason?: string; chapter?: number } = {},
): ForeshadowingStore {
  const noteParts = [
    options.reason || issue.reason || "维护工具标记为已放弃",
    options.chapter != null ? `（操作时约第${options.chapter}章）` : "",
  ]
  const note = noteParts.filter(Boolean).join(" ")
  for (const id of issue.ids) {
    const item = store.items.find((f) => f.id === id)
    if (!item) continue
    item.status = "abandoned"
    item.notes = item.notes ? `${item.notes}；${note}` : note
  }
  store.lastUpdated = new Date().toISOString()
  return store
}

/**
 * One-shot bulk cleanup: delete noise ids, abandon stale ids.
 * Prefer this over N queue tasks — one backup / one write.
 */
export function applyBulkDeleteAndAbandon(
  store: ForeshadowingStore,
  options: {
    deleteIds: readonly string[]
    abandonIds: readonly string[]
    reason?: string
    chapter?: number
  },
): { deleted: number; abandoned: number } {
  const deleteSet = new Set(options.deleteIds)
  const abandonSet = new Set(options.abandonIds.filter((id) => !deleteSet.has(id)))
  let deleted = 0
  let abandoned = 0

  if (deleteSet.size > 0) {
    const before = store.items.length
    store.items = store.items.filter((f) => !deleteSet.has(f.id))
    deleted = before - store.items.length
  }

  if (abandonSet.size > 0) {
    const noteParts = [
      options.reason || "一键清理：标记为已放弃",
      options.chapter != null ? `（操作时约第${options.chapter}章）` : "",
    ]
    const note = noteParts.filter(Boolean).join(" ")
    for (const item of store.items) {
      if (!abandonSet.has(item.id)) continue
      if (item.status === "abandoned") continue
      item.status = "abandoned"
      item.notes = item.notes ? `${item.notes}；${note}` : note
      abandoned++
    }
  }

  if (deleted > 0 || abandoned > 0) {
    store.lastUpdated = new Date().toISOString()
  }
  return { deleted, abandoned }
}

export function applyCleanupIssue(
  store: ForeshadowingStore,
  issue: CleanupIssue,
  options: {
    canonicalId?: string
    reason?: string
    chapter?: number
    action?: CleanupApplyAction
  } = {},
): ForeshadowingStore {
  const action = options.action ?? defaultCleanupAction(issue.kind)
  if (action === "delete") {
    return applyDeleteIssue(store, issue)
  }
  if (action === "abandon") {
    return applyAbandonIssue(store, issue, options)
  }
  // merge
  if (issue.kind !== "duplicate") {
    throw new Error(`merge action requires duplicate issue, got ${issue.kind}`)
  }
  const canonicalId = options.canonicalId || issue.canonicalId || issue.ids[0]
  return applyMergeIssue(store, issue, canonicalId)
}

/** Stable key for matching queue tasks to UI cards (ids + kind). */
export function cleanupIssueKey(issue: CleanupIssue): string {
  return normalizeIssueKey(issue.kind, issue.ids)
}

/** Queue identity: same ids can be merge or delete-all. */
export function cleanupTaskKey(
  issue: CleanupIssue,
  action?: CleanupApplyAction,
): string {
  return `${action ?? defaultCleanupAction(issue.kind)}:${cleanupIssueKey(issue)}`
}
