import { readFile, writeFileAtomic, fileExists, createDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { mergeArrayFieldsIntoContent } from "@/lib/sources-merge"
import type { ChapterSnapshot } from "./chapter-ingest"
import type { WikiUpdatePatch, WikiUpdateEntry } from "./chapter-ingest-output"
import { looksLikeStableNovelEntityLabel } from "./memory-rebuild"

export interface NovelGraphNode {
  id: string
  label: string
  type: NovelNodeType
}

export interface NovelGraphEdge {
  source: string
  target: string
  relation: string
  confidence?: number
}

export type NovelNodeType =
  | "character"
  | "location"
  | "organization"
  | "item"
  | "event"
  | "chapter"
  | "outline"
  | "foreshadowing"
  | "secret"
  | "conflict"
  | "timeline-point"
  | "canon-rule"
  | "concept"

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function normalizeCharacterAliases(snapshot: ChapterSnapshot): Record<string, string[]> | undefined {
  if (!snapshot.characterAliases) return undefined

  const normalizedEntries = Object.entries(snapshot.characterAliases)
    .map(([canonical, aliases]) => {
      const cleanCanonical = canonical.trim()
      if (!cleanCanonical) return null
      return [cleanCanonical, uniqueNonEmpty(aliases).filter((alias) => alias !== cleanCanonical)] as const
    })
    .filter((entry): entry is readonly [string, string[]] => Boolean(entry))

  if (normalizedEntries.length === 0) return undefined
  return Object.fromEntries(normalizedEntries)
}

function characterCanonicalMap(snapshot: ChapterSnapshot): Map<string, string> {
  const aliasMap = new Map<string, string>()
  const aliases = normalizeCharacterAliases(snapshot)
  if (!aliases) return aliasMap

  for (const [canonical, names] of Object.entries(aliases)) {
    aliasMap.set(canonical, canonical)
    for (const alias of names) {
      aliasMap.set(alias, canonical)
    }
  }

  return aliasMap
}

export function getCanonicalCharacterName(snapshot: ChapterSnapshot, name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return trimmed
  return characterCanonicalMap(snapshot).get(trimmed) ?? trimmed
}

export function getCharacterNamesForMatching(snapshot: ChapterSnapshot, canonicalName: string): string[] {
  const canonical = getCanonicalCharacterName(snapshot, canonicalName)
  const aliases = normalizeCharacterAliases(snapshot)?.[canonical] ?? []
  return uniqueNonEmpty([canonical, ...aliases])
}

export function canonicalizeGraphNodeId(snapshot: ChapterSnapshot, raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed

  const index = trimmed.indexOf(":")
  if (index >= 0) {
    const prefix = trimmed.slice(0, index)
    const label = trimmed.slice(index + 1)
    if (prefix.toLowerCase() === "character") {
      return `character:${getCanonicalCharacterName(snapshot, label)}`
    }
    return trimmed
  }

  const canonical = getCanonicalCharacterName(snapshot, trimmed)
  return canonical !== trimmed ? `character:${canonical}` : trimmed
}

export function canonicalizeSnapshotCharacters(snapshot: ChapterSnapshot): ChapterSnapshot {
  const aliases = normalizeCharacterAliases(snapshot)
  if (!aliases) return snapshot

  const canonicalCharacters = uniqueNonEmpty([
    ...snapshot.characters.map((name) => getCanonicalCharacterName(snapshot, name)),
    ...Object.keys(aliases),
  ])

  const characterDetails = snapshot.characterDetails
    ? Object.entries(snapshot.characterDetails).reduce<Record<string, NonNullable<ChapterSnapshot["characterDetails"]>[string]>>((result, [name, detail]) => {
        const canonical = getCanonicalCharacterName(snapshot, name)
        result[canonical] = { ...(result[canonical] ?? {}), ...detail }
        return result
      }, {})
    : undefined

  return {
    ...snapshot,
    characters: canonicalCharacters,
    characterAliases: aliases,
    characterDetails,
    graphNodes: uniqueNonEmpty(snapshot.graphNodes.map((node) => canonicalizeGraphNodeId(snapshot, node))),
  }
}

export const NOVEL_NODE_TYPE_LABELS: Record<NovelNodeType, string> = {
  character: "人物",
  location: "地点",
  organization: "组织",
  item: "物品",
  event: "事件",
  chapter: "章节",
  outline: "大纲",
  foreshadowing: "伏笔",
  secret: "秘密",
  conflict: "冲突",
  "timeline-point": "时间点",
  "canon-rule": "正史规则",
  concept: "概念",
}

export const NOVEL_RELATION_LABELS: Record<string, string> = {
  APPEARS_IN: "出场于",
  HAPPENS_IN: "发生于",
  BELONGS_TO: "属于",
  HAS_ITEM: "持有",
  ENEMY_OF: "敌对",
  ALLY_OF: "合作",
  SUSPECTS: "怀疑",
  HIDES_FROM: "隐瞒",
  KNOWS: "知道",
  DOES_NOT_KNOW: "不知道",
  ADVANCES_FORESHADOWING: "推进伏笔",
  RESOLVES_FORESHADOWING: "回收伏笔",
  CREATES_FORESHADOWING: "新增伏笔",
  CAUSES: "导致",
  REVEALS: "揭示",
  AFFECTS: "影响",
  LOCATED_AT: "位于",
}

export function snapshotToGraphNodes(snapshot: ChapterSnapshot): NovelGraphNode[] {
  const canonicalSnapshot = canonicalizeSnapshotCharacters(snapshot)
  const nodes: NovelGraphNode[] = []

  canonicalSnapshot.characters.forEach(name => {
    nodes.push({ id: `character:${name}`, label: name, type: "character" })
  })
  canonicalSnapshot.locations.forEach(name => {
    nodes.push({ id: `location:${name}`, label: name, type: "location" })
  })
  canonicalSnapshot.organizations.forEach(name => {
    nodes.push({ id: `organization:${name}`, label: name, type: "organization" })
  })
  canonicalSnapshot.items.forEach(name => {
    nodes.push({ id: `item:${name}`, label: name, type: "item" })
  })
  canonicalSnapshot.events.forEach(name => {
    nodes.push({ id: `event:${name}`, label: name, type: "event" })
  })

  nodes.push({
    id: `chapter:${canonicalSnapshot.chapterNumber}`,
    label: `第${canonicalSnapshot.chapterNumber}章`,
    type: "chapter",
  })

  return nodes
}

function stripGraphEdgeDecoration(raw: string): string {
  return raw.trim().replace(/[（(][^()（）]*[)）]\s*$/u, "").trim()
}

function normalizeGraphEdgeNodeId(raw: string, nodeIdsByLabel: Map<string, string>): string {
  const candidates = Array.from(new Set([
    raw.trim(),
    stripGraphEdgeDecoration(raw),
  ].filter(Boolean)))

  for (const candidate of candidates) {
    if (nodeIdsByLabel.has(candidate)) return nodeIdsByLabel.get(candidate)!
    if (/^[a-z-]+:/i.test(candidate)) return candidate
  }

  return candidates[candidates.length - 1] ?? raw.trim()
}

function normalizeGraphEdgeRelation(raw: string): string {
  const relation = raw.trim()
  if (!relation) return "AFFECTS"

  const relationType = relation.toUpperCase()
  if (NOVEL_RELATION_LABELS[relationType]) return relationType

  for (const [type, label] of Object.entries(NOVEL_RELATION_LABELS)) {
    if (label === relation) return type
  }

  return relation
}

export function snapshotToGraphEdges(snapshot: ChapterSnapshot): NovelGraphEdge[] {
  const canonicalSnapshot = canonicalizeSnapshotCharacters(snapshot)
  const edges: NovelGraphEdge[] = []
  const chapterId = `chapter:${canonicalSnapshot.chapterNumber}`
  const nodeIdsByLabel = new Map<string, string>()
  for (const node of snapshotToGraphNodes(canonicalSnapshot)) {
    nodeIdsByLabel.set(node.id, node.id)
    nodeIdsByLabel.set(node.label, node.id)
    if (node.type === "character") {
      for (const alias of getCharacterNamesForMatching(canonicalSnapshot, node.label)) {
        nodeIdsByLabel.set(alias, node.id)
        nodeIdsByLabel.set(`character:${alias}`, node.id)
      }
    }
  }

  canonicalSnapshot.characters.forEach(name => {
    edges.push({ source: `character:${name}`, target: chapterId, relation: "APPEARS_IN" })
  })
  canonicalSnapshot.locations.forEach(name => {
    edges.push({ source: chapterId, target: `location:${name}`, relation: "HAPPENS_IN" })
  })
  canonicalSnapshot.organizations.forEach(name => {
    edges.push({ source: `organization:${name}`, target: chapterId, relation: "APPEARS_IN" })
  })
  canonicalSnapshot.items.forEach(name => {
    edges.push({ source: `item:${name}`, target: chapterId, relation: "APPEARS_IN" })
  })

  canonicalSnapshot.graphEdges.forEach(edge => {
    const parts = edge.split("->")
    if (parts.length === 3) {
      const source = normalizeGraphEdgeNodeId(parts[0], nodeIdsByLabel)
      const target = normalizeGraphEdgeNodeId(parts[2], nodeIdsByLabel)
      const relation = normalizeGraphEdgeRelation(parts[1])
      if (!source || !target) return
      edges.push({ source, target, relation })
    }
  })

  return edges
}

export function detectNodeType(label: string): NovelNodeType {
  if (/^(第\d+章|Chapter\s+\d+)/.test(label)) return "chapter"

  const rules: [RegExp, NovelNodeType][] = [
    [/^character:/i, "character"],
    [/^人物[：:]/i, "character"],
    [/^location:/i, "location"],
    [/^地点[：:]/i, "location"],
    [/^organization:/i, "organization"],
    [/^组织[：:]/i, "organization"],
    [/^item:/i, "item"],
    [/^物品[：:]/i, "item"],
    [/^event:/i, "event"],
    [/^事件[：:]/i, "event"],
    [/^outline:/i, "outline"],
    [/^大纲[：:]/i, "outline"],
    [/^foreshadowing:/i, "foreshadowing"],
    [/^伏笔[：:]/i, "foreshadowing"],
    [/^secret:/i, "secret"],
    [/^秘密[：:]/i, "secret"],
    [/^conflict:/i, "conflict"],
    [/^冲突[：:]/i, "conflict"],
    [/^timeline-point:/i, "timeline-point"],
    [/^时间点[：:]/i, "timeline-point"],
    [/^canon-rule:/i, "canon-rule"],
    [/^正史[：:]/i, "canon-rule"],
  ]

  for (const [pattern, type] of rules) {
    if (pattern.test(label)) return type
  }

  if (/人物|角色|主角|配角|反派/.test(label)) return "character"
  if (/地点|城市|王国|山脉|森林|河流|海洋/.test(label)) return "location"
  if (/组织|门派|宗门|家族|势力|帝国|王国|联盟/.test(label)) return "organization"
  if (/物品|武器|法宝|丹药|卷轴|神器/.test(label)) return "item"
  if (/事件|战争|战役|大会|试炼|婚礼|葬礼/.test(label)) return "event"
  if (/大纲/.test(label)) return "outline"
  if (/伏笔|悬念/.test(label)) return "foreshadowing"
  if (/秘密|真相|揭露/.test(label)) return "secret"
  if (/冲突|对抗|竞争/.test(label)) return "conflict"
  if (/时间线|年表|纪元/.test(label)) return "timeline-point"
  if (/规则|正史|设定/.test(label)) return "canon-rule"

  return "concept"
}

const NODE_TYPE_TO_TAG: Record<string, string> = {
  character: "character",
  location: "location",
  organization: "organization",
  item: "item",
  event: "event",
  chapter: "chapter",
  outline: "outline",
  foreshadowing: "foreshadowing",
  secret: "secret",
  conflict: "conflict",
  "timeline-point": "timeline-point",
  "canon-rule": "canon-rule",
  concept: "concept",
}

const STABLE_ENTITY_TYPES = new Set<NovelNodeType>([
  "character",
  "location",
  "organization",
  "item",
])

const STABLE_PATCH_ENTRY_TYPES = new Set<WikiUpdateEntry["entryType"]>([
  "character",
  "location",
  "organization",
  "item",
])

function isStableEntityType(type: NovelNodeType): type is "character" | "location" | "organization" | "item" {
  return STABLE_ENTITY_TYPES.has(type)
}

function isStablePatchEntryType(entryType: WikiUpdateEntry["entryType"]): entryType is "character" | "location" | "organization" | "item" {
  return STABLE_PATCH_ENTRY_TYPES.has(entryType)
}

function shouldPersistSnapshotNode(node: NovelGraphNode): boolean {
  return isStableEntityType(node.type) && looksLikeStableNovelEntityLabel(node.type, node.label)
}

function shouldPersistPatchEntry(entry: WikiUpdateEntry): boolean {
  return isStablePatchEntryType(entry.entryType)
    && looksLikeStableNovelEntityLabel(entry.entryType, entry.title)
}

function nodeIdToSlug(nodeId: string): string {
  const idx = nodeId.indexOf(":")
  return idx >= 0 ? nodeId.slice(idx + 1) : nodeId
}

function snapshotSourceFileName(chapterNumber: number): string {
  if (chapterNumber < 0) {
    return `outline-${String(Math.abs(chapterNumber)).padStart(3, "0")}.snapshot.json`
  }
  return `${String(chapterNumber).padStart(3, "0")}.snapshot.json`
}

function projectionSnapshotMeta(snapshot: ChapterSnapshot): {
  snapshotId: string
  sourceType: "chapter" | "outline"
  sourceSequence: number
  sourceRevision: number
  isHistorical: boolean
} {
  const sourceType = snapshot.sourceType ?? (snapshot.chapterNumber < 0 ? "outline" : "chapter")
  const sourceSequence = snapshot.sourceSequence ?? Math.abs(snapshot.chapterNumber)
  const sourceRevision = snapshot.revision ?? 1
  return {
    snapshotId: snapshot.snapshotId ?? `${snapshot.chapterId}-r${sourceRevision}`,
    sourceType,
    sourceSequence,
    sourceRevision,
    isHistorical: snapshot.isHistorical ?? false,
  }
}

function buildEntityPage(
  title: string,
  tag: string,
  relatedSlugs: string[],
  sourceFile: string,
  date: string,
  relationLines: string[],
  snapshotMeta: ReturnType<typeof projectionSnapshotMeta>,
  aliases: string[] = [],
): string {
  return [
    "---",
    `type: entity`,
    `title: "${title}"`,
    `created: ${date}`,
    `updated: ${date}`,
    `tags: [${tag}]`,
    `aliases: [${aliases.map((alias) => `"${alias}"`).join(", ")}]`,
    `related: [${relatedSlugs.join(", ")}]`,
    `snapshot_id: "${snapshotMeta.snapshotId}"`,
    `source_type: "${snapshotMeta.sourceType}"`,
    `source_sequence: ${snapshotMeta.sourceSequence}`,
    `source_revision: ${snapshotMeta.sourceRevision}`,
    `is_historical: ${snapshotMeta.isHistorical ? "true" : "false"}`,
    `sources: ["${sourceFile}"]`,
    "---",
    "",
    `# ${title}`,
    "",
    ...relationLines,
  ].join("\n") + "\n"
}

function replaceOrInsertFrontmatterLine(content: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key}:.*$`, "m")
  if (pattern.test(content)) {
    return content.replace(pattern, `${key}: ${value}`)
  }
  const closeIndex = content.indexOf("\n---\n")
  if (closeIndex < 0) return content
  return `${content.slice(0, closeIndex)}\n${key}: ${value}${content.slice(closeIndex)}`
}

function applyProjectionSnapshotMeta(
  content: string,
  snapshotMeta: ReturnType<typeof projectionSnapshotMeta>,
): string {
  let updated = replaceOrInsertFrontmatterLine(content, "snapshot_id", `"${snapshotMeta.snapshotId}"`)
  updated = replaceOrInsertFrontmatterLine(updated, "source_type", `"${snapshotMeta.sourceType}"`)
  updated = replaceOrInsertFrontmatterLine(updated, "source_sequence", String(snapshotMeta.sourceSequence))
  updated = replaceOrInsertFrontmatterLine(updated, "source_revision", String(snapshotMeta.sourceRevision))
  updated = replaceOrInsertFrontmatterLine(updated, "is_historical", snapshotMeta.isHistorical ? "true" : "false")
  return updated
}

const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g

function mergeExistingPage(existing: string, incoming: string, today: string): string {
  let merged = mergeArrayFieldsIntoContent(existing, incoming, ["tags", "related", "sources"])

  merged = merged.replace(/^updated:.*$/m, `updated: ${today}`)

  const incomingLinks = new Set<string>()
  let m: RegExpExecArray | null
  const re1 = new RegExp(WIKILINK_RE.source, "g")
  while ((m = re1.exec(incoming)) !== null) {
    incomingLinks.add(m[1])
  }

  const existingLinks = new Set<string>()
  const re2 = new RegExp(WIKILINK_RE.source, "g")
  while ((m = re2.exec(merged)) !== null) {
    existingLinks.add(m[1])
  }

  const missing = [...incomingLinks].filter(l => !existingLinks.has(l))
  if (missing.length > 0) {
    const closeFm = merged.indexOf("---", 4)
    if (closeFm >= 0) {
      const bodyStart = merged.indexOf("\n", closeFm + 3) + 1
      const body = merged.slice(bodyStart)
      const newLines = missing.map(l => `- [[${l}]]`)
      merged = merged.slice(0, bodyStart) + body.trimEnd() + "\n\n" + newLines.join("\n") + "\n"
    }
  }

  return merged
}

export async function writeSnapshotToWiki(
  projectPath: string,
  snapshot: ChapterSnapshot,
): Promise<string[]> {
  const pp = normalizePath(projectPath)
  const canonicalSnapshot = canonicalizeSnapshotCharacters(snapshot)
  const snapshotMeta = projectionSnapshotMeta(canonicalSnapshot)
  const nodes = snapshotToGraphNodes(canonicalSnapshot).filter(shouldPersistSnapshotNode)
  const edges = snapshotToGraphEdges(canonicalSnapshot)
  const entitiesDir = `${pp}/wiki/entities`
  const today = new Date().toISOString().split("T")[0]
  const sourceFile = snapshotSourceFileName(canonicalSnapshot.chapterNumber)

  const slugMap = new Map<string, string>()
  for (const node of nodes) {
    slugMap.set(node.id, node.label)
  }

  const relatedMap = new Map<string, Set<string>>()
  for (const edge of edges) {
    const sourceSlug = slugMap.get(edge.source)
    const targetSlug = slugMap.get(edge.target)
    if (!sourceSlug || !targetSlug) {
      continue
    }
    if (!relatedMap.has(edge.source)) relatedMap.set(edge.source, new Set())
    if (!relatedMap.has(edge.target)) relatedMap.set(edge.target, new Set())
    relatedMap.get(edge.source)!.add(targetSlug)
    relatedMap.get(edge.target)!.add(sourceSlug)
  }

  await createDirectory(entitiesDir)

  const writtenPaths: string[] = []

  for (const node of nodes) {
    try {
      const slug = slugMap.get(node.id) ?? nodeIdToSlug(node.id)
      const filePath = `${entitiesDir}/${slug}.md`
      const tag = NODE_TYPE_TO_TAG[node.type] ?? "concept"
      const aliases = node.type === "character"
        ? getCharacterNamesForMatching(canonicalSnapshot, node.label).filter((name) => name !== node.label)
        : []
      const relatedSlugs = relatedMap.has(node.id)
        ? Array.from(relatedMap.get(node.id)!)
        : []

      const relationLines = edges
        .filter(e => (e.source === node.id || e.target === node.id) && slugMap.has(e.source) && slugMap.has(e.target))
        .map(e => {
          const otherSlug = e.source === node.id
            ? (slugMap.get(e.target) ?? nodeIdToSlug(e.target))
            : (slugMap.get(e.source) ?? nodeIdToSlug(e.source))
          const label = NOVEL_RELATION_LABELS[e.relation] ?? e.relation
          return `- [[${otherSlug}]] — ${label}`
        })

      const newContent = buildEntityPage(
        node.label, tag, relatedSlugs, sourceFile, today, relationLines, snapshotMeta, aliases,
      )

      let contentToWrite: string
      if (await fileExists(filePath)) {
        const existing = await readFile(filePath)
        contentToWrite = applyProjectionSnapshotMeta(mergeExistingPage(existing, newContent, today), snapshotMeta)
      } else {
        contentToWrite = newContent
      }

      await writeFileAtomic(filePath, contentToWrite)
      writtenPaths.push(filePath)
    } catch (err) {
      console.warn(
        `[graph-adapter] Failed to write entity page for node ${node.id}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  return writtenPaths
}

function entryTypeToTag(entryType: string): string {
  if (entryType === "timeline") return "timeline-point"
  return NODE_TYPE_TO_TAG[entryType] ?? "concept"
}

function formatFieldValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "object" && item !== null) {
        return JSON.stringify(item)
      }
      return String(item)
    }).join(", ")
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value)
  }
  return String(value)
}

function buildChapterInfoSection(entry: WikiUpdateEntry): string {
  const lines: string[] = ["## 章节信息", ""]
  const detailLines: string[] = []
  const fieldLabelMap: Record<string, string> = {
    name: "名称",
    appearanceChapters: "出场章节",
    currentState: "当前状态",
    relationshipSummary: "关系变化",
    aliases: "别名",
    cognition: "角色认知",
    latestChangeSource: "最新来源",
    relatedChapters: "相关章节",
    keyEvents: "关键事件",
    stateChanges: "状态变化",
    chapterNumber: "章节编号",
    title: "标题",
    summary: "摘要",
    keyPlots: "关键情节",
    endingHook: "结尾钩子",
    endingState: "结尾状态",
    volume: "分卷",
    chapterGoal: "章节目标",
    outlineNodeIds: "大纲节点",
    canonStatus: "正史状态",
    sourceQuotes: "来源引用",
    createdAt: "创建时间",
    updatedAt: "更新时间",
    participants: "参与者",
    locations: "出场地点",
    organizations: "出场组织",
    result: "结果",
    impacts: "影响",
    status: "状态",
    evidence: "证据",
    content: "内容",
    relation: "关系",
    rule: "规则",
    sourceChapter: "来源章节",
    constraintStrength: "约束强度",
    timePoint: "时间点",
    identity: "身份",
    faction: "阵营",
    goals: "目标",
    arcChange: "弧光变化",
    region: "区域",
    type: "类型",
    controller: "控制者",
    hiddenInfo: "隐藏信息",
    leader: "领导者",
    members: "成员",
    resources: "资源",
    holder: "当前持有者",
    previousHolders: "前持有者",
    abilities: "能力",
    limitations: "限制",
    origin: "来源",
    cause: "起因",
    process: "过程",
    relatedForeshadowing: "关联伏笔",
    relatedConflicts: "关联冲突",
    followUpItems: "后续事项",
  }

  const detailKeys = new Set([
    "identity", "faction", "goals", "arcChange",
    "region", "type", "controller", "hiddenInfo",
    "leader", "members", "resources",
    "holder", "previousHolders", "abilities", "limitations", "origin",
    "cause", "process", "relatedForeshadowing", "relatedConflicts", "followUpItems",
  ])

  for (const [key, value] of Object.entries(entry.fields)) {
    if (value === undefined || value === null) continue
    if (value === "") continue
    if (Array.isArray(value) && value.length === 0) continue
    const displayValue = formatFieldValue(value)
    if (displayValue === "") continue
    const label = fieldLabelMap[key] ?? key
    if (detailKeys.has(key)) {
      detailLines.push(`## ${label}`, "", displayValue, "")
    } else {
      lines.push(`- **${label}**: ${displayValue}`)
    }
  }

  if (detailLines.length > 0) {
    lines.push(...detailLines)
  }
  return lines.join("\n")
}

function buildNewEntityPage(title: string, tag: string, date: string, sectionMd: string, aliases: string[] = []): string {
  return [
    "---",
    "type: entity",
    `title: "${title}"`,
    `created: ${date}`,
    `updated: ${date}`,
    `tags: [${tag}]`,
    `aliases: [${aliases.map((alias) => `"${alias}"`).join(", ")}]`,
    "related: []",
    "sources: []",
    "---",
    "",
    `# ${title}`,
    "",
    sectionMd,
  ].join("\n") + "\n"
}

function appendChapterInfo(existing: string, sectionMd: string, today: string): string {
  let updated = existing.replace(/^updated:.*$/m, `updated: ${today}`)
  updated = updated.trimEnd() + "\n\n" + sectionMd + "\n"
  return updated
}

export async function writePatchFieldsToWiki(
  projectPath: string,
  patch: WikiUpdatePatch,
): Promise<string[]> {
  const pp = normalizePath(projectPath)
  const entitiesDir = `${pp}/wiki/entities`
  const today = new Date().toISOString().split("T")[0]

  await createDirectory(entitiesDir)

  const writtenPaths: string[] = []

  for (const entry of patch.entries) {
    if (!shouldPersistPatchEntry(entry)) {
      continue
    }
    try {
      const slug = nodeIdToSlug(entry.entryId)
      const filePath = `${entitiesDir}/${slug}.md`
      const tag = entryTypeToTag(entry.entryType)
      const sectionMd = buildChapterInfoSection(entry)
      const aliases = Array.isArray(entry.fields.aliases)
        ? entry.fields.aliases.map((alias) => String(alias).trim()).filter(Boolean)
        : []

      let contentToWrite: string
      if (await fileExists(filePath)) {
        const existing = await readFile(filePath)
        contentToWrite = appendChapterInfo(existing, sectionMd, today)
      } else {
        contentToWrite = buildNewEntityPage(entry.title, tag, today, sectionMd, aliases)
      }

      await writeFileAtomic(filePath, contentToWrite)
      writtenPaths.push(filePath)
    } catch (err) {
      console.warn(
        `[graph-adapter] Failed to write patch fields for entry ${entry.entryId}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  return writtenPaths
}
