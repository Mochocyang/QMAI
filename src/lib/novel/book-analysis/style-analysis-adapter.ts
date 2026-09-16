/**
 * 文风 skill 的 pipeline adapter —— Writing DNA 分层蒸馏（feature/writing-dna）
 *
 * 单分片流程（full 深度）：
 *   1. computeStyleMetrics 脚本统计（不调 LLM）
 *   2. L1 语言 + L6 排版节奏（喂统计数字让模型解读）
 *   3. L2 章节结构（顺带返回 evidence 与每章标注）
 *   4. L3-L5 认知框架
 * aggregate 阶段合并各分片，再跑一次整合，产出 Writing-DNA.md 正文与风格硬约束。
 *
 * fast 深度只跑步骤 1-2，samples 与 evidence 改由脚本从原文截取，
 * 供大部头先拿到可用结果；代价是没有 L2/L3-L5 分层。
 */
import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import { joinPath, normalizePath } from "@/lib/path-utils"
import { upsertWritingStylePreset } from "@/lib/novel/writing-style-store"
import { loadMetadata } from "./analysis-engine"
import { replaceAutomaticEvidence } from "./analysis-evidence-store"
import { rebuildBookAnalysisContextIndex } from "./analysis-context-index"
import { loadAnalysisManifest, saveAnalysisManifest } from "./analysis-pipeline-storage"
import {
  DEFAULT_STYLE_ANALYSIS_DEPTH,
  type AnalysisEvidenceSnippet,
  type BookAnalysisModuleManifest,
  type StyleAnalysisDepth,
} from "./analysis-pipeline-types"
import type { AnalysisSkillAdapter } from "./analysis-skill-adapter"
import {
  buildChapterMetaEntry,
  excerptChapterBody,
  upsertChapterMeta,
  type ChapterMetaEntry,
} from "./chapter-meta"
import { computeStyleMetrics, mergeStyleMetrics, type StyleMetrics } from "./style-metrics"
import { emptyWritingDnaLayers, INTEGRATED_DNA_FILE_NAME, WRITING_DNA_LAYERS } from "./style-profile-schema"
import {
  buildCognitiveFramePrompt,
  buildDnaIntegrationPrompt,
  buildLanguageAndRhythmPrompt,
  buildLayerAggregatePrompt,
  buildStructurePatternPrompt,
  FALLBACK_STYLE_CONSTITUTION,
  parseCognitiveFrameResult,
  parseIntegratedDnaResult,
  parseLanguageAndRhythmResult,
  parseLayerAggregateResult,
  parseStructurePatternResult,
  parseStyleEvidenceResult,
} from "./writing-dna-prompts"
import { renderWritingDnaFiles, styleProfileToMarkdown } from "./writing-dna-render"
import type { BookStyleProfile, WritingDnaLayers } from "./types"
import { scheduleVerification } from "./verification-engine"
import { CHAPTER_BODY_EXCERPT_MAX_CHARS } from "@/lib/novel/chapter-excerpts"

/** fast 模式下脚本截取样本的条数与长度。 */
const FAST_SAMPLE_COUNT = 4
const FAST_SAMPLE_CHARS = 260

/** 分片产出：必须可 JSON 序列化，scheduler 会落盘再读回来汇总。 */
export interface StyleAnalysisChunkResult {
  metrics: StyleMetrics
  layers: WritingDnaLayers
  samples: string[]
  chapterMeta: ChapterMetaEntry[]
  sampledChapterIds: string[]
  legacy: {
    narrativeDensity: string
    sentenceStyle: string
    rhetoricDensity: string
    dialogueStyle: string
    transitionStyle: string
    descriptionWeight: string
    emotionRendering: string
    thematicHabits: string
    narrativeVoice: string
    pointOfView: string
    vocabularyPreferences: string[]
    avoidPatterns: string[]
    humorMechanisms: string[]
    highEnergyMechanisms: string[]
  }
}

/** aggregate 产出：profile 之外还要把章节标注带到 publish 去落盘。 */
export interface StyleAnalysisAggregateResult {
  profile: BookStyleProfile
  chapterMeta: ChapterMetaEntry[]
}

interface StyleAnalysisAdapterDependencies {
  readFile: typeof readFile
  writeFile: typeof writeFile
  createDirectory: typeof createDirectory
  loadMetadata: typeof loadMetadata
  callModel: (messages: ChatMessage[], llmConfig: Parameters<typeof streamChat>[0], signal: AbortSignal) => Promise<string>
  upsertPreset: typeof upsertWritingStylePreset
  replaceEvidence: typeof replaceAutomaticEvidence
  loadManifest: typeof loadAnalysisManifest
  saveManifest: typeof saveAnalysisManifest
  rebuildContextIndex: typeof rebuildBookAnalysisContextIndex
  saveChapterMeta: typeof upsertChapterMeta
  now: () => number
  /** 任务上没写 styleDepth 时的兜底深度（旧任务与测试用） */
  fallbackDepth: () => StyleAnalysisDepth
}

async function callStyleModel(
  messages: ChatMessage[],
  llmConfig: Parameters<typeof streamChat>[0],
  signal: AbortSignal,
): Promise<string> {
  let output = ""
  let streamError: Error | null = null
  await streamChat(llmConfig, messages, {
    onToken: (token) => { output += token },
    onDone: () => {},
    onError: (error) => { streamError = error },
  }, signal, { reasoning: llmConfig.reasoning })
  if (signal.aborted) throw new Error("用户取消文风分析")
  if (streamError) throw streamError
  return output.trim()
}

const defaultDependencies: StyleAnalysisAdapterDependencies = {
  readFile,
  writeFile,
  createDirectory,
  loadMetadata,
  callModel: callStyleModel,
  upsertPreset: upsertWritingStylePreset,
  replaceEvidence: replaceAutomaticEvidence,
  loadManifest: loadAnalysisManifest,
  saveManifest: saveAnalysisManifest,
  rebuildContextIndex: rebuildBookAnalysisContextIndex,
  saveChapterMeta: upsertChapterMeta,
  now: Date.now,
  fallbackDepth: () => DEFAULT_STYLE_ANALYSIS_DEPTH,
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()
}

function frontmatterTitle(content: string): string {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ""
  return frontmatter.match(/^title:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? ""
}

function mergeStrings(values: Array<string | undefined>): string {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].join("；")
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function emptyLegacy(): StyleAnalysisChunkResult["legacy"] {
  return {
    narrativeDensity: "", sentenceStyle: "", rhetoricDensity: "", dialogueStyle: "",
    transitionStyle: "", descriptionWeight: "", emotionRendering: "", thematicHabits: "",
    narrativeVoice: "", pointOfView: "",
    vocabularyPreferences: [], avoidPatterns: [], humorMechanisms: [], highEnergyMechanisms: [],
  }
}

interface ChapterSample {
  chapterId: string
  order: number
  title: string
  body: string
}

/**
 * 合并各分片的同一层文本。
 * 只有一段非空内容时直接返回，多段才调模型去重——省一次调用。
 */
async function aggregateLayer(
  layerLabel: string,
  texts: string[],
  bookTitle: string,
  call: (prompt: string) => Promise<string>,
): Promise<string> {
  const filled = unique(texts)
  if (filled.length === 0) return ""
  if (filled.length === 1) return filled[0]
  const raw = await call(buildLayerAggregatePrompt(layerLabel, filled, bookTitle))
  return parseLayerAggregateResult(raw) || filled.join("\n\n")
}

export function createStyleAnalysisAdapter(
  overrides: Partial<StyleAnalysisAdapterDependencies> = {},
): AnalysisSkillAdapter<StyleAnalysisChunkResult, StyleAnalysisAggregateResult> {
  const dependencies = { ...defaultDependencies, ...overrides }

  return {
    skill: "style",

    async runChunk({ task, bookPath, llmConfig, chunk, signal, onProgress }) {
      const depth = task.styleDepth ?? dependencies.fallbackDepth()
      onProgress?.({ stageLabel: "读取章节样本…", percentage: 5 })
      const metadata = await dependencies.loadMetadata(bookPath)
      if (!metadata) throw new Error("未找到作品元数据，无法分析文风")

      const samplesRead: ChapterSample[] = []
      for (const [index, chapterId] of chunk.chapterIds.entries()) {
        const raw = await dependencies.readFile(joinPath(bookPath, "chapters", `${chapterId}.md`))
        const body = stripFrontmatter(raw).slice(0, CHAPTER_BODY_EXCERPT_MAX_CHARS)
        if (body) {
          samplesRead.push({
            chapterId,
            order: chunk.startOrder + index,
            title: frontmatterTitle(raw),
            body,
          })
        }
      }
      if (samplesRead.length !== chunk.chapterIds.length) {
        throw new Error("所选文风章节正文为空，请检查后重试")
      }

      const sampleText = samplesRead
        .map((item) => `【章节ID：${item.chapterId}${item.title ? ` · ${item.title}` : ""}】\n${item.body}`)
        .join("\n\n———\n\n")

      // 步骤 1：脚本统计，不调 LLM
      onProgress?.({ stageLabel: "统计语言与排版指标…", percentage: 15 })
      const metrics = computeStyleMetrics(samplesRead.map((item) => item.body))

      const call = (prompt: string, system: string): Promise<string> => dependencies.callModel([
        { role: "system", content: system },
        { role: "user", content: prompt },
      ], llmConfig, signal)

      const layers = emptyWritingDnaLayers()
      const legacy = emptyLegacy()
      let samples: string[] = []
      let evidence: AnalysisEvidenceSnippet[] = []
      let chapterMetaAnnotations: Awaited<ReturnType<typeof parseStructurePatternResult>>["chapterMeta"] = []

      // 步骤 2：L1 语言 + L6 排版节奏
      onProgress?.({ stageLabel: "解读语言与节奏（L1/L6）…", percentage: 30 })
      const languageRaw = await call(
        buildLanguageAndRhythmPrompt(metrics, sampleText, metadata.title),
        "你是专业的小说文风分析助手。只输出用户要求的 JSON，不要解释。",
      )
      const language = parseLanguageAndRhythmResult(languageRaw)
      layers.languageDna = language.languageDna
      layers.rhythmGuide = language.rhythmGuide
      legacy.narrativeDensity = language.narrativeDensity
      legacy.sentenceStyle = language.sentenceStyle
      legacy.rhetoricDensity = language.rhetoricDensity
      legacy.dialogueStyle = language.dialogueStyle
      legacy.vocabularyPreferences = language.vocabularyPreferences
      legacy.avoidPatterns = language.avoidPatterns

      if (depth === "full") {
        // 步骤 3：L2 章节结构（附 evidence 与每章标注）
        onProgress?.({ stageLabel: "提炼章节结构（L2）…", percentage: 55 })
        const structureRaw = await call(
          buildStructurePatternPrompt(sampleText, metadata.title),
          "你是专业的小说结构分析助手。只输出用户要求的 JSON，不要解释。",
        )
        const structure = parseStructurePatternResult(structureRaw)
        layers.structurePatterns = structure.structurePatterns
        legacy.transitionStyle = structure.transitionStyle
        legacy.descriptionWeight = structure.descriptionWeight
        legacy.emotionRendering = structure.emotionRendering
        legacy.thematicHabits = structure.thematicHabits
        samples = structure.samples
        chapterMetaAnnotations = structure.chapterMeta

        const orderByChapterId = new Map(samplesRead.map((item) => [item.chapterId, item.order]))
        evidence = parseStyleEvidenceResult(structureRaw).flatMap((candidate, index): AnalysisEvidenceSnippet[] => {
          const chapterOrder = orderByChapterId.get(candidate.chapterId)
          if (chapterOrder === undefined) return []
          return [{
            version: 1,
            id: `evidence-${task.id}-style-${chunk.id}-${index}`,
            bookId: task.bookId,
            skill: "style",
            taskId: task.id,
            chapterId: candidate.chapterId,
            chapterOrder,
            text: candidate.text.trim().slice(0, 500),
            tags: candidate.tags,
            reason: candidate.reason || "体现作品稳定的文风机制",
            purpose: candidate.purpose || "文风仿写参考",
            enabled: true,
            userPinned: false,
            createdAt: dependencies.now(),
            updatedAt: dependencies.now(),
          }]
        })

        // 步骤 4：L3-L5 认知框架
        onProgress?.({ stageLabel: "归纳认知框架（L3-L5）…", percentage: 80 })
        const cognitiveRaw = await call(
          buildCognitiveFramePrompt(sampleText, metadata.title),
          "你是专业的小说叙事分析助手。只输出用户要求的 JSON，不要解释。",
        )
        const cognitive = parseCognitiveFrameResult(cognitiveRaw)
        layers.cognitiveFrame = cognitive.cognitiveFrame
        legacy.narrativeVoice = cognitive.narrativeVoice
        legacy.pointOfView = cognitive.pointOfView
        legacy.humorMechanisms = cognitive.humorMechanisms
        legacy.highEnergyMechanisms = cognitive.highEnergyMechanisms
      }

      // fast 模式没有 L2，样本与证据改由脚本从原文截取——比留空可用，且不多花调用
      if (samples.length === 0) {
        const picked = samplesRead.slice(0, FAST_SAMPLE_COUNT)
        samples = picked
          .map((item) => excerptChapterBody(item.body, FAST_SAMPLE_CHARS))
          .filter(Boolean)
        if (evidence.length === 0) {
          evidence = picked.flatMap((item, index): AnalysisEvidenceSnippet[] => {
            const text = excerptChapterBody(item.body, FAST_SAMPLE_CHARS)
            if (!text) return []
            return [{
              version: 1,
              id: `evidence-${task.id}-style-${chunk.id}-auto-${index}`,
              bookId: task.bookId,
              skill: "style",
              taskId: task.id,
              chapterId: item.chapterId,
              chapterOrder: item.order,
              text: text.slice(0, 500),
              tags: ["脚本抽取"],
              reason: "快速模式下由脚本从章节开头截取的代表片段",
              purpose: "文风仿写参考",
              enabled: true,
              userPinned: false,
              createdAt: dependencies.now(),
              updatedAt: dependencies.now(),
            }]
          })
        }
      }

      const annotationById = new Map(chapterMetaAnnotations.map((item) => [item.chapterId, item]))
      const chapterMeta = samplesRead.map((item) => buildChapterMetaEntry({
        chapterId: item.chapterId,
        order: item.order,
        title: item.title,
        body: item.body,
        annotation: annotationById.get(item.chapterId),
        now: dependencies.now(),
      }))

      onProgress?.({ stageLabel: "文风区块分析完成", percentage: 95 })
      return {
        result: {
          metrics,
          layers,
          samples,
          chapterMeta,
          sampledChapterIds: samplesRead.map((item) => item.chapterId),
          legacy,
        },
        evidence,
      }
    },

    async aggregate({ bookPath, llmConfig, chunks, signal, onProgress }) {
      if (chunks.length === 0) throw new Error("没有已完成的文风区块可供汇总")
      const metadata = await dependencies.loadMetadata(bookPath)
      const bookTitle = metadata?.title || "未命名作品"

      const call = (prompt: string, system: string): Promise<string> => dependencies.callModel([
        { role: "system", content: system },
        { role: "user", content: prompt },
      ], llmConfig, signal)

      // 统计按原始计数相加后重新派生——比率的平均是错的
      onProgress?.({ stageLabel: "合并统计指标…", percentage: 88 })
      const metrics = mergeStyleMetrics(chunks.map((chunk) => chunk.metrics))

      onProgress?.({ stageLabel: "合并分层产物…", percentage: 90 })
      const layers = emptyWritingDnaLayers()
      for (const layer of WRITING_DNA_LAYERS) {
        layers[layer.key] = await aggregateLayer(
          `${layer.level} ${layer.label}`,
          chunks.map((chunk) => chunk.layers[layer.key]),
          bookTitle,
          (prompt) => call(prompt, "你只汇总已有分析结果，不分析范围外内容。"),
        )
      }

      const legacyKeys = Object.keys(emptyLegacy()) as Array<keyof StyleAnalysisChunkResult["legacy"]>
      const legacy = emptyLegacy()
      for (const key of legacyKeys) {
        const values = chunks.map((chunk) => chunk.legacy[key])
        if (Array.isArray(legacy[key])) {
          ;(legacy[key] as string[]) = unique(values.flatMap((value) => (Array.isArray(value) ? value : [])))
        } else {
          ;(legacy[key] as string) = mergeStrings(values.map((value) => (typeof value === "string" ? value : "")))
        }
      }

      // 整合：产出 Writing-DNA.md 正文 + 可注入的风格硬约束
      onProgress?.({ stageLabel: "整合 Writing DNA…", percentage: 93 })
      const integratedRaw = await call(
        buildDnaIntegrationPrompt(layers, metrics, bookTitle),
        "你是文风蒸馏专家。直接输出 markdown 正文，不要 JSON，不要代码围栏。",
      )
      const integrated = parseIntegratedDnaResult(integratedRaw)

      const chapterMeta = [...new Map(
        chunks.flatMap((chunk) => chunk.chapterMeta).map((item) => [item.chapterId, item]),
      ).values()].sort((a, b) => a.order - b.order)

      const profile: BookStyleProfile = {
        schemaVersion: 2,
        generatedAt: dependencies.now(),
        sampledChapterIds: unique(chunks.flatMap((chunk) => chunk.sampledChapterIds)),
        metrics,
        layers,
        integratedDna: integrated.integratedDna,
        constitution: integrated.constitution || FALLBACK_STYLE_CONSTITUTION,
        samples: unique(chunks.flatMap((chunk) => chunk.samples)).slice(0, 6),
        ...legacy,
      }

      onProgress?.({ stageLabel: "文风汇总完成", percentage: 95 })
      return { profile, chapterMeta }
    },

    async publish({ task, bookPath, projectPath, llmConfig, result, evidence, onProgress }) {
      onProgress?.({ stageLabel: "正在发布文风结果…", percentage: 97 })
      const metadata = await dependencies.loadMetadata(bookPath)
      if (!metadata) throw new Error("未找到作品元数据，无法发布文风分析")

      const { profile, chapterMeta } = result
      profile.evidenceIds = evidence.map((item) => item.id)

      const resultPath = normalizePath(joinPath(bookPath, "style-profile.json"))
      await dependencies.writeFile(resultPath, JSON.stringify(profile, null, 2))

      // 分层产物 + 整合文档；style.md 保留是因为 library-state 的 styleStatus 判定依赖它
      for (const file of renderWritingDnaFiles(profile, metadata.title, chapterMeta)) {
        await dependencies.writeFile(joinPath(bookPath, file.fileName), file.content)
      }
      await dependencies.writeFile(joinPath(bookPath, "style.md"), styleProfileToMarkdown(profile, metadata.title))

      if (chapterMeta.length > 0) {
        await dependencies.saveChapterMeta(bookPath, chapterMeta)
      }
      await dependencies.replaceEvidence(bookPath, "style", evidence)
      await dependencies.upsertPreset(projectPath, {
        name: `${metadata.title} · 文风`,
        sourceBook: metadata.title,
        sourceBookId: task.bookId,
        evidenceIds: profile.evidenceIds,
        profile,
      })

      const updatedAt = dependencies.now()
      const current = await dependencies.loadManifest(bookPath)
      const manifest: BookAnalysisModuleManifest = {
        version: 1,
        bookId: task.bookId,
        modules: {
          ...(current?.modules ?? {}),
          style: {
            ...task.modules.style,
            status: "completed",
            resultPath,
            summary: `蒸馏 Writing DNA（${INTEGRATED_DNA_FILE_NAME}）与 ${evidence.length} 条代表片段，`
              + `覆盖第 ${task.modules.style.range.startOrder}～${task.modules.style.range.endOrder} 章，`
              + `深度 ${(task.styleDepth ?? dependencies.fallbackDepth()) === "fast" ? "快速" : "完整"}。`,
            updatedAt,
          },
        },
        updatedAt,
      }
      await dependencies.saveManifest(bookPath, manifest)
      await dependencies.rebuildContextIndex(projectPath)
      onProgress?.({ stageLabel: "文风结果已发布", percentage: 100 })

      // 后台审计：三重验证 + 压力测试（best-effort，失败不影响任务）
      void scheduleVerification(bookPath, "style", llmConfig)
        .catch((error) => console.warn("[style-verify] 校验失败：", error))
      return resultPath
    },
  }
}

export const styleAnalysisAdapter = createStyleAnalysisAdapter()
