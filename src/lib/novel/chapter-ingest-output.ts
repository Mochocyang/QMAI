import type { ChapterSnapshot } from "./chapter-ingest"
import {
  canonicalizeGraphNodeId,
  canonicalizeSnapshotCharacters,
  detectNodeType,
  getCharacterNamesForMatching,
  snapshotToGraphEdges,
  snapshotToGraphNodes,
  type NovelNodeType,
} from "./graph-adapter"

export type WikiEntryType =
  | "chapter"
  | "character"
  | "location"
  | "organization"
  | "item"
  | "event"
  | "foreshadowing"
  | "secret"
  | "conflict"
  | "timeline"
  | "canon-rule"

export interface IngestSourceRef {
  chapterNumber: number
  snapshotId: string
  evidence?: string
}

export interface ChapterWikiFields {
  chapterNumber: number
  title: string
  volume: string
  chapterGoal: string
  summary: string
  keyPlots: string[]
  endingState: string
  endingHook: string
  outlineNodeIds: string[]
  canonStatus: "confirmed"
  sourceQuotes: string[]
  createdAt: string
  updatedAt: string
}

export interface WikiUpdateEntry {
  entryId: string
  entryType: WikiEntryType
  title: string
  mergeStrategy: "merge-by-entry-id"
  fields: Record<string, unknown>
  sources: IngestSourceRef[]
}

export interface WikiUpdatePatch {
  sharedWiki: true
  entries: WikiUpdateEntry[]
}

export interface SharedWikiState {
  sharedWiki: true
  entries: Record<string, WikiUpdateEntry>
  chapterWikiIds: string[]
  isolatedChapterWikiIds: string[]
}

export interface GraphDerivationNode {
  id: string
  label: string
  type: NovelNodeType
  source: IngestSourceRef
}

export interface GraphDerivationEdge {
  source: string
  target: string
  relation: string
  sourceRef: IngestSourceRef
}

export interface GraphDerivationCandidates {
  nodes: GraphDerivationNode[]
  edges: GraphDerivationEdge[]
}

export interface SearchIndexSection {
  name: string
  content: string
  weight: number
}

export interface SearchIndexText {
  documentId: string
  title: string
  sections: SearchIndexSection[]
}

export interface VectorIndexChunk {
  kind: "summary" | "character" | "event" | "foreshadowing" | "canon" | "timeline" | "conflict"
  text: string
  metadata: Record<string, string | number>
}

export interface VectorIndexText {
  documentId: string
  chunks: VectorIndexChunk[]
}

export interface ChapterIngestOutputOptions {
  title?: string
  volume?: string
  chapterGoal?: string
  endingState?: string
  outlineNodeIds?: string[]
  sourceQuotes?: string[]
  now?: string
}

export interface ChapterIngestOutput {
  snapshotWikiFields: ChapterWikiFields
  wikiUpdatePatch: WikiUpdatePatch
  graphDerivation: GraphDerivationCandidates
  searchIndexText: SearchIndexText
  vectorIndexText: VectorIndexText
}

export function buildChapterIngestOutput(snapshot: ChapterSnapshot, options: ChapterIngestOutputOptions = {}): ChapterIngestOutput {
  const normalizedSnapshot = canonicalizeSnapshotCharacters(snapshot)
  const now = options.now ?? new Date().toISOString()
  const source = sourceRef(normalizedSnapshot, options.sourceQuotes?.[0])
  const title = options.title ?? `第${normalizedSnapshot.chapterNumber}章`
  const snapshotWikiFields: ChapterWikiFields = {
    chapterNumber: normalizedSnapshot.chapterNumber,
    title,
    volume: options.volume ?? "",
    chapterGoal: options.chapterGoal ?? "",
    summary: normalizedSnapshot.summary,
    keyPlots: normalizedSnapshot.events,
    endingState: options.endingState ?? "",
    endingHook: normalizedSnapshot.endingHook,
    outlineNodeIds: options.outlineNodeIds ?? [],
    canonStatus: "confirmed",
    sourceQuotes: options.sourceQuotes ?? [],
    createdAt: now,
    updatedAt: now,
  }

  return {
    snapshotWikiFields,
    wikiUpdatePatch: buildWikiUpdatePatch(normalizedSnapshot, snapshotWikiFields, source),
    graphDerivation: buildGraphDerivation(normalizedSnapshot, source),
    searchIndexText: buildSearchIndexText(normalizedSnapshot, title),
    vectorIndexText: buildVectorIndexText(normalizedSnapshot),
  }
}

function buildWikiUpdatePatch(snapshot: ChapterSnapshot, chapterFields: ChapterWikiFields, source: IngestSourceRef): WikiUpdatePatch {
  return {
    sharedWiki: true,
    entries: [
      entry(`chapter:${snapshot.chapterNumber}`, "chapter", chapterFields.title, { ...chapterFields }, source),
      ...snapshot.characters.map((name) => {
        const matchingNames = getCharacterNamesForMatching(snapshot, name)
        const aliases = matchingNames.filter((alias) => alias !== name)
        return entry(`character:${name}`, "character", name, {
          name,
          ...(aliases.length > 0 ? { aliases } : {}),
          appearanceChapters: [snapshot.chapterNumber],
          currentState: findStateForName(snapshot.characterStateChanges, name, aliases),
          relationshipSummary: snapshot.relationshipChanges.filter((change) => matchingNames.some((candidate) => change.includes(candidate))),
          cognition: cognitionForName(snapshot.knowledgeChanges, name, aliases),
          latestChangeSource: snapshot.chapterId,
          ...(snapshot.characterDetails?.[name] ?? {}),
        }, source)
      }),
      ...snapshot.locations.map((name) => entry(`location:${name}`, "location", name, {
        name,
        relatedChapters: [snapshot.chapterNumber],
        keyEvents: snapshot.events,
        stateChanges: snapshot.timelineEvents.filter((event) => event.includes(name)),
        latestChangeSource: snapshot.chapterId,
        ...(snapshot.locationDetails?.[name] ?? {}),
      }, source)),
      ...snapshot.organizations.map((name) => entry(`organization:${name}`, "organization", name, {
        name,
        relatedChapters: [snapshot.chapterNumber],
        relationshipSummary: snapshot.relationshipChanges.filter((change) => change.includes(name)),
        currentState: findStateForName(snapshot.characterStateChanges, name),
        latestChangeSource: snapshot.chapterId,
        ...(snapshot.organizationDetails?.[name] ?? {}),
      }, source)),
      ...snapshot.items.map((name) => entry(`item:${name}`, "item", name, {
        name,
        relatedChapters: [snapshot.chapterNumber],
        relatedEvents: snapshot.events,
        stateChanges: snapshot.timelineEvents.filter((event) => event.includes(name)),
        latestChangeSource: snapshot.chapterId,
        ...(snapshot.itemDetails?.[name] ?? {}),
      }, source)),
      ...snapshot.events.map((name) => entry(`event:${name}`, "event", name, {
        name,
        chapterNumber: snapshot.chapterNumber,
        participants: snapshot.characters,
        locations: snapshot.locations,
        organizations: snapshot.organizations,
        result: snapshot.summary,
        impacts: snapshot.characterStateChanges,
        ...(snapshot.eventDetails?.[name] ?? {}),
      }, source)),
      ...snapshot.foreshadowingChanges.map((change) => entry(`foreshadowing:${cleanPrefixedText(change)}`, "foreshadowing", cleanPrefixedText(change), {
        status: foreshadowingStatus(change),
        relatedChapters: [snapshot.chapterNumber],
        evidence: change,
        characterVisibleInfo: snapshot.knowledgeChanges,
      }, source)),
      ...snapshot.knowledgeChanges.map((change) => entry(`secret:${cleanPrefixedText(change)}`, "secret", cleanPrefixedText(change), {
        content: change,
        cognition: cognitionFromChange(change),
        currentCanonStatus: "confirmed",
      }, source)),
      ...snapshot.conflicts.map((conflict) => entry(`conflict:${conflict}`, "conflict", conflict, {
        name: conflict,
        chapterNumber: snapshot.chapterNumber,
        participants: snapshot.characters,
        relatedEvents: snapshot.events,
        latestChangeSource: snapshot.chapterId,
      }, source)),
      ...snapshot.timelineEvents.map((event) => entry(`timeline:${event}`, "timeline", event, {
        timePoint: event.split(/[：:]/)[0] ?? "",
        chapterNumber: snapshot.chapterNumber,
        eventSummary: event,
        participants: snapshot.characters,
        locations: snapshot.locations,
      }, source)),
      ...snapshot.newCanonFacts.map((fact) => entry(`canon-rule:${fact}`, "canon-rule", fact, {
        rule: fact,
        sourceChapter: snapshot.chapterNumber,
        evidence: fact,
        constraintStrength: "confirmed",
      }, source)),
    ],
  }
}

function buildGraphDerivation(snapshot: ChapterSnapshot, source: IngestSourceRef): GraphDerivationCandidates {
  const parsedNodes = snapshot.graphNodes.map((raw) => {
    const id = canonicalizeGraphNodeId(snapshot, raw)
    const index = id.indexOf(":")
    const label = index >= 0 ? id.slice(index + 1) : id
    return { id, label, type: detectNodeType(id) }
  })
  const nodes = dedupeById([...snapshotToGraphNodes(snapshot), ...parsedNodes]).map((node) => ({ ...node, source }))
  const edges = snapshotToGraphEdges(snapshot).map((edge) => ({ ...edge, sourceRef: source }))
  return { nodes, edges }
}

function buildSearchIndexText(snapshot: ChapterSnapshot, title: string): SearchIndexText {
  return {
    documentId: `chapter:${snapshot.chapterNumber}`,
    title,
    sections: [
      section("摘要", snapshot.summary, 3),
      section("人物", snapshot.characters.join("\n"), 2),
      section("地点", snapshot.locations.join("\n"), 2),
      section("组织", snapshot.organizations.join("\n"), 2),
      section("物品", snapshot.items.join("\n"), 2),
      section("事件", snapshot.events.join("\n"), 3),
      section("人物状态", snapshot.characterStateChanges.join("\n"), 3),
      section("角色认知", snapshot.knowledgeChanges.join("\n"), 3),
      section("伏笔", snapshot.foreshadowingChanges.join("\n"), 3),
      section("冲突", snapshot.conflicts.join("\n"), 3),
      section("时间线", snapshot.timelineEvents.join("\n"), 3),
      section("正史规则", snapshot.newCanonFacts.join("\n"), 3),
      section("结尾钩子", snapshot.endingHook, 2),
    ].filter((item) => item.content.trim()),
  }
}

function buildVectorIndexText(snapshot: ChapterSnapshot): VectorIndexText {
  const metadata = { chapterNumber: snapshot.chapterNumber, snapshotId: snapshot.chapterId }
  return {
    documentId: `chapter:${snapshot.chapterNumber}`,
    chunks: [
      ...chunk("summary", [snapshot.summary], metadata),
      ...chunk("character", snapshot.characterStateChanges, metadata),
      ...chunk("event", snapshot.events, metadata),
      ...chunk("foreshadowing", snapshot.foreshadowingChanges, metadata),
      ...chunk("conflict", snapshot.conflicts, metadata),
      ...chunk("canon", snapshot.newCanonFacts, metadata),
      ...chunk("timeline", snapshot.timelineEvents, metadata),
    ],
  }
}

function sourceRef(snapshot: ChapterSnapshot, evidence?: string): IngestSourceRef {
  return evidence?.trim()
    ? { chapterNumber: snapshot.chapterNumber, snapshotId: snapshot.chapterId, evidence }
    : { chapterNumber: snapshot.chapterNumber, snapshotId: snapshot.chapterId }
}

export function applyWikiUpdatePatch(state: SharedWikiState | undefined, patch: WikiUpdatePatch): SharedWikiState {
  const next: SharedWikiState = state
    ? {
      sharedWiki: true,
      entries: { ...state.entries },
      chapterWikiIds: [...state.chapterWikiIds],
      isolatedChapterWikiIds: [...state.isolatedChapterWikiIds],
    }
    : { sharedWiki: true, entries: {}, chapterWikiIds: [], isolatedChapterWikiIds: [] }

  for (const incoming of patch.entries) {
    const existing = next.entries[incoming.entryId]
    next.entries[incoming.entryId] = existing
      ? {
        ...existing,
        title: incoming.title,
        fields: mergeFields(existing.fields, incoming.fields),
        sources: mergeSources(existing.sources, incoming.sources),
      }
      : { ...incoming, fields: { ...incoming.fields }, sources: [...incoming.sources] }

    if (incoming.entryType === "chapter" && !next.chapterWikiIds.includes(incoming.entryId)) {
      next.chapterWikiIds.push(incoming.entryId)
    }
  }

  return next
}

function mergeFields(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...existing }
  for (const [key, value] of Object.entries(incoming)) {
    const current = merged[key]
    if (Array.isArray(current) && Array.isArray(value)) {
      merged[key] = Array.from(new Set([...current, ...value]))
    } else if (isRecord(current) && isRecord(value)) {
      merged[key] = mergeFields(current, value)
    } else if (value !== "" && value !== undefined) {
      merged[key] = value
    }
  }
  return merged
}

function mergeSources(existing: IngestSourceRef[], incoming: IngestSourceRef[]): IngestSourceRef[] {
  const result = [...existing]
  for (const source of incoming) {
    if (!result.some((item) => item.chapterNumber === source.chapterNumber && item.snapshotId === source.snapshotId && item.evidence === source.evidence)) {
      result.push(source)
    }
  }
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function entry(entryId: string, entryType: WikiEntryType, title: string, fields: Record<string, unknown>, source: IngestSourceRef): WikiUpdateEntry {
  return { entryId, entryType, title, mergeStrategy: "merge-by-entry-id", fields, sources: [source] }
}

function section(name: string, content: string, weight: number): SearchIndexSection {
  return { name, content, weight }
}

function chunk(kind: VectorIndexChunk["kind"], values: string[], metadata: Record<string, string | number>): VectorIndexChunk[] {
  return values.filter((text) => text.trim()).map((text) => ({ kind, text, metadata }))
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values())
}

function findStateForName(changes: string[], name: string, aliases: string[] = []): string {
  const names = [name, ...aliases]
  const matched = changes.find((change) =>
    names.some((candidate) => change.startsWith(`${candidate}：`) || change.startsWith(`${candidate}:`)),
  )
  if (!matched) return ""
  const colonIndexes = [matched.indexOf("："), matched.indexOf(":")].filter((index) => index >= 0)
  if (colonIndexes.length === 0) return matched.trim()
  return matched.slice(Math.min(...colonIndexes) + 1).trim()
}

function cognitionForName(changes: string[], name: string, aliases: string[] = []): { knows: string[]; doesNotKnow: string[] } {
  const names = [name, ...aliases]
  return changes.reduce((result, change) => {
    const knownName = names.find((candidate) => change.startsWith(`${candidate}知道`))
    const unknownName = names.find((candidate) => change.startsWith(`${candidate}不知道`))
    if (knownName) result.knows.push(change.replace(`${knownName}知道`, "").trim())
    if (unknownName) result.doesNotKnow.push(change.replace(`${unknownName}不知道`, "").trim())
    return result
  }, { knows: [] as string[], doesNotKnow: [] as string[] })
}

function cognitionFromChange(change: string): Record<string, string> {
  const knowIndex = change.indexOf("知道")
  if (knowIndex < 0) return { content: change }
  return { subject: change.slice(0, knowIndex), content: change.slice(knowIndex + 2) }
}

function cleanPrefixedText(value: string): string {
  return value.replace(/^(新增伏笔|新增|推进伏笔|推进|回收伏笔|回收)[:：]?/, "").trim()
}

function foreshadowingStatus(value: string): "created" | "advanced" | "resolved" {
  if (/回收/.test(value)) return "resolved"
  if (/推进/.test(value)) return "advanced"
  return "created"
}
