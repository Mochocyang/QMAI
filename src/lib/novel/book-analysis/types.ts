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
  /** 角色识别阶段状态（feature/character-recognition-and-simple-mode） */
  recognitionStatus?: "idle" | "heuristic" | "llm_scoring" | "done" | "error"
  recognizedCharactersCount?: number
  /** 简单提取进度（feature/character-recognition-and-simple-mode） */
  simpleExtractionStatus?: "idle" | "running" | "done" | "error"
  simpleExtractionCompleted?: number
  simpleExtractionTotal?: number
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
  /** 简单提取结果（feature/character-recognition-and-simple-mode） */
  personalityProfile?: PersonalityProfile
  simpleExtractionMeta?: SimpleExtractionMeta
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

// === 角色识别（feature/character-recognition-and-simple-mode）===
export type CharacterCategory = "主角" | "配角" | "次要"

export interface RecognizedCharacter {
  id: string                       // 稳定 id：name + sourceBook 的 hash
  name: string
  aliases: string[]
  appearances: number              // 出场次数（启发式）
  chapterIndices: number[]         // 出场章节索引
  importanceScore: number          // 0-100（LLM 评分）
  category: CharacterCategory      // 按 score 自动分类
  sourceBook: string               // 用于 id 稳定性
}

// === 简单提取（feature/character-recognition-and-simple-mode）===
export interface PersonalityProfile {
  personality: string         // 性格：核心性格特征 + 优缺点
  motivation: string          // 动机：核心目标、欲望、恐惧
  speechStyle: string         // 说话风格：语言习惯、用词偏好、语气
  behaviorPatterns: string    // 行为模式：决策倾向、面对冲突的方式、社交风格
  quotes: string[]            // 代表性台词 3-5 句
}

export interface SimpleExtractionMeta {
  generatedAt: number
  schemaVersion: 1
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
