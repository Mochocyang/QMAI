import { listDirectory, readFile } from "@/commands/fs"
import i18n from "@/i18n"
import { searchWiki, tokenizeQuery, type SearchWikiOptions } from "@/lib/search"
import { normalizePath } from "@/lib/path-utils"
import { useWikiStore } from "@/stores/wiki-store"
import { parseChapterMeta } from "./chapter-meta"
import { parseFrontmatter } from "@/lib/frontmatter"
import { listSnapshots, loadSnapshot, type ChapterSnapshot } from "./chapter-ingest"
import { buildRevisionDirectives, loadRevisionFeedbackForContext } from "./revision-feedback"
import { loadCognitionState, cognitionToContextText } from "./character-cognition"
import { getChapterVolumes } from "./volume"
import { buildCharacterAuraContext } from "./character-aura"
import { isAuthoritativeGenerationPath, isHistoricalProjectionSnippet, novelMixedSearch } from "./search-adapter"
import { readSoulDoc } from "./soul-doc"
import { rerankCandidates } from "@/lib/rerank"
import type { FileNode } from "@/types/wiki"

const SECTION_PRIORITY: Record<string, number> = {
  "当前任务": 1,
  "当前章节目标": 2,
  "项目灵魂": 3,
  "大纲要求": 4,
  "禁止违背": 5,
  "最近剧情摘要": 6,
  "上一章结尾": 7,
  "当前人物状态": 8,
  "角色灵魂": 9,
  "当前伏笔状态": 10,
  "时间线": 11,
  "角色认知状态": 12,
  "相关地点/组织/物品": 13,
  "相关记忆检索": 14,
  "修改反馈": 15,
  "下一章推进建议": 16,
  "写作风格": 17,
}
const CONTEXT_SEARCH_MAX_CONTENT_CHARS = 20000
const CONTEXT_SEARCH_DEFAULT_TOP_K = 8

export interface ContextPack {
  task: string
  chapterGoal: string
  outline: string
  recentSummaries: string[]
  previousChapterEnding: string
  characterStates: string
  soulDoc: string
  characterAuras: string
  cognitionStates: string
  foreshadowingStates: string
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
): Promise<ContextPack> {
  const pp = normalizePath(projectPath)
  const novelMode = useWikiStore.getState().novelMode
  const novelConfig = useWikiStore.getState().novelConfig
  const revisionFeedbackWindowConfig = useWikiStore.getState().revisionFeedbackWindowConfig
  if (!novelMode) {
    return emptyPack(task)
  }

  const recentSummaryWindow = novelConfig.recentSummaryWindow > 0 ? novelConfig.recentSummaryWindow : 8
  const searchTopK = novelConfig.searchTopK > 0 ? novelConfig.searchTopK : 5
  const snapshotLookback = 3

  const resolvedChapterNumber = chapterNumber ?? extractChapterNumberFromTask(task)
  const [outline, chapterOutline, volumeContext, snapshots, fallbackRecentSummaries, fallbackPreviousEnding, fallbackCharacterStates, fallbackForeshadowingStates, fallbackTimeline, relatedSettings, canonRules, writingStyle, searchResults, graphSearchResults, revisionFeedback, cognitionText, soulDoc] = await Promise.all([
    readOutlineContent(pp),
    readChapterOutlineContent(pp, resolvedChapterNumber),
    readVolumeContext(pp, resolvedChapterNumber),
    readSnapshotContext(pp, resolvedChapterNumber, recentSummaryWindow, snapshotLookback),
    readRecentChapterSummaries(pp, recentSummaryWindow),
    readPreviousChapterEnding(pp, resolvedChapterNumber),
    readCharacterStates(pp),
    readForeshadowingStates(pp),
    readTimeline(pp),
    readRelatedSettings(pp),
    readCanonRules(pp),
    readWritingStyle(pp),
    searchRelevantContentUnified(pp, task, resolvedChapterNumber, searchTopK),
    searchGraphRelevantContent(pp, task, resolvedChapterNumber),
    loadRevisionFeedbackForContext(pp, resolvedChapterNumber, revisionFeedbackWindowConfig),
    readCognitionStates(pp),
    readSoulDoc(pp),
  ])

  const recentSummaries = snapshots.recentSummaries.length > 0 ? snapshots.recentSummaries : fallbackRecentSummaries
  const previousChapterEnding = snapshots.previousChapterEnding || fallbackPreviousEnding
  const characterStates = joinNonEmpty([snapshots.characterStates, fallbackCharacterStates], "\n\n")
  const timeline = joinNonEmpty([snapshots.timeline, fallbackTimeline], "\n\n")
  const foreshadowingStates = mergeForeshadowingSignals(
    snapshots.foreshadowingSignals.length > 0 ? snapshots.foreshadowingSignals : [fallbackForeshadowingStates].filter(Boolean),
    searchResults,
  )
  const chapterGoal = buildChapterGoal(outline, chapterOutline, resolvedChapterNumber)
  const mergedOutline = joinNonEmpty([outline, volumeContext, chapterOutline], "\n\n")
  const revisionDirectives = buildRevisionDirectives(revisionFeedback)
  const characterAuras = await buildCharacterAuraContext(pp, task, {
    matchingText: joinNonEmpty([
      chapterGoal,
      chapterOutline,
      fallbackCharacterStates,
      snapshots.characterStates,
      cognitionText,
    ], "\n\n"),
  })

  return {
    task,
    chapterGoal,
    outline: mergedOutline,
    recentSummaries,
    previousChapterEnding,
    characterStates,
    soulDoc,
    characterAuras,
    cognitionStates: cognitionText,
    foreshadowingStates,
    timeline,
    relatedSettings,
    canonRules,
    writingStyle,
    searchResults,
    graphSearchResults,
    mustDo: buildMustDo(chapterGoal, previousChapterEnding, foreshadowingStates),
    mustAvoid: buildMustAvoid(canonRules, timeline, characterStates),
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

function emptyPack(task: string): ContextPack {
  return {
    task,
    chapterGoal: "",
    outline: "",
    recentSummaries: [],
    previousChapterEnding: "",
    characterStates: "",
    soulDoc: "",
    characterAuras: "",
    cognitionStates: "",
    foreshadowingStates: "",
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

function contextSearchWiki(
  pp: string,
  query: string,
  options: SearchWikiOptions = {},
) {
  return searchWiki(pp, query, {
    ...options,
    includeVector: false,
    maxContentChars: options.maxContentChars ?? CONTEXT_SEARCH_MAX_CONTENT_CHARS,
    topK: options.topK ?? CONTEXT_SEARCH_DEFAULT_TOP_K,
  })
}

async function readOutlineContent(pp: string): Promise<string> {
  try {
    const results = await contextSearchWiki(pp, "outline type:outline", { topK: 12 })
    if (results.length > 0) {
      const contents = await Promise.all(
        results.slice(0, 12).map(async (result) => {
          try {
            return (await readFile(result.path)).slice(0, 2500)
          } catch {
            return ""
          }
        }),
      )
      return joinNonEmpty(contents, "\n\n---\n\n").slice(0, 12000)
    }
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

async function readChapterOutlineContent(pp: string, chapterNumber?: number): Promise<string> {
  if (!chapterNumber) return ""
  const direct = await readChapterOutlineDirect(pp, chapterNumber)
  if (direct.trim()) return direct
  const queries = [
    `第${chapterNumber}章细纲 outline`,
    `chapter ${chapterNumber} outline`,
    `chapter_number:${chapterNumber} outline_type:chapter-outline`,
  ]
  for (const query of queries) {
    try {
      const results = await contextSearchWiki(pp, query, { topK: 1 })
      if (results.length > 0) {
        return (await readFile(results[0].path)).slice(0, 3000)
      }
    } catch {}
  }
  return ""
}

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

async function readRecentChapterSummaries(pp: string, count: number): Promise<string[]> {
  const summaries: string[] = []
  try {
    const results = await contextSearchWiki(pp, "type:chapter", { topK: count })
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

async function readPreviousChapterEnding(pp: string, chapterNumber?: number): Promise<string> {
  if (!chapterNumber || chapterNumber <= 1) return ""
  try {
    const results = await contextSearchWiki(pp, `chapter_number:${chapterNumber - 1}`, { topK: 1 })
    if (results.length > 0) {
      const content = await readFile(results[0].path)
      const lines = content.split("\n")
      const lastLines = lines.slice(-10).join("\n")
      return lastLines
    }
  } catch {}
  return ""
}

async function readCharacterStates(pp: string): Promise<string> {
  try {
    const results = await contextSearchWiki(pp, "type:entity character", { topK: 5 })
    if (results.length > 0) {
      const contents = await Promise.all(results.slice(0, 5).map(r => readFile(r.path).catch(() => "")))
      return contents.filter(Boolean).join("\n---\n").slice(0, 3000)
    }
  } catch {}
  return ""
}

async function readCognitionStates(pp: string): Promise<string> {
  try {
    const state = await loadCognitionState(pp)
    if (!state) return ""
    return cognitionToContextText(state)
  } catch {}
  return ""
}

async function readForeshadowingStates(pp: string): Promise<string> {
  try {
    const results = await contextSearchWiki(pp, "伏笔 foreshadowing", { topK: 3 })
    if (results.length > 0) {
      const contents = await Promise.all(results.slice(0, 3).map(r => readFile(r.path).catch(() => "")))
      return contents.filter(Boolean).join("\n---\n").slice(0, 2000)
    }
  } catch {}
  return ""
}

async function readTimeline(pp: string): Promise<string> {
  try {
    const results = await contextSearchWiki(pp, "timeline 时间线", { topK: 1 })
    if (results.length > 0) {
      const content = await readFile(results[0].path)
      return content.slice(0, 2000)
    }
  } catch {}
  return ""
}

async function readRelatedSettings(pp: string): Promise<string> {
  try {
    const results = await contextSearchWiki(pp, "setting 设定 location 地点", { topK: 3 })
    if (results.length > 0) {
      const contents = await Promise.all(results.slice(0, 3).map(r => readFile(r.path).catch(() => "")))
      return contents.filter(Boolean).join("\n---\n").slice(0, 2000)
    }
  } catch {}
  return ""
}

async function readCanonRules(pp: string): Promise<string> {
  try {
    const results = await contextSearchWiki(pp, "canon 正史 rule 规则", { topK: 1 })
    if (results.length > 0) {
      const content = await readFile(results[0].path)
      return content.slice(0, 2000)
    }
  } catch {}
  return ""
}

async function readWritingStyle(pp: string): Promise<string> {
  try {
    const results = await contextSearchWiki(pp, "style 风格 writing 写作", { topK: 1 })
    if (results.length > 0) {
      const content = await readFile(results[0].path)
      return content.slice(0, 1000)
    }
  } catch {}
  return ""
}

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
    contextSearchWiki(pp, query, { topK: limit }).catch(() => []),
    contextSearchWiki(pp, `关键词索引 向量索引 ${task}`, { topK: limit }).catch(() => []),
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

async function searchRelevantContentUnified(
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
      includeGraph: false,
      includeRecentChapters: true,
      includeCanon: true,
    }).catch(() => []),
    contextSearchWiki(pp, `关键词索引 向量索引 ${task}`, {
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

async function searchGraphRelevantContent(
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
    if (topNodes.length === 0) return ""

    return topNodes.map(
      n => `- 【${n.title}】(关联度 ${n.relevance}): ${n.snippet}`,
    ).join("\n")
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

function joinNonEmpty(parts: string[], separator: string): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(separator)
}

interface FieldConfig {
  titleKey: string
  fieldKey: keyof ContextPack
}

const FIELD_CONFIGS: FieldConfig[] = [
  { titleKey: "novel.contextPack.currentChapterGoal", fieldKey: "chapterGoal" },
  { titleKey: "novel.contextPack.mustDo.title", fieldKey: "mustDo" },
  { titleKey: "novel.contextPack.mustAvoid.title", fieldKey: "mustAvoid" },
  { titleKey: "novel.contextPack.nextChapterAdvice.title", fieldKey: "nextChapterAdvice" },
  { titleKey: "novel.contextPack.soulDoc", fieldKey: "soulDoc" },
  { titleKey: "novel.contextPack.recentRevisionDirectives", fieldKey: "revisionDirectives" },
  { titleKey: "novel.contextPack.requiredOutline", fieldKey: "outline" },
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

export function contextPackToPrompt(pack: ContextPack, tokenBudget?: number): string {
  const sections: string[] = []

  sections.push(i18n.t("novel.contextPack.title"))
  sections.push("")
  sections.push(i18n.t("novel.contextPack.currentTask"))
  sections.push(pack.task)
  sections.push("")

  const fieldSections: { title: string; content: string | string[] }[] = []
  for (const config of FIELD_CONFIGS) {
    const content = pack[config.fieldKey] as string | string[]
    const hasContent = Array.isArray(content) ? content.length > 0 : Boolean(content)
    if (!hasContent) continue
    fieldSections.push({ title: i18n.t(config.titleKey), content })
  }

  fieldSections.sort((a, b) => {
    const keyA = a.title.replace(/^##\s*/, "")
    const keyB = b.title.replace(/^##\s*/, "")
    const priorityA = SECTION_PRIORITY[keyA] ?? 999
    const priorityB = SECTION_PRIORITY[keyB] ?? 999
    return priorityA - priorityB
  })

  for (const { title, content } of fieldSections) {
    sections.push(title)
    if (Array.isArray(content)) {
      content.forEach(item => sections.push(item))
    } else {
      sections.push(content)
    }
    sections.push("")
  }

  const fullPrompt = sections.join("\n")

  if (tokenBudget && tokenBudget > 0 && fullPrompt.length > tokenBudget) {
    const estimatedTokens = Math.ceil(fullPrompt.length / 4)
    if (estimatedTokens <= tokenBudget) return fullPrompt
    const targetChars = tokenBudget * 4
    const headChars = Math.floor(targetChars * 0.4)
    const tailChars = targetChars - headChars
    return fullPrompt.slice(0, headChars) + "\n\n[...上下文已按Token预算裁剪...]\n\n" + fullPrompt.slice(-tailChars)
  }

  return fullPrompt
}
