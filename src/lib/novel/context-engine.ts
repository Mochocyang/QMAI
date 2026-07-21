import { listDirectory, readFile } from "@/commands/fs"
import i18n from "@/i18n"
import { searchWiki, tokenizeQuery } from "@/lib/search"
import { normalizePath } from "@/lib/path-utils"
import { useWikiStore } from "@/stores/wiki-store"
import { parseChapterMeta } from "./chapter-meta"
import { parseFrontmatter } from "@/lib/frontmatter"
import { listSnapshots, loadSnapshot, type ChapterSnapshot } from "./chapter-ingest"
import { buildRevisionDirectives } from "./revision-feedback"
import { extractChapterOutlineStatus } from "./outline-quality-check"
import { loadCognitionState, cognitionToContextText } from "./character-cognition"
import { getChapterVolumes } from "./volume"
import { isAuthoritativeGenerationPath, isHistoricalProjectionSnippet, novelMixedSearch } from "./search-adapter"
import { rerankCandidates } from "@/lib/rerank"
import type { FileNode } from "@/types/wiki"
import {
  DataSourceRegistry,
  type ContextLoadContext,
  type DataSourceLoadAdapter,
} from "./context-data-source"
import { getAllDataSources, getDataSourcesForCategories } from "./context-data-sources"
import type { DataSourceCategory } from "./classification"
import { stripOutlineFrontmatter } from "./outline-markdown"

const FIELD_PRIORITY: Record<string, number> = {
  sectionBriefing: 0,
  task: 1,
  chapterGoal: 2,
  mustDo: 3,
  mustAvoid: 4,
  soulDoc: 5,
  outline: 6,
  recentSummaries: 7,
  previousChapterEnding: 8,
  characterStates: 9,
  characterAuras: 10,
  foreshadowingStates: 11,
  recentChapterContents: 12,
  revisionDirectives: 13,
  cognitionStates: 14,
  timeline: 15,
  relatedSettings: 16,
  canonRules: 17,
  nextChapterAdvice: 18,
  writingStyle: 19,
  searchResults: 20,
  graphSearchResults: 21,
}

export interface TrimResult {
  prompt: string
  trimmedFields: string[]
  partiallyTrimmedField?: {
    fieldKey: string
    originalChars: number
    keptChars: number
  }
  trimmedChars: number
  originalChars: number
  finalChars: number
}

export interface ContextPack {
  task: string
  chapterGoal: string
  outline: string
  recentChapterContents?: string[]
  recentSummaries: string[]
  previousChapterEnding: string
  characterStates: string
  soulDoc: string
  characterAuras: string
  cognitionStates: string
  foreshadowingStates: string
  sectionBriefing?: string
  timeline: string
  relatedSettings: string
  canonRules: string
  writingStyle: string
  searchResults: string
  graphSearchResults: string
  mustDo: string
  mustAvoid: string
  nextChapterAdvice: string
  revisionDirectives: string
}

export async function buildContextPack(
  projectPath: string,
  task: string,
  chapterNumber?: number,
  options?: { categories?: DataSourceCategory[]; loadAdapter?: DataSourceLoadAdapter },
): Promise<ContextPack> {
  const pp = normalizePath(projectPath)
  const novelMode = useWikiStore.getState().novelMode
  if (!novelMode) {
    return emptyPack(task)
  }

  // 构建加载上下文
  const context = buildLoadContext(pp, task, chapterNumber)
  
  // 创建数据源注册器并加载所有数据
  const registry = createDataSourceRegistry(options?.categories, options?.loadAdapter)
  const rawData = await registry.loadAll(context)
  
  // 从原始数据构建上下文包
  return buildContextPackFromRawData(rawData, context)
}

/**
 * 构建加载上下文配置
 */
function buildLoadContext(
  projectPath: string,
  task: string,
  chapterNumber?: number,
): ContextLoadContext {
  const novelConfig = useWikiStore.getState().novelConfig
  const revisionFeedbackWindowConfig = useWikiStore.getState().revisionFeedbackWindowConfig
  
  return {
    projectPath,
    task,
    chapterNumber: chapterNumber ?? extractChapterNumberFromTask(task),
    config: {
      recentSummaryWindow: novelConfig.recentSummaryWindow > 0 ? novelConfig.recentSummaryWindow : 8,
      searchTopK: novelConfig.searchTopK > 0 ? novelConfig.searchTopK : 5,
      snapshotLookback: 3,
      revisionFeedbackWindowConfig,
    },
  }
}

/**
 * 创建并配置数据源注册器
 */
function createDataSourceRegistry(
  categories?: DataSourceCategory[],
  loadAdapter?: DataSourceLoadAdapter,
): DataSourceRegistry {
  const registry = new DataSourceRegistry({ loadAdapter })
  registry.registerAll(categories?.length ? getDataSourcesForCategories(categories) : getAllDataSources())
  
  return registry
}

/**
 * 从原始数据构建上下文包
 */
async function buildContextPackFromRawData(
  rawData: Record<string, any>,
  context: ContextLoadContext,
): Promise<ContextPack> {
  const searchResults = joinNonEmpty([
    rawData.searchResults || "",
    rawData.bookAnalysisReferences || "",
  ], "\n\n")
  // 合并快照数据和降级数据，优先使用 retrieval 索引
  const retrievalRecentSummaries = Array.isArray(rawData.retrieval?.recentSummaries)
    ? rawData.retrieval.recentSummaries
    : []
  const snapshotRecentSummaries = Array.isArray(rawData.snapshots?.recentSummaries)
    ? rawData.snapshots.recentSummaries
    : []
  const recentSummaries = retrievalRecentSummaries.length > 0
    ? retrievalRecentSummaries
    : snapshotRecentSummaries.length > 0 
    ? snapshotRecentSummaries 
    : rawData.fallbackRecentSummaries
  const recentChapterContents = Array.isArray(rawData.recentChapterContents)
    ? rawData.recentChapterContents
    : []
  
  const previousChapterEnding = rawData.snapshots.previousChapterEnding 
    || rawData.fallbackPreviousEnding
  
  const retrievalCharacterStates = rawData.retrieval?.characterStates || ""
  const snapshotCharacterStates = rawData.snapshots?.characterStates || ""
  const characterStates = joinNonEmpty([
    retrievalCharacterStates,
    snapshotCharacterStates, 
    rawData.fallbackCharacterStates
  ], "\n\n")
  
  const retrievalTimeline = rawData.retrieval?.timeline || ""
  const snapshotTimeline = rawData.snapshots?.timeline || ""
  const timeline = joinNonEmpty([
    retrievalTimeline,
    snapshotTimeline, 
    rawData.fallbackTimeline
  ], "\n\n")
  
  const retrievalForeshadowingSignals = Array.isArray(rawData.retrieval?.foreshadowingSignals)
    ? rawData.retrieval.foreshadowingSignals
    : []
  const snapshotForeshadowingSignals = Array.isArray(rawData.snapshots?.foreshadowingSignals)
    ? rawData.snapshots.foreshadowingSignals
    : []
  const foreshadowingSignals = retrievalForeshadowingSignals.length > 0
    ? retrievalForeshadowingSignals
    : snapshotForeshadowingSignals
  const foreshadowingStates = mergeForeshadowingSignals(
    foreshadowingSignals.length > 0 
      ? foreshadowingSignals 
      : [rawData.fallbackForeshadowingStates].filter(Boolean),
    searchResults,
  )
  
  // 构建章节目标
  const chapterGoal = buildChapterGoal(
    rawData.outline, 
    rawData.chapterOutline, 
    context.chapterNumber
  )
  
  // 合并大纲信息
  const mergedOutline = joinNonEmpty([
    rawData.outline,
    rawData.volumeContext,
    rawData.chapterOutline
  ], "\n\n")
  
  // 构建修订指令
  const revisionDirectives = buildRevisionDirectives(rawData.revisionFeedback)
  
  // 构建角色氛围上下文（依赖其他数据）
  const { buildCharacterAuraContext } = await import("./character-aura")
  const characterAuras = await buildCharacterAuraContext(context.projectPath, context.task, {
    matchingText: joinNonEmpty([
      chapterGoal,
      rawData.chapterOutline,
      rawData.fallbackCharacterStates,
      rawData.snapshots.characterStates,
      rawData.cognitionText,
    ], "\n\n"),
  })

  return {
    task: context.task,
    chapterGoal,
    outline: mergedOutline,
    recentChapterContents,
    recentSummaries,
    previousChapterEnding,
    characterStates,
    soulDoc: rawData.soulDoc,
    sectionBriefing: rawData.sectionBriefing || "",
    characterAuras,
    cognitionStates: rawData.cognitionText,
    foreshadowingStates,
    timeline,
    relatedSettings: rawData.relatedSettings,
    canonRules: rawData.canonRules,
    writingStyle: rawData.writingStyle,
    searchResults,
    graphSearchResults: rawData.graphSearchResults,
    mustDo: buildMustDo(chapterGoal, previousChapterEnding, foreshadowingStates),
    mustAvoid: buildMustAvoid(rawData.canonRules, timeline, characterStates),
    nextChapterAdvice: buildNextChapterAdvice({
      chapterGoal,
      recentSummaries,
      previousChapterEnding,
      foreshadowingStates,
      timeline,
      searchResults,
    }),
    revisionDirectives,
  }
}

export function extractChapterNumberFromTask(task: string): number | undefined {
  const patterns = [
    /\u7b2c\s*(\d+)\s*\u7ae0/i,
    /chapter\s*(\d+)/i,
    /ch\.?\s*(\d+)/i,
  ]
  for (const pattern of patterns) {
    const match = task.match(pattern)
    if (match) {
      const value = Number(match[1])
      if (Number.isFinite(value) && value > 0) return value
    }
  }
  return undefined
}

export function selectLookbackChapterNumbers(chapterNumber: number, lookback: number): number[] {
  const result: number[] = []
  for (let current = chapterNumber - 1; current >= 1 && result.length < lookback; current -= 1) {
    result.push(current)
  }
  return result
}

export function mergeForeshadowingSignals(signals: string[], searchResults: string): string {
  const normalized = signals
    .map((signal) => signal.trim())
    .filter(Boolean)

  if (normalized.length === 0 && !searchResults.trim()) return ""

  const unresolved = normalized.filter(signal => /未回收|未解决|新增伏笔/i.test(signal))
  const repeated = unresolved.filter(signal => {
    const keyword = signal.split(/[：:]/)[0]?.trim()
    return keyword && searchResults.includes(keyword)
  })

  const sections = [normalized.join("\n")]
  if (repeated.length > 0) {
    const names = repeated
      .map(signal => signal.split(/[：:]/)[0]?.trim())
      .filter(Boolean)
    sections.push(`以下伏笔近期反复出现，但尚未明显推进，需注意是否在本章继续铺设或回收：${Array.from(new Set(names)).join("、")}`)
  }
  return sections.filter(Boolean).join("\n\n")
}

export function buildChapterGoal(outline: string, chapterOutline: string, chapterNumber?: number): string {
  const parts: string[] = []
  const fromOutline = extractChapterGoal(outline, chapterNumber)
  const fromChapterOutline = extractChapterGoal(chapterOutline, chapterNumber)
  if (fromOutline) parts.push(fromOutline)
  if (fromChapterOutline && !parts.includes(fromChapterOutline)) parts.push(fromChapterOutline)
  return parts.join("\n")
}

export function buildMustDo(chapterGoal: string, previousChapterEnding: string, foreshadowingStates: string): string {
  const items: string[] = []
  chapterGoal.split("\n").map((line) => line.trim()).filter(Boolean).forEach((line) => items.push(`- ${line}`))
  if (previousChapterEnding.trim()) {
    items.push(i18n.t("novel.contextPack.mustDo.previousChapterEnding", { value: previousChapterEnding.trim() }))
  }
  if (foreshadowingStates.trim()) {
    const firstForeshadowing = foreshadowingStates.split("\n").find(Boolean)
    if (firstForeshadowing) {
      items.push(i18n.t("novel.contextPack.mustDo.foreshadowing", { value: firstForeshadowing.trim() }))
    }
  }
  return items.join("\n")
}

export function buildMustAvoid(canonRules: string, timeline: string, characterStates: string): string {
  const items: string[] = []
  if (canonRules.trim()) items.push(i18n.t("novel.contextPack.mustAvoid.canonRules", { value: canonRules.trim() }))
  if (timeline.trim()) items.push(i18n.t("novel.contextPack.mustAvoid.timeline", { value: timeline.trim() }))
  if (characterStates.trim()) items.push(i18n.t("novel.contextPack.mustAvoid.characterStates", { value: characterStates.trim() }))
  return items.join("\n")
}

export function buildNextChapterAdvice(input: {
  chapterGoal: string
  recentSummaries: string[]
  previousChapterEnding: string
  foreshadowingStates: string
  timeline: string
  searchResults: string
}): string {
  const advice: string[] = []
  if (input.previousChapterEnding.trim()) {
    advice.push(i18n.t("novel.contextPack.nextChapterAdvice.previousChapterEnding", { value: input.previousChapterEnding.trim() }))
  }
  if (input.chapterGoal.trim()) {
    advice.push(i18n.t("novel.contextPack.nextChapterAdvice.chapterGoal", { value: input.chapterGoal.trim() }))
  }
  if (input.foreshadowingStates.trim()) {
    const firstForeshadowing = input.foreshadowingStates.split("\n").find(Boolean)
    if (firstForeshadowing) {
      advice.push(i18n.t("novel.contextPack.nextChapterAdvice.foreshadowing", { value: firstForeshadowing.trim() }))
    }
  }
  if (input.timeline.trim()) {
    advice.push(i18n.t("novel.contextPack.nextChapterAdvice.timeline", { value: input.timeline.trim() }))
  }
  if (input.searchResults.trim()) {
    advice.push(i18n.t("novel.contextPack.nextChapterAdvice.searchResults", { value: input.searchResults.trim() }))
  }
  if (input.recentSummaries.length > 0) {
    advice.push(i18n.t("novel.contextPack.nextChapterAdvice.recentSummaries", { value: input.recentSummaries.slice(-2).join("；") }))
  }
  return advice.join("\n")
}

export function joinNonEmpty(parts: string[], separator: string): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(separator)
}

function emptyPack(task: string): ContextPack {
  return {
    task,
    chapterGoal: "",
    outline: "",
    recentChapterContents: [],
    recentSummaries: [],
    previousChapterEnding: "",
    characterStates: "",
    soulDoc: "",
    characterAuras: "",
    cognitionStates: "",
    foreshadowingStates: "",
    sectionBriefing: "",
    timeline: "",
    relatedSettings: "",
    canonRules: "",
    writingStyle: "",
    searchResults: "",
    graphSearchResults: "",
    mustDo: "",
    mustAvoid: "",
    nextChapterAdvice: "",
    revisionDirectives: "",
  }
}

export async function readOutlineContent(pp: string): Promise<string> {
  try {
    const results = await searchWiki(pp, "outline type:outline")
    if (results.length > 0) {
      const contents = await Promise.all(
        results.map(async (result) => {
          try {
            return stripOutlineFrontmatter(await readFile(result.path))
          } catch {
            return ""
          }
        }),
      )
      return joinNonEmpty(contents, "\n\n")
    }
  } catch {}
  try {
    const tree = await listDirectory(`${pp}/wiki/outlines`)
    const files = flattenOutlineMarkdownFiles(tree).slice(0, 80)
    const contents = await Promise.all(
      files.map(async (file) => stripOutlineFrontmatter(await readFile(file.path)).trim()),
    )
    return joinNonEmpty(contents, "\n\n")
  } catch {}
  return ""
}

function flattenOutlineMarkdownFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir) {
      if (node.children) files.push(...flattenOutlineMarkdownFiles(node.children))
      continue
    }
    if (node.name.toLowerCase().endsWith(".md")) files.push(node)
  }
  return files
}

function readFrontmatterChapterNumber(content: string): number | undefined {
  const raw = parseFrontmatter(content).frontmatter?.chapter_number
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function numberToChineseChapter(value: number): string {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"]
  if (value <= 10) {
    if (value === 10) return "十"
    return digits[value] ?? String(value)
  }
  if (value < 20) return `十${digits[value - 10]}`
  if (value < 100) {
    const tens = Math.floor(value / 10)
    const ones = value % 10
    return `${digits[tens]}十${ones === 0 ? "" : digits[ones]}`
  }
  if (value < 1000) {
    const hundreds = Math.floor(value / 100)
    const rest = value % 100
    if (rest === 0) return `${digits[hundreds]}百`
    if (rest < 10) return `${digits[hundreds]}百零${digits[rest]}`
    return `${digits[hundreds]}百${numberToChineseChapter(rest)}`
  }
  return String(value)
}

function chapterLabels(chapterNumber: number): string[] {
  return [`第${chapterNumber}章`, `第${numberToChineseChapter(chapterNumber)}章`]
}

function includesChapterMarker(text: string, chapterNumber: number): boolean {
  const compact = text.replace(/\s+/g, "")
  return chapterLabels(chapterNumber).some((label) => compact.includes(label)) ||
    new RegExp(`chapter\\s*${chapterNumber}\\b`, "i").test(text)
}

export function pickChapterOutlineByNumber(
  candidates: Array<{ path: string; content: string }>,
  chapterNumber: number,
): string {
  const frontmatterMatch = candidates.find((candidate) => readFrontmatterChapterNumber(candidate.content) === chapterNumber)
  if (frontmatterMatch) return frontmatterMatch.content.slice(0, 4000)

  const headingMatch = candidates.find((candidate) =>
    includesChapterMarker(candidate.content, chapterNumber) || includesChapterMarker(candidate.path, chapterNumber),
  )
  if (headingMatch) return headingMatch.content.slice(0, 4000)

  return ""
}

async function readChapterOutlineDirect(pp: string, chapterNumber: number): Promise<string> {
  try {
    const tree = await listDirectory(`${pp}/wiki/outlines`)
    const files = flattenOutlineMarkdownFiles(tree)
    const candidates = await Promise.all(
      files.slice(0, 80).map(async (file) => ({
        path: file.path,
        content: await readFile(file.path).catch(() => ""),
      })),
    )
    return pickChapterOutlineByNumber(
      candidates.filter((candidate) => candidate.content.trim()),
      chapterNumber,
    )
  } catch {
    return ""
  }
}

export async function readChapterOutlineContent(pp: string, chapterNumber?: number): Promise<string> {
  if (!chapterNumber) return ""
  const direct = await readChapterOutlineDirect(pp, chapterNumber)
  if (direct.trim()) return annotateChapterOutlineStatus(direct)
  const queries = [
    `第${chapterNumber}章细纲 outline`,
    `chapter ${chapterNumber} outline`,
    `chapter_number:${chapterNumber} outline_type:chapter-outline`,
  ]
  for (const query of queries) {
    try {
      const results = await searchWiki(pp, query)
      if (results.length > 0) {
        return annotateChapterOutlineStatus(await readFile(results[0].path)).slice(0, 3000)
      }
    } catch {}
  }
  return ""
}

export function annotateChapterOutlineStatus(content: string): string {
  const status = extractChapterOutlineStatus(content)
  if (status === "已确认") return content
  const label = status === "未知" ? "未标明当前状态" : `当前状态为「${status}」`
  return [
    `【章纲状态提示】该章纲${label}，普通 AI 会话生成正文前应提醒用户确认是否继续使用；不得自行补写或改写章纲。`,
    "",
    content,
  ].join("\n")
}

// 以下函数已被数据源模式使用，但通过动态导入，TypeScript 无法检测到
// @ts-expect-error - 函数通过动态导入在 context-data-sources.ts 中使用
async function readSnapshotContext(
  pp: string,
  chapterNumber: number | undefined,
  recentSummaryWindow: number,
  snapshotLookback: number,
): Promise<{
  recentSummaries: string[]
  previousChapterEnding: string
  characterStates: string
  foreshadowingSignals: string[]
  timeline: string
}> {
  const snapshotNumbers = await listSnapshots(pp)
  if (snapshotNumbers.length === 0) {
    return {
      recentSummaries: [],
      previousChapterEnding: "",
      characterStates: "",
      foreshadowingSignals: [],
      timeline: "",
    }
  }

  const lookbackNumbers = chapterNumber
    ? selectLookbackChapterNumbers(chapterNumber, snapshotLookback)
    : [...snapshotNumbers].sort((a, b) => b - a).slice(0, snapshotLookback)
  const summaryNumbers = chapterNumber
    ? snapshotNumbers.filter((n) => n < chapterNumber).slice(-recentSummaryWindow)
    : snapshotNumbers.slice(-recentSummaryWindow)

  const [lookbackSnapshots, summarySnapshots] = await Promise.all([
    Promise.all(lookbackNumbers.map((n) => loadSnapshot(pp, n))),
    Promise.all(summaryNumbers.map((n) => loadSnapshot(pp, n))),
  ])

  const validLookback = lookbackSnapshots.filter((snapshot): snapshot is ChapterSnapshot => Boolean(snapshot))
  const validSummarySnapshots = summarySnapshots.filter((snapshot): snapshot is ChapterSnapshot => Boolean(snapshot))

  const previousSnapshot = validLookback[0]
  const recentSummaries = validSummarySnapshots.map((snapshot) => `第${snapshot.chapterNumber}章：${snapshot.summary}`)
  const characterStates = joinNonEmpty(
    validLookback
      .flatMap((snapshot) => snapshot.characterStateChanges.map((change) => `第${snapshot.chapterNumber}章：${change}`)),
    "\n",
  )
  const foreshadowingSignals = validLookback.flatMap((snapshot) => snapshot.foreshadowingChanges)
  const timeline = joinNonEmpty(
    validLookback
      .flatMap((snapshot) => snapshot.timelineEvents.map((event) => `第${snapshot.chapterNumber}章：${event}`)),
    "\n",
  )

  return {
    recentSummaries,
    previousChapterEnding: previousSnapshot?.endingHook || "",
    characterStates,
    foreshadowingSignals,
    timeline,
  }
}

// @ts-expect-error - 函数通过动态导入在 context-data-sources.ts 中使用
async function readRecentChapterSummaries(pp: string, count: number): Promise<string[]> {
  const summaries: string[] = []
  try {
    const results = await searchWiki(pp, "type:chapter")
    for (const r of results.slice(0, count)) {
      try {
        const content = await readFile(r.path)
        const parsed = parseFrontmatter(content)
        const fm = parsed.frontmatter as Record<string, unknown> | null
        const meta = fm ? parseChapterMeta(fm) : null
        if (meta) {
          const bodyStart = content.indexOf("---", 4)
          const body = bodyStart >= 0 ? content.slice(bodyStart + 3).trim() : content
          summaries.push(`第${meta.chapterNumber}章 (${meta.status}): ${body.slice(0, 500)}`)
        }
      } catch {}
    }
  } catch {}
  return summaries
}

// @ts-expect-error - 函数通过动态导入在 context-data-sources.ts 中使用
async function readPreviousChapterEnding(pp: string, chapterNumber?: number): Promise<string> {
  if (!chapterNumber || chapterNumber <= 1) return ""
  try {
    const results = await searchWiki(pp, `chapter_number:${chapterNumber - 1}`)
    if (results.length > 0) {
      const content = await readFile(results[0].path)
      const lines = content.split("\n")
      const lastLines = lines.slice(-10).join("\n")
      return lastLines
    }
  } catch {}
  return ""
}

// @ts-expect-error - 函数通过动态导入在 context-data-sources.ts 中使用
async function readCharacterStates(pp: string): Promise<string> {
  try {
    const results = await searchWiki(pp, "type:entity character")
    if (results.length > 0) {
      const contents = await Promise.all(results.slice(0, 5).map(r => readFile(r.path).catch(() => "")))
      return contents.filter(Boolean).join("\n---\n").slice(0, 3000)
    }
  } catch {}
  return ""
}

// @ts-expect-error - 函数通过动态导入在 context-data-sources.ts 中使用
async function readCognitionStates(pp: string): Promise<string> {
  try {
    const state = await loadCognitionState(pp)
    if (!state) return ""
    return cognitionToContextText(state)
  } catch {}
  return ""
}

// @ts-expect-error - 函数通过动态导入在 context-data-sources.ts 中使用
async function readForeshadowingStates(pp: string): Promise<string> {
  try {
    const results = await searchWiki(pp, "伏笔 foreshadowing")
    if (results.length > 0) {
      const contents = await Promise.all(results.slice(0, 3).map(r => readFile(r.path).catch(() => "")))
      return contents.filter(Boolean).join("\n---\n").slice(0, 2000)
    }
  } catch {}
  return ""
}

// @ts-expect-error - 函数通过动态导入在 context-data-sources.ts 中使用
async function readTimeline(pp: string): Promise<string> {
  try {
    const results = await searchWiki(pp, "timeline 时间线")
    if (results.length > 0) {
      const content = await readFile(results[0].path)
      return content.slice(0, 2000)
    }
  } catch {}
  return ""
}

// @ts-expect-error - 函数通过动态导入在 context-data-sources.ts 中使用
async function readRelatedSettings(pp: string): Promise<string> {
  try {
    const results = await searchWiki(pp, "setting 设定 location 地点")
    if (results.length > 0) {
      const contents = await Promise.all(results.slice(0, 3).map(r => readFile(r.path).catch(() => "")))
      return contents.filter(Boolean).join("\n---\n").slice(0, 2000)
    }
  } catch {}
  return ""
}

// @ts-expect-error - 函数通过动态导入在 context-data-sources.ts 中使用
async function readCanonRules(pp: string): Promise<string> {
  try {
    const results = await searchWiki(pp, "canon 正史 rule 规则")
    if (results.length > 0) {
      const content = await readFile(results[0].path)
      return content.slice(0, 2000)
    }
  } catch {}
  return ""
}

// @ts-expect-error - 函数通过动态导入在 context-data-sources.ts 中使用
async function readWritingStyle(pp: string): Promise<string> {
  // 优先：已启用的拆书作品文风预设（feature/book-style-extraction）。
  // buildWritingStyleContext 内部已做长度上限与"只学文风不借剧情"硬约束。
  try {
    const { buildWritingStyleContext } = await import("./writing-style-store")
    const styleContext = await buildWritingStyleContext(pp)
    if (styleContext.trim()) return styleContext
  } catch {}
  // 回退：wiki 中的风格页（旧行为）。
  try {
    const results = await searchWiki(pp, "style 风格 writing 写作")
    if (results.length > 0) {
      const content = await readFile(results[0].path)
      return content.slice(0, 1000)
    }
  } catch {}
  return ""
}

// @ts-expect-error - 函数通过动态导入在 context-data-sources.ts 中使用
async function readVolumeContext(
  pp: string,
  chapterNumber: number | undefined,
): Promise<string> {
  if (!chapterNumber) return ""
  try {
    const volumes = await getChapterVolumes(pp, chapterNumber)
    if (volumes.length === 0) return ""
    return volumes
      .map(v => {
        const parts = [`第${v.volumeNumber}卷：${v.title}`]
        if (v.summary) parts.push(`概要：${v.summary}`)
        if (v.chapterRangeStart !== undefined && v.chapterRangeEnd !== undefined) {
          parts.push(`章节范围：第${v.chapterRangeStart}章 - 第${v.chapterRangeEnd}章`)
        }
        return parts.join("\n")
      })
      .join("\n\n")
  } catch {
    return ""
  }
}

export async function searchRelevantContent(
  pp: string,
  task: string,
  chapterNumber: number | undefined,
  limit: number,
): Promise<string> {
  const tokens = tokenizeQuery(task)
  const entityHints = tokens.filter(t => t.length >= 2).slice(0, 5)
  const queryParts = [task]
  if (chapterNumber) {
    queryParts.push(`第${chapterNumber}章`)
  }
  if (entityHints.length > 0) {
    queryParts.push(entityHints.join(" "), "伏笔", "人物", "设定", "时间线")
  } else {
    queryParts.push("伏笔", "人物", "设定")
  }
  const query = queryParts.join(" ")

  const [keywordResults, indexResults, vectorResults] = await Promise.all([
    searchWiki(pp, query).catch(() => []),
    searchWiki(pp, `关键词索引 向量索引 ${task}`).catch(() => []),
    runVectorSearchForContext(pp, query, limit).catch(() => []),
  ])

  const seen = new Set<string>()
  const merged: string[] = []

  const add = (title: string, snippet: string) => {
    const key = `${title}|${snippet.slice(0, 50)}`
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(`- ${title}: ${snippet}`)
    }
  }

  for (const r of keywordResults.slice(0, limit)) {
    add(r.title, r.snippet ?? "")
  }
  for (const r of indexResults.slice(0, limit)) {
    add(r.title, r.snippet ?? "")
  }
  for (const r of vectorResults.slice(0, limit)) {
    add(r.title, r.snippet)
  }

  return merged.slice(0, Math.max(limit, limit * 2)).join("\n")
}

export async function searchRelevantContentUnified(
  pp: string,
  task: string,
  chapterNumber: number | undefined,
  limit: number,
): Promise<string> {
  const tokens = tokenizeQuery(task)
  const entityHints = tokens.filter((t) => t.length >= 2).slice(0, 5)
  const queryParts = [task]
  if (chapterNumber) {
    queryParts.push(`chapter ${chapterNumber}`)
  }
  if (entityHints.length > 0) {
    queryParts.push(entityHints.join(" "), "伏笔", "人物", "设定", "时间线")
  } else {
    queryParts.push("伏笔", "人物", "设定")
  }
  const query = queryParts.join(" ")

  const [semanticResults, indexResults, vectorResults] = await Promise.all([
    novelMixedSearch({
      projectPath: pp,
      query,
      chapterNumber,
      topK: Math.max(limit * 2, 6),
      authoritativeOnly: true,
      includeKeyword: true,
      includeVector: true,
      includeGraph: true,
      includeRecentChapters: true,
      includeCanon: true,
    }).catch(() => []),
    searchWiki(pp, `关键词索引 向量索引 ${task}`, {
      rerank: true,
      topK: Math.max(limit, 4),
      rerankPurpose: "用于补充剧情上下文中的索引和记忆条目。",
    }).catch(() => []),
    runVectorSearchForContext(pp, query, limit).catch(() => []),
  ])

  const candidates = [
    ...semanticResults.map((result) => ({
      id: `${result.type}:${result.path}`,
      path: result.path,
      title: result.title,
      snippet: result.snippet ?? "",
      source: result.type,
    })),
    ...indexResults.map((result) => ({
      id: `index:${result.path}`,
      path: result.path,
      title: result.title,
      snippet: result.snippet ?? "",
      source: "index",
    })),
    ...vectorResults.map((result, index) => ({
      id: `vector-context:${index}:${result.title}`,
      path: result.path,
      title: result.title,
      snippet: result.snippet,
      source: "vector_context",
    })),
  ].filter((item) => {
    const path = typeof (item as { path?: unknown }).path === "string"
      ? (item as { path?: string }).path ?? ""
      : ""
    const snippet = item.snippet ?? ""
    if (!path || isHistoricalProjectionSnippet(path, snippet)) return false
    return isAuthoritativeGenerationPath(path)
  })

  const reranked = await rerankCandidates(query, candidates, {
    topK: Math.max(limit * 2, limit),
    purpose: "用于构建小说写作上下文，优先保留最能支撑当前章节任务的记忆、设定、伏笔和正史约束。",
  }).catch(() => candidates)

  const merged: string[] = []
  const seen = new Set<string>()
  for (const result of reranked) {
    const key = `${result.title}|${result.snippet.slice(0, 50)}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(`- ${result.title}: ${result.snippet}`)
  }

  return merged.slice(0, Math.max(limit * 2, limit)).join("\n")
}

async function runVectorSearchForContext(
  pp: string,
  query: string,
  limit: number,
): Promise<{ title: string; snippet: string; path: string }[]> {
  const embCfg = useWikiStore.getState().embeddingConfig
  if (!embCfg.enabled || !embCfg.model) return []

  try {
    const { searchByEmbedding } = await import("@/lib/embedding")
    const vectorResults = await searchByEmbedding(pp, query, embCfg, Math.max(limit * 2, 10))
    if (vectorResults.length === 0) return []

    const items: { title: string; snippet: string; path: string }[] = []
    const dirs = ["entities", "concepts", "sources", "synthesis", "comparison", "queries"]

    for (const vr of vectorResults.slice(0, limit)) {
      let found = false
      for (const dir of dirs) {
        const tryPath = `${pp}/wiki/${dir}/${vr.id}.md`
        try {
          const content = await readFile(tryPath)
          const title = content.match(/^#\s+(.+)/m)?.[1]?.trim()
            ?? content.match(/^---\ntitle:\s*(.+)/m)?.[1]?.trim()
            ?? vr.id
          items.push({ title, snippet: content.slice(0, 300).replace(/\n/g, " "), path: tryPath })
          found = true
          break
        } catch {}
      }
      if (!found) {
        const tryPath = `${pp}/wiki/${vr.id}.md`
        try {
          const content = await readFile(tryPath)
          items.push({ title: vr.id, snippet: content.slice(0, 300).replace(/\n/g, " "), path: tryPath })
        } catch {}
      }
    }
    return items
  } catch {
    return []
  }
}

export async function searchGraphRelevantContent(
  pp: string,
  task: string,
  _chapterNumber: number | undefined,
): Promise<string> {
  try {
    const { buildRetrievalGraph, getRelatedNodes } = await import("@/lib/graph-relevance")
    const graph = await buildRetrievalGraph(pp)
    if (graph.nodes.size === 0) return ""

    const tokens = tokenizeQuery(task)
    const candidateNames = new Set<string>()

    for (const token of tokens) {
      if (token.length >= 2) candidateNames.add(token)
    }

    for (const [, node] of graph.nodes) {
      if (task.includes(node.title) || task.includes(node.id)) {
        candidateNames.add(node.title)
        candidateNames.add(node.id)
      }
      for (const name of candidateNames) {
        if (node.title.includes(name) || node.id.includes(name)) {
          candidateNames.add(node.title)
          candidateNames.add(node.id)
        }
      }
    }

    const seenIds = new Set<string>()
    const scoredNodes: { title: string; snippet: string; relevance: number }[] = []

    for (const name of candidateNames) {
      const matchedNodes = Array.from(graph.nodes.values()).filter(
        n => n.title.includes(name) || n.id.includes(name),
      )
      for (const matchedNode of matchedNodes) {
        if (seenIds.has(matchedNode.id)) continue
        seenIds.add(matchedNode.id)

        const related = getRelatedNodes(matchedNode.id, graph, 5)
        for (const { node, relevance } of related) {
          if (seenIds.has(node.id)) continue
          seenIds.add(node.id)
          try {
            const content = await readFile(node.path)
            scoredNodes.push({
              title: node.title,
              snippet: content.slice(0, 300).replace(/\n/g, " "),
              relevance: Math.round(relevance * 100) / 100,
            })
          } catch {}
        }
      }
    }

    scoredNodes.sort((a, b) => b.relevance - a.relevance)
    const topNodes = await rerankCandidates(
      task,
      scoredNodes.slice(0, 10).map((node, index) => ({
        id: `graph:${index}:${node.title}`,
        title: node.title,
        snippet: node.snippet,
        source: "graph_context",
        relevance: node.relevance,
      })),
      {
        topK: 10,
        purpose: "用于补充图谱关联上下文，优先保留和当前任务最直接相关的关联节点。",
      },
    ).catch(() => scoredNodes.slice(0, 10))

    const nodeResults = topNodes.length > 0
      ? topNodes.map(
          n => `- 【${n.title}】(关联度 ${n.relevance}): ${n.snippet}`,
        ).join("\n")
      : ""

    // 追加社区摘要向量检索
    let communityResults = ""
    try {
      const { searchCommunitySummaries } = await import("./community-summary")
      communityResults = await searchCommunitySummaries(pp, task, 3)
    } catch {
      // 社区摘要检索失败不影响主流程
    }

    return [nodeResults, communityResults].filter(Boolean).join("\n")
  } catch {
    return ""
  }
}

export function extractChapterGoal(outline: string, chapterNumber?: number): string {
  if (!chapterNumber || !outline) return ""
  const cleaned = outline.replace(/^---[\s\S]*?---\s*/m, "").trim()
  for (const line of cleaned.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const compact = trimmed.replace(/\s+/g, "")
    for (const label of chapterLabels(chapterNumber)) {
      if (compact.includes(label)) {
        const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        const rest = trimmed.replace(new RegExp(`^#*\\s*${escapedLabel}[：:、\\s-]*`), "").trim()
        return (rest || cleaned).slice(0, 2500)
      }
    }
    const englishMatch = trimmed.match(new RegExp(`^#*\\s*Chapter\\s*${chapterNumber}[：:\\s-]*(.+)?$`, "i"))
    if (englishMatch) {
      return ((englishMatch[1] ?? "").trim() || cleaned).slice(0, 2500)
    }
  }
  if (includesChapterMarker(cleaned, chapterNumber)) return cleaned.slice(0, 2500)
  return ""
}

interface FieldConfig {
  titleKey: string
  fieldKey: keyof ContextPack
}

const FIELD_CONFIGS: FieldConfig[] = [
  { titleKey: "novel.contextPack.sectionBriefing", fieldKey: "sectionBriefing" },
  { titleKey: "novel.contextPack.currentChapterGoal", fieldKey: "chapterGoal" },
  { titleKey: "novel.contextPack.mustDo.title", fieldKey: "mustDo" },
  { titleKey: "novel.contextPack.mustAvoid.title", fieldKey: "mustAvoid" },
  { titleKey: "novel.contextPack.nextChapterAdvice.title", fieldKey: "nextChapterAdvice" },
  { titleKey: "novel.contextPack.soulDoc", fieldKey: "soulDoc" },
  { titleKey: "novel.contextPack.recentRevisionDirectives", fieldKey: "revisionDirectives" },
  { titleKey: "novel.contextPack.requiredOutline", fieldKey: "outline" },
  { titleKey: "novel.contextPack.recentChapterContents", fieldKey: "recentChapterContents" },
  { titleKey: "novel.contextPack.recentPlotSummaries", fieldKey: "recentSummaries" },
  { titleKey: "novel.contextPack.previousChapterEnding", fieldKey: "previousChapterEnding" },
  { titleKey: "novel.contextPack.characterStates", fieldKey: "characterStates" },
  { titleKey: "novel.contextPack.characterAuras", fieldKey: "characterAuras" },
  { titleKey: "novel.contextPack.cognitionStates", fieldKey: "cognitionStates" },
  { titleKey: "novel.contextPack.foreshadowingStates", fieldKey: "foreshadowingStates" },
  { titleKey: "novel.contextPack.timeline", fieldKey: "timeline" },
  { titleKey: "novel.contextPack.relatedSettings", fieldKey: "relatedSettings" },
  { titleKey: "novel.contextPack.canonRules", fieldKey: "canonRules" },
  { titleKey: "novel.contextPack.writingStyle", fieldKey: "writingStyle" },
  { titleKey: "novel.contextPack.searchResults", fieldKey: "searchResults" },
  { titleKey: "novel.contextPack.graphSearchResults", fieldKey: "graphSearchResults" },
]

export function contextPackToPrompt(pack: ContextPack, tokenBudget?: number, options?: { excludeOutline?: boolean }): string {
  const result = trimContextPack(pack, tokenBudget, options)
  return result.prompt
}

function trimFieldContent(content: string | string[], maxChars: number): string | string[] {
  if (Array.isArray(content)) {
    if (content.length === 0) return content
    const result: string[] = []
    let total = 0
    for (let i = content.length - 1; i >= 0; i--) {
      const item = content[i]
      if (total + item.length <= maxChars) {
        result.unshift(item)
        total += item.length
      } else {
        break
      }
    }
    if (result.length === 0 && content.length > 0) {
      const last = content[content.length - 1]
      return [last.slice(0, maxChars) + "..."]
    }
    return result
  } else {
    if (content.length <= maxChars) return content
    if (maxChars < 50) return content.slice(0, maxChars) + "..."
    const headChars = Math.floor(maxChars * 0.4)
    const tailChars = maxChars - headChars - 5
    return content.slice(0, headChars) + "\n...\n" + content.slice(-tailChars)
  }
}

export function trimContextPack(
  pack: ContextPack,
  tokenBudget?: number,
  options?: { excludeOutline?: boolean }
): TrimResult {
  const sections: string[] = []

  sections.push(i18n.t("novel.contextPack.title"))
  sections.push("")
  sections.push(i18n.t("novel.contextPack.currentTask"))
  sections.push(pack.task)
  sections.push("")

  const fieldData: { fieldKey: string; title: string; content: string | string[]; priority: number; charCount: number }[] = []
  for (const config of FIELD_CONFIGS) {
    if (options?.excludeOutline && config.fieldKey === "outline") {
      continue
    }

    const rawContent = pack[config.fieldKey as keyof ContextPack] as string | string[] | undefined
    const content = Array.isArray(rawContent) ? rawContent : rawContent ?? ""
    const hasContent = Array.isArray(content) ? content.length > 0 : Boolean(content)
    if (!hasContent) continue

    const charCount = Array.isArray(content)
      ? content.reduce((sum, item) => sum + item.length, 0)
      : content.length

    fieldData.push({
      fieldKey: config.fieldKey,
      title: i18n.t(config.titleKey),
      content,
      priority: FIELD_PRIORITY[config.fieldKey] ?? 999,
      charCount,
    })
  }

  fieldData.sort((a, b) => a.priority - b.priority)

  const headerChars = sections.join("\n").length + 2
  let totalChars = headerChars + fieldData.reduce((sum, f) => sum + f.charCount + f.title.length + 3, 0)
  const originalChars = totalChars
  const trimmedFields: string[] = []

  const targetChars = tokenBudget ? tokenBudget * 4 : Infinity

  if (totalChars <= targetChars) {
    for (const { title, content } of fieldData) {
      sections.push(title)
      if (Array.isArray(content)) {
        content.forEach(item => sections.push(item))
      } else {
        sections.push(content)
      }
      sections.push("")
    }
    return {
      prompt: sections.join("\n"),
      trimmedFields: [],
      trimmedChars: 0,
      originalChars,
      finalChars: originalChars,
    }
  }

  const sortedByPriorityAsc = [...fieldData].sort((a, b) => a.priority - b.priority)
  let accumulatedChars = headerChars
  let keepCount = 0
  for (let i = 0; i < sortedByPriorityAsc.length; i++) {
    const field = sortedByPriorityAsc[i]
    const fieldTotalChars = field.charCount + field.title.length + 3
    if (accumulatedChars + fieldTotalChars <= targetChars) {
      accumulatedChars += fieldTotalChars
      keepCount = i + 1
    } else {
      break
    }
  }

  for (let i = keepCount; i < sortedByPriorityAsc.length; i++) {
    trimmedFields.push(sortedByPriorityAsc[i].fieldKey)
    totalChars -= sortedByPriorityAsc[i].charCount + sortedByPriorityAsc[i].title.length + 3
  }

  let partiallyTrimmed: { fieldKey: string; originalChars: number; keptChars: number } | null = null

  if (keepCount < sortedByPriorityAsc.length) {
    const nextField = sortedByPriorityAsc[keepCount]
    const remainingBudget = targetChars - accumulatedChars
    const minKeepChars = 100
    const targetContentChars = remainingBudget - nextField.title.length - 3
    const originalFieldChars = nextField.charCount
    
    if (targetContentChars > minKeepChars && nextField.charCount > targetContentChars) {
      const trimmedContent = trimFieldContent(nextField.content, targetContentChars)
      const keptContentChars = Array.isArray(trimmedContent)
        ? trimmedContent.reduce((sum, item) => sum + item.length, 0)
        : trimmedContent.length
      
      if (keptContentChars > 0) {
        nextField.content = trimmedContent
        nextField.charCount = keptContentChars
        totalChars = accumulatedChars + keptContentChars + nextField.title.length + 3
        partiallyTrimmed = {
          fieldKey: nextField.fieldKey,
          originalChars: originalFieldChars,
          keptChars: keptContentChars,
        }
        const idx = trimmedFields.indexOf(nextField.fieldKey)
        if (idx > -1) trimmedFields.splice(idx, 1)
        keepCount++
      }
    }
  }

  const keptFields = sortedByPriorityAsc.slice(0, keepCount)

  for (const { title, content } of keptFields) {
    sections.push(title)
    if (Array.isArray(content)) {
      content.forEach(item => sections.push(item))
    } else {
      sections.push(content)
    }
    sections.push("")
  }

  const trimmedChars = originalChars - totalChars

  if (trimmedFields.length > 0) {
    sections.push(`[...已裁剪 ${trimmedFields.length} 个低优先级上下文字段，约 ${trimmedChars} 字符...]`)
    sections.push("")
  }

  return {
    prompt: sections.join("\n"),
    trimmedFields,
    partiallyTrimmedField: partiallyTrimmed ?? undefined,
    trimmedChars,
    originalChars,
    finalChars: totalChars,
  }
}
