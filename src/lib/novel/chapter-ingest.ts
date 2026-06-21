import { readFile, writeFileAtomic, listDirectory, fileExists, createDirectory, deleteFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { useWikiStore } from "@/stores/wiki-store"
import { parseFrontmatter } from "@/lib/frontmatter"
import { isChapterPage, isFinalChapter, parseChapterNumber } from "./chapter-meta"
import { DEFAULT_LLM_REQUEST_TIMEOUT_MS, streamChat, type StreamCallbacks } from "@/lib/llm-client"
import type { ChatMessage } from "@/lib/llm-providers"
import { getOutputLanguage, buildLanguageReminder } from "@/lib/output-language"
import type { LlmConfig } from "@/stores/wiki-store"
import { canonicalizeSnapshotCharacters, writeSnapshotToWiki, writePatchFieldsToWiki } from "./graph-adapter"
import { resolveNovelModel } from "./model-resolver"
import { emptyCognitionState, mergeCognitionFromSnapshot, loadCognitionState, saveCognitionState } from "./character-cognition"
import { createEmptyCharacterStateStore, loadCharacterStates, saveCharacterStates, type CharacterStateStore } from "./character-state"
import { createEmptyForeshadowingStore, loadForeshadowingTracker, saveForeshadowingTracker, type Foreshadowing, type ForeshadowingStore } from "./foreshadowing-tracker"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { buildChapterIngestOutput, type ChapterIngestOutput } from "./chapter-ingest-output"
import { createChapterPipeline } from "./chapter-pipeline"
import { mergeSnapshotTimeline } from "./timeline"
import { buildStructuredMemoryDocuments, isValidMemorySnapshot } from "./memory-rebuild"
import { clearGraphCache } from "@/lib/graph-relevance"

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

export type IngestFailReason = "no_llm" | "not_chapter" | "not_final" | "invalid_chapter_number" | "extract_failed"

export interface IngestResult {
  snapshot: ChapterSnapshot | null
  failReason?: IngestFailReason
}

export async function ingestChapter(
  projectPath: string,
  chapterPath: string,
  _reviewModel?: string,
): Promise<IngestResult> {
  const pp = normalizePath(projectPath)
  const novelMode = useWikiStore.getState().novelMode
  if (!novelMode) return { snapshot: null }

  const llmConfig = useWikiStore.getState().llmConfig
  const novelConfig = useWikiStore.getState().novelConfig
  // 使用 resolveNovelModel 正确解析提取模型（含供应商配置切换）
  const runtimeLlmConfig = resolveNovelModel(llmConfig, novelConfig, "extract")
  if (!hasUsableLlm(runtimeLlmConfig)) return { snapshot: null, failReason: "no_llm" }

  const content = await readFile(chapterPath)
  const parsed = parseFrontmatter(content)
  const fm = parsed.frontmatter as Record<string, unknown> | null
  if (!fm || !isChapterPage(fm)) return { snapshot: null, failReason: "not_chapter" }
  if (!isFinalChapter(fm)) {
    console.warn(`[Chapter Ingest] Chapter status is not final, skipping ingest.`)
    return { snapshot: null, failReason: "not_final" }
  }

  const chapterNumber = parseChapterNumber(fm.chapter_number) ?? 0
  if (chapterNumber <= 0) {
    console.warn("[Chapter Ingest] Invalid chapter number, skipping ingest.")
    return { snapshot: null, failReason: "invalid_chapter_number" }
  }
  const body = parsed.body

  const extractedSnapshot = await extractSnapshotWithLLM(chapterNumber, body, runtimeLlmConfig)
  const snapshot = extractedSnapshot ? canonicalizeSnapshotCharacters(extractedSnapshot) : null

  if (!snapshot) {
    return { snapshot: null, failReason: "extract_failed" as IngestFailReason }
  }

  if (snapshot) {
    try {
      const entityWarnings = await validateEntityReferences(pp, snapshot)
      const canonWarnings = await validateCanonConflicts(pp, snapshot)
      snapshot.validationWarnings = [...entityWarnings, ...canonWarnings]
      snapshot.entityIsNew = snapshot.entityIsNew || {}
    } catch (err) {
      console.warn("[Chapter Ingest] Validation failed:", err instanceof Error ? err.message : err)
      snapshot.validationWarnings = []
      snapshot.entityIsNew = {}
    }
    await saveSnapshot(pp, snapshot)
    await saveChapterIngestOutput(pp, snapshot, {
      title: typeof fm.title === "string" ? fm.title : undefined,
    })
  }

  const embCfg = useWikiStore.getState().embeddingConfig
  if (embCfg.enabled && embCfg.model) {
    try {
      const { embedPage } = await import("@/lib/embedding")
      const pageId = chapterPath.split(/[/\\]/).pop()?.replace(/\.md$/, "") ?? ""
      if (pageId) {
        const title = typeof fm?.title === "string" ? fm.title : pageId
        await embedPage(pp, pageId, title, content, embCfg)
      }
    } catch {
      console.warn("[Chapter Ingest] Embedding update failed, skipping")
    }
  }

  if (snapshot) {
    try {
      const writtenPaths = await writeSnapshotToWiki(pp, snapshot)
      if (writtenPaths.length > 0) {
        console.log(`[Chapter Ingest] Wrote ${writtenPaths.length} entity pages from snapshot`)
      }
    } catch (err) {
      console.warn("[Chapter Ingest] Entity page write failed:", err instanceof Error ? err.message : err)
    }

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
  }

  if (snapshot && snapshot.knowledgeChanges.length > 0) {
    try {
      const existing = await loadCognitionState(pp) ?? emptyCognitionState()
      const updated = mergeCognitionFromSnapshot(existing, snapshot)
      await saveCognitionState(pp, updated)
    } catch (err) {
      console.warn("[Chapter Ingest] Cognition state update failed:", err instanceof Error ? err.message : err)
    }
  }

  if (snapshot && snapshot.characterStateChanges.length > 0) {
    try {
      const existingChars = await loadCharacterStates(pp)
      for (const change of snapshot.characterStateChanges) {
        const colonIdx = change.indexOf(":")
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
      await saveCharacterStates(pp, existingChars)
    } catch (err) {
      console.warn("[Chapter Ingest] Character state update failed:", err instanceof Error ? err.message : err)
    }
  }

  if (snapshot && snapshot.foreshadowingChanges.length > 0) {
    try {
      const existingForeshadows = await loadForeshadowingTracker(pp)
      for (const change of snapshot.foreshadowingChanges) {
        const trimmed = change.trim()
        if (trimmed.startsWith("新增伏笔") || trimmed.startsWith("新增:")) {
          const content = trimmed.replace(/^(新增伏笔|新增)[:：]?\s*/, "")
          const dashIdx = content.indexOf("-")
          const name = dashIdx > 0 ? content.slice(0, dashIdx).trim() : content.trim()
          const desc = dashIdx > 0 ? content.slice(dashIdx + 1).trim() : ""
          const newForeshadow: Foreshadowing = {
            id: `fs-${snapshot.chapterNumber}-${existingForeshadows.items.length + 1}`,
            name,
            description: desc,
            status: "planted",
            plantedChapter: snapshot.chapterNumber,
            advancedChapters: [],
            relatedCharacters: [],
            relatedEvents: [],
            notes: "",
          }
          existingForeshadows.items.push(newForeshadow)
        } else if (trimmed.startsWith("推进伏笔") || trimmed.startsWith("推进:")) {
          const content = trimmed.replace(/^(推进伏笔|推进)[:：]?\s*/, "").trim()
          const matched = existingForeshadows.items.find(
            f => f.name === content || content.includes(f.name) || f.name.includes(content)
          )
          if (matched) {
            matched.status = "advanced"
            if (!matched.advancedChapters.includes(snapshot.chapterNumber)) {
              matched.advancedChapters.push(snapshot.chapterNumber)
            }
          }
        } else if (trimmed.startsWith("回收伏笔") || trimmed.startsWith("回收:")) {
          const content = trimmed.replace(/^(回收伏笔|回收)[:：]?\s*/, "").trim()
          const matched = existingForeshadows.items.find(
            f => f.name === content || content.includes(f.name) || f.name.includes(content)
          )
          if (matched) {
            matched.status = "resolved"
            matched.resolvedChapter = snapshot.chapterNumber
          }
        }
      }
      existingForeshadows.lastUpdated = new Date().toISOString()
      await saveForeshadowingTracker(pp, existingForeshadows)
    } catch (err) {
      console.warn("[Chapter Ingest] Foreshadowing update failed:", err instanceof Error ? err.message : err)
    }
  }

  if (snapshot) {
    try {
      const memoryPaths = await exportStructuredMemoryToWiki(pp, snapshot)
      if (memoryPaths.length > 0) {
        console.log(`[Chapter Ingest] Wrote ${memoryPaths.length} structured memory pages`)
      }
    } catch (err) {
      console.warn("[Chapter Ingest] Structured memory export failed:", err instanceof Error ? err.message : err)
    }
  }

  const syncResult = await syncSnapshotToMemory(pp, snapshot)
  return { snapshot: { ...snapshot, memorySyncedAt: syncResult.memorySyncedAt } }
}

export const ingestChapterPipeline = createChapterPipeline({ ingestChapter })

function normalizeOutlineIngestError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err)
  if (/request cancelled|aborted|cancelled/i.test(message)) {
    return new Error("大纲摄取已中断，请稍后重试")
  }
  return new Error(message)
}

async function extractSnapshotWithLLM(
  chapterNumber: number,
  chapterBody: string,
  llmConfig: LlmConfig,
): Promise<ChapterSnapshot | null> {
  const outputLang = getOutputLanguage()
  const langReminder = buildLanguageReminder(outputLang)

  const systemPrompt = `你是一个专业的小说编辑助手。你的任务是从给定的章节正文中提取结构化信息。
请严格按照 JSON 格式输出，不要输出任何其他内容。
${langReminder}`

  const userPrompt = `请从以下章节中提取结构化信息，输出 JSON：

章节编号：第${chapterNumber}章

章节正文：
${chapterBody.slice(0, 8000)}

请输出以下格式的 JSON：
{
  "chapterId": "chapter-${chapterNumber}",
  "chapterNumber": ${chapterNumber},
  "summary": "章节摘要（200字以内）",
  "characters": ["出场人物列表"],
  "characterAliases": { "人物正式名": ["昵称", "小名", "旧名"] },
  "locations": ["出场地点列表"],
  "organizations": ["出场组织列表"],
  "items": ["出场物品列表"],
  "events": ["关键事件列表"],
  "characterStateChanges": ["人物状态变化描述"],
  "relationshipChanges": ["人物关系变化描述"],
  "knowledgeChanges": ["角色认知变化描述"],
  "foreshadowingChanges": ["伏笔变化描述（新增/推进/回收）"],
  "newCanonFacts": ["新增正史设定"],
  "timelineEvents": ["时间线事件"],
  "conflicts": ["冲突变化描述"],
  "endingHook": "章节结尾钩子描述",
  "graphNodes": ["图谱节点列表"],
  "graphEdges": ["图谱关系边列表，格式：A->关系->B。关系必须是以下之一：出场于|发生于|属于|持有|敌对|合作|怀疑|隐瞒|知道|不知道|推进伏笔|回收伏笔|新增伏笔|导致|揭示|影响|位于"],
  "characterDetails": {
    "人物名": {
      "identity": "身份（具体身份描述）",
      "faction": "阵营（所属势力或立场）",
      "goals": "目标（当前章节中的目标）",
      "arcChange": "弧光变化（本章中该人物的成长或变化）"
    }
  },
  "locationDetails": {
    "地点名": {
      "region": "区域（所属地理区域）",
      "type": "类型（场景类型，如宫殿、森林、密室等）",
      "controller": "控制者（当前控制该地点的势力或人物）",
      "hiddenInfo": "隐藏信息（地点中的秘密或未揭示的设定）"
    }
  },
  "organizationDetails": {
    "组织名": {
      "leader": "领导者",
      "members": "成员（本章出现或提及的成员）",
      "goals": "目标（组织当前的目标）",
      "resources": "资源（组织掌控的资源）"
    }
  },
  "itemDetails": {
    "物品名": {
      "holder": "当前持有者",
      "previousHolders": "前持有者",
      "abilities": "能力（物品的功能或能力）",
      "limitations": "限制（使用限制或副作用）",
      "origin": "来源（物品的来历）"
    }
  },
  "eventDetails": {
    "事件名": {
      "cause": "起因（事件的触发原因）",
      "process": "过程（事件的发展过程）",
      "relatedForeshadowing": "关联伏笔（与此事件相关的伏笔）",
      "relatedConflicts": "关联冲突（与此事件相关的冲突）",
      "followUpItems": "后续事项（事件引发的后续影响或待处理事项）"
    }
  }
}

注意：如果同一个人物在正文里有昵称、小名、旧名或全名，请把正式名放进 characters，把其他称呼放进 characterAliases，不要把同一人物拆成多个 characters。
注意：characterDetails、locationDetails、organizationDetails、itemDetails、eventDetails 仅在章节中确实有相关信息时才填写；如果某个字段没有相关信息，直接省略该字段即可。`

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

    await streamChat(llmConfig, messages, callbacks, AbortSignal.timeout(DEFAULT_LLM_REQUEST_TIMEOUT_MS))
    if (streamError) throw streamError

    const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.match(/\{[\s\S]*\}/) ?? result.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error("章节快照提取失败：模型没有返回可解析的 JSON")
    }

    const parsed = JSON.parse(jsonMatch[0])
    return normalizeChapterSnapshot({
      ...parsed,
      chapterId: parsed.chapterId || `chapter-${chapterNumber}`,
      chapterNumber: parsed.chapterNumber || chapterNumber,
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

export async function saveEditedSnapshot(projectPath: string, snapshot: ChapterSnapshot): Promise<void> {
  const pp = normalizePath(projectPath)
  const currentSnapshot = await readCurrentSnapshot(pp, snapshot.chapterNumber)
  const normalizedSnapshot = normalizeChapterSnapshot(snapshot, {
    chapterId: snapshot.chapterId,
    chapterNumber: snapshot.chapterNumber,
  })
  if (!normalizedSnapshot) {
    throw new Error("Invalid snapshot data.")
  }
  await backupSnapshotBeforeOverwrite(pp, snapshot.chapterNumber)
  await saveSnapshot(pp, materializeNextCurrentSnapshot(normalizedSnapshot, currentSnapshot))
}

function appendPreviewSection(lines: string[], title: string, items: string[]): void {
  lines.push(`${title}：`)
  if (items.length === 0) {
    lines.push("- 无")
  } else {
    lines.push(...items.map(item => `- ${item}`))
  }
  lines.push("")
}

export function buildSnapshotMemorySyncPreview(snapshot: ChapterSnapshot): string {
  const graphItems = [
    ...snapshot.characters,
    ...snapshot.locations,
    ...snapshot.organizations,
    ...snapshot.items,
    ...snapshot.events,
  ]
  const uniqueGraphItems = Array.from(new Set(graphItems.filter(Boolean)))
  const lines = ["本次将同步以下内容：", ""]

  appendPreviewSection(lines, "人物状态", snapshot.characterStateChanges)
  appendPreviewSection(lines, "角色认知", snapshot.knowledgeChanges)
  appendPreviewSection(lines, "伏笔追踪", snapshot.foreshadowingChanges)
  appendPreviewSection(lines, "实体页 / 图谱", uniqueGraphItems)
  appendPreviewSection(lines, "RAG 记忆页面", ["章节快照记忆", "角色认知状态", "人物状态记忆", "伏笔追踪记忆"])

  return lines.join("\n").trimEnd()
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

export interface SyncSnapshotToMemoryResult {
  writtenEntityPaths: string[]
  memoryPagePaths: string[]
  memorySyncedAt: string
}

export async function syncSnapshotToMemory(
  projectPath: string,
  snapshot: ChapterSnapshot,
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

  if (syncedSnapshot.knowledgeChanges.length > 0) {
    const existing = await loadCognitionState(pp) ?? emptyCognitionState()
    const updated = mergeCognitionFromSnapshot(existing, syncedSnapshot)
    await saveCognitionState(pp, updated)
  }

  if (syncedSnapshot.characterStateChanges.length > 0) {
    await syncCharacterStateChanges(pp, syncedSnapshot)
  }

  if (syncedSnapshot.foreshadowingChanges.length > 0) {
    await syncForeshadowingChanges(pp, syncedSnapshot)
  }

  await backupSnapshotBeforeOverwrite(pp, syncedSnapshot.chapterNumber)
  await saveSnapshot(pp, syncedSnapshot)
  const memoryPagePaths = await exportStructuredMemoryToWiki(pp, syncedSnapshot)
  clearGraphCache()
  useWikiStore.getState().bumpDataVersion()

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

function applyForeshadowingChangesToStore(existingForeshadows: ForeshadowingStore, snapshot: ChapterSnapshot): ForeshadowingStore {
  for (const change of snapshot.foreshadowingChanges) {
    const trimmed = change.trim()
    if (trimmed.startsWith("新增伏笔") || trimmed.startsWith("新增:")) {
      const content = trimmed.replace(/^(新增伏笔|新增)[:：]?\s*/, "")
      const dashIdx = content.indexOf("-")
      const name = dashIdx > 0 ? content.slice(0, dashIdx).trim() : content.trim()
      const desc = dashIdx > 0 ? content.slice(dashIdx + 1).trim() : ""
      const newForeshadow: Foreshadowing = {
        id: `fs-${snapshot.chapterNumber}-${existingForeshadows.items.length + 1}`,
        name,
        description: desc,
        status: "planted",
        plantedChapter: snapshot.chapterNumber,
        advancedChapters: [],
        relatedCharacters: [],
        relatedEvents: [],
        notes: "",
      }
      existingForeshadows.items.push(newForeshadow)
    } else if (trimmed.startsWith("推进伏笔") || trimmed.startsWith("推进:")) {
      const content = trimmed.replace(/^(推进伏笔|推进)[:：]?\s*/, "").trim()
      const matched = existingForeshadows.items.find(
        f => f.name === content || content.includes(f.name) || f.name.includes(content)
      )
      if (matched) {
        matched.status = "advanced"
        if (!matched.advancedChapters.includes(snapshot.chapterNumber)) {
          matched.advancedChapters.push(snapshot.chapterNumber)
        }
      }
    } else if (trimmed.startsWith("回收伏笔") || trimmed.startsWith("回收:")) {
      const content = trimmed.replace(/^(回收伏笔|回收)[:：]?\s*/, "").trim()
      const matched = existingForeshadows.items.find(
        f => f.name === content || content.includes(f.name) || f.name.includes(content)
      )
      if (matched) {
        matched.status = "resolved"
        matched.resolvedChapter = snapshot.chapterNumber
      }
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

async function rebuildDerivedMemoryFromSnapshots(projectPath: string, latestSnapshot?: ChapterSnapshot): Promise<void> {
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

  await writeStructuredMemoryDocuments(projectPath, snapshots)
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

  for (const { key, label } of categories) {
    for (const name of snapshot[key]) {
      try {
        const filePath = `${entitiesDir}/${name}.md`
        const exists = await fileExists(filePath)
        snapshot.entityIsNew[name] = !exists
        if (!exists) {
          warnings.push({
            type: "entity_new",
            message: `新${label}: ${name}`,
          })
        }
      } catch {
        snapshot.entityIsNew[name] = true
        warnings.push({
          type: "entity_new",
          message: `新${label}: ${name}`,
        })
      }
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

export async function deleteChapterSnapshots(projectPath: string, chapterNumber: number): Promise<void> {
  const pp = normalizePath(projectPath)
  const jsonPath = snapshotJsonPath(pp, chapterNumber)
  const mdPath = snapshotMarkdownPath(pp, chapterNumber)
  const historyDir = snapshotHistoryDir(pp, chapterNumber)
  try { if (await fileExists(jsonPath)) await deleteFile(jsonPath) } catch { /* ignore */ }
  try { if (await fileExists(mdPath)) await deleteFile(mdPath) } catch { /* ignore */ }
  try { if (await fileExists(historyDir)) await deleteFile(historyDir) } catch { /* ignore */ }
  await rebuildDerivedMemoryFromSnapshots(pp)
  clearGraphCache()
  useWikiStore.getState().bumpDataVersion()
}

export async function ingestOutline(
  projectPath: string,
  outlinePath: string,
): Promise<ChapterSnapshot | null> {
  const pp = normalizePath(projectPath)
  const llmConfig = useWikiStore.getState().llmConfig
  const novelConfig = useWikiStore.getState().novelConfig
  // 使用 resolveNovelModel 正确解析提取模型（含供应商配置切换），与 ingestChapter 保持一致
  const runtimeLlmConfig = resolveNovelModel(llmConfig, novelConfig, "extract")
  if (!hasUsableLlm(runtimeLlmConfig)) return null

  const content = await readFile(outlinePath)
  const body = content.length > 8000 ? content.slice(0, 8000) : content

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

  const outputLang = getOutputLanguage()
  const langReminder = buildLanguageReminder(outputLang)

  const systemPrompt = `你是一个专业的小说编辑助手。请从大纲中提取初始设定信息，输出 JSON。${langReminder}`

  const userPrompt = `请从以下大纲中提取初始设定：

${body}

输出 JSON：
{
  "chapterId": "outline-init",
  "chapterNumber": 0,
  "summary": "大纲摘要",
  "characters": ["初始人物"],
  "locations": ["初始地点"],
  "organizations": ["初始组织/势力"],
  "items": ["关键物品"],
  "events": ["背景事件"],
  "characterStateChanges": ["人物初始状态"],
  "relationshipChanges": ["人物初始关系"],
  "knowledgeChanges": [],
  "foreshadowingChanges": ["初始伏笔"],
  "newCanonFacts": ["世界观正史设定"],
  "timelineEvents": ["时间线背景"],
  "conflicts": ["核心冲突"],
  "endingHook": "",
  "graphNodes": ["图谱节点列表"],
  "graphEdges": ["图谱关系边，格式：A->关系->B。关系必须是以下之一：出场于|发生于|属于|持有|敌对|合作|怀疑|隐瞒|知道|不知道|推进伏笔|回收伏笔|新增伏笔|导致|揭示|影响|位于"]
}`

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

    await streamChat(runtimeLlmConfig, messages, callbacks, AbortSignal.timeout(DEFAULT_LLM_REQUEST_TIMEOUT_MS))
    if (streamError) throw streamError

    const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.match(/\{[\s\S]*\}/) ?? result.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error("大纲摄取失败：模型没有返回可解析的 JSON")
    }

    const parsed = JSON.parse(jsonMatch[0])
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

    const syncResult = await syncSnapshotToMemory(pp, snapshot)
    return { ...snapshot, memorySyncedAt: syncResult.memorySyncedAt }
  } catch (err) {
    console.error("[Outline Ingest] Failed:", err)
    throw normalizeOutlineIngestError(err)
  }
}
