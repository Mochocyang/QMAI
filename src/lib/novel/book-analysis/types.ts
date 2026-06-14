/**
 * 拆书分析系统 - 类型定义（精简版，聚焦角色提取）
 */

/** 6 维度分析深度档位（feature/book-analysis-6d-skill） */
export type AnalysisDepth = "fast" | "standard" | "deep"

/** 角色名称归一表（feature/book-analysis-6d-skill） */
export interface NameAliasMap {
  canonical: string
  aliases: string[]
}

/** 6 维度研究结果（feature/book-analysis-6d-skill） */
export interface SixDimensionResearch {
  publicMaterial: string
  speechStyle: string
  expressionDna: string
  externalViews: string
  decisionLog: string
  timeline: string
}

/** 6 维度元数据（feature/book-analysis-6d-skill） */
export interface SixDimensionMeta {
  depth: AnalysisDepth
  schemaVersion: 1
  generatedAt: number
  webSearchUsed: boolean
  llmFallbackUsed: boolean
  sourceNote: string
}

export type SixDimensionKey =
  | "publicMaterial"
  | "speechStyle"
  | "expressionDna"
  | "externalViews"
  | "decisionLog"
  | "timeline"

export type SixDimensionStatus = "pending" | "running" | "done" | "failed"

export interface SixDimensionProgressItem {
  key: SixDimensionKey
  label: string
  status: SixDimensionStatus
}

export type BookAnalysisStage =
  | "idle"
  | "reading_file"
  | "splitting_chapters"
  | "extracting_characters"
  | "analyzing_six_dimension"  // 6 维度细粒度进度（feature/book-analysis-6d-skill）
  | "generating_skills"
  | "completed"
  | "error"

export interface BookAnalysisConfig {
  sourceType: "file"
  sourcePath: string
  selectedChapters: string[]
}

export interface BookAnalysisMetadata {
  title: string
  author?: string
  totalChapters: number
  totalWords: number
  sourceType: "file"
  createdAt: number
  updatedAt: number
}

export interface BookAnalysisProgress {
  stage: BookAnalysisStage
  stageLabel: string
  completed: number
  total: number
  percentage: number
  currentItem?: string
  estimatedTimeMs?: number
  /** 6 维度分析时（feature/book-analysis-6d-skill）：当前正在处理的角色名 */
  currentCharacter?: string
  /** 6 维度分析时：当前正在处理的维度 key */
  currentDimension?: SixDimensionKey
  /** 6 维度分析时：6 个维度的完整状态清单（UI 可直接渲染） */
  dimensions?: SixDimensionProgressItem[]
}

export interface BookAnalysisCheckpoint {
  version: 1
  taskId: string
  projectPath: string
  stage: BookAnalysisStage
  completedStages: string[]
  currentStage: string
  lastUpdateTime: number
  progress: {
    splitChapters: number
    extractedCharacters: number
    generatedSkills: number
  }
  createdAt: number
  updatedAt: number
}

// 章节选择状态
export interface ChapterSelectionState {
  chapterId: string
  title: string
  order: number
  wordCount: number
  selected: boolean
  analyzed: boolean
}

// 提取的角色（核心数据结构）
export interface ExtractedCharacter {
  id: string
  name: string
  aliases: string[]
  importance: number
  category: "protagonist" | "antagonist" | "supporting" | "minor"
  firstAppearance: number
  lastAppearance: number
  appearanceCount: number
  description: string
  personality: string
  speechStyle: string
  relationships: Array<{
    target: string
    relation: string
    description?: string
  }>
  keyEvents: Array<{
    chapterId: string
    description: string
  }>
  corpus?: string
  aliasMap?: NameAliasMap
  sixDimensionResearch?: SixDimensionResearch
  sixDimensionMeta?: SixDimensionMeta
}

// 角色 Skill
export interface CharacterSkill {
  id: string
  characterId: string
  characterName: string
  skillContent: string
  sourceBook: string
  chapterRange: string[]
  createdAt: number
  filePath?: string
  depth?: AnalysisDepth
  sixDimensionMeta?: SixDimensionMeta
}

// 分析结果（用于查看器）
export interface BookAnalysisResult {
  metadata: BookAnalysisMetadata
  characters: ExtractedCharacter[]
  skills: CharacterSkill[]
}

// 分析任务状态
export interface BookAnalysisTask {
  id: string
  projectPath: string
  bookId: string
  config: BookAnalysisConfig
  metadata?: BookAnalysisMetadata
  progress: BookAnalysisProgress
  status: "running" | "paused" | "completed" | "error"
  error?: string
  startedAt: number
  updatedAt: number
  completedAt?: number
  abortController?: AbortController
  chapters?: Array<{
    id: string
    title: string
    order: number
    wordCount: number
    path: string
  }>
  characters?: ExtractedCharacter[]
  skills?: CharacterSkill[]
}

// 作品库信息
export interface BookAnalysisLibrary {
  version: 1
  books: Array<{
    id: string
    title: string
    author?: string
    totalChapters: number
    totalWords: number
    createdAt: number
    updatedAt: number
    charactersCount: number
    skillsCount: number
  }>
}
