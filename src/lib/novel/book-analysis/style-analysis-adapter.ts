import { readFile, writeFile } from "@/commands/fs"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import { joinPath, normalizePath } from "@/lib/path-utils"
import { upsertWritingStylePreset } from "@/lib/novel/writing-style-store"
import { loadMetadata } from "./analysis-engine"
import { replaceAutomaticEvidence } from "./analysis-evidence-store"
import { rebuildBookAnalysisContextIndex } from "./analysis-context-index"
import { loadAnalysisManifest, saveAnalysisManifest } from "./analysis-pipeline-storage"
import type { AnalysisEvidenceSnippet, BookAnalysisModuleManifest } from "./analysis-pipeline-types"
import type { AnalysisSkillAdapter } from "./analysis-skill-adapter"
import {
  buildStyleExtractionPrompt,
  parseStyleEvidenceResult,
  parseStyleProfileResult,
} from "./style-prompts"
import { styleProfileToMarkdown } from "./style-extraction-engine"
import type { BookStyleProfile } from "./types"
import { CHAPTER_BODY_EXCERPT_MAX_CHARS } from "@/lib/novel/chapter-excerpts"

export interface StyleAnalysisChunkResult {
  raw: string
  profile: BookStyleProfile
}

interface StyleAnalysisAdapterDependencies {
  readFile: typeof readFile
  writeFile: typeof writeFile
  loadMetadata: typeof loadMetadata
  callModel: (messages: ChatMessage[], llmConfig: Parameters<typeof streamChat>[0], signal: AbortSignal) => Promise<string>
  upsertPreset: typeof upsertWritingStylePreset
  replaceEvidence: typeof replaceAutomaticEvidence
  loadManifest: typeof loadAnalysisManifest
  saveManifest: typeof saveAnalysisManifest
  rebuildContextIndex: typeof rebuildBookAnalysisContextIndex
  now: () => number
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
  loadMetadata,
  callModel: callStyleModel,
  upsertPreset: upsertWritingStylePreset,
  replaceEvidence: replaceAutomaticEvidence,
  loadManifest: loadAnalysisManifest,
  saveManifest: saveAnalysisManifest,
  rebuildContextIndex: rebuildBookAnalysisContextIndex,
  now: Date.now,
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()
}

function mergeStrings(values: Array<string | undefined>): string {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].join("；")
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function mergeStyleChunkProfiles(
  chunks: StyleAnalysisChunkResult[],
  evidenceIds: string[],
  generatedAt: number,
): BookStyleProfile {
  const profiles = chunks.map((chunk) => chunk.profile)
  return {
    schemaVersion: 1,
    generatedAt,
    sampledChapterIds: unique(profiles.flatMap((profile) => profile.sampledChapterIds)),
    narrativeDensity: mergeStrings(profiles.map((profile) => profile.narrativeDensity)),
    descriptionWeight: mergeStrings(profiles.map((profile) => profile.descriptionWeight)),
    emotionRendering: mergeStrings(profiles.map((profile) => profile.emotionRendering)),
    sentenceStyle: mergeStrings(profiles.map((profile) => profile.sentenceStyle)),
    rhetoricDensity: mergeStrings(profiles.map((profile) => profile.rhetoricDensity)),
    transitionStyle: mergeStrings(profiles.map((profile) => profile.transitionStyle)),
    narrativeVoice: mergeStrings(profiles.map((profile) => profile.narrativeVoice)),
    dialogueStyle: mergeStrings(profiles.map((profile) => profile.dialogueStyle)),
    thematicHabits: mergeStrings(profiles.map((profile) => profile.thematicHabits)),
    humorMechanisms: unique(profiles.flatMap((profile) => profile.humorMechanisms ?? [])),
    highEnergyMechanisms: unique(profiles.flatMap((profile) => profile.highEnergyMechanisms ?? [])),
    pointOfView: mergeStrings(profiles.map((profile) => profile.pointOfView)),
    vocabularyPreferences: unique(profiles.flatMap((profile) => profile.vocabularyPreferences ?? [])),
    avoidPatterns: unique(profiles.flatMap((profile) => profile.avoidPatterns ?? [])),
    evidenceIds,
    constitution: mergeStrings(profiles.map((profile) => profile.constitution)),
    samples: unique(profiles.flatMap((profile) => profile.samples)).slice(0, 6),
  }
}

function aggregatePrompt(chunks: StyleAnalysisChunkResult[]): string {
  return [
    "你是小说文风汇总专家。以下是同一用户所选章节范围内，各区块已经完成的文风 JSON。",
    "请去重、消除偶发特征，并输出与原格式相同的单个 JSON。必须保留幽默机制、热血机制、叙事视角、词汇偏好、禁用写法和可执行风格宪法。",
    "不得引入未分析章节，不得复述原作剧情。evidence 可以返回空数组，因为证据由区块结果单独保存。",
    "",
    ...chunks.map((chunk, index) => `区块 ${index + 1}：\n${chunk.raw}`),
  ].join("\n\n")
}

export function createStyleAnalysisAdapter(
  overrides: Partial<StyleAnalysisAdapterDependencies> = {},
): AnalysisSkillAdapter<StyleAnalysisChunkResult, BookStyleProfile> {
  const dependencies = { ...defaultDependencies, ...overrides }
  return {
    skill: "style",
    async runChunk({ task, bookPath, llmConfig, chunk, signal, onProgress }) {
      onProgress?.({ stageLabel: "读取章节样本…", percentage: 10 })
      const metadata = await dependencies.loadMetadata(bookPath)
      if (!metadata) throw new Error("未找到作品元数据，无法分析文风")
      const blocks: string[] = []
      for (const chapterId of chunk.chapterIds) {
        const raw = await dependencies.readFile(joinPath(bookPath, "chapters", `${chapterId}.md`))
        const body = stripFrontmatter(raw).slice(0, CHAPTER_BODY_EXCERPT_MAX_CHARS)
        if (body) blocks.push(`【章节ID：${chapterId}】\n${body}`)
      }
      if (blocks.length !== chunk.chapterIds.length) throw new Error("所选文风章节正文为空，请检查后重试")
      onProgress?.({ stageLabel: "正在调用模型分析文风…", percentage: 40 })
      const raw = await dependencies.callModel([
        { role: "system", content: "你是专业的小说文风分析助手。只输出用户要求的 JSON，不要解释。" },
        { role: "user", content: buildStyleExtractionPrompt(blocks.join("\n\n———\n\n"), metadata.title) },
      ], llmConfig, signal)
      onProgress?.({ stageLabel: "解析文风结果…", percentage: 85 })
      const profile = parseStyleProfileResult(raw, chunk.chapterIds)
      const evidence = parseStyleEvidenceResult(raw).flatMap((candidate, index): AnalysisEvidenceSnippet[] => {
        if (!chunk.chapterIds.includes(candidate.chapterId)) return []
        const chapterIndex = chunk.chapterIds.indexOf(candidate.chapterId)
        return [{
          version: 1,
          id: `evidence-${task.id}-style-${chunk.id}-${index}`,
          bookId: task.bookId,
          skill: "style",
          taskId: task.id,
          chapterId: candidate.chapterId,
          chapterOrder: chunk.startOrder + chapterIndex,
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
      onProgress?.({ stageLabel: "文风区块分析完成", percentage: 95 })
      return { result: { raw, profile }, evidence }
    },
    async aggregate({ chunks, llmConfig, signal, onProgress }) {
      if (chunks.length === 0) throw new Error("没有已完成的文风区块可供汇总")
      const evidenceIds: string[] = []
      if (chunks.length === 1) {
        onProgress?.({ stageLabel: "单区块无需汇总", percentage: 95 })
        return mergeStyleChunkProfiles(chunks, evidenceIds, dependencies.now())
      }
      onProgress?.({ stageLabel: "正在调用模型汇总文风…", percentage: 93 })
      const raw = await dependencies.callModel([
        { role: "system", content: "你只汇总已有文风分析，不分析范围外内容。" },
        { role: "user", content: aggregatePrompt(chunks) },
      ], llmConfig, signal)
      const profile = parseStyleProfileResult(raw, chunks.flatMap((chunk) => chunk.profile.sampledChapterIds))
      profile.generatedAt = dependencies.now()
      profile.evidenceIds = evidenceIds
      onProgress?.({ stageLabel: "文风汇总完成", percentage: 95 })
      return profile
    },
    async publish({ task, bookPath, projectPath, result, evidence, onProgress }) {
      onProgress?.({ stageLabel: "正在发布文风结果…", percentage: 97 })
      const metadata = await dependencies.loadMetadata(bookPath)
      if (!metadata) throw new Error("未找到作品元数据，无法发布文风分析")
      result.evidenceIds = evidence.map((item) => item.id)
      const resultPath = normalizePath(joinPath(bookPath, "style-profile.json"))
      await dependencies.writeFile(resultPath, JSON.stringify(result, null, 2))
      await dependencies.writeFile(joinPath(bookPath, "style.md"), styleProfileToMarkdown(result, metadata.title))
      await dependencies.replaceEvidence(bookPath, "style", evidence)
      await dependencies.upsertPreset(projectPath, {
        name: `${metadata.title} · 文风`,
        sourceBook: metadata.title,
        sourceBookId: task.bookId,
        evidenceIds: result.evidenceIds,
        profile: result,
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
            summary: `提取文风机制与 ${evidence.length} 条代表片段，覆盖第 ${task.modules.style.range.startOrder}～${task.modules.style.range.endOrder} 章。`,
            updatedAt,
          },
        },
        updatedAt,
      }
      await dependencies.saveManifest(bookPath, manifest)
      await dependencies.rebuildContextIndex(projectPath)
      onProgress?.({ stageLabel: "文风结果已发布", percentage: 100 })
      return resultPath
    },
  }
}

export const styleAnalysisAdapter = createStyleAnalysisAdapter()
