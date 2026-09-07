import * as fs from "@/commands/fs"
import { sha256Text } from "@/lib/context-hub/fingerprint"
import { isAbsolutePath, isPathInside, joinPath, normalizeComparablePath } from "@/lib/path-utils"
import { loadGlobalUserMemoryConfig } from "@/lib/user-memory/store"
import type { GlobalUserMemoryConfig } from "@/lib/user-memory/types"
import type { LlmConfig } from "@/stores/wiki-store"
import { ANALYSIS_RESULT_ALGORITHM_VERSION, buildAnalysisCacheIdentity, type AnalysisResultCacheIo } from "./analysis-result-cache"

export interface AnalysisStageCacheInput {
  bookPath: string
  projectPath?: string
  llmConfig: LlmConfig
  stage: string
  materials: unknown
}

export interface AnalysisStageCache {
  createKey(input: AnalysisStageCacheInput): Promise<string | null>
  read<T>(input: AnalysisStageCacheInput, key: string): Promise<T | null>
  write<T>(input: AnalysisStageCacheInput, key: string, value: T, signal?: AbortSignal): Promise<void>
}

const HASH = /^[a-f0-9]{64}$/
function rootFor(input: AnalysisStageCacheInput): string {
  const book = normalizeComparablePath(input.bookPath)
  if (!isAbsolutePath(book) || book.split("/").some((part) => part === "." || part === "..")
    || (input.projectPath && !isPathInside(book, normalizeComparablePath(input.projectPath)))) {
    throw new Error("分析缓存必须位于指定作品目录内")
  }
  return joinPath(book, "analysis", "stage-cache")
}

/** 汇总/验证成功结果的本地复用，不回放小说创作回答，也不冒充供应商缓存。 */
export function createAnalysisStageCache(options: {
  io?: AnalysisResultCacheIo
  loadUserMemory?: () => GlobalUserMemoryConfig
  now?: () => number
} = {}): AnalysisStageCache {
  const io = options.io ?? {
    createDirectory: (path: string) => fs.createDirectory(path),
    fileExists: (path: string) => fs.fileExists(path),
    readFile: (path: string) => fs.readFile(path),
    writeFileAtomic: (path: string, contents: string) => fs.writeFileAtomic(path, contents),
  }
  return {
    async createKey(input) {
      try {
        rootFor(input)
        if (!input.llmConfig.provider || !input.llmConfig.model?.trim()) return null
        const identity = buildAnalysisCacheIdentity(input.llmConfig,
          (options.loadUserMemory ?? loadGlobalUserMemoryConfig)(), (options.now ?? Date.now)())
        return await sha256Text(JSON.stringify({
          version: ANALYSIS_RESULT_ALGORITHM_VERSION, stage: input.stage,
          bookPath: normalizeComparablePath(input.bookPath), identity, materials: input.materials,
        }))
      } catch { return null }
    },
    async read<T>(input: AnalysisStageCacheInput, key: string): Promise<T | null> {
      try {
        if (!HASH.test(key)) return null
        const path = joinPath(rootFor(input), `${key}.json`)
        if (!await io.fileExists(path)) return null
        const stored = JSON.parse(await io.readFile(path))
        if (stored.version !== ANALYSIS_RESULT_ALGORITHM_VERSION || stored.key !== key
          || stored.stage !== input.stage || stored.value === undefined
          || stored.hash !== await sha256Text(JSON.stringify(stored.value))) return null
        return stored.value as T
      } catch { return null }
    },
    async write<T>(input: AnalysisStageCacheInput, key: string, value: T, signal?: AbortSignal): Promise<void> {
      try {
        if (signal?.aborted || !HASH.test(key) || value === undefined || value === null) return
        const serialized = JSON.stringify(value)
        const hash = await sha256Text(serialized)
        const root = rootFor(input)
        await io.createDirectory(root)
        if (signal?.aborted) return
        await io.writeFileAtomic(joinPath(root, `${key}.json`), JSON.stringify({
          version: ANALYSIS_RESULT_ALGORITHM_VERSION, stage: input.stage, key, hash, value: JSON.parse(serialized),
        }))
      } catch { /* 缓存失败不能影响正常分析。 */ }
    },
  }
}
