import type { LlmConfig } from "@/stores/wiki-store"
import type {
  AnalysisChunkRecord,
  AnalysisEvidenceSnippet,
  AnalysisRuntimeProgress,
  AnalysisSkill,
  BookAnalysisPipelineTask,
} from "./analysis-pipeline-types"

export interface AnalysisSkillContext {
  task: BookAnalysisPipelineTask
  skill: AnalysisSkill
  bookPath: string
  projectPath: string
  llmConfig: LlmConfig
}

export type AnalysisProgressReporter = (progress: AnalysisRuntimeProgress) => void

export interface AnalysisSkillAdapter<TChunk = unknown, TResult = unknown> {
  skill: AnalysisSkill
  runChunk(input: AnalysisSkillContext & {
    chunk: AnalysisChunkRecord
    signal: AbortSignal
    onProgress?: AnalysisProgressReporter
  }): Promise<{
    result: TChunk
    evidence: AnalysisEvidenceSnippet[]
  }>
  aggregate(input: AnalysisSkillContext & {
    chunks: TChunk[]
    signal: AbortSignal
    onProgress?: AnalysisProgressReporter
  }): Promise<TResult>
  publish(input: AnalysisSkillContext & {
    result: TResult
    evidence: AnalysisEvidenceSnippet[]
    signal: AbortSignal
    onProgress?: AnalysisProgressReporter
  }): Promise<string>
}

export interface AnalysisChunkOutput<T = unknown> {
  result: T
  evidence: AnalysisEvidenceSnippet[]
}
