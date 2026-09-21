import { readFile, writeFileAtomic, listDirectory, fileExists, createDirectory, deleteFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { useWikiStore } from "@/stores/wiki-store"
import { parseFrontmatter } from "@/lib/frontmatter"
import { isChapterPage, isFinalChapter, parseChapterNumber } from "./chapter-meta"
import { streamChat, type StreamCallbacks } from "@/lib/llm-client"
import type { ChatMessage } from "@/lib/llm-providers"
import { getOutputLanguage, buildLanguageReminder } from "@/lib/output-language"
import type { LlmConfig } from "@/stores/wiki-store"
import { canonicalizeSnapshotCharacters, writeSnapshotToWiki, writePatchFieldsToWiki } from "./graph-adapter"
import { resolveNovelModel } from "./model-resolver"
import { emptyCognitionState, mergeCognitionFromSnapshot, loadCognitionState, saveCognitionState } from "./character-cognition"
import { createEmptyCharacterStateStore, loadCharacterStates, saveCharacterStates, type CharacterStateStore } from "./character-state"
import { updateTrackingAfterChapter } from "./tracking-updater"
import {
  createEmptyForeshadowingStore,
  generateForeshadowingId,
  loadForeshadowingTracker,
  saveForeshadowingTracker,
  type Foreshadowing,
  type ForeshadowingStore,
} from "./foreshadowing-tracker"
import {
  findForeshadowingByNormalizedName,
  parseForeshadowingChange,
} from "./foreshadowing-normalize"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { shouldRebuildCommunitySummaries, generateCommunitySummaries } from "./community-summary"
import { buildChapterIngestOutput, type ChapterIngestOutput } from "./chapter-ingest-output"
import { mergeSnapshotTimeline, rebuildTimelineFromSnapshots } from "./timeline"
import { buildStructuredMemoryDocuments, isValidMemorySnapshot } from "./memory-rebuild"
import { clearGraphCache } from "@/lib/graph-relevance"
import { RetrievalStore } from "./retrieval"
import { computeOutlineIngestBodyBudget } from "@/lib/context-budget"
import { parseLlmJsonObject } from "./book-analysis/llm-json"
import {
  buildChapterExtractSystemPrompt,
  buildChapterExtractUserPrompt,
  buildOutlineExtractSystemPrompt,
  buildOutlineExtractUserPrompt,
  CHAPTER_EXTRACT_REQUEST_OVERRIDES,
  resolveChapterExtractMaxTokens,
} from "./chapter-ingest-extract"
import { appendChapterIngestLog, previewLlmOutput } from "./chapter-ingest-log"

export interface ValidationWarning {
  type: "entity_new" | "canon_conflict"
  message: string
}

export interface CharacterDetail {
  identity: string
  faction: string
  goals: string
  arcChange: string
}

export interface LocationDetail {
  region: string
  type: string
  controller: string
  hiddenInfo: string
}

export interface OrganizationDetail {
  leader: string
  members: string
  goals: string
  resources: string
}

export interface ItemDetail {
  holder: string
  previousHolders: string
  abilities: string
  limitations: string
  origin: string
}

export interface EventDetail {
  cause: string
  process: string
  relatedForeshadowing: string
  relatedConflicts: string
  followUpItems: string
}

export interface ChapterSnapshot {
  chapterId: string
  chapterNumber: number
  chapterTitle?: string
  summary: string
  characters: string[]
  characterAliases?: Record<string, string[]>
  locations: string[]
  organizations: string[]
  items: string[]
  events: string[]
  characterStateChanges: string[]
  relationshipChanges: string[]
  knowledgeChanges: string[]
  foreshadowingChanges: string[]
  newCanonFacts: string[]
  timelineEvents: string[]
  conflicts: string[]
  endingHook: string
  graphNodes: string[]
  graphEdges: string[]
  sourceType?: "chapter" | "outline"
  sourceSequence?: number
  revision?: number
  snapshotId?: string
  supersedes?: string
  isHistorical?: boolean
  entityIsNew?: Record<string, boolean>
  validationWarnings?: ValidationWarning[]
  memorySyncedAt?: string
  characterDetails?: Record<string, CharacterDetail>
  locationDetails?: Record<string, LocationDetail>
  organizationDetails?: Record<string, OrganizationDetail>
  itemDetails?: Record<string, ItemDetail>
  eventDetails?: Record<string, EventDetail>
}

function normalizeSnapshotText(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return ""
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const parsed = parseChapterNumber(value)
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

function normalizeSnapshotList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeSnapshotText(item).trim())
      .filter(Boolean)
  }

  const single = normalizeSnapshotText(value).trim()
  return single ? [single] : []
}

function normalizeSnapshotAliasRecord(value: unknown): Record<string, string[]> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined

  const aliases = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([name, rawAliases]) => [name.trim(), normalizeSnapshotList(rawAliases)] as const)
      .filter(([name, names]) => name.length > 0 && names.length > 0),
  )

  return Object.keys(aliases).length > 0 ? aliases : undefined
}

function normalizeEntityFlags(value: unknown): Record<string, boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key.trim().length > 0)
      .map(([key, flag]) => [key, Boolean(flag)]),
  )
}

function normalizeValidationWarnings(value: unknown): ValidationWarning[] | undefined {
  if (!Array.isArray(value)) return undefined
  const warnings = value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const rawType = (item as { type?: unknown }).type
    const message = normalizeSnapshotText((item as { message?: unknown }).message).trim()
    if (!message) return []
    if (rawType === "entity_new" || rawType === "canon_conflict") {
      return [{ type: rawType as ValidationWarning["type"], message }]
    }
    return []
  })
  return warnings.length > 0 ? warnings : undefined
}

function normalizeSnapshotDetailRecord<T extends object>(value: unknown): Record<string, T> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, T>
}

function normalizeChapterSnapshot(
  value: unknown,
  fallback: Partial<Pick<ChapterSnapshot, "chapterId" | "chapterNumber">> = {},
): ChapterSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null

  const raw = value as Record<string, unknown>
  const chapterNumber = parseChapterNumber(raw.chapterNumber) ?? fallback.chapterNumber ?? 0
  const normalizedChapterId = normalizeSnapshotText(raw.chapterId).trim()
  const chapterId = normalizedChapterId || fallback.chapterId || `chapter-${chapterNumber}`

  return {
    chapterId,
    chapterNumber,
    chapterTitle: normalizeSnapshotText(raw.chapterTitle) || undefined,
    summary: normalizeSnapshotText(raw.summary),
    characters: normalizeSnapshotList(raw.characters),
    characterAliases: normalizeSnapshotAliasRecord(raw.characterAliases),
    locations: normalizeSnapshotList(raw.locations),
    organizations: normalizeSnapshotList(raw.organizations),
    items: normalizeSnapshotList(raw.items),
    events: normalizeSnapshotList(raw.events),
    characterStateChanges: normalizeSnapshotList(raw.characterStateChanges),
    relationshipChanges: normalizeSnapshotList(raw.relationshipChanges),
    knowledgeChanges: normalizeSnapshotList(raw.knowledgeChanges),
    foreshadowingChanges: normalizeSnapshotList(raw.foreshadowingChanges),
    newCanonFacts: normalizeSnapshotList(raw.newCanonFacts),
    timelineEvents: normalizeSnapshotList(raw.timelineEvents),
    conflicts: normalizeSnapshotList(raw.conflicts),
    endingHook: normalizeSnapshotText(raw.endingHook),
    graphNodes: normalizeSnapshotList(raw.graphNodes),
    graphEdges: normalizeSnapshotList(raw.graphEdges),
    sourceType: raw.sourceType === "chapter" || raw.sourceType === "outline" ? raw.sourceType : undefined,
    sourceSequence: normalizePositiveInteger(raw.sourceSequence),
    revision: normalizePositiveInteger(raw.revision),
    snapshotId: normalizeSnapshotText(raw.snapshotId) || undefined,
    supersedes: normalizeSnapshotText(raw.supersedes) || undefined,
    isHistorical: typeof raw.isHistorical === "boolean" ? raw.isHistorical : undefined,
    entityIsNew: normalizeEntityFlags(raw.entityIsNew),
    validationWarnings: normalizeValidationWarnings(raw.validationWarnings),
    memorySyncedAt: normalizeSnapshotText(raw.memorySyncedAt) || undefined,
    characterDetails: normalizeSnapshotDetailRecord<CharacterDetail>(raw.characterDetails),
    locationDetails: normalizeSnapshotDetailRecord<LocationDetail>(raw.locationDetails),
    organizationDetails: normalizeSnapshotDetailRecord<OrganizationDetail>(raw.organizationDetails),
    itemDetails: normalizeSnapshotDetailRecord<ItemDetail>(raw.itemDetails),
    eventDetails: normalizeSnapshotDetailRecord<EventDetail>(raw.eventDetails),
  }
}

function inferSnapshotSourceType(snapshot: Pick<ChapterSnapshot, "chapterNumber">): "chapter" | "outline" {
  return snapshot.chapterNumber < 0 ? "outline" : "chapter"
}

function inferSnapshotSourceSequence(snapshot: Pick<ChapterSnapshot, "chapterNumber">): number {
  return Math.abs(snapshot.chapterNumber)
}

function buildSnapshotRevisionId(snapshot: Pick<ChapterSnapshot, "chapterId">, revision: number): string {
  return `${snapshot.chapterId}-r${revision}`
}

function ensureSnapshotIdentity(
  snapshot: ChapterSnapshot,
  overrides: Partial<Pick<ChapterSnapshot, "sourceType" | "sourceSequence" | "revision" | "snapshotId" | "supersedes" | "isHistorical">> = {},
): ChapterSnapshot {
  const sourceType = overrides.sourceType ?? snapshot.sourceType ?? inferSnapshotSourceType(snapshot)
  const sourceSequence = overrides.sourceSequence ?? snapshot.sourceSequence ?? inferSnapshotSourceSequence(snapshot)
  const revision = overrides.revision ?? snapshot.revision ?? 1
  const snapshotId = overrides.snapshotId ?? snapshot.snapshotId ?? buildSnapshotRevisionId(snapshot, revision)

  return {
    ...snapshot,
    sourceType,
    sourceSequence,
    revision,
    snapshotId,
    supersedes: overrides.supersedes ?? snapshot.supersedes,
    isHistorical: overrides.isHistorical ?? snapshot.isHistorical ?? false,
  }
}

async function readCurrentSnapshot(projectPath: string, chapterNumber: number): Promise<ChapterSnapshot | null> {
  try {
    const raw = await readFile(snapshotJsonPath(projectPath, chapterNumber))
    const parsed = normalizeChapterSnapshot(JSON.parse(raw), {
      chapterId: `chapter-${chapterNumber}`,
      chapterNumber,
    })
    return parsed ? ensureSnapshotIdentity(parsed) : null
  } catch {
    return null
  }
}

function materializeNextCurrentSnapshot(snapshot: ChapterSnapshot, currentSnapshot: ChapterSnapshot | null): ChapterSnapshot {
  const existing = currentSnapshot ? ensureSnapshotIdentity(currentSnapshot) : null
  const nextRevisionBase = Math.max(existing?.revision ?? 0, snapshot.revision ?? 0)
  const nextRevision = nextRevisionBase > 0 ? nextRevisionBase + 1 : 1
  return ensureSnapshotIdentity(snapshot, {
    sourceType: snapshot.sourceType ?? existing?.sourceType ?? inferSnapshotSourceType(snapshot),
    sourceSequence: snapshot.sourceSequence ?? existing?.sourceSequence ?? inferSnapshotSourceSequence(snapshot),
    revision: nextRevision,
    snapshotId: buildSnapshotRevisionId(snapshot, nextRevision),
    supersedes: existing?.snapshotId ?? snapshot.snapshotId,
    isHistorical: false,
  })
}

function materializeRestoredCurrentSnapshot(
  archivedSnapshot: ChapterSnapshot,
  currentSnapshot: ChapterSnapshot | null,
): ChapterSnapshot {
  const archived = ensureSnapshotIdentity(archivedSnapshot, { isHistorical: true })
  const current = currentSnapshot ? ensureSnapshotIdentity(currentSnapshot) : null
  const nextRevision = Math.max(archived.revision ?? 1, current?.revision ?? 0) + 1
  return ensureSnapshotIdentity(archived, {
    revision: nextRevision,
    snapshotId: buildSnapshotRevisionId(archived, nextRevision),
    supersedes: current?.snapshotId ?? archived.snapshotId,
    isHistorical: false,
  })
}

type IngestFailReason = "no_llm" | "not_chapter" | "not_final" | "invalid_chapter_number" | "extract_failed" | "cancelled"

interface IngestResult {
  snapshot: ChapterSnapshot | null
  failReason?: IngestFailReason
  error?: string
}

interface IngestChapterOptions {
  allowDraft?: boolean
}

export async function ingestChapter(
  projectPath: string,
  chapterPath: string,
  _reviewModel?: string,
  signal?: AbortSignal,
  chapterNumberOverride?: number,
  options: IngestChapterOptions = {},
): Promise<IngestResult> {
  const pp = normalizePath(projectPath)
  const state = useWikiStore.getState()
  if (!state.novelMode) return { snapshot: null }

  const llmConfig = state.llmConfig
  const novelConfig = state.novelConfig
  // 使用 resolveNovelModel 正确解析提取模型（含供应商配置切换）
  const runtimeLlmConfig = resolveNovelModel(llmConfig, novelConfig, "extract")
  const startedAt = Date.now()
  let resolvedChapterNumber = chapterNumberOverride
  const logFail = async (failReason: IngestFailReason, error?: string) => {
    const message = error ?? failReason
    console.error(`[Chapter Ingest] ${failReason}:`, message)
    await appendChapterIngestLog(pp, {
      event: "fail",
      chapterNumber: resolvedChapterNumber,
      chapterPath,
      failReason,
      error: message,
      model: runtimeLlmConfig.model,
      provider: runtimeLlmConfig.provider,
      elapsedMs: Date.now() - startedAt,
    })
    return { snapshot: null, failReason, error: message } satisfies IngestResult
  }

  if (!hasUsableLlm(runtimeLlmConfig, state.providerConfigs)) {
    return logFail("no_llm", "提取模型不可用")
  }

  const content = await readFile(chapterPath)
  const parsed = parseFrontmatter(content)
  const fm = parsed.frontmatter as Record<string, unknown> | null
  if (!fm || !isChapterPage(fm)) return logFail("not_chapter", "不是章节页")
  if (!options.allowDraft && !isFinalChapter(fm)) {
    console.warn(`[Chapter Ingest] Chapter status is not final, skipping ingest.`)
    return logFail("not_final", "章节不是正式稿")
  }

  const chapterNumber = chapterNumberOverride ?? parseChapterNumber(fm.chapter_number) ?? 0
  resolvedChapterNumber = chapterNumber
  if (chapterNumber <= 0) {
    console.warn("[Chapter Ingest] Invalid chapter number, skipping ingest.")
    return logFail("invalid_chapter_number", "章节号无效")
  }
  const body = parsed.body

  if (signal?.aborted) return logFail("cancelled", "已取消")
  await appendChapterIngestLog(pp, {
    event: "start",
    chapterNumber,
    chapterPath,
    model: runtimeLlmConfig.model,
    provider: runtimeLlmConfig.provider,
  })
  const existingSnapshotPromise = readCurrentSnapshot(pp, chapterNumber)
  let extractedSnapshot: ChapterSnapshot | null
  try {
    extractedSnapshot = await extractSnapshotWithLLM(chapterNumber, body, runtimeLlmConfig, signal)
  } catch (err) {
    return logFail("extract_failed", err instanceof Error ? err.message : String(err))
  }
  const snapshot = extractedSnapshot ? canonicalizeSnapshotCharacters(extractedSnapshot) : null

  if (!snapshot) {
    return logFail("extract_failed", "模型没有返回快照")
  }

  const existingSnapshot = await existingSnapshotPromise
  const isReingest = existingSnapshot != null

  try {
    const [entityWarnings, canonWarnings] = await Promise.all([
      validateEntityReferences(pp, snapshot),
      validateCanonConflicts(pp, snapshot),
    ])
    snapshot.validationWarnings = [...entityWarnings, ...canonWarnings]
    snapshot.entityIsNew = snapshot.entityIsNew || {}
  } catch (err) {
    console.warn("[Chapter Ingest] Validation failed:", err instanceof Error ? err.message : err)
    snapshot.validationWarnings = []
    snapshot.entityIsNew = {}
  }

  await saveChapterIngestOutput(pp, snapshot, {
    title: typeof fm.title === "string" ? fm.title : undefined,
  })

  const embedPromise = (async () => {
    const embCfg = useWikiStore.getState().embeddingConfig
    if (!embCfg.enabled || !embCfg.model) return
    try {
      const { embedPage } = await import("@/lib/embedding")
      const pageId = chapterPath.split(/[/\\]/).pop()?.replace(/\.md$/, "") ?? ""
      if (!pageId) return
      const title = typeof fm?.title === "string" ? fm.title : pageId
      await embedPage(pp, pageId, title, content, embCfg)
    } catch {
      console.warn("[Chapter Ingest] Embedding update failed, skipping")
    }
  })()

  const syncResult = await syncSnapshotToMemory(pp, snapshot, isReingest ? REINGEST_SYNC_OPTIONS : undefined)

  try {
    const patchPath = `${pp}/.novel/chapter-ingest-output/${String(snapshot.chapterNumber).padStart(3, "0")}.wiki-patch.json`
    const patchJson = await readFile(patchPath)
    const patch = JSON.parse(patchJson)
    const patchPaths = await writePatchFieldsToWiki(pp, patch)
    if (patchPaths.length > 0) {
      console.log(`[Chapter Ingest] Wrote ${patchPaths.length} entity pages from wiki patch fields`)
    }
  } catch (err) {
    console.warn("[Chapter Ingest] Wiki patch fields write failed:", err instanceof Error ? err.message : err)
  }

  if (isReingest) {
    await finalizeProjectMemoryRebuild(pp)
  }

  await embedPromise

  // 重新提取只替换本章快照，不必顺带打一次社区摘要（那是另一次 LLM）。
  if (!isReingest && shouldRebuildCommunitySummaries(snapshot.chapterNumber, novelConfig)) {
    const rebuildCommunitySummaries = async () => {
      try {
        await generateCommunitySummaries(pp, llmConfig, novelConfig, signal)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn("[Chapter Ingest] 社区摘要生成失败:", message)
        // 弹窗提示（通过 store 触发 UI 通知）
        useWikiStore.getState().setCommunitySummaryError(message)
      }
    }

    if (novelConfig.communitySummaryAsync) {
      // 后台异步执行，不阻塞章节摄取
      void rebuildCommunitySummaries()
    } else {
      // 同步等待
      await rebuildCommunitySummaries()
    }
  }

  if (snapshot) {
    try {
      const retrievalStore = createRetrievalStore(pp)
      const sourceHash = buildSourceHash(content)
      const relativePath = normalizePath(chapterPath).startsWith(normalizePath(pp) + "/")
        ? normalizePath(chapterPath).slice(normalizePath(pp).length + 1)
        : chapterPath
      await retrievalStore.updateChapterEntry(snapshot.chapterNumber, snapshot, {
        filePath: relativePath,
        sourceHash,
      }).catch((err) => {
        console.warn("[Chapter Ingest] Retrieval index update failed:", err)
      })
    } catch (err) {
      console.warn("[Chapter Ingest] Retrieval index update failed:", err instanceof Error ? err.message : err)
    }
  }

  // 章节写完后自动更新追踪文件
  if (snapshot) {
    try {
      const chapterTitle = snapshot.chapterTitle || (typeof fm?.title === "string" ? fm.title : `第${chapterNumber}章`)
      await updateTrackingAfterChapter(pp, chapterNumber, chapterTitle, body, snapshot.summary)
    } catch (err) {
      console.warn("[Chapter Ingest] 追踪文件更新失败:", err instanceof Error ? err.message : err)
    }
  }

  await appendChapterIngestLog(pp, {
    event: "ok",
    chapterNumber,
    chapterPath,
    model: runtimeLlmConfig.model,
    provider: runtimeLlmConfig.provider,
    elapsedMs: Date.now() - startedAt,
  })
  return { snapshot: { ...snapshot, memorySyncedAt: syncResult.memorySyncedAt } }
}

function createRetrievalStore(projectPath: string): RetrievalStore {
  const fsAdapter = {
    readFile,
    writeFile: writeFileAtomic,
    fileExists,
    listDirectory: async (path: string): Promise<string[]> => {
      const nodes = await listDirectory(path)
      return nodes.map((n: any) => n.name)
    },
    createDirectory,
    joinPath: (...parts: string[]) => parts.join("/"),
  }
  return new RetrievalStore(projectPath, fsAdapter as any)
}

export function buildSourceHash(content: string): string {
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return String(hash)
}

function normalizeOutlineIngestError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err)
  if (/request cancelled|aborted|cancelled/i.test(message)) {
    return new Error("大纲摄取已中断，请稍后重试")
  }
  return new Error(message)
}

export interface OutlineIngestResult {
  snapshot: ChapterSnapshot | null
  truncated: boolean
  originalLength: number
  bodyLength: number
  bodyBudget: number
  failureReason?: "no_llm" | null
}

interface IngestOutlineOptions {
  skipSync?: boolean
}

function buildOutlineIngestUserPrompt(body: string): string {
  return buildOutlineExtractUserPrompt(body)
}

async function extractSnapshotWithLLM(
  chapterNumber: number,
  chapterBody: string,
  llmConfig: LlmConfig,
  signal?: AbortSignal,
): Promise<ChapterSnapshot | null> {
  const outputLang = getOutputLanguage()
  const langReminder = buildLanguageReminder(outputLang)
  const systemPrompt = buildChapterExtractSystemPrompt(langReminder)
  const userPrompt = buildChapterExtractUserPrompt(chapterNumber, chapterBody)

  try {
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]

    let result = ""
    let streamError: Error | null = null
    const callbacks: StreamCallbacks = {
      onToken: (token: string) => {
        result += token
      },
      onDone: () => {},
      onError: (error: Error) => {
        streamError = error
      },
    }

    await streamChat(llmConfig, messages, callbacks, signal, {
      ...CHAPTER_EXTRACT_REQUEST_OVERRIDES,
      max_tokens: resolveChapterExtractMaxTokens(llmConfig.maxContextSize),
    })
    if (streamError) throw streamError
    if (!result.trim()) {
      throw new Error("章节快照提取失败：模型返回空内容（流结束但没有任何正文）")
    }

    const parsed = parseLlmJsonObject(result)
    if (!parsed) {
      throw new Error(
        `章节快照提取失败：模型没有返回可解析的 JSON（${result.trim().length} chars） ${previewLlmOutput(result, 400)}`,
      )
    }
    return normalizeChapterSnapshot({
      ...parsed,
      chapterId: parsed.chapterId || `chapter-${chapterNumber}`,
      chapterNumber: chapterNumber, // 强制使用代码传入的章节号，不信任LLM输出
      entityIsNew: {},
      validationWarnings: [],
      characterDetails: parsed.characterDetails || undefined,
      locationDetails: parsed.locationDetails || undefined,
      organizationDetails: parsed.organizationDetails || undefined,
      itemDetails: parsed.itemDetails || undefined,
      eventDetails: parsed.eventDetails || undefined,
    }, { chapterId: `chapter-${chapterNumber}`, chapterNumber })
  } catch (err) {
    console.error("[Chapter Ingest] Failed to extract snapshot:", err)
    throw err
  }
}

function snapshotToMarkdown(snapshot: ChapterSnapshot): string {
  const md = [
    `# 第${snapshot.chapterNumber}章 快照`,
    "",
    `## 摘要`,
    snapshot.summary,
    "",
    `## 出场人物`,
    ...(snapshot.characters.length > 0 ? snapshot.characters.map(c => `- ${c}`) : ["（无）"]),
    "",
    `## 出场地点`,
    ...(snapshot.locations.length > 0 ? snapshot.locations.map(l => `- ${l}`) : ["（无）"]),
    "",
    `## 出场组织`,
    ...(snapshot.organizations.length > 0 ? snapshot.organizations.map(o => `- ${o}`) : ["（无）"]),
    "",
    `## 出场物品`,
    ...(snapshot.items.length > 0 ? snapshot.items.map(i => `- ${i}`) : ["（无）"]),
    "",
    `## 关键事件`,
    ...(snapshot.events.length > 0 ? snapshot.events.map(e => `- ${e}`) : ["（无）"]),
    "",
    `## 人物状态变化`,
    ...(snapshot.characterStateChanges.length > 0 ? snapshot.characterStateChanges.map(c => `- ${c}`) : ["（无）"]),
    "",
    `## 人物关系变化`,
    ...(snapshot.relationshipChanges.length > 0 ? snapshot.relationshipChanges.map(r => `- ${r}`) : ["（无）"]),
    "",
    `## 角色认知变化`,
    ...(snapshot.knowledgeChanges.length > 0 ? snapshot.knowledgeChanges.map(k => `- ${k}`) : ["（无）"]),
    "",
    `## 伏笔变化`,
    ...(snapshot.foreshadowingChanges.length > 0 ? snapshot.foreshadowingChanges.map(f => `- ${f}`) : ["（无）"]),
    "",
    `## 新增正史设定`,
    ...(snapshot.newCanonFacts.length > 0 ? snapshot.newCanonFacts.map(c => `- ${c}`) : ["（无）"]),
    "",
    `## 时间线事件`,
    ...(snapshot.timelineEvents.length > 0 ? snapshot.timelineEvents.map(t => `- ${t}`) : ["（无）"]),
    "",
    `## 冲突变化`,
    ...(snapshot.conflicts.length > 0 ? snapshot.conflicts.map(c => `- ${c}`) : ["（无）"]),
    "",
    `## 结尾钩子`,
    snapshot.endingHook || "（无）",
    "",
    `## 图谱节点`,
    ...(snapshot.graphNodes.length > 0 ? snapshot.graphNodes.map(g => `- ${g}`) : ["（无）"]),
    "",
    `## 图谱关系边`,
    ...(snapshot.graphEdges.length > 0 ? snapshot.graphEdges.map(g => `- ${g}`) : ["（无）"]),
  ]

  if (snapshot.validationWarnings && snapshot.validationWarnings.length > 0) {
    md.push(
      "",
      `## 校验警告`,
      ...snapshot.validationWarnings.map(w => `- [${w.type}] ${w.message}`),
    )
  }

  return md.join("\n")
}

export interface SnapshotHistoryEntry {
  fileName: string
  path: string
  createdAt: string
}

function snapshotFilePrefix(chapterNumber: number): string {
  if (chapterNumber < 0) return `outline-${String(Math.abs(chapterNumber)).padStart(3, "0")}`
  return String(chapterNumber).padStart(3, "0")
}

function snapshotJsonPath(projectPath: string, chapterNumber: number): string {
  return `${projectPath}/.novel/snapshots/${snapshotFilePrefix(chapterNumber)}.snapshot.json`
}

function snapshotMarkdownPath(projectPath: string, chapterNumber: number): string {
  return `${projectPath}/.novel/snapshots/${snapshotFilePrefix(chapterNumber)}.snapshot.md`
}

function snapshotHistoryDir(projectPath: string, chapterNumber: number): string {
  return `${projectPath}/.novel/snapshots/history/${snapshotFilePrefix(chapterNumber)}`
}

function snapshotHistoryFileName(): string {
  return `${new Date().toISOString().replace(/:/g, "-")}.snapshot.json`
}

async function backupSnapshotBeforeOverwrite(projectPath: string, chapterNumber: number): Promise<void> {
  const currentJsonPath = snapshotJsonPath(projectPath, chapterNumber)
  if (!(await fileExists(currentJsonPath))) return
  const currentRaw = await readFile(currentJsonPath)
  const normalizedCurrent = normalizeChapterSnapshot(JSON.parse(currentRaw), {
    chapterId: `chapter-${chapterNumber}`,
    chapterNumber,
  })
  const currentJson = normalizedCurrent
    ? JSON.stringify(ensureSnapshotIdentity(normalizedCurrent, { isHistorical: true }), null, 2)
    : currentRaw
  const historyDir = snapshotHistoryDir(projectPath, chapterNumber)
  await createDirectory(historyDir)
  await writeFileAtomic(`${historyDir}/${snapshotHistoryFileName()}`, currentJson)
}

export async function listSnapshotHistory(projectPath: string, chapterNumber: number): Promise<SnapshotHistoryEntry[]> {
  const pp = normalizePath(projectPath)
  const historyDir = snapshotHistoryDir(pp, chapterNumber)
  try {
    const nodes = await listDirectory(historyDir)
    return nodes
      .filter(node => !node.is_dir && node.name.endsWith(".snapshot.json"))
      .map(node => ({
        fileName: node.name,
        path: node.path,
        createdAt: node.name.replace(/\.snapshot\.json$/, "").replace(/-(\d{2})-(\d{2})-(\d{2})\.(\d{3})Z$/, ":$1:$2.$3Z"),
      }))
      .sort((a, b) => b.fileName.localeCompare(a.fileName))
  } catch {
    return []
  }
}

export async function restoreSnapshotHistory(
  projectPath: string,
  chapterNumber: number,
  historyFileName: string,
): Promise<ChapterSnapshot> {
  const pp = normalizePath(projectPath)
  const currentSnapshot = await readCurrentSnapshot(pp, chapterNumber)
  await backupSnapshotBeforeOverwrite(pp, chapterNumber)
  const historyPath = `${snapshotHistoryDir(pp, chapterNumber)}/${historyFileName}`
  const snapshot = normalizeChapterSnapshot(
    JSON.parse(await readFile(historyPath)),
    { chapterId: `chapter-${chapterNumber}`, chapterNumber },
  )
  if (!snapshot) {
    throw new Error("Invalid snapshot history file.")
  }
  const restoredCurrent = materializeRestoredCurrentSnapshot(snapshot, currentSnapshot)
  await saveSnapshot(pp, restoredCurrent)
  const writtenEntityPaths = await writeSnapshotToWiki(pp, restoredCurrent)
  await cleanupSupersededEntityFiles(pp, restoredCurrent, writtenEntityPaths)
  await rebuildDerivedMemoryFromSnapshots(pp, restoredCurrent)
  clearGraphCache()
  useWikiStore.getState().bumpDataVersion()
  return restoredCurrent
}

async function listActualChapterNumbers(projectPath: string): Promise<number[]> {
  const pp = normalizePath(projectPath)
  const chaptersDir = `${pp}/wiki/chapters`
  try {
    const nodes = await listDirectory(chaptersDir)
    const chapterNumbers = await Promise.all(
      nodes
        .filter((node) => !node.is_dir && node.name.endsWith(".md"))
        .map(async (node) => {
          try {
            const parsed = parseFrontmatter(await readFile(node.path))
            const frontmatter = parsed.frontmatter as Record<string, unknown> | null
            if (!frontmatter || !isChapterPage(frontmatter)) {
              return null
            }
            return parseChapterNumber(frontmatter.chapter_number)
          } catch {
            return null
          }
        }),
    )
    return chapterNumbers.filter((chapterNumber): chapterNumber is number => Number.isFinite(chapterNumber))
  } catch {
    return []
  }
}

async function loadValidMemorySnapshots(
  projectPath: string,
  latestSnapshot?: ChapterSnapshot,
): Promise<ChapterSnapshot[]> {
  const pp = normalizePath(projectPath)
  const actualChapterNumbers = await listActualChapterNumbers(pp)
  const snapshotNumbers = await listSnapshots(pp)
  const snapshotMap = new Map<number, ChapterSnapshot>()

  const loadedSnapshots = await Promise.all(snapshotNumbers.map((chapterNumber) => loadSnapshot(pp, chapterNumber)))
  for (const loadedSnapshot of loadedSnapshots) {
    if (isValidMemorySnapshot(loadedSnapshot, actualChapterNumbers)) {
      snapshotMap.set(loadedSnapshot.chapterNumber, loadedSnapshot)
    }
  }

  if (isValidMemorySnapshot(latestSnapshot ?? null, actualChapterNumbers)) {
    snapshotMap.set(latestSnapshot!.chapterNumber, latestSnapshot!)
  }

  return [...snapshotMap.values()].sort((a, b) => a.chapterNumber - b.chapterNumber)
}

export async function exportStructuredMemoryToWiki(projectPath: string, snapshot: ChapterSnapshot): Promise<string[]> {
  const pp = normalizePath(projectPath)
  const snapshots = await loadValidMemorySnapshots(pp, snapshot)
  if (snapshots.length === 0) {
    return []
  }
  return writeStructuredMemoryDocuments(pp, snapshots)
}

async function writeStructuredMemoryDocuments(projectPath: string, snapshots: ChapterSnapshot[]): Promise<string[]> {
  const pp = normalizePath(projectPath)
  const memoryDir = `${pp}/wiki/memory`
  const memoryDocuments = buildStructuredMemoryDocuments(snapshots)

  await createDirectory(memoryDir)
  const writtenPaths: string[] = []
  for (const [fileName, content] of Object.entries(memoryDocuments)) {
    const filePath = `${memoryDir}/${fileName}`
    await writeFileAtomic(filePath, content)
    writtenPaths.push(filePath)
  }
  return writtenPaths
}

interface SyncSnapshotToMemoryResult {
  writtenEntityPaths: string[]
  memoryPagePaths: string[]
  memorySyncedAt: string
}

interface SyncSnapshotToMemoryOptions {
  deferStructuredMemoryExport?: boolean
  deferDerivedRebuild?: boolean
  /** 跳过认知/人物/伏笔的增量合并。重新提取时应随后全量重建派生记忆。 */
  skipDerivedIncremental?: boolean
}

const REINGEST_SYNC_OPTIONS: SyncSnapshotToMemoryOptions = {
  skipDerivedIncremental: true,
  deferStructuredMemoryExport: true,
  deferDerivedRebuild: true,
}

export async function syncSnapshotToMemory(
  projectPath: string,
  snapshot: ChapterSnapshot,
  options?: SyncSnapshotToMemoryOptions,
): Promise<SyncSnapshotToMemoryResult> {
  const pp = normalizePath(projectPath)
  const currentSnapshot = await readCurrentSnapshot(pp, snapshot.chapterNumber)
  const memorySyncedAt = new Date().toISOString()
  const normalizedSnapshot = normalizeChapterSnapshot(
    { ...snapshot, memorySyncedAt },
    { chapterId: snapshot.chapterId, chapterNumber: snapshot.chapterNumber },
  )
  if (!normalizedSnapshot) {
    throw new Error("Invalid snapshot data.")
  }
  const syncedSnapshot = materializeNextCurrentSnapshot(normalizedSnapshot, currentSnapshot)

  // 获取同步前该快照关联的旧实体文件（用于清理）
  const entitiesDir = `${pp}/wiki/entities`
  let oldEntityFiles: string[] = []
  try {
    const tree = await listDirectory(entitiesDir)
    oldEntityFiles = tree.filter(f => f.name.endsWith(".md")).map(f => f.name)
  } catch { /* entities dir may not exist */ }

  const writtenEntityPaths = await writeSnapshotToWiki(pp, syncedSnapshot)
  await cleanupSupersededEntityFiles(pp, syncedSnapshot, writtenEntityPaths)

  // 清理旧实体：如果一个实体文件不在新写入列表中，且其内容引用了当前快照的 source，则删除
  const writtenFileNames = new Set(writtenEntityPaths.map(p => p.split("/").pop() ?? ""))
  const snapshotSourceFiles = new Set(snapshotSourceFileNameCandidates(syncedSnapshot.chapterNumber))

  for (const oldFile of oldEntityFiles) {
    if (writtenFileNames.has(oldFile)) continue // 仍然存在于新快照中，保留
    try {
      const filePath = `${entitiesDir}/${oldFile}`
      const content = await readFile(filePath)
      if (shouldDeleteSupersededProjectionContent(content, syncedSnapshot)) {
        await deleteFile(filePath)
        continue
      }
      // 只删除引用了当前快照 source 的实体文件
      if (Array.from(snapshotSourceFiles).some(sourceFile => content.includes(sourceFile))) {
        // 检查是否还被其他快照引用
        const allSources = content.match(/[A-Za-z0-9_-]+\.snapshot\.json/g) ?? []
        const onlyCurrentSource = allSources.length > 0 && allSources.every(s => snapshotSourceFiles.has(s))
        if (onlyCurrentSource) {
          await deleteFile(filePath)
        }
      }
    } catch { /* skip errors */ }
  }

  if (!options?.skipDerivedIncremental && syncedSnapshot.knowledgeChanges.length > 0) {
    const existing = await loadCognitionState(pp) ?? emptyCognitionState()
    const updated = mergeCognitionFromSnapshot(existing, syncedSnapshot)
    await saveCognitionState(pp, updated)
  }

  if (!options?.skipDerivedIncremental && syncedSnapshot.characterStateChanges.length > 0) {
    await syncCharacterStateChanges(pp, syncedSnapshot)
  }

  if (!options?.skipDerivedIncremental && syncedSnapshot.foreshadowingChanges.length > 0) {
    await syncForeshadowingChanges(pp, syncedSnapshot)
  }

  await backupSnapshotBeforeOverwrite(pp, syncedSnapshot.chapterNumber)
  await saveSnapshot(pp, syncedSnapshot)
  const memoryPagePaths = options?.deferStructuredMemoryExport
    ? []
    : await exportStructuredMemoryToWiki(pp, syncedSnapshot)
  if (!options?.deferDerivedRebuild) {
    clearGraphCache()
    useWikiStore.getState().bumpDataVersion()
  }

  return { writtenEntityPaths, memoryPagePaths, memorySyncedAt }
}

function snapshotSourceFileNameCandidates(chapterNumber: number): string[] {
  const canonical = chapterNumber < 0
    ? `outline-${String(Math.abs(chapterNumber)).padStart(3, "0")}.snapshot.json`
    : `${String(chapterNumber).padStart(3, "0")}.snapshot.json`
  const legacy = `${String(chapterNumber).padStart(3, "0")}.snapshot.json`
  return Array.from(new Set([canonical, legacy]))
}

function extractFrontmatterString(content: string, key: string): string | null {
  const match = content.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, "m"))
  return match?.[1]?.trim() || null
}

function extractFrontmatterNumber(content: string, key: string): number | null {
  const value = extractFrontmatterString(content, key)
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function shouldDeleteSupersededProjectionContent(content: string, snapshot: ChapterSnapshot): boolean {
  const currentSnapshot = ensureSnapshotIdentity(snapshot)
  const snapshotId = extractFrontmatterString(content, "snapshot_id")
  if (snapshotId && currentSnapshot.supersedes && snapshotId === currentSnapshot.supersedes) {
    return true
  }

  const sourceType = extractFrontmatterString(content, "source_type")
  const sourceSequence = extractFrontmatterNumber(content, "source_sequence")
  const sourceRevision = extractFrontmatterNumber(content, "source_revision")
  if (
    sourceType
    && sourceSequence
    && sourceRevision
    && sourceType === currentSnapshot.sourceType
    && sourceSequence === currentSnapshot.sourceSequence
    && sourceRevision < (currentSnapshot.revision ?? 1)
  ) {
    return true
  }

  return false
}

async function cleanupSupersededEntityFiles(
  projectPath: string,
  snapshot: ChapterSnapshot,
  writtenEntityPaths: string[],
): Promise<void> {
  const entitiesDir = `${projectPath}/wiki/entities`
  const writtenFileNames = new Set(writtenEntityPaths.map((path) => path.split("/").pop() ?? ""))
  const snapshotSourceFiles = new Set(snapshotSourceFileNameCandidates(snapshot.chapterNumber))

  let oldEntityFiles: string[] = []
  try {
    const tree = await listDirectory(entitiesDir)
    oldEntityFiles = tree.filter((file) => file.name.endsWith(".md")).map((file) => file.name)
  } catch {
    return
  }

  for (const oldFile of oldEntityFiles) {
    if (writtenFileNames.has(oldFile)) continue
    try {
      const filePath = `${entitiesDir}/${oldFile}`
      const content = await readFile(filePath)
      if (shouldDeleteSupersededProjectionContent(content, snapshot)) {
        await deleteFile(filePath)
        continue
      }
      if (Array.from(snapshotSourceFiles).some((sourceFile) => content.includes(sourceFile))) {
        const allSources = content.match(/[A-Za-z0-9_-]+\.snapshot\.json/g) ?? []
        const onlyCurrentSource = allSources.length > 0 && allSources.every((sourceFile) => snapshotSourceFiles.has(sourceFile))
        if (onlyCurrentSource) {
          await deleteFile(filePath)
        }
      }
    } catch {
      // ignore cleanup failures per file
    }
  }
}

function applyCharacterStateChangesToStore(existingChars: CharacterStateStore, snapshot: ChapterSnapshot): CharacterStateStore {
  for (const change of snapshot.characterStateChanges) {
    const colonIdx = change.indexOf(":") >= 0 ? change.indexOf(":") : change.indexOf("：")
    if (colonIdx > 0) {
      const charName = change.slice(0, colonIdx).trim()
      const changeDesc = change.slice(colonIdx + 1).trim()
      const existing = existingChars.characters.find(c => c.characterName === charName)
      if (existing) {
        existing.status = changeDesc
        existing.lastUpdatedChapter = snapshot.chapterNumber
        existing.lastUpdatedAt = new Date().toISOString()
      } else {
        existingChars.characters.push({
          characterName: charName,
          currentLocation: "",
          status: changeDesc,
          equipment: [],
          abilities: [],
          relationships: {},
          lastUpdatedChapter: snapshot.chapterNumber,
          lastUpdatedAt: new Date().toISOString(),
        })
      }
    } else {
      const matched = existingChars.characters.find(c => change.includes(c.characterName))
      if (matched) {
        matched.status = change
        matched.lastUpdatedChapter = snapshot.chapterNumber
        matched.lastUpdatedAt = new Date().toISOString()
      }
    }
  }
  existingChars.lastUpdated = new Date().toISOString()
  return existingChars
}

async function syncCharacterStateChanges(projectPath: string, snapshot: ChapterSnapshot): Promise<void> {
  const existingChars = await loadCharacterStates(projectPath)
  applyCharacterStateChangesToStore(existingChars, snapshot)
  await saveCharacterStates(projectPath, existingChars)
}

export function applyForeshadowingChangesToStore(
  existingForeshadows: ForeshadowingStore,
  snapshot: ChapterSnapshot,
): ForeshadowingStore {
  for (const change of snapshot.foreshadowingChanges) {
    const parsed = parseForeshadowingChange(change)
    if (!parsed) continue

    const matched = findForeshadowingByNormalizedName(existingForeshadows.items, parsed.name)

    if (parsed.kind === "plant") {
      if (matched) {
        // Same normalized name already exists → treat as advance (ingest-side dedup)
        if (matched.status !== "resolved" && matched.status !== "abandoned") {
          matched.status = "advanced"
        }
        if (!matched.advancedChapters.includes(snapshot.chapterNumber)) {
          matched.advancedChapters.push(snapshot.chapterNumber)
        }
        if (parsed.description && parsed.description.length > (matched.description?.length ?? 0)) {
          matched.description = parsed.description
        }
        continue
      }
      const newForeshadow: Foreshadowing = {
        id: generateForeshadowingId(existingForeshadows),
        name: parsed.name,
        description: parsed.description,
        status: "planted",
        plantedChapter: snapshot.chapterNumber,
        advancedChapters: [],
        relatedCharacters: [],
        relatedEvents: [],
        notes: "",
      }
      existingForeshadows.items.push(newForeshadow)
      continue
    }

    if (parsed.kind === "advance") {
      if (matched) {
        if (matched.status !== "resolved" && matched.status !== "abandoned") {
          matched.status = "advanced"
        }
        if (!matched.advancedChapters.includes(snapshot.chapterNumber)) {
          matched.advancedChapters.push(snapshot.chapterNumber)
        }
        if (parsed.description && parsed.description.length > (matched.description?.length ?? 0)) {
          matched.description = parsed.description
        }
      }
      continue
    }

    // resolve — if no match, still record as resolved (same as memory-rebuild:
    // resolve lines often use different wording than the original plant)
    if (matched) {
      matched.status = "resolved"
      matched.resolvedChapter = snapshot.chapterNumber
      if (parsed.description && parsed.description.length > (matched.description?.length ?? 0)) {
        matched.description = parsed.description
      }
    } else {
      existingForeshadows.items.push({
        id: generateForeshadowingId(existingForeshadows),
        name: parsed.name,
        description: parsed.description,
        status: "resolved",
        plantedChapter: snapshot.chapterNumber,
        advancedChapters: [],
        resolvedChapter: snapshot.chapterNumber,
        relatedCharacters: [],
        relatedEvents: [],
        notes: "",
      })
    }
  }
  existingForeshadows.lastUpdated = new Date().toISOString()
  return existingForeshadows
}

async function syncForeshadowingChanges(projectPath: string, snapshot: ChapterSnapshot): Promise<void> {
  const existingForeshadows = await loadForeshadowingTracker(projectPath)
  applyForeshadowingChangesToStore(existingForeshadows, snapshot)
  await saveForeshadowingTracker(projectPath, existingForeshadows)
}

export async function rebuildDerivedMemoryFromSnapshots(projectPath: string, latestSnapshot?: ChapterSnapshot): Promise<void> {
  const snapshots = await loadValidMemorySnapshots(projectPath, latestSnapshot)

  const cognitionState = snapshots.reduce(
    (state, snapshot) => mergeCognitionFromSnapshot(state, snapshot),
    emptyCognitionState(),
  )
  await saveCognitionState(projectPath, cognitionState)

  const characterStateStore = createEmptyCharacterStateStore()
  for (const snapshot of snapshots) {
    applyCharacterStateChangesToStore(characterStateStore, snapshot)
  }
  await saveCharacterStates(projectPath, characterStateStore)

  const foreshadowingStore = createEmptyForeshadowingStore()
  for (const snapshot of snapshots) {
    applyForeshadowingChangesToStore(foreshadowingStore, snapshot)
  }
  await saveForeshadowingTracker(projectPath, foreshadowingStore)
  await rebuildTimelineFromSnapshots(projectPath, snapshots)

  await writeStructuredMemoryDocuments(projectPath, snapshots)
}

export async function finalizeProjectMemoryRebuild(projectPath: string): Promise<void> {
  const pp = normalizePath(projectPath)
  await rebuildDerivedMemoryFromSnapshots(pp)
  clearGraphCache()
  useWikiStore.getState().bumpDataVersion()
}

async function saveSnapshot(projectPath: string, snapshot: ChapterSnapshot): Promise<void> {
  const canonicalSnapshot = ensureSnapshotIdentity(canonicalizeSnapshotCharacters(snapshot))
  const normalizedSnapshot = normalizeChapterSnapshot(canonicalSnapshot, {
    chapterId: snapshot.chapterId,
    chapterNumber: snapshot.chapterNumber,
  })
  if (!normalizedSnapshot) {
    throw new Error("Invalid snapshot data.")
  }
  const snapshotDir = `${projectPath}/.novel/snapshots`
  const jsonPath = snapshotJsonPath(projectPath, normalizedSnapshot.chapterNumber)
  const mdPath = snapshotMarkdownPath(projectPath, normalizedSnapshot.chapterNumber)

  await createDirectory(snapshotDir)
  await writeFileAtomic(jsonPath, JSON.stringify(normalizedSnapshot, null, 2))
  await writeFileAtomic(mdPath, snapshotToMarkdown(normalizedSnapshot))

  await mergeSnapshotTimeline(projectPath, normalizedSnapshot.chapterNumber, normalizedSnapshot.timelineEvents)
}

async function saveChapterIngestOutput(projectPath: string, snapshot: ChapterSnapshot, options: { title?: string } = {}): Promise<ChapterIngestOutput> {
  const output = buildChapterIngestOutput(snapshot, options)
  const outputDir = `${projectPath}/.novel/chapter-ingest-output`
  const prefix = `${outputDir}/${String(snapshot.chapterNumber).padStart(3, "0")}`

  await createDirectory(outputDir)
  await writeFileAtomic(`${prefix}.output.json`, JSON.stringify(output, null, 2))
  await writeFileAtomic(`${prefix}.wiki-patch.json`, JSON.stringify(output.wikiUpdatePatch, null, 2))
  await writeFileAtomic(`${prefix}.search-index.json`, JSON.stringify(output.searchIndexText, null, 2))
  await writeFileAtomic(`${prefix}.vector-index.json`, JSON.stringify(output.vectorIndexText, null, 2))

  return output
}

async function validateEntityReferences(
  projectPath: string,
  snapshot: ChapterSnapshot,
): Promise<ValidationWarning[]> {
  const warnings: ValidationWarning[] = []
  const entitiesDir = `${projectPath}/wiki/entities`

  const categories = [
    { key: "characters" as const, label: "人物" },
    { key: "locations" as const, label: "地点" },
    { key: "organizations" as const, label: "组织" },
    { key: "items" as const, label: "物品" },
  ]

  if (!snapshot.entityIsNew) {
    snapshot.entityIsNew = {}
  }

  const checks = categories.flatMap(({ key, label }) =>
    snapshot[key].map(async (name) => {
      try {
        const exists = await fileExists(`${entitiesDir}/${name}.md`)
        return { name, exists, label }
      } catch {
        return { name, exists: false, label }
      }
    }),
  )
  const results = await Promise.all(checks)
  for (const { name, exists, label } of results) {
    snapshot.entityIsNew[name] = !exists
    if (!exists) {
      warnings.push({
        type: "entity_new",
        message: `新${label}: ${name}`,
      })
    }
  }

  return warnings
}

async function validateCanonConflicts(
  projectPath: string,
  snapshot: ChapterSnapshot,
): Promise<ValidationWarning[]> {
  const warnings: ValidationWarning[] = []

  try {
    const canonPath = `${projectPath}/wiki/canon.md`
    try {
      await readFile(canonPath)
    } catch {
      return warnings
    }

    const conflictPatterns: [RegExp, string][] = [
      [/推翻|打破|改写了|不再是/, "设定推翻"],
      [/之前.+错误|误解|记错|搞错/, "历史修正"],
      [/实际上.+不是|真相是|真正.*是/, "真相揭示"],
    ]

    for (const event of snapshot.events) {
      for (const [regex, label] of conflictPatterns) {
        if (regex.test(event)) {
          warnings.push({
            type: "canon_conflict",
            message: `${label}: "${event}" 可能与正史规则存在潜在冲突`,
          })
          break
        }
      }
    }
  } catch {
    // 校验失败不影响主流程
  }

  return warnings
}

export async function loadSnapshot(
  projectPath: string,
  chapterNumber: number,
): Promise<ChapterSnapshot | null> {
  const pp = normalizePath(projectPath)
  const prefix = chapterNumber < 0
    ? `outline-${String(Math.abs(chapterNumber)).padStart(3, "0")}`
    : String(chapterNumber).padStart(3, "0")
  const jsonPath = `${pp}/.novel/snapshots/${prefix}.snapshot.json`
  try {
    const raw = await readFile(jsonPath)
    return normalizeChapterSnapshot(JSON.parse(raw), {
      chapterId: `chapter-${chapterNumber}`,
      chapterNumber,
    })
  } catch {
    return null
  }
}

export async function listSnapshots(projectPath: string): Promise<number[]> {
  const pp = normalizePath(projectPath)
  const snapshotDir = `${pp}/.novel/snapshots`
  try {
    const tree = await listDirectory(snapshotDir)
    return tree
      .filter(f => f.name.endsWith(".snapshot.json"))
      .map(f => {
        const stem = f.name.split(".")[0]
        // outline-001 → -1, outline-002 → -2
        const outlineMatch = stem.match(/^outline-(\d+)$/)
        if (outlineMatch) return -parseInt(outlineMatch[1], 10)
        return parseInt(stem, 10)
      })
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b)
  } catch {
    return []
  }
}

export async function deleteChapterSnapshotArtifacts(projectPath: string, chapterNumber: number): Promise<boolean> {
  const pp = normalizePath(projectPath)
  const jsonPath = snapshotJsonPath(pp, chapterNumber)
  const mdPath = snapshotMarkdownPath(pp, chapterNumber)
  const historyDir = snapshotHistoryDir(pp, chapterNumber)
  let deleted = false
  try {
    if (await fileExists(jsonPath)) {
      await deleteFile(jsonPath)
      deleted = true
    }
  } catch { /* ignore */ }
  try {
    if (await fileExists(mdPath)) {
      await deleteFile(mdPath)
      deleted = true
    }
  } catch { /* ignore */ }
  try {
    if (await fileExists(historyDir)) {
      await deleteFile(historyDir)
      deleted = true
    }
  } catch { /* ignore */ }
  return deleted
}

export async function deleteChapterSnapshots(projectPath: string, chapterNumber: number): Promise<void> {
  const pp = normalizePath(projectPath)
  await deleteChapterSnapshotArtifacts(pp, chapterNumber)
  await rebuildDerivedMemoryFromSnapshots(pp)
  clearGraphCache()
  useWikiStore.getState().bumpDataVersion()
}

export async function ingestOutline(
  projectPath: string,
  outlinePath: string,
  signal?: AbortSignal,
  options?: IngestOutlineOptions,
): Promise<OutlineIngestResult> {
  const emptyResult = (
    snapshot: ChapterSnapshot | null = null,
    failureReason: OutlineIngestResult["failureReason"] = null,
  ): OutlineIngestResult => ({
    snapshot,
    truncated: false,
    originalLength: 0,
    bodyLength: 0,
    bodyBudget: 0,
    failureReason,
  })

  const pp = normalizePath(projectPath)
  const state = useWikiStore.getState()
  const llmConfig = state.llmConfig
  const novelConfig = state.novelConfig
  // 使用 resolveNovelModel 正确解析提取模型（含供应商配置切换），与 ingestChapter 保持一致
  const runtimeLlmConfig = resolveNovelModel(llmConfig, novelConfig, "extract")
  if (!hasUsableLlm(runtimeLlmConfig, state.providerConfigs)) return emptyResult(null, "no_llm")

  const content = await readFile(outlinePath)
  const originalLength = content.length

  const outputLang = getOutputLanguage()
  const langReminder = buildLanguageReminder(outputLang)
  const systemPrompt = buildOutlineExtractSystemPrompt(langReminder)
  const promptOverhead = systemPrompt.length + buildOutlineIngestUserPrompt("").length
  const bodyBudget = computeOutlineIngestBodyBudget(runtimeLlmConfig.maxContextSize, promptOverhead)
  const truncated = content.length > bodyBudget
  const body = truncated ? content.slice(0, bodyBudget) : content

  // 从文件路径提取大纲名称作为标题
  const normalizedOutlinePath = normalizePath(outlinePath)
  const fileName = normalizedOutlinePath.split("/").pop() ?? "outline"
  const outlineName = fileName.replace(/\.\w+$/, "") // 去掉扩展名，如 "总大纲"、"人物小传"

  // 根据文件名生成唯一的负数 chapterNumber（不同大纲不会互相覆盖）
  // 使用文件名的简单哈希生成 1-999 范围的数字
  let hash = 0
  for (let i = 0; i < outlineName.length; i++) {
    hash = ((hash << 5) - hash + outlineName.charCodeAt(i)) | 0
  }
  const outlineNumber = -(Math.abs(hash % 999) + 1) // -1 到 -999
  const chapterId = `outline-${outlineName}`

  const userPrompt = buildOutlineIngestUserPrompt(body)
  const existingSnapshotPromise = readCurrentSnapshot(pp, outlineNumber)

  try {
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]

    let result = ""
    let streamError: Error | null = null
    const callbacks: StreamCallbacks = {
      onToken: (token: string) => { result += token },
      onDone: () => {},
      onError: (error: Error) => { streamError = error },
    }

    await streamChat(runtimeLlmConfig, messages, callbacks, signal, {
      ...CHAPTER_EXTRACT_REQUEST_OVERRIDES,
      max_tokens: resolveChapterExtractMaxTokens(runtimeLlmConfig.maxContextSize),
    })
    if (streamError) throw streamError

    const parsed = parseLlmJsonObject(result)
    if (!parsed) {
      throw new Error("大纲摄取失败：模型没有返回可解析的 JSON")
    }
    const snapshot = normalizeChapterSnapshot({
      ...parsed,
      chapterId,
      chapterNumber: outlineNumber,
      chapterTitle: outlineName,
      entityIsNew: {},
      validationWarnings: [],
    }, { chapterId, chapterNumber: outlineNumber })
    if (!snapshot) {
      throw new Error("Outline snapshot payload is invalid.")
    }

    if (options?.skipSync) {
      return {
        snapshot,
        truncated,
        originalLength,
        bodyLength: body.length,
        bodyBudget,
        failureReason: null,
      }
    }

    const isReingest = (await existingSnapshotPromise) != null
    const syncResult = await syncSnapshotToMemory(pp, snapshot, isReingest ? REINGEST_SYNC_OPTIONS : undefined)
    if (isReingest) {
      await finalizeProjectMemoryRebuild(pp)
    }
    return {
      snapshot: { ...snapshot, memorySyncedAt: syncResult.memorySyncedAt },
      truncated,
      originalLength,
      bodyLength: body.length,
      bodyBudget,
      failureReason: null,
    }
  } catch (err) {
    console.error("[Outline Ingest] Failed:", err)
    throw normalizeOutlineIngestError(err)
  }
}
