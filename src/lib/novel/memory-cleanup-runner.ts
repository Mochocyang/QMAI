import { createDirectory, deleteFile, fileExists, listDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { isPathInside, normalizePath } from "@/lib/path-utils"
import { streamChat } from "@/lib/llm-client"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"
import { clearGraphCache } from "@/lib/graph-relevance"
import { parseFrontmatter } from "@/lib/frontmatter"
import type { FileNode } from "@/types/wiki"
import { parseLlmJsonObject } from "./book-analysis/llm-json"
import { fingerprintText } from "./book-analysis/content-fingerprint"
import { chapterSnapshotNumbersFromFileNames } from "./chapter-memory-dot"
import { chapterSnapshotJsonPath, createRetrievalStore, loadSnapshot, rebuildDerivedMemoryFromSnapshots, replaceSnapshotForMemoryCleanup, type ChapterSnapshot } from "./chapter-ingest"
import { buildChapterIngestOutput } from "./chapter-ingest-output"
import { memoryProjectionPaths, rebuildMemoryEntityProjections } from "./graph-adapter"
import { loadCharacterStates } from "./character-state"
import { loadForeshadowingTracker } from "./foreshadowing-tracker"
import { normalizeForeshadowingName } from "./foreshadowing-normalize"
import { loadTimeline } from "./timeline"
import { readContextMd, writeCharacterStateMd, writeContextMd, writeForeshadowingMd, writeTimelineMd } from "./tracking-files"
import { filterRemovedMemories, loadMemoryCleanupPolicy, saveMemoryCleanupPolicy, memoryPolicyPath, memoryRemovalKey, withMemoryWriteLock, MEMORY_FIELDS, type MemoryCleanupPolicy, type MemoryField } from "./memory-cleanup-policy"
import { collectMemoryRecords, snapshotsInCleanupScope, MEMORY_CLEANUP_SYSTEM, parseMemoryCleanupIssues, type MemoryCleanupIssue, type MemoryCleanupRecord, type MemoryCleanupScan, type MemoryCleanupScope } from "./memory-cleanup"
import { memoryAppearanceSubject, planMemoryCleanupRules, type MemoryCleanupRuleOptions, type MemoryCleanupRulePlan } from "./memory-cleanup-rules"
import { buildPersonaChapterFacts, mergeLiveLines } from "./persona-skill-facts"
import { applyPersonaProfileEdits, splitPersonaSkillDocument } from "./persona-skill-profile"
import { loadPersonaSkillIndexStrict, personaSkillDocumentPath, personaSkillIndexPath, personaSkillLockKey, savePersonaSkillIndex, withPersonaSkillLock } from "./persona-skill-store"
import { PERSONA_LIVE_SECTION_LIMITS } from "./persona-skill-types"

type Log = (message: string) => void
const CLEANUP_BATCH_RECORD_CAP = 120
const CLEANUP_BATCH_OVERLAP = 8
const CLEANUP_BATCH_CONCURRENCY = 4
const scanPath = (p: string) => `${normalizePath(p)}/.qmai/memory-cleanup-scan.json`
const lastPath = (p: string) => `${normalizePath(p)}/.qmai/memory-cleanup-last.json`
const historyRoot = (p: string) => `${normalizePath(p)}/.qmai/memory-cleanup-history`

function memoryCleanupBatchSubject(record: MemoryCleanupRecord): string {
  const named = memoryAppearanceSubject(record.text, record.field)
  if (named) return named
  const normalized = record.text.normalize("NFKC").trim()
  const head = normalized.split(/[:：]/u)[0]?.trim() ?? ""
  if (!head || head.length > 40 || head === normalized || /^(?:推进|新增|回收)/u.test(head)) return ""
  return head
}

async function readSnapshots(projectPath: string): Promise<ChapterSnapshot[]> {
  const dir = `${normalizePath(projectPath)}/.novel/snapshots`
  if (!await fileExists(dir)) return []
  const numbers = chapterSnapshotNumbersFromFileNames((await listDirectory(dir)).filter((f) => !f.is_dir).map((f) => f.name))
  const result: ChapterSnapshot[] = []
  for (const n of numbers) {
    const snapshot = await loadSnapshot(projectPath, n)
    if (!snapshot) throw new Error(`第 ${n} 章快照无法读取，已停止清理。`)
    if (!snapshot.isHistorical) result.push(snapshot)
  }
  return result
}

export async function loadMemoryCleanupScan(projectPath: string): Promise<MemoryCleanupScan | null> {
  if (!await fileExists(scanPath(projectPath))) return null
  let data: MemoryCleanupScan
  try { data = JSON.parse(await readFile(scanPath(projectPath))) as MemoryCleanupScan } catch { return null }
  if (!data || data.version !== 1 || !Array.isArray(data.records) || !Array.isArray(data.issues)) return null
  if (data.records.some((r) => !r || !MEMORY_FIELDS.includes(r.field))) return null
  const fields = [...new Set(data.records.map((r) => r.field))]
  const current = new Map(collectMemoryRecords(snapshotsInCleanupScope(await readSnapshots(projectPath), data.scope), fields).map((r) => [r.id, r]))
  if (current.size !== data.records.length) return null
  if (data.records.some((r) => !r || current.get(r.id)?.revision !== r.revision || current.get(r.id)?.text !== r.text)) return null
  const policy = await loadMemoryCleanupPolicy(projectPath)
  return { ...data, issues: parseMemoryCleanupIssues({ issues: data.issues }, data.records).filter((i) => !policy.kept.includes(i.id)) }
}

export async function runMemoryCleanupScan(projectPath: string, config: LlmConfig, options: {
  fields?: MemoryField[]; scope?: MemoryCleanupScope; resume?: boolean; signal?: AbortSignal; onLog?: Log; onProgress?: (done: number, total: number, scan: MemoryCleanupScan) => void
  onActivity?: (activity: { batch: number; receivedChars: number; elapsedSeconds: number }) => void
} = {}): Promise<MemoryCleanupScan> {
  if (options.scope && ([options.scope.fromChapter, options.scope.toChapter].some((n) => n !== undefined && (!Number.isInteger(n) || n < 1))
    || (options.scope.fromChapter !== undefined && options.scope.toChapter !== undefined && options.scope.fromChapter > options.scope.toChapter))) throw new Error("清理章节范围无效")
  if (options.fields && (!options.fields.length || options.fields.some((field) => !MEMORY_FIELDS.includes(field)))) throw new Error("清理记忆类别无效")
  const policy = await loadMemoryCleanupPolicy(projectPath)
  const snapshots = await withMemoryWriteLock(projectPath, async () => snapshotsInCleanupScope(await readSnapshots(projectPath), options.scope))
  const records = collectMemoryRecords(snapshots.map((s) => filterRemovedMemories(s, policy)), options.fields)
  const batches: MemoryCleanupRecord[][] = []
  const maxChars = Math.min(32000, Math.max(3000, Math.floor((config.maxContextSize ?? 32768) * 0.8)))
  for (const field of options.fields ?? MEMORY_FIELDS) {
    const items = records.filter((r) => r.field === field).sort((a, b) => {
      const subject = memoryCleanupBatchSubject(a).localeCompare(memoryCleanupBatchSubject(b), "zh-CN")
      return subject || a.chapterNumber - b.chapterNumber || a.text.localeCompare(b.text, "zh-CN") || a.id.localeCompare(b.id)
    })
    let start = 0
    while (start < items.length) {
      let end = start, chars = 0
      while (end < items.length && end - start < CLEANUP_BATCH_RECORD_CAP) {
        const size = Math.min(items[end].text.length, 2000) + 160
        if (end > start && chars + size > maxChars) break
        chars += size; end++
      }
      batches.push(items.slice(start, end))
      if (end === items.length) break
      start = Math.max(start + 1, end - CLEANUP_BATCH_OVERLAP)
    }
  }
  const checkpointPath = `${normalizePath(projectPath)}/.qmai/memory-cleanup-checkpoint.json`
  const recentStory = snapshots.filter((s) => s.chapterNumber > 0).slice(-3).map((s) => ({ chapter: s.chapterNumber, summary: s.summary.slice(0, 400) }))
  const fingerprint = fingerprintText(JSON.stringify({ records, batches: batches.map((batch) => batch.map((r) => r.id)), recentStory,
    model: `${config.provider}/${config.model}`, prompt: MEMORY_CLEANUP_SYSTEM }))
  /*
   * 显式标注成 string：`crypto.randomUUID()` 的返回类型是模板字面量
   * `${string}-${string}-...`，而断点里读回来的 scanId 只是 string，
   * 不标注会让 `scanId = checkpoint.scan.scanId` 报 TS2322。
   */
  let scanId: string = crypto.randomUUID()
  let completed = 0
  const issues = new Map<string, MemoryCleanupIssue>()
  if (options.resume !== false && await fileExists(checkpointPath)) {
    let checkpoint: { version: number; fingerprint: string; scan: MemoryCleanupScan } | null = null
    try { checkpoint = JSON.parse(await readFile(checkpointPath)) } catch { /* A broken checkpoint cannot be trusted. */ }
    if (checkpoint?.version === 1 && checkpoint.fingerprint === fingerprint && checkpoint.scan.complete === false
      && Number.isInteger(checkpoint.scan.completedBatches) && checkpoint.scan.completedBatches! >= 0 && checkpoint.scan.completedBatches! <= batches.length) {
      scanId = checkpoint.scan.scanId ?? scanId
      completed = checkpoint.scan.completedBatches!
      for (const issue of parseMemoryCleanupIssues({ issues: checkpoint.scan.issues }, records)) if (!policy.kept.includes(issue.id)) issues.set(issue.id, issue)
      options.onLog?.(`恢复断点：已完成 ${completed}/${batches.length} 批，保留 ${issues.size} 组候选；继续未完成批次。`)
    } else if (checkpoint?.scan?.complete === false) options.onLog?.("来源、模型或扫描参数已变化，旧断点不再适用，本次重新扫描。")
  }
  await createDirectory(`${normalizePath(projectPath)}/.qmai`)
  let scan: MemoryCleanupScan
  const publish = async (complete: boolean) => {
    const scannedIds = new Set(batches.slice(0, completed).flatMap((batch) => batch.map((record) => record.id)))
    scan = { version: 1, scanId, ...(options.scope ? { scope: options.scope } : {}), fields: [...(options.fields ?? MEMORY_FIELDS)], scannedAt: Date.now(), records,
      issues: [...issues.values()], complete, completedBatches: completed, totalBatches: batches.length, scannedRecordCount: scannedIds.size }
    // Persist a completed batch before announcing progress; a restart repeats only
    // the currently unfinished request. Partial candidates are independently usable.
    await writeFileAtomic(checkpointPath, JSON.stringify({ version: 1, fingerprint, scan }))
    // A fresh run has no candidates yet. Keep the previous result file until a batch
    // actually finishes, so cancelling immediately does not blank the review list.
    if (completed > 0 || complete || scan.issues.length > 0) await writeFileAtomic(scanPath(projectPath), JSON.stringify(scan, null, 2))
    options.onProgress?.(completed, batches.length, scan)
  }
  await publish(false)
  const buffered = new Map<number, MemoryCleanupIssue[]>()
  const inFlight = new Map<number, Promise<void>>()
  const failed = new Set<number>()
  let launch = completed
  let failure: unknown = null
  const scanBatch = async (index: number): Promise<MemoryCleanupIssue[]> => {
    options.signal?.throwIfAborted()
    options.onLog?.(`分析第 ${index + 1}/${batches.length} 批，${batches[index].length} 条来源记忆`)
    let output = "", requestError: Error | null = null, lastActivity = 0
    const startedAt = Date.now()
    const activity = (force = false) => {
      if (!force && Date.now() - lastActivity < 500) return
      lastActivity = Date.now()
      options.onActivity?.({ batch: index + 1, receivedChars: output.length, elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000) })
    }
    activity(true)
    const timer = setInterval(() => activity(), 1000)
    try {
      await streamChat(config, [
        { role: "system", content: MEMORY_CLEANUP_SYSTEM },
        { role: "user", content: JSON.stringify({ recentStory, records: batches[index].map((r) => ({ ...r, text: r.text.slice(0, 2000) })) }) },
      ], { onToken: (text) => { output += text; activity() }, onDone: () => {}, onError: (error) => { requestError = error } }, options.signal,
      { temperature: 0.1, skipUserMemory: true, reasoning: { mode: "off" }, max_tokens: 4096 })
    } finally { clearInterval(timer) }
    options.signal?.throwIfAborted()
    if (requestError) throw requestError
    return parseMemoryCleanupIssues(parseLlmJsonObject(output), batches[index]).filter((issue) => !policy.kept.includes(issue.id))
  }
  // Later batches may finish first. Only a contiguous prefix is checkpointed,
  // so abort or a crash cannot mark batch N done while an earlier batch is open.
  while (completed < batches.length) {
    while (buffered.has(completed)) {
      options.signal?.throwIfAborted()
      for (const issue of buffered.get(completed)!) issues.set(issue.id, issue)
      buffered.delete(completed)
      completed += 1
      await publish(completed === batches.length)
    }
    if (completed >= batches.length) break
    options.signal?.throwIfAborted()
    if (failed.has(completed)) throw failure
    while (inFlight.size < CLEANUP_BATCH_CONCURRENCY && launch < batches.length && !failure) {
      const index = launch++
      const job = scanBatch(index).then((found) => { buffered.set(index, found) }).catch((error) => { failed.add(index); failure ??= error })
      inFlight.set(index, job)
      void job.finally(() => { if (inFlight.get(index) === job) inFlight.delete(index) })
    }
    if (buffered.has(completed)) continue
    if (failed.has(completed)) throw failure
    const pending = [...inFlight.values()]
    if (!pending.length) break
    await Promise.race(pending)
  }
  if (failure && completed < batches.length) throw failure
  if ((!batches.length || completed === batches.length) && scan!.complete !== true) await publish(true)
  options.onLog?.(`扫描完成：${records.length} 条来源记忆，${issues.size} 组候选。`)
  return scan!
}

interface BackupFile { path: string; before: string | null; after?: string }
interface CleanupBackup { version: 1; files: BackupFile[]; createdAt: number }
function walk(nodes: FileNode[]): string[] { return nodes.flatMap((node) => node.is_dir ? walk(node.children ?? []) : [node.path]) }
async function optionalTree(path: string): Promise<string[]> { return await fileExists(path) ? walk(await listDirectory(path)) : [] }
const allowedBackupPath = (relative: string) => !relative.split("/").includes("..") && !relative.includes("\\") && [
  ".novel/", ".qmai/persona-skills/", "wiki/memory/", "wiki/tracking/", "wiki/entities/", "retrieval/",
].some((prefix) => relative.startsWith(prefix))

async function captureBackup(projectPath: string, changed: ChapterSnapshot[], entityPaths: string[]): Promise<{ dir: string; backup: CleanupBackup }> {
  const pp = normalizePath(projectPath)
  const paths = new Set<string>([
    memoryPolicyPath(pp),
    ...["cognition-state", "character-states", "foreshadowing-tracker", "timeline"].map((n) => `${pp}/.novel/${n}.json`),
    ...["chapter-snapshots", "character-cognition", "character-states", "foreshadowing-tracker", "timeline", "canon-facts", "conflicts"].map((n) => `${pp}/wiki/memory/${n}.md`),
    ...["角色状态", "伏笔", "时间线", "上下文"].map((n) => `${pp}/wiki/tracking/${n}.md`),
    ...entityPaths,
  ])
  for (const snapshot of changed) {
    const json = chapterSnapshotJsonPath(pp, snapshot.chapterNumber)
    paths.add(json); paths.add(json.replace(/\.json$/, ".md"))
    const prefix = `${pp}/.novel/chapter-ingest-output/${String(snapshot.chapterNumber).padStart(3, "0")}`
    paths.add(`${prefix}.output.json`); paths.add(`${prefix}.wiki-patch.json`)
    if (snapshot.chapterNumber > 0) {
      const retrieval = createRetrievalStore(pp)
      paths.add(retrieval.indexPath)
      paths.add(retrieval.getVolumePath(retrieval.chapterToVolumeName(snapshot.chapterNumber)))
    }
  }
  for (const path of [...await optionalTree(`${pp}/retrieval`), ...await optionalTree(`${pp}/.novel/community-summaries`)]) paths.add(path)
  const persona = await loadPersonaSkillIndexStrict(pp)
  if (persona) {
    paths.add(personaSkillIndexPath(pp))
    for (const skill of persona.skills) paths.add(personaSkillDocumentPath(pp, skill.id))
  }
  const files: BackupFile[] = []
  for (const path of paths) {
    const relative = normalizePath(path).slice(pp.length + 1)
    if (!isPathInside(path, pp) || !allowedBackupPath(relative)) throw new Error("记忆备份路径越界")
    files.push({ path: relative, before: await fileExists(path) ? await readFile(path) : null })
  }
  const dir = `${historyRoot(pp)}/${Date.now()}-${crypto.randomUUID()}`
  const backup: CleanupBackup = { version: 1, files, createdAt: Date.now() }
  await createDirectory(dir)
  await writeFileAtomic(`${dir}/backup.json`, JSON.stringify(backup))
  return { dir, backup }
}

async function restoreFiles(projectPath: string, backup: CleanupBackup): Promise<void> {
  for (const file of backup.files) {
    if (!allowedBackupPath(file.path)) throw new Error("记忆备份路径无效")
    const path = `${normalizePath(projectPath)}/${file.path}`
    if (file.before === null) { if (await fileExists(path)) await deleteFile(path) }
    else { await createDirectory(path.slice(0, path.lastIndexOf("/"))); await writeFileAtomic(path, file.before) }
  }
}

async function syncTracking(projectPath: string): Promise<void> {
  const [characters, foreshadowing, timeline, progress] = await Promise.all([
    loadCharacterStates(projectPath), loadForeshadowingTracker(projectPath), loadTimeline(projectPath), readContextMd(projectPath),
  ])
  await writeCharacterStateMd(projectPath, characters)
  await writeForeshadowingMd(projectPath, foreshadowing.items, foreshadowing.items.filter((f) => f.status === "resolved" && f.resolvedChapter != null)
    .map((f) => ({ id: f.id, resolvedInChapter: f.resolvedChapter!, resolution: `伏笔「${f.name}」在第${f.resolvedChapter}章回收` })))
  await writeTimelineMd(projectPath, timeline.entries)
  if (progress) {
    const active = foreshadowing.items.filter((f) => f.status !== "resolved" && f.status !== "abandoned")
    await writeContextMd(projectPath, { ...progress, activeForeshadowingCount: active.length, keyPendingForeshadowing: active.slice(0, 5).map((f) => f.name) })
  }
}

async function rebuildPersonaFacts(projectPath: string, snapshots: ChapterSnapshot[], changed: Set<number>, fields: Set<MemoryField>): Promise<void> {
  if (!fields.has("knowledgeChanges") && !fields.has("characterStateChanges")) return
  const index = await loadPersonaSkillIndexStrict(projectPath)
  if (!index) return
  let dirty = false
  for (const meta of index.skills) {
    const path = personaSkillDocumentPath(projectPath, meta.id)
    if (!await fileExists(path)) continue
    const document = await readFile(path), parsed = splitPersonaSkillDocument(document)
    const sources = snapshots.filter((s) => s.chapterNumber > 0 && s.characters.some((name) => [meta.characterName, ...meta.aliases].includes(name)))
    if (!sources.some((s) => changed.has(s.chapterNumber))) continue
    const facts = sources.map((s) => buildPersonaChapterFacts(s, meta.characterName, meta.aliases))
    const oldState = parsed.fields["当前状态"] ?? ""
    const generatedState = /^第\s*(-?\d+)\s*章[：:]/.test(oldState)
    const manualCognition = (parsed.fields["认知变化"] ?? "").split("\n").filter((line) => !/^\s*(?:[-*]\s*)?第\s*-?\d+\s*章[：:]/.test(line)).join("\n")
    const next = applyPersonaProfileEdits(document, {
      ...(generatedState && fields.has("characterStateChanges") ? { 当前状态: facts.map((f) => f.currentState).filter(Boolean).slice(-1)[0] ?? "" } : {}),
      ...(fields.has("knowledgeChanges") ? { 认知变化: mergeLiveLines(manualCognition, facts.flatMap((f) => f.cognition), PERSONA_LIVE_SECTION_LIMITS.认知变化) } : {}),
    })
    if (next !== document) { await writeFileAtomic(path, next); meta.skillRevision++; dirty = true }
  }
  if (dirty) await savePersonaSkillIndex(projectPath, index)
}

async function invalidateVectors(projectPath: string, paths: string[], communities: string[], onLog?: Log): Promise<void> {
  if (!await fileExists(`${normalizePath(projectPath)}/.qmai/lancedb`)) return
  const { removePageEmbeddingStrict, embedPage } = await import("@/lib/embedding")
  const ids = new Set(paths.filter((path) => path.endsWith(".md")).map((path) => path.split("/").pop()!.replace(/\.md$/, "")))
  for (const path of communities) ids.add(`community:${path.split("/").pop()!.replace(/\.json$/, "")}`)
  for (const id of ids) await removePageEmbeddingStrict(projectPath, id)
  const config = useWikiStore.getState().embeddingConfig
  if (config.enabled && config.model) {
    const pages = [...new Set(paths)].filter((path) => path.includes("/wiki/") && path.endsWith(".md"))
    for (let index = 0; index < pages.length; index++) {
      const path = pages[index]
      if (!await fileExists(path)) continue
      const id = path.split("/").pop()!.replace(/\.md$/, "")
      const content = await readFile(path)
      const title = parseFrontmatter(content).frontmatter?.title
      onLog?.(`同步向量索引 ${index + 1}/${pages.length}：${id}`)
      try {
        if (!await embedPage(projectPath, id, typeof title === "string" ? title : id, content, config)) throw new Error("嵌入未完成")
      } catch {
        onLog?.(`警告：旧向量已清除，但页面「${id}」重新索引失败，尚未完成的页面请在向量设置中重建索引。来源及文档已同步。`)
        return
      }
    }
    for (const path of communities) {
      if (!await fileExists(path)) continue
      const record = JSON.parse(await readFile(path)) as { summary?: string }
      const id = `community:${path.split("/").pop()!.replace(/\.json$/, "")}`
      if (record.summary) {
        try { if (!await embedPage(projectPath, id, "社区摘要", record.summary, config)) throw new Error("嵌入未完成") }
        catch { onLog?.("警告：旧向量已清除，但社区摘要重新索引失败，请在向量设置中重建索引。来源及文档已同步。"); return }
      }
    }
  } else onLog?.("受影响的旧向量已清除；重新启用向量检索后可重建索引。")
}

export async function applyMemoryCleanup(projectPath: string, scan: MemoryCleanupScan, selected: readonly MemoryCleanupIssue[], onLog?: Log): Promise<number> {
  return withMemoryWriteLock(projectPath, () => withPersonaSkillLock(personaSkillLockKey(projectPath), async () => {
    const snapshots = await readSnapshots(projectPath), current = new Map(collectMemoryRecords(snapshots).map((r) => [r.id, r]))
    const scanned = new Map(scan.records.map((r) => [r.id, r]))
    const scanFields = new Set(scan.records.map((r) => r.field))
    const scopeRecordCount = collectMemoryRecords(snapshotsInCleanupScope(snapshots, scan.scope), [...scanFields]).length
    if (scopeRecordCount !== scan.records.length
      || scan.records.some((r) => current.get(r.id)?.revision !== r.revision || current.get(r.id)?.text !== r.text)) {
      throw new Error("来源记忆已变化，请重新扫描后再清理。")
    }
    const remove = new Set(selected.flatMap((i) => i.removeIds))
    if (!remove.size) throw new Error("未选择要处理的条目")
    if (selected.some((i) => i.keepId && (remove.has(i.keepId) || !current.has(i.keepId)))) throw new Error("候选之间存在冲突：不能同时删除另一组需要保留的依据。请调整选择。")
    for (const id of [...remove, ...selected.flatMap((i) => i.keepId ? [i.keepId] : [])]) {
      const before = scanned.get(id), now = current.get(id)
      if (!before || !now || before.revision !== now.revision || before.text !== now.text) throw new Error("来源记忆已变化，请重新扫描后再清理。")
    }
    const policy = await loadMemoryCleanupPolicy(projectPath)
    const oldKeys = new Set(policy.removed.map(memoryRemovalKey))
    const nextPolicy: MemoryCleanupPolicy = { ...policy, removed: [...policy.removed] }
    for (const id of remove) {
      const { chapterNumber, field, text } = current.get(id)!
      const record = { chapterNumber, field, text }
      if (!oldKeys.has(memoryRemovalKey(record))) { nextPolicy.removed.push(record); oldKeys.add(memoryRemovalKey(record)) }
    }
    const changedNumbers = new Set([...remove].map((id) => current.get(id)!.chapterNumber))
    const changedFields = new Set([...remove].map((id) => current.get(id)!.field))
    const changed = snapshots.filter((s) => changedNumbers.has(s.chapterNumber))
    const next = snapshots.map((s) => filterRemovedMemories(s, nextPolicy))
    const changedPatches = changed.flatMap((snapshot) => {
      // Compare the content before revision/timestamp changes, so a single
      // empty foreshadowing item does not rewrite every entity in its chapter.
      const before = buildChapterIngestOutput(snapshot, { now: "" }).wikiUpdatePatch
      const after = buildChapterIngestOutput(next.find((s) => s.chapterNumber === snapshot.chapterNumber)!, { now: "" }).wikiUpdatePatch
      const oldEntries = new Map(before.entries.map((entry) => [entry.entryId, entry]))
      const newEntries = new Map(after.entries.map((entry) => [entry.entryId, entry]))
      const differs = (id: string) => JSON.stringify(oldEntries.get(id)) !== JSON.stringify(newEntries.get(id))
      return [{ ...before, entries: before.entries.filter((entry) => differs(entry.entryId)) }, { ...after, entries: after.entries.filter((entry) => differs(entry.entryId)) }]
    })
    const entityPaths = memoryProjectionPaths(projectPath, changedPatches)
    const { dir, backup } = await captureBackup(projectPath, changed, entityPaths)
    onLog?.(`已备份至 ${dir}`)
    const communities = backup.files.filter((f) => f.path.startsWith(".novel/community-summaries/")).map((f) => `${normalizePath(projectPath)}/${f.path}`)
    try {
      await saveMemoryCleanupPolicy(projectPath, nextPolicy)
      for (const snapshot of next.filter((s) => changedNumbers.has(s.chapterNumber))) await replaceSnapshotForMemoryCleanup(projectPath, snapshot)
      const committed = await readSnapshots(projectPath)
      const patches = committed.filter((s) => s.chapterNumber > 0).map((s) => buildChapterIngestOutput(s).wikiUpdatePatch)
      await rebuildDerivedMemoryFromSnapshots(projectPath, undefined, { fields: [...changedFields] })
      await syncTracking(projectPath)
      const retrieval = createRetrievalStore(projectPath)
      for (const snapshot of committed.filter((s) => s.chapterNumber > 0 && changedNumbers.has(s.chapterNumber))) await retrieval.updateChapterEntry(snapshot.chapterNumber, snapshot)
      await rebuildMemoryEntityProjections(projectPath, patches, entityPaths, changed, committed)
      await rebuildPersonaFacts(projectPath, committed, changedNumbers, changedFields)
      for (const path of communities) await deleteFile(path)
      // Invalidate stale chunks before reporting success. Reindexing can restore recall later.
      const mutatedPaths: string[] = []
      for (const file of backup.files) {
        const path = `${normalizePath(projectPath)}/${file.path}`
        const after = await fileExists(path) ? await readFile(path) : null
        file.after = fingerprintText(JSON.stringify(after))
        if (after !== file.before) mutatedPaths.push(path)
      }
      // Include newly created retrieval files in rollback/undo as absent originals.
      const known = new Set(backup.files.map((f) => f.path))
      for (const path of await optionalTree(`${normalizePath(projectPath)}/retrieval`)) {
        const relative = normalizePath(path).slice(normalizePath(projectPath).length + 1)
        if (!known.has(relative)) { backup.files.push({ path: relative, before: null, after: fingerprintText(JSON.stringify(await readFile(path))) }); mutatedPaths.push(path) }
      }
      await invalidateVectors(projectPath, mutatedPaths, communities, onLog)
      // Only changed files belong to this undo operation. Unrelated persona/retrieval
      // updates after cleanup must neither block undo nor get overwritten by it.
      const mutated = new Set(mutatedPaths)
      backup.files = backup.files.filter((file) => mutated.has(`${normalizePath(projectPath)}/${file.path}`))
      await writeFileAtomic(`${dir}/backup.json`, JSON.stringify(backup))
      await writeFileAtomic(lastPath(projectPath), JSON.stringify({ dir }))
      clearGraphCache(); useWikiStore.getState().bumpDataVersion()
      onLog?.(`已从来源删除 ${remove.size} 条，完成 JSON、Markdown、检索索引和缓存同步。`)
      return remove.size
    } catch (error) {
      try { await restoreFiles(projectPath, backup) }
      catch (restoreError) {
        clearGraphCache(); useWikiStore.getState().bumpDataVersion()
        throw new Error(`清理失败且备份恢复未完成，请保留 ${dir}：${String(restoreError)}；原错误：${String(error)}`)
      }
      clearGraphCache(); useWikiStore.getState().bumpDataVersion()
      throw new Error(`清理失败，已恢复文件备份：${error instanceof Error ? error.message : String(error)}`)
    }
  }))
}

async function loadRawCleanupRecords(projectPath: string): Promise<MemoryCleanupRecord[]> {
  return collectMemoryRecords(await withMemoryWriteLock(projectPath, () => readSnapshots(projectPath)))
}

export async function planMemoryCleanupByRules(projectPath: string, options: MemoryCleanupRuleOptions): Promise<MemoryCleanupRulePlan> {
  return planMemoryCleanupRules(await loadRawCleanupRecords(projectPath), options)
}

export async function applyMemoryCleanupRules(projectPath: string, options: MemoryCleanupRuleOptions, onLog?: Log): Promise<number> {
  const records = await loadRawCleanupRecords(projectPath)
  const plan = planMemoryCleanupRules(records, options)
  if (!plan.issues.length) return 0
  const scan: MemoryCleanupScan = { version: 1, scannedAt: Date.now(), records, issues: plan.issues, complete: true }
  return applyMemoryCleanup(projectPath, scan, plan.issues, onLog)
}

export async function keepMemoryCleanupIssue(projectPath: string, issue: MemoryCleanupIssue): Promise<void> {
  await withMemoryWriteLock(projectPath, async () => {
    const policy = await loadMemoryCleanupPolicy(projectPath)
    await saveMemoryCleanupPolicy(projectPath, { ...policy, kept: [...new Set([...policy.kept, issue.id])] })
  })
}

/** Compatibility for queued jobs from the former foreshadowing-only panel. */
export async function cleanupLegacyForeshadowingSources(projectPath: string, ids: readonly string[], onLog?: Log): Promise<number> {
  const store = await loadForeshadowingTracker(projectPath)
  const targets = ids.map((id) => store.items.find((f) => f.id === id))
  if (!targets.length || targets.some((f) => !f)) throw new Error("旧伏笔条目已变化，请在「清理写作记忆」重新扫描。")
  const records = collectMemoryRecords(await readSnapshots(projectPath), ["foreshadowingChanges"])
  const matches = (record: MemoryCleanupRecord, item: typeof store.items[number]) => {
    const parsed = normalizeForeshadowingName(record.text)
    return parsed.name === item.name || parsed.description === item.description
  }
  const remove = new Set<string>()
  for (const target of targets) {
    const found = records.filter((r) => matches(r, target!))
    if (!found.length) throw new Error("无法精确定位旧伏笔的来源，请在统一清理面板重新扫描。")
    found.forEach((r) => remove.add(r.id))
  }
  const issue: MemoryCleanupIssue = { id: "legacy", kind: "noise", removeIds: [...remove], reason: "迁移旧版伏笔清理任务，从来源处理", confidence: "high" }
  return applyMemoryCleanup(projectPath, { version: 1, scannedAt: Date.now(), records, issues: [issue] }, [issue], onLog)
}

export async function undoLastMemoryCleanup(projectPath: string, onLog?: Log): Promise<void> {
  await withMemoryWriteLock(projectPath, () => withPersonaSkillLock(personaSkillLockKey(projectPath), async () => {
    if (!await fileExists(lastPath(projectPath))) throw new Error("没有可撤销的清理记录。")
    const { dir } = JSON.parse(await readFile(lastPath(projectPath))) as { dir: string }
    if (typeof dir !== "string" || !isPathInside(dir, historyRoot(projectPath))) throw new Error("清理备份路径无效")
    const backup = JSON.parse(await readFile(`${dir}/backup.json`)) as CleanupBackup
    if (backup.version !== 1 || !Array.isArray(backup.files)) throw new Error("清理备份无效")
    for (const file of backup.files) {
      if (!allowedBackupPath(file.path) || typeof file.after !== "string" || (file.before !== null && typeof file.before !== "string")) throw new Error("清理备份无效")
      const path = `${normalizePath(projectPath)}/${file.path}`
      const current = await fileExists(path) ? await readFile(path) : null
      if (fingerprintText(JSON.stringify(current)) !== file.after) throw new Error("清理后文件已有新变化，不能覆盖恢复。备份已保留。")
    }
    await restoreFiles(projectPath, backup)
    const paths = backup.files.map((f) => `${normalizePath(projectPath)}/${f.path}`)
    let indexError: unknown = null
    try { await invalidateVectors(projectPath, paths, paths.filter((path) => path.includes("/.novel/community-summaries/")), onLog) }
    catch (error) { indexError = error }
    await deleteFile(lastPath(projectPath))
    clearGraphCache(); useWikiStore.getState().bumpDataVersion()
    if (indexError) throw new Error(`记忆文件已撤销恢复，但向量索引同步失败，请重建索引：${String(indexError)}`)
  }))
}
