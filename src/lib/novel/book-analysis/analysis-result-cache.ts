import { createDirectory, fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import {
  getEffectiveMaxContextSize,
  getEffectiveMaxOutputTokens,
  getProviderConfig,
} from "@/lib/llm-providers"
import { isAbsolutePath, isPathInside, joinPath, normalizeComparablePath } from "@/lib/path-utils"
import { governUserMemoryConfig } from "@/lib/user-memory/governance"
import { loadGlobalUserMemoryConfig } from "@/lib/user-memory/store"
import type { GlobalUserMemoryConfig } from "@/lib/user-memory/types"
import type { LlmConfig } from "@/stores/wiki-store"
import { normalizeSelectedSkills, type AnalysisChunkRecord } from "./analysis-pipeline-types"
import type { AnalysisChunkOutput, AnalysisSkillContext } from "./analysis-skill-adapter"

// 修改提取提示、采样策略、解析规则或用户偏好注入语义时，必须递增此版本。
export const ANALYSIS_RESULT_ALGORITHM_VERSION = "book-analysis-chunks-v2"
const CACHE_VERSION = 1
const SHA256_PATTERN = /^[a-f0-9]{64}$/

export interface AnalysisResultCacheInput extends AnalysisSkillContext {
  chunk: AnalysisChunkRecord
}

export interface AnalysisResultCacheIo {
  createDirectory(path: string): Promise<void>
  fileExists(path: string): Promise<boolean>
  readFile(path: string): Promise<string>
  writeFileAtomic(path: string, contents: string): Promise<void>
}

export interface AnalysisResultCache {
  createKey(input: AnalysisResultCacheInput): Promise<string | null>
  read(input: AnalysisResultCacheInput, key: string): Promise<AnalysisChunkOutput | null>
  write(input: AnalysisResultCacheInput, key: string, output: AnalysisChunkOutput, signal?: AbortSignal): Promise<void>
}

const defaultIo: AnalysisResultCacheIo = {
  createDirectory: (path) => createDirectory(path),
  fileExists: (path) => fileExists(path),
  readFile: (path) => readFile(path),
  writeFileAtomic: (path, contents) => writeFileAtomic(path, contents),
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => isRecord(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
    : item)
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function cacheRoot(input: AnalysisResultCacheInput): string {
  const bookPath = normalizeComparablePath(input.bookPath)
  const projectPath = normalizeComparablePath(input.projectPath)
  if (!isAbsolutePath(bookPath) || !isAbsolutePath(projectPath)
    || !isPathInside(bookPath, projectPath)
    || [bookPath, projectPath].some((path) => path.split("/").some((part) => part === "." || part === ".."))) {
    throw new Error("分析缓存必须位于当前项目的作品目录内")
  }
  return joinPath(bookPath, "analysis", "result-cache")
}

function endpointWithoutCredentials(endpoint: string): string {
  const url = new URL(endpoint)
  url.username = ""
  url.password = ""
  url.hash = ""
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:api[-_]?key|key|token|access[-_]?token|authorization|password|secret)$/i.test(key)) {
      url.searchParams.delete(key)
    }
  }
  url.searchParams.sort()
  return url.toString()
}

function modelIdentity(config: LlmConfig): unknown {
  const localCli = config.provider === "claude-code" || config.provider === "codex-cli"
  const provider = localCli ? null : getProviderConfig({ ...config, apiKey: "" })
  // 使用供应商真实 buildBody 的默认采样/推理参数；不构造请求、不保存 headers。
  const body = provider?.buildBody([])
  const parameters = isRecord(body) ? Object.fromEntries(Object.entries(body).filter(([key]) => (
    !["messages", "contents", "input", "system", "instructions"].includes(key)
  ))) : null
  return {
    provider: config.provider,
    model: config.model,
    apiMode: config.provider === "custom" ? config.apiMode ?? "chat_completions" : null,
    endpoint: provider ? endpointWithoutCredentials(provider.url) : null,
    maxContextSize: getEffectiveMaxContextSize(config),
    maxOutputTokens: getEffectiveMaxOutputTokens(config),
    reasoning: {
      mode: config.reasoning?.mode ?? "auto",
      budgetTokens: config.reasoning?.mode === "custom" ? config.reasoning.budgetTokens : undefined,
    },
    parameters,
    localCliIsolation: localCli ? config.localCliIsolation : undefined,
    codexSpeedMode: config.provider === "codex-cli" ? config.codexSpeedMode : undefined,
    cursorSpeedMode: config.provider === "cursor-cli" ? config.cursorSpeedMode : undefined,
  }
}

function effectiveMemory(config: GlobalUserMemoryConfig, now: number): unknown {
  const governed = governUserMemoryConfig(config, now)
  if (!governed.enabled || !governed.autoRead) return []
  // 各子请求依据提示推断 surface，不能只取 book-analysis 而漏掉实际生效的规则。
  // 当前适配器未传 project/session key，故保守涵盖所有可用的全局规则。
  return governed.rules.filter((rule) => rule.enabled
    && (!governed.onlyManual || rule.source === "manual")
    && (rule.status ?? "active") === "active"
    && (rule.scope ?? "global") === "global")
    .map((rule) => ({
      rule: rule.rule,
      category: rule.category,
      source: rule.source,
      surfaces: rule.surfaces,
      confidence: rule.confidence,
      fingerprint: rule.fingerprint,
      // 规则更新时间参与实际选择排序；配置更新时间、使用计数/时间不参与。
      updatedAt: rule.updatedAt,
    }))
}

/** 仅用于本地内容寻址：有效模型参数与实际可读偏好，绝不包含凭证。 */
export function buildAnalysisCacheIdentity(
  config: LlmConfig,
  memory: GlobalUserMemoryConfig = loadGlobalUserMemoryConfig(),
  now = Date.now(),
): unknown {
  return { model: modelIdentity(config), userMemory: effectiveMemory(memory, now) }
}

function isCompleteOutput(value: unknown, input: AnalysisResultCacheInput): value is AnalysisChunkOutput {
  if (!isRecord(value) || !isRecord(value.result) || !Array.isArray(value.evidence)) return false
  const result = value.result
  if (value.error || result.error || value.success === false || result.success === false || result.cacheable === false) return false
  const ids = new Set<string>()
  for (const snippet of value.evidence) {
    if (!isRecord(snippet) || snippet.version !== 1 || typeof snippet.id !== "string" || !snippet.id
      || ids.has(snippet.id) || snippet.bookId !== input.task.bookId || snippet.skill !== input.skill
      || typeof snippet.taskId !== "string" || !snippet.taskId
      || typeof snippet.chapterId !== "string" || !input.chunk.chapterIds.includes(snippet.chapterId)
      || typeof snippet.chapterOrder !== "number" || !Number.isFinite(snippet.chapterOrder)
      || snippet.chapterOrder < input.chunk.startOrder || snippet.chapterOrder > input.chunk.endOrder
      || typeof snippet.text !== "string" || !snippet.text.trim()
      || !Array.isArray(snippet.tags) || !snippet.tags.every((tag) => typeof tag === "string")
      || typeof snippet.reason !== "string" || typeof snippet.purpose !== "string"
      || typeof snippet.enabled !== "boolean" || typeof snippet.userPinned !== "boolean"
      || typeof snippet.createdAt !== "number" || !Number.isFinite(snippet.createdAt)
      || typeof snippet.updatedAt !== "number" || !Number.isFinite(snippet.updatedAt)) return false
    ids.add(snippet.id)
  }
  if (input.skill === "characters") {
    const characters = result.characters
    const targets = input.task.targetCharacters
    // 旧引擎会吞掉单人物错误；没有目标清单或缺目标时无法证明完整成功。
    if (!targets?.length || !Array.isArray(characters) || characters.length < targets.length) return false
    return targets.every((target) => characters.some((character) => isRecord(character)
      && [target.name, ...target.aliases].some((name) => character.name === name
        || (Array.isArray(character.aliases) && character.aliases.includes(name)))))
  }
  if (input.skill === "story") {
    const map = result.map
    const rangeChapterIds = result.rangeChapterIds
    const chapters = isRecord(map) ? map.chapters : null
    return isRecord(map) && map.schemaVersion === 1 && map.bookId === input.task.bookId
      && Array.isArray(rangeChapterIds) && input.chunk.chapterIds.every((id) => rangeChapterIds.includes(id))
      && Array.isArray(chapters) && input.chunk.chapterIds.every((id) => chapters.some((chapter: unknown) => (
        isRecord(chapter) && chapter.id === id && Array.isArray(chapter.mainEvents) && chapter.mainEvents.length > 0
      )))
  }
  const profile = result.profile
  const sampledChapterIds = isRecord(profile) ? profile.sampledChapterIds : null
  return typeof result.raw === "string" && Boolean(result.raw.trim())
    && isRecord(profile) && profile.schemaVersion === 1 && Array.isArray(sampledChapterIds)
    && input.chunk.chapterIds.every((id) => sampledChapterIds.includes(id))
    && typeof profile.constitution === "string" && Array.isArray(profile.samples)
}

function rebindOutput(input: AnalysisResultCacheInput, output: AnalysisChunkOutput, now: number): AnalysisChunkOutput {
  const evidenceIds = new Map(output.evidence.map((snippet, index) => [
    snippet.id, `evidence-${input.task.id}-${input.skill}-${input.chunk.id}-${index}`,
  ]))
  const rebindId = (value: unknown): string => {
    if (typeof value !== "string" || !evidenceIds.has(value)) throw new Error("分析缓存的证据引用已失效")
    return evidenceIds.get(value)!
  }
  const rebindResult = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rebindResult)
    if (!isRecord(value)) return value
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (key === "evidenceIds") {
        if (!Array.isArray(item)) throw new Error("分析缓存的证据引用不完整")
        return [key, item.map(rebindId)]
      }
      if (key === "evidenceId") return [key, rebindId(item)]
      if (key === "taskId") return [key, input.task.id]
      return [key, rebindResult(item)]
    }))
  }
  // 保留额外结果/统计字段，绝不把旧任务的证据 ID 当成当前任务证据。
  return {
    ...output,
    result: rebindResult(output.result),
    evidence: output.evidence.map((snippet) => ({
      ...snippet,
      id: rebindId(snippet.id),
      taskId: input.task.id,
      bookId: input.task.bookId,
      skill: input.skill,
      enabled: true,
      userPinned: false,
      createdAt: now,
      updatedAt: now,
    })),
  }
}

export function createAnalysisResultCache(options: {
  io?: AnalysisResultCacheIo
  loadUserMemory?: () => GlobalUserMemoryConfig
  algorithmVersion?: string
  now?: () => number
} = {}): AnalysisResultCache {
  const io = options.io ?? defaultIo
  const loadUserMemory = options.loadUserMemory ?? loadGlobalUserMemoryConfig
  const algorithmVersion = options.algorithmVersion ?? ANALYSIS_RESULT_ALGORITHM_VERSION
  const now = options.now ?? Date.now
  return {
    async createKey(input) {
      try {
        cacheRoot(input)
        if (!input.llmConfig.provider || !input.llmConfig.model?.trim() || input.chunk.chapterIds.length === 0) return null
        const chapters: Array<{ id: string; sha256: string }> = []
        for (const id of input.chunk.chapterIds) {
          if (!/^[A-Za-z0-9_-]+$/.test(id)) return null
          const raw = await io.readFile(joinPath(input.bookPath, "chapters", `${id}.md`))
          if (!raw.trim()) return null
          // 包含正文每个位置（连同影响提示的标题/序号）；不使用采样指纹或截断文本。
          chapters.push({ id, sha256: await sha256(raw) })
        }
        const metadata: unknown = JSON.parse(await io.readFile(joinPath(input.bookPath, "metadata.json")))
        if (!isRecord(metadata) || typeof metadata.title !== "string") return null
        return await sha256(stableJson({
          version: CACHE_VERSION,
          algorithmVersion,
          projectPath: normalizeComparablePath(input.projectPath),
          bookPath: normalizeComparablePath(input.bookPath),
          bookId: input.task.bookId,
          book: { title: metadata.title, author: metadata.author },
          skill: input.skill,
          range: { startOrder: input.chunk.startOrder, endOrder: input.chunk.endOrder },
          chapters,
          task: {
            range: input.task.range,
            moduleRange: input.task.modules[input.skill].range,
            selectedSkills: normalizeSelectedSkills(input.task.selectedSkills),
            targetCharacters: input.task.targetCharacters?.length ? input.task.targetCharacters : null,
            charactersCompleted: input.skill === "story" ? input.task.modules.characters.status === "completed" : undefined,
          },
          request: buildAnalysisCacheIdentity(input.llmConfig, loadUserMemory(), now()),
        }))
      } catch {
        // 缓存不可用时回源；不记录正文、密钥或用户偏好。
        return null
      }
    },
    async read(input, key) {
      try {
        if (!SHA256_PATTERN.test(key)) return null
        const path = joinPath(cacheRoot(input), `${key}.json`)
        if (!(await io.fileExists(path))) return null
        const entry: unknown = JSON.parse(await io.readFile(path))
        if (!isRecord(entry) || entry.version !== CACHE_VERSION || entry.algorithmVersion !== algorithmVersion
          || entry.key !== key || !isCompleteOutput(entry.output, input)
          || entry.outputHash !== await sha256(JSON.stringify(entry.output))) return null
        return rebindOutput(input, entry.output, now())
      } catch {
        return null
      }
    },
    async write(input, key, output, signal) {
      try {
        if (signal?.aborted || !SHA256_PATTERN.test(key) || !isCompleteOutput(output, input)) return
        if (output.evidence.some((snippet) => snippet.taskId !== input.task.id)) return
        const serialized = JSON.stringify(output)
        const stored: AnalysisChunkOutput = JSON.parse(serialized)
        rebindOutput(input, stored, now()) // 缺失证据引用同样不缓存。
        const outputHash = await sha256(serialized)
        const root = cacheRoot(input)
        await io.createDirectory(root)
        if (signal?.aborted) return
        await io.writeFileAtomic(joinPath(root, `${key}.json`), JSON.stringify({
          version: CACHE_VERSION, algorithmVersion, key, outputHash, output: stored,
        }))
      } catch {
        // best-effort：不能因缓存写入失败将正常完成的分析标为失败。
      }
    },
  }
}
