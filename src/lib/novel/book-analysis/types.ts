
import type { StyleMetrics } from "./style-metrics"

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
  | "extracting_style"
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
  recognitionStatus?: "idle" | "heuristic" | "llm_recognizing" | "llm_scoring" | "done" | "error"
  recognizedCharactersCount?: number
  /** 简单提取进度（feature/character-recognition-and-simple-mode） */
  simpleExtractionStatus?: "idle" | "running" | "done" | "error" | "partial"
  simpleExtractionCompleted?: number
  simpleExtractionTotal?: number
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
  motivation?: string
  goals?: string[]
  fears?: string[]
  growthArc?: string
  behaviorPatterns?: string
  representativeQuotes?: Array<{
    chapterId: string
    text: string
  }>
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
  bookId?: string
  /** 作品级写作文风画像（feature/book-style-extraction），未提取时为 undefined。 */
  styleProfile?: BookStyleProfile
}

// 分析任务状态
export interface BookAnalysisTask {
  id: string
  projectPath: string
  bookId: string
  /** 拆书作品目录绝对路径（projectPath/book-analysis/bookId）。
   *  仅在拆书完成后由 updateTaskBookData 写入；用于"现在处理"重建章节选择面板。 */
  bookPath?: string
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
  /** 作品级写作文风画像（feature/book-style-extraction）。 */
  styleProfile?: BookStyleProfile
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

// === 作品级写作文风（feature/book-style-extraction → feature/writing-dna）===
/**
 * 分层蒸馏产物（writing-dna 的 L1-L6，已映射到小说语境）。
 * 每层是一段可直接写入 markdown 的中文说明；整合文档由 integratedDna 承载。
 */
export interface WritingDnaLayers {
  /** L1 语言 DNA：模型对确定性统计（句长、标点、词频）的解读 */
  languageDna: string
  /** L2 章节结构模板：开场 hook、场景切换、章尾钩子、单章场景数 */
  structurePatterns: string
  /** L3-L5 叙事视角与认知框架：推进取舍、细节素材、作者价值判断 */
  cognitiveFrame: string
  /** L6 排版与节奏：段落长度节奏、一句一段用法、分隔方式 */
  rhythmGuide: string
}

/**
 * 从一本拆书作品提取的"作品级叙事文风"画像。
 * 区别于角色灵魂（人物的说话方式），这是作者的整体叙事风格。
 *
 * schemaVersion 2 起改为 writing-dna 分层蒸馏：metrics 是脚本统计的确定性数字，
 * layers 是 L1-L6 分层解读，integratedDna 是注入生成的总入口（上限约 4000 字）。
 * v1 的 9 个维度字段全部保留为可选，既能读旧数据，也让旧 UI 与校验引擎继续工作。
 */
export interface BookStyleProfile {
  schemaVersion: 1 | 2
  generatedAt: number
  sampledChapterIds: string[]
  /** v2：L1 / L6 的确定性统计结果（不调 LLM 算出）。 */
  metrics?: StyleMetrics
  /** v2：L1-L6 分层蒸馏产物。 */
  layers?: WritingDnaLayers
  /** v2：整合文档正文，注入生成时的首选内容。 */
  integratedDna?: string
  /** v1 维度，v2 仍会尽量填充以兼容旧 UI 与 verification-engine。 */
  narrativeDensity?: string
  descriptionWeight?: string
  emotionRendering?: string
  sentenceStyle?: string
  rhetoricDensity?: string
  transitionStyle?: string
  narrativeVoice?: string
  dialogueStyle?: string
  thematicHabits?: string
  humorMechanisms?: string[]
  highEnergyMechanisms?: string[]
  pointOfView?: string
  vocabularyPreferences?: string[]
  avoidPatterns?: string[]
  evidenceIds?: string[]
  /** 8~12 条注入用"风格宪法"硬约束。v2 仍保留，作为 integratedDna 缺失时的降级内容。 */
  constitution: string
  /** 3~6 段代表原文片段，作为模仿锚点（few-shot）。 */
  samples: string[]
}

// === 作品库索引（feature/book-analysis-reuse）===
export interface BookLibraryEntry {
  bookId: string
  sourcePath: string         // 标准化路径
  contentHash: string        // 旧版 fingerprintFileSample 采样指纹，保留以兼容已有索引
  contentSha256?: string      // 规范化完整正文的 SHA-256；旧版索引可能不存在
  title: string
  author?: string
  totalChapters: number
  totalWords: number
  charactersCount: number
  skillsCount: number
  status: "completed" | "error" | "partial"
  createdAt: number
  updatedAt: number
}

export interface BookLibrary {
  version: 1
  entries: BookLibraryEntry[]
}
