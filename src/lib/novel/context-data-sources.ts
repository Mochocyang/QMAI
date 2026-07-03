/**
 * 具体数据源实现
 * 将原有的数据获取函数重构为数据源对象
 */

import { readFile } from "@/commands/fs"
import { searchWiki } from "@/lib/search"
import { parseFrontmatter } from "@/lib/frontmatter"
import { parseChapterMeta } from "./chapter-meta"
import { listSnapshots, loadSnapshot, type ChapterSnapshot } from "./chapter-ingest"
import { loadRevisionFeedbackForContext, createEmptyRevisionFeedback } from "./revision-feedback"
import { loadCognitionState, cognitionToContextText } from "./character-cognition"
import { getChapterVolumes } from "./volume"
import { readSoulDoc } from "./soul-doc"
import { buildWritingStyleContext } from "./writing-style-store"
import type { DataSource, ContextLoadContext } from "./context-data-source"
import { loadFrameworks } from "./story-simulation/framework-store"
import { loadBinding, buildBindingContext } from "./story-simulation/framework-binding"
import { RetrievalStore } from "./retrieval"
import { writeFileAtomic, fileExists, listDirectory, createDirectory } from "@/commands/fs"
import type { DataSourceCategory } from "./classification"

// 导入现有的辅助函数
import {
  readOutlineContent,
  readChapterOutlineContent,
  searchRelevantContentUnified,
  searchGraphRelevantContent,
  selectLookbackChapterNumbers,
  joinNonEmpty,
} from "./context-engine"

const RECENT_CHAPTER_CONTENT_MAX_CHARS = 6000
const RECENT_CHAPTER_CONTENT_HEAD_CHARS = 2200
const RECENT_CHAPTER_CONTENT_TAIL_CHARS = 3200

const DATA_SOURCE_CATEGORY_MAP: Record<string, DataSourceCategory[]> = {
  outline: ["outline"],
  chapterOutline: ["outline"],
  volumeContext: ["outline", "settings"],
  snapshots: ["recent_summaries", "chapter_content", "character_states", "foreshadowing", "timeline"],
  retrieval: ["recent_summaries", "character_states", "foreshadowing", "timeline"],
  recentChapterContents: ["chapter_content"],
  fallbackRecentSummaries: ["recent_summaries"],
  fallbackPreviousEnding: ["chapter_content"],
  fallbackCharacterStates: ["character_states"],
  fallbackForeshadowingStates: ["foreshadowing"],
  fallbackTimeline: ["timeline"],
  relatedSettings: ["settings"],
  canonRules: ["settings"],
  writingStyle: ["settings"],
  searchResults: ["memory", "plot_tools"],
  graphSearchResults: ["graph"],
  revisionFeedback: ["revision"],
  cognitionText: ["character_states"],
  soulDoc: ["soul"],
  characterAuras: ["character_states", "soul"],
  storyFrameworkBinding: ["settings", "outline"],
}

function selectRecentChapterNumbersForContent(chapterNumber: number | undefined, count: number): number[] {
  if (!chapterNumber || chapterNumber <= 1) return []
  const start = Math.max(1, chapterNumber - Math.max(1, count))
  const numbers: number[] = []
  for (let current = start; current < chapterNumber; current += 1) {
    numbers.push(current)
  }
  return numbers
}

function stripFrontmatterBody(content: string): string {
  return parseFrontmatter(content).body.trim()
}

function excerptChapterContent(body: string): string {
  const normalized = body.trim()
  if (normalized.length <= RECENT_CHAPTER_CONTENT_MAX_CHARS) return normalized
  const head = normalized.slice(0, RECENT_CHAPTER_CONTENT_HEAD_CHARS).trimEnd()
  const tail = normalized.slice(-RECENT_CHAPTER_CONTENT_TAIL_CHARS).trimStart()
  return `${head}\n\n[章节正文中段已按上下文预算省略]\n\n${tail}`
}

/**
 * 大纲数据源
 */
export const outlineDataSource: DataSource<string> = {
  name: "outline",
  priority: 1,
  async load(context: ContextLoadContext): Promise<string> {
    return await readOutlineContent(context.projectPath)
  },
}

/**
 * 章节大纲数据源
 */
export const chapterOutlineDataSource: DataSource<string> = {
  name: "chapterOutline",
  priority: 2,
  async load(context: ContextLoadContext): Promise<string> {
    if (!context.chapterNumber) return ""
    return await readChapterOutlineContent(context.projectPath, context.chapterNumber)
  },
}

/**
 * 卷信息数据源
 */
export const volumeContextDataSource: DataSource<string> = {
  name: "volumeContext",
  priority: 3,
  async load(context: ContextLoadContext): Promise<string> {
    if (!context.chapterNumber) return ""
    try {
      const volumes = await getChapterVolumes(context.projectPath, context.chapterNumber)
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
  },
}

/**
 * 快照上下文数据源
 */
export const snapshotDataSource: DataSource<{
  recentSummaries: string[]
  previousChapterEnding: string
  characterStates: string
  foreshadowingSignals: string[]
  timeline: string
}> = {
  name: "snapshots",
  priority: 4,
  async load(context: ContextLoadContext) {
    const { projectPath, chapterNumber, config } = context
    const snapshotNumbers = await listSnapshots(projectPath)
    
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
      ? selectLookbackChapterNumbers(chapterNumber, config.snapshotLookback)
      : [...snapshotNumbers].sort((a, b) => b - a).slice(0, config.snapshotLookback)
    
    const summaryNumbers = chapterNumber
      ? snapshotNumbers.filter((n) => n < chapterNumber).slice(-config.recentSummaryWindow)
      : snapshotNumbers.slice(-config.recentSummaryWindow)

    const [lookbackSnapshots, summarySnapshots] = await Promise.all([
      Promise.all(lookbackNumbers.map((n) => loadSnapshot(projectPath, n))),
      Promise.all(summaryNumbers.map((n) => loadSnapshot(projectPath, n))),
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
  },
}

/**
 * 降级：近期章节摘要数据源
 */
export const recentChapterContentsDataSource: DataSource<string[]> = {
  name: "recentChapterContents",
  priority: 5,
  async load(context: ContextLoadContext): Promise<string[]> {
    const chapterNumbers = selectRecentChapterNumbersForContent(
      context.chapterNumber,
      context.config.recentSummaryWindow,
    )
    if (chapterNumbers.length === 0) return []

    const contents: string[] = []
    for (const chapterNumber of chapterNumbers) {
      try {
        const results = await searchWiki(context.projectPath, `chapter_number:${chapterNumber}`)
        if (results.length === 0) continue
        const content = await readFile(results[0].path)
        const body = stripFrontmatterBody(content)
        if (!body) continue
        contents.push(`## 第${chapterNumber}章正文片段\n${excerptChapterContent(body)}`)
      } catch {}
    }
    return contents
  },
}

export const fallbackRecentSummariesDataSource: DataSource<string[]> = {
  name: "fallbackRecentSummaries",
  priority: 5,
  async load(context: ContextLoadContext): Promise<string[]> {
    const summaries: string[] = []
    try {
      const results = await searchWiki(context.projectPath, "type:chapter")
      for (const r of results.slice(0, context.config.recentSummaryWindow)) {
        try {
          const content = await readFile(r.path)
          const parsed = parseFrontmatter(content)
          const fm = parsed.frontmatter as Record<string, unknown> | null
          const meta = fm ? parseChapterMeta(fm) : null
          if (meta) {
            const bodyStart = content.indexOf("---", 4)
            const body = bodyStart >= 0 ? content.slice(bodyStart + 3).trim() : content
            summaries.push(`第${meta.chapterNumber}章 (${meta.status}): ${body.slice(0, 800)}`)
          }
        } catch {}
      }
    } catch {}
    return summaries
  },
}

/**
 * 降级：前一章结尾数据源
 */
export const fallbackPreviousEndingDataSource: DataSource<string> = {
  name: "fallbackPreviousEnding",
  priority: 6,
  async load(context: ContextLoadContext): Promise<string> {
    if (!context.chapterNumber || context.chapterNumber <= 1) return ""
    try {
      const results = await searchWiki(context.projectPath, `chapter_number:${context.chapterNumber - 1}`)
      if (results.length > 0) {
        const content = await readFile(results[0].path)
        const bodyStart = content.indexOf("---", 4)
        const body = bodyStart >= 0 ? content.slice(bodyStart + 3).trim() : content
        const lines = body.split("\n")
        return lines.slice(-30).join("\n").slice(-1200)
      }
    } catch {}
    return ""
  },
}

/**
 * 降级：角色状态数据源
 */
export const fallbackCharacterStatesDataSource: DataSource<string> = {
  name: "fallbackCharacterStates",
  priority: 7,
  async load(context: ContextLoadContext): Promise<string> {
    try {
      const results = await searchWiki(context.projectPath, "type:entity character")
      if (results.length > 0) {
        const contents = await Promise.all(results.slice(0, 5).map(r => readFile(r.path).catch(() => "")))
        return contents.filter(Boolean).join("\n---\n").slice(0, 3000)
      }
    } catch {}
    return ""
  },
}

/**
 * 降级：伏笔状态数据源
 */
export const fallbackForeshadowingStatesDataSource: DataSource<string> = {
  name: "fallbackForeshadowingStates",
  priority: 8,
  async load(context: ContextLoadContext): Promise<string> {
    try {
      const results = await searchWiki(context.projectPath, "伏笔 foreshadowing")
      if (results.length > 0) {
        const contents = await Promise.all(results.slice(0, 3).map(r => readFile(r.path).catch(() => "")))
        return contents.filter(Boolean).join("\n---\n").slice(0, 2000)
      }
    } catch {}
    return ""
  },
}

/**
 * 降级：时间线数据源
 */
export const fallbackTimelineDataSource: DataSource<string> = {
  name: "fallbackTimeline",
  priority: 9,
  async load(context: ContextLoadContext): Promise<string> {
    try {
      const results = await searchWiki(context.projectPath, "timeline 时间线")
      if (results.length > 0) {
        const content = await readFile(results[0].path)
        return content.slice(0, 2000)
      }
    } catch {}
    return ""
  },
}

/**
 * 相关设定数据源
 */
export const relatedSettingsDataSource: DataSource<string> = {
  name: "relatedSettings",
  priority: 10,
  async load(context: ContextLoadContext): Promise<string> {
    try {
      const results = await searchWiki(context.projectPath, "setting 设定 location 地点")
      if (results.length > 0) {
        const contents = await Promise.all(results.slice(0, 3).map(r => readFile(r.path).catch(() => "")))
        return contents.filter(Boolean).join("\n---\n").slice(0, 2000)
      }
    } catch {}
    return ""
  },
}

/**
 * 正史规则数据源
 */
export const canonRulesDataSource: DataSource<string> = {
  name: "canonRules",
  priority: 11,
  async load(context: ContextLoadContext): Promise<string> {
    try {
      const results = await searchWiki(context.projectPath, "canon 正史 rule 规则")
      if (results.length > 0) {
        const content = await readFile(results[0].path)
        return content.slice(0, 2000)
      }
    } catch {}
    return ""
  },
}

/**
 * 写作风格数据源
 */
export const writingStyleDataSource: DataSource<string> = {
  name: "writingStyle",
  priority: 12,
  async load(context: ContextLoadContext): Promise<string> {
    try {
      const enabledStyle = await buildWritingStyleContext(context.projectPath)
      if (enabledStyle.trim()) return enabledStyle
    } catch {}

    try {
      const results = await searchWiki(context.projectPath, "style 风格 writing 写作")
      if (results.length > 0) {
        const content = await readFile(results[0].path)
        return content.slice(0, 1000)
      }
    } catch {}
    return ""
  },
}

/**
 * 搜索结果数据源
 */
export const searchResultsDataSource: DataSource<string> = {
  name: "searchResults",
  priority: 13,
  async load(context: ContextLoadContext): Promise<string> {
    return await searchRelevantContentUnified(
      context.projectPath,
      context.task,
      context.chapterNumber,
      context.config.searchTopK
    )
  },
}

/**
 * 图谱搜索结果数据源
 */
export const graphSearchResultsDataSource: DataSource<string> = {
  name: "graphSearchResults",
  priority: 14,
  async load(context: ContextLoadContext): Promise<string> {
    return await searchGraphRelevantContent(
      context.projectPath,
      context.task,
      context.chapterNumber
    )
  },
}

/**
 * 修订反馈数据源
 */
export const revisionFeedbackDataSource: DataSource<any> = {
  name: "revisionFeedback",
  priority: 15,
  async load(context: ContextLoadContext): Promise<any> {
    if (!context.chapterNumber) return createEmptyRevisionFeedback()
    return await loadRevisionFeedbackForContext(
      context.projectPath,
      context.chapterNumber,
      context.config.revisionFeedbackWindowConfig
    )
  },
}

/**
 * 认知状态数据源
 */
export const cognitionTextDataSource: DataSource<string> = {
  name: "cognitionText",
  priority: 16,
  async load(context: ContextLoadContext): Promise<string> {
    try {
      const state = await loadCognitionState(context.projectPath)
      if (!state) return ""
      return cognitionToContextText(state)
    } catch {}
    return ""
  },
}

/**
 * 灵魂文档数据源
 */
export const soulDocDataSource: DataSource<string> = {
  name: "soulDoc",
  priority: 17,
  async load(context: ContextLoadContext): Promise<string> {
    return await readSoulDoc(context.projectPath)
  },
}

/**
 * 角色氛围数据源（依赖其他数据源的结果，需要后处理）
 */
export const characterAurasDataSource: DataSource<string> = {
  name: "characterAuras",
  priority: 18,
  async load(_context: ContextLoadContext): Promise<string> {
    // 这个数据源需要依赖其他数据，将在主函数中单独处理
    return ""
  },
}

/**
 * 故事框架绑定数据源
 * 加载当前激活的框架绑定，构建注入 AI 会话的上下文文本。
 */
export const storyFrameworkBindingDataSource: DataSource<string> = {
  name: "storyFrameworkBinding",
  priority: 19,
  async load(context: ContextLoadContext): Promise<string> {
    try {
      const binding = await loadBinding(context.projectPath)
      if (!binding) return ""
      const frameworks = await loadFrameworks(context.projectPath)
      const framework = frameworks.find((f) => f.id === binding.frameworkId)
      if (!framework) return ""
      return buildBindingContext(binding, framework)
    } catch {
      return ""
    }
  },
}

/**
 * Retrieval 索引数据源
 * 从 retrieval.md 主索引读取最近章节摘要
 */
export const retrievalDataSource: DataSource<{
  recentSummaries: string[]
  characterStates: string
  foreshadowingSignals: string[]
  timeline: string
}> = {
  name: "retrieval",
  priority: 3,
  async load(context: ContextLoadContext) {
    const { projectPath, chapterNumber, config } = context
    const store = createRetrievalStoreForDataSource(projectPath)
    const hasIndex = await store.hasIndex()
    
    if (!hasIndex) {
      return {
        recentSummaries: [],
        characterStates: "",
        foreshadowingSignals: [],
        timeline: "",
      }
    }

    try {
      const allEntries = await store.getAllEntries()
      const sortedEntries = [...allEntries].sort((a, b) => a.chapterNumber - b.chapterNumber)
      
      const summaryCount = config.recentSummaryWindow
      const lookbackCount = config.snapshotLookback
      
      const summaryEntries = chapterNumber
        ? sortedEntries.filter((e) => e.chapterNumber < chapterNumber).slice(-summaryCount)
        : sortedEntries.slice(-summaryCount)
      
      const lookbackEntries = chapterNumber
        ? sortedEntries.filter((e) => e.chapterNumber < chapterNumber).slice(-lookbackCount)
        : sortedEntries.slice(-lookbackCount)

      const recentSummaries = summaryEntries.map(
        (entry) => `第${entry.chapterNumber}章 ${entry.chapterTitle}：${entry.summary}`
      )
      
      const characterStates = joinNonEmpty(
        lookbackEntries
          .filter((e) => e.characterStates)
          .map((e) => `第${e.chapterNumber}章：${e.characterStates}`),
        "\n",
      )
      
      const foreshadowingSignals = lookbackEntries
        .filter((e) => e.foreshadowingChanges)
        .flatMap((e) => e.foreshadowingChanges.split("\n").filter(Boolean))
      
      const timeline = joinNonEmpty(
        lookbackEntries
          .filter((e) => e.timelineEvents)
          .map((e) => `第${e.chapterNumber}章：${e.timelineEvents}`),
        "\n",
      )

      return {
        recentSummaries,
        characterStates,
        foreshadowingSignals,
        timeline,
      }
    } catch (err) {
      console.warn("[DataSource] retrieval load failed:", err)
      return {
        recentSummaries: [],
        characterStates: "",
        foreshadowingSignals: [],
        timeline: "",
      }
    }
  },
}

function createRetrievalStoreForDataSource(projectPath: string): RetrievalStore {
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

/**
 * 获取所有数据源
 */
export function getAllDataSources(): DataSource<any>[] {
  return [
    outlineDataSource,
    chapterOutlineDataSource,
    volumeContextDataSource,
    snapshotDataSource,
    retrievalDataSource,
    recentChapterContentsDataSource,
    fallbackRecentSummariesDataSource,
    fallbackPreviousEndingDataSource,
    fallbackCharacterStatesDataSource,
    fallbackForeshadowingStatesDataSource,
    fallbackTimelineDataSource,
    relatedSettingsDataSource,
    canonRulesDataSource,
    writingStyleDataSource,
    searchResultsDataSource,
    graphSearchResultsDataSource,
    revisionFeedbackDataSource,
    cognitionTextDataSource,
    soulDocDataSource,
    storyFrameworkBindingDataSource,
  ]
}

export function getDataSourceNamesForCategories(categories: DataSourceCategory[]): string[] {
  const allowed = new Set(categories)
  return getAllDataSources()
    .filter((source) => (DATA_SOURCE_CATEGORY_MAP[source.name] || []).some((category) => allowed.has(category)))
    .map((source) => source.name)
}

export function getDataSourcesForCategories(categories?: DataSourceCategory[]): DataSource<any>[] {
  if (!categories || categories.length === 0) return getAllDataSources()
  const allowedNames = new Set(getDataSourceNamesForCategories(categories))
  return getAllDataSources().filter((source) => allowedNames.has(source.name))
}
