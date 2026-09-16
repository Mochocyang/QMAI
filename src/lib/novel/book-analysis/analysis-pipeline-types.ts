import type { RecognizedCharacter } from "./types"

export const ANALYSIS_SKILL_ORDER = ["characters", "story", "style"] as const

export type AnalysisSkill = (typeof ANALYSIS_SKILL_ORDER)[number]

export type AnalysisTaskStatus =
  | "awaiting-range"
  | "awaiting-character-selection"
  | "queued"
  | "running"
  | "paused"
  | "failed"
  | "cancelled"
  | "completed"

export type AnalysisChunkStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled"

export type AnalysisSkillStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"

export interface AnalysisChapterRange {
  startOrder: number
  endOrder: number
}

/**
 * 文风 skill 的蒸馏深度（feature/writing-dna）。
 * full：跑齐 L1-L6，3 次 LLM/分片。
 * fast：只跑脚本统计 + L1/L6 一次调用，样本与证据由脚本截取，供大部头快速出结果。
 */
export type StyleAnalysisDepth = "fast" | "full"

export const DEFAULT_STYLE_ANALYSIS_DEPTH: StyleAnalysisDepth = "full"

export interface AnalysisChunkPlan {
  id: string
  chapterIds: string[]
  startOrder: number
  endOrder: number
  wordCount: number
}

export interface AnalysisChunkRecord extends AnalysisChunkPlan {
  version: 1
  taskId: string
  skill: AnalysisSkill
  status: AnalysisChunkStatus
  attempts: number
  resultPath: string | null
  error: string | null
  startedAt: number | null
  completedAt: number | null
  updatedAt: number
}

export interface AnalysisModuleState {
  skill: AnalysisSkill
  status: AnalysisSkillStatus
  range: AnalysisChapterRange
  chunkIds: string[]
  completedChunkIds: string[]
  failedChunkId: string | null
  resultPath: string | null
  summary?: string
  analysisVersion: number
  updatedAt: number
}

export interface BookAnalysisPipelineTask {
  version: 1
  id: string
  batchId: string | null
  projectPath: string
  bookId: string
  bookPath: string
  selectedSkills: AnalysisSkill[]
  range: AnalysisChapterRange | null
  status: AnalysisTaskStatus
  currentSkill: AnalysisSkill | null
  modules: Record<AnalysisSkill, AnalysisModuleState>
  /** 轻量识别结果；供深度分析前的角色勾选面板重开 */
  recognizedCharacters?: RecognizedCharacter[]
  /** 用户确认后的深挖目标；有值时角色 adapter 只分析这些角色 */
  targetCharacters?: RecognizedCharacter[]
  /**
   * 本任务使用的模型 key（`providerId/modelId` 或裸模型名）。
   * 留空表示沿用项目默认模型。存在任务上而不是全局，
   * 是为了让暂停后再继续、以及并行的多个任务各自用回自己当初选的模型。
   */
  modelKey?: string
  /** 文风蒸馏深度；仅 style skill 读取，留空按 DEFAULT_STYLE_ANALYSIS_DEPTH 处理 */
  styleDepth?: StyleAnalysisDepth
  error: string | null
  createdAt: number
  startedAt: number | null
  completedAt: number | null
  updatedAt: number
}

export interface AnalysisEvidenceSnippet {
  version: 1
  id: string
  bookId: string
  skill: AnalysisSkill
  taskId: string
  chapterId: string
  chapterOrder: number
  text: string
  tags: string[]
  reason: string
  purpose: string
  enabled: boolean
  userPinned: boolean
  createdAt: number
  updatedAt: number
}

export interface AnalysisEvidenceCollection {
  version: 1
  bookId: string
  snippets: AnalysisEvidenceSnippet[]
  updatedAt: number
}

export interface BookAnalysisModuleManifest {
  version: 1
  bookId: string
  modules: Partial<Record<AnalysisSkill, AnalysisModuleState>>
  updatedAt: number
}

/** 运行时细进度（仅内存，不落盘） */
export interface AnalysisRuntimeProgress {
  stageLabel: string
  percentage: number
  currentItem?: string
}

export function analysisProgressKey(
  taskId: string,
  skill: AnalysisSkill,
  scope: string,
): string {
  return `${taskId}:${skill}:${scope}`
}

export function normalizeSelectedSkills(skills: AnalysisSkill[]): AnalysisSkill[] {
  const selected = new Set(skills)
  return ANALYSIS_SKILL_ORDER.filter((skill) => selected.has(skill))
}
