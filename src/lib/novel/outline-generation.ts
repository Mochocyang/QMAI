import { createDirectory, fileExists, listDirectory, readFile, writeFile } from "@/commands/fs"
import { streamChat } from "@/lib/llm-client"
import { getOutputLanguage } from "@/lib/output-language"
import { getFileName, normalizePath } from "@/lib/path-utils"
import { refreshProjectState } from "@/lib/project-refresh"
import i18n from "@/i18n"
import type { ChatMessage } from "@/lib/llm-providers"
import { PROMPTS } from "@/lib/novel/prompt-templates"
import { useOutlineGenerationStore } from "@/stores/outline-generation-store"
import { useImportProgressStore } from "@/stores/import-progress-store"
import type { LlmConfig } from "@/stores/wiki-store"
import { useWikiStore } from "@/stores/wiki-store"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { mapWithConcurrency } from "@/lib/async-pool"
import {
  finalizeProjectMemoryRebuild,
  ingestOutline,
  syncSnapshotToMemory,
  type OutlineIngestResult,
} from "./chapter-ingest"
import { buildContextPack, type ContextPack } from "./context-engine"
import { resolveDefaultModel, resolveModelConfig, resolveNovelModel } from "@/lib/novel/model-resolver"

export type OutlineSectionGenerationKey =
  | "chapterOutlines"
  | "characterBriefs"
  | "organizationsOutline"
  | "powerSystem"
  | "foreshadowingPlan"
  | "locationsOutline"

export interface OutlineSectionGenerationConfig {
  key: OutlineSectionGenerationKey
  title: string
  englishTitle: string
  englishFileName: string
  requestHint: string
}

export interface OutlineRefinementResult {
  primaryPath: string | null
  sections: Partial<Record<OutlineSectionGenerationKey, string>>
  writtenPaths: string[]
}

export type OutlineRefinementWriteMode =
  | "replaceDefault"
  | "appendCurrent"
  | "newFileAndAddToList"

export interface OutlineRefinementWriteOptions {
  mode?: OutlineRefinementWriteMode
  targetPath?: string | null
}

export const OUTLINE_SECTION_GENERATION_CONFIGS: OutlineSectionGenerationConfig[] = [
  {
    key: "chapterOutlines",
    title: "章节细纲",
    englishTitle: "Chapter Outlines",
    englishFileName: "chapter-outlines.md",
    requestHint: "根据已有总纲、分卷大纲与章节推进需要，生成或完善章节细纲，明确每章目标、冲突、转折和结尾钩子。",
  },
  {
    key: "characterBriefs",
    title: "人物小传",
    englishTitle: "Character Briefs",
    englishFileName: "character-briefs.md",
    requestHint: "根据已有大纲和项目记忆，整理主要人物的小传、动机、弧线、关系网络与当前状态。",
  },
  {
    key: "organizationsOutline",
    title: "组织势力设定",
    englishTitle: "Faction Notes",
    englishFileName: "organizations.md",
    requestHint: "根据已有大纲和项目记忆，补完组织、势力、阵营目标、关系、冲突与剧情作用。",
  },
  {
    key: "powerSystem",
    title: "金手指与能力体系",
    englishTitle: "Power System",
    englishFileName: "power-system.md",
    requestHint: "根据已有大纲和项目记忆，整理金手指、能力体系、规则、限制、代价与剧情作用。",
  },
  {
    key: "foreshadowingPlan",
    title: "伏笔计划",
    englishTitle: "Foreshadowing Plan",
    englishFileName: "foreshadowing-plan.md",
    requestHint: "根据已有大纲和项目记忆，整理伏笔的埋设、推进、回收节奏与对应章节节点。",
  },
  {
    key: "locationsOutline",
    title: "地点设定",
    englishTitle: "Location Notes",
    englishFileName: "locations.md",
    requestHint: "根据已有大纲和项目记忆，整理重要地点、地点规则、所属势力与剧情作用。",
  },
]

function useEnglishOutlineNames(): boolean {
  return getOutputLanguage() === "English"
}

function getOutlineSectionTitle(config: OutlineSectionGenerationConfig): string {
  return useEnglishOutlineNames() ? config.englishTitle : config.title
}

function getOutlineSectionFileName(config: OutlineSectionGenerationConfig): string {
  return useEnglishOutlineNames() ? config.englishFileName : `${config.title}.md`
}

function getStoryOutlineFileName(): string {
  return useEnglishOutlineNames() ? "story-outline.md" : "总大纲.md"
}

function outlinePageMarkdown(title: string, content: string): string {
  return [
    "---",
    "type: outline",
    `title: "${title.replace(/"/g, '\\"')}"`,
    "---",
    "",
    `# ${title}`,
    "",
    content.trim(),
    "",
  ].join("\n")
}

function appendContextSection(sections: string[], title: string, content: string | string[]) {
  const text = Array.isArray(content) ? content.filter(Boolean).join("\n") : content.trim()
  if (!text) return
  sections.push(`## ${title}\n${text}`)
}

function formatOutlineRefinementContext(pack: ContextPack): string {
  const sections: string[] = []
  appendContextSection(sections, "已有大纲", pack.outline)
  appendContextSection(sections, "最近剧情摘要", pack.recentSummaries)
  appendContextSection(sections, "人物状态变化", pack.characterStates)
  appendContextSection(sections, "角色认知", pack.cognitionStates)
  appendContextSection(sections, "伏笔状态", pack.foreshadowingStates)
  appendContextSection(sections, "时间线", pack.timeline)
  appendContextSection(sections, "相关设定", pack.relatedSettings)
  appendContextSection(sections, "正史规则", pack.canonRules)
  appendContextSection(sections, "关联检索", pack.searchResults)
  appendContextSection(sections, "图谱关联检索", pack.graphSearchResults)
  return sections.join("\n\n").slice(0, 20000)
}

function formatOutlineGenerationContext(pack: ContextPack): string {
  const sections: string[] = []
  appendContextSection(sections, "已有故事记忆与项目资料", pack.soulDoc)
  appendContextSection(sections, "已有大纲与故事骨架", pack.outline)
  appendContextSection(sections, "最近剧情记忆", pack.recentSummaries)
  appendContextSection(sections, "人物状态与关系", pack.characterStates)
  appendContextSection(sections, "角色认知与信息差", pack.cognitionStates)
  appendContextSection(sections, "伏笔与未回收线索", pack.foreshadowingStates)
  appendContextSection(sections, "时间线与剧情节点", pack.timeline)
  appendContextSection(sections, "设定与地点组织", pack.relatedSettings)
  appendContextSection(sections, "正史规则", pack.canonRules)
  appendContextSection(sections, "剧情记忆与卡片故事", pack.searchResults)
  appendContextSection(sections, "图谱关联", pack.graphSearchResults)
  return sections.join("\n\n").slice(0, 20000)
}

export async function buildOutlineGenerationPrompt(
  projectPath: string,
  genre: string,
  scale: string,
  premise: string,
): Promise<string> {
  const pack = await safeBuildOutlineContextPack(projectPath, `?????${premise || genre}`)
  return PROMPTS.outlineGeneration(genre, scale, premise, formatOutlineGenerationContext(pack))
}

export async function hasOutlineForRefinement(projectPath: string): Promise<boolean> {
  try {
    const pp = normalizePath(projectPath)
    const tree = await listDirectory(`${pp}/wiki/outlines`)
    const flattenFiles = (nodes: typeof tree): typeof tree => {
      const files: typeof tree = []
      for (const node of nodes) {
        if (node.is_dir && node.children) files.push(...flattenFiles(node.children))
        else if (!node.is_dir && node.name.endsWith(".md")) files.push(node)
      }
      return files
    }
    return flattenFiles(tree).length > 0
  } catch {
    return false
  }
}

export async function buildOutlineRefinementContext(
  projectPath: string,
  userRequest: string,
): Promise<{ context: string; hasOutline: boolean }> {
  const pack = await safeBuildOutlineContextPack(projectPath, userRequest)
  return {
    context: formatOutlineRefinementContext(pack),
    hasOutline: Boolean(pack.outline.trim()),
  }
}

function emptyOutlineContextPack(task: string): ContextPack {
  return {
    task,
    chapterGoal: "",
    outline: "",
    recentSummaries: [],
    previousChapterEnding: "",
    characterStates: "",
    soulDoc: "",
    characterAuras: "",
    cognitionStates: "",
    foreshadowingStates: "",
    timeline: "",
    relatedSettings: "",
    canonRules: "",
    writingStyle: "",
    searchResults: "",
    graphSearchResults: "",
    mustDo: "",
    mustAvoid: "",
    nextChapterAdvice: "",
    revisionDirectives: "",
  }
}

async function safeBuildOutlineContextPack(projectPath: string, task: string): Promise<ContextPack> {
  try {
    return await buildContextPack(projectPath, task)
  } catch {
    return emptyOutlineContextPack(task)
  }
}

function buildSectionRefinementPrompt(
  context: string,
  config: OutlineSectionGenerationConfig,
  userRequest: string,
): string {
  const sectionTitle = getOutlineSectionTitle(config)
  return [
    "请基于已有大纲和项目记忆，生成指定类型的小说设定文件。",
    "",
    "硬性约束：",
    "1. 已有大纲、人物状态、角色认知、伏笔状态、时间线、正史规则和项目记忆都是最高优先级，不得推翻。",
    "2. 本次用户要求只能用于补充、聚焦和完善，不得改写既定主线和核心设定。",
    "3. 如果信息不足，只能做最小必要补完，且必须与现有设定兼容。",
    "4. 只输出正文 Markdown，不要输出 JSON、代码块、解释、前言或额外说明。",
    "",
    "已有大纲与项目记忆：",
    context || "当前暂无可读取的项目记忆，请仅基于已有大纲与本次要求进行细化。",
    "",
    "本次细化重点：",
    userRequest.trim() || "未额外指定，请基于已有大纲与项目记忆完成细化。",
    "",
    `本次只生成：${sectionTitle}`,
    config.requestHint,
  ].join("\n")
}

async function streamOutlineSectionContent(
  llmConfig: LlmConfig,
  context: string,
  config: OutlineSectionGenerationConfig,
  userRequest: string,
  signal?: AbortSignal,
): Promise<string> {
  let content = ""
  let streamError: Error | null = null

  await streamChat(llmConfig, [{ role: "user", content: buildSectionRefinementPrompt(context, config, userRequest) }], {
    onToken: (token) => {
      content += token
    },
    onDone: () => {},
    onError: (err) => {
      streamError = err
    },
  }, signal)

  if (streamError) throw streamError
  return content.trim()
}

async function getUniqueOutlinePath(outlinesDir: string, fileName: string): Promise<string> {
  const firstPath = `${outlinesDir}/${fileName}`
  if (!(await fileExists(firstPath))) return firstPath

  const extensionIndex = fileName.lastIndexOf(".")
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : ""
  for (let index = 2; index <= 99; index += 1) {
    const candidate = `${outlinesDir}/${stem}-${index}${extension}`
    if (!(await fileExists(candidate))) return candidate
  }
  return `${outlinesDir}/${stem}-${Date.now()}${extension}`
}

async function writeOutlineSectionFile(
  projectPath: string,
  outlinesDir: string,
  config: OutlineSectionGenerationConfig,
  sectionContent: string,
  options: OutlineRefinementWriteOptions = {},
): Promise<string | null> {
  if (!sectionContent.trim()) return null
  const sectionTitle = getOutlineSectionTitle(config)
  const fileName = getOutlineSectionFileName(config)

  if (options.mode === "appendCurrent" && options.targetPath) {
    const targetPath = normalizePath(options.targetPath)
    const existing = await readFile(targetPath).catch(() => "")
    const appended = [
      existing.trimEnd(),
      "",
      "---",
      "",
      `## ${sectionTitle}`,
      "",
      sectionContent.trim(),
      "",
    ].filter((part, index) => index > 0 || part).join("\n")
    await writeFile(targetPath, appended)
    return targetPath
  }

  const outlinePath = options.mode === "newFileAndAddToList"
    ? await getUniqueOutlinePath(outlinesDir, fileName)
    : `${outlinesDir}/${fileName}`
  await writeFile(outlinePath, outlinePageMarkdown(sectionTitle, sectionContent))
  if (options.mode === "newFileAndAddToList") {
    await addOutlineFileToSourceList(projectPath, outlinePath)
  }
  return outlinePath
}

export async function generateOutlineRefinementSectionFile(
  projectPath: string,
  llmConfig: LlmConfig,
  userRequest: string,
  sectionKey: OutlineSectionGenerationKey,
  writeOptions: OutlineRefinementWriteOptions = {},
  signal?: AbortSignal,
): Promise<string> {
  const pp = normalizePath(projectPath)
  const config = OUTLINE_SECTION_GENERATION_CONFIGS.find((item) => item.key === sectionKey)
  if (!config) {
    throw new Error("未知的大纲生成类型")
  }

  const { context, hasOutline } = await buildOutlineRefinementContext(pp, userRequest)
  if (!hasOutline) {
    throw new Error(i18n.t("novel.outlineGenerator.refineMissingOutline"))
  }

  const outlinesDir = `${pp}/wiki/outlines`
  await createDirectory(outlinesDir)
  const sectionContent = await streamOutlineSectionContent(llmConfig, context, config, userRequest, signal)
  const outlinePath = await writeOutlineSectionFile(pp, outlinesDir, config, sectionContent, writeOptions)
  if (!outlinePath) {
    throw new Error(i18n.t("novel.outlineGenerator.refineEmpty"))
  }
  return outlinePath
}

export async function generateOutlineRefinementFiles(
  projectPath: string,
  llmConfig: LlmConfig,
  userRequest: string,
  writeOptions: OutlineRefinementWriteOptions = {},
  signal?: AbortSignal,
): Promise<OutlineRefinementResult> {
  const pp = normalizePath(projectPath)
  const { context, hasOutline } = await buildOutlineRefinementContext(pp, userRequest)
  if (!hasOutline) {
    throw new Error(i18n.t("novel.outlineGenerator.refineMissingOutline"))
  }

  const outlinesDir = `${pp}/wiki/outlines`
  await createDirectory(outlinesDir)

  const sections: Partial<Record<OutlineSectionGenerationKey, string>> = {}
  const writtenPaths: string[] = []
  let primaryPath: string | null = null

  for (const config of OUTLINE_SECTION_GENERATION_CONFIGS) {
    if (signal?.aborted) {
      throw new Error("细化生成已取消")
    }
    const sectionContent = await streamOutlineSectionContent(llmConfig, context, config, userRequest, signal)
    sections[config.key] = sectionContent
    const outlinePath = await writeOutlineSectionFile(pp, outlinesDir, config, sectionContent, writeOptions)
    if (!outlinePath) continue
    writtenPaths.push(outlinePath)

    if (config.key === "chapterOutlines") {
      primaryPath = outlinePath
    } else if (!primaryPath) {
      primaryPath = outlinePath
    }
  }

  if (writtenPaths.length === 0) {
    throw new Error(i18n.t("novel.outlineGenerator.refineEmpty"))
  }

  return {
    primaryPath,
    sections,
    writtenPaths,
  }
}

export async function generateOutlineFile(
  projectPath: string,
  llmConfig: LlmConfig,
  prompt: string,
  signal?: AbortSignal,
): Promise<{ outlinePath: string; content: string }> {
  let content = ""
  let streamError: Error | null = null

  const messages: ChatMessage[] = [{ role: "user", content: prompt }]

  await streamChat(llmConfig, messages, {
    onToken: (token) => {
      content += token
    },
    onDone: () => {},
    onError: (err) => {
      streamError = err
    },
  }, signal)

  if (streamError) {
    throw streamError
  }

  const pp = normalizePath(projectPath)
  const outlinesDir = `${pp}/wiki/outlines`
  await createDirectory(outlinesDir)
  const outlineTitle = useEnglishOutlineNames() ? "Story Outline" : "总大纲"
  const fullContent = outlinePageMarkdown(outlineTitle, content)
  const outlinePath = `${outlinesDir}/${getStoryOutlineFileName()}`
  await writeFile(outlinePath, fullContent)
  return { outlinePath, content }
}

export async function runOutlineGenerationTask(taskId: string, llmConfig: LlmConfig): Promise<void> {
  const task = useOutlineGenerationStore.getState().tasks.find((item) => item.id === taskId)
  if (!task) return

  const { providerConfigs } = useWikiStore.getState()
  const effectiveLlmConfig = task.modelId
    ? resolveModelConfig(task.modelId, llmConfig, providerConfigs)
    : resolveDefaultModel(llmConfig)

  if (!hasUsableLlm(effectiveLlmConfig, providerConfigs)) {
    throw new Error("请先在设置中配置并选择一个可用的 AI 模型，或在大纲弹窗中选择模型后再试。")
  }

  const abortController = new AbortController()
  const progressTaskId = useImportProgressStore.getState().startTask({
    projectPath: task.projectPath,
    kind: "outline_generation",
    total: 100,
    currentTitle: "生成大纲",
    message: "正在生成大纲",
    abortController,
  })

  try {
    const { outlinePath } = await generateOutlineFile(task.projectPath, effectiveLlmConfig, task.prompt, abortController.signal)
    await refreshProjectState(task.projectPath)
    useOutlineGenerationStore.getState().updateTask(taskId, {
      status: "generated",
      outlinePath,
      message: i18n.t("novel.outlineGenerator.generatedNotification"),
      error: null,
    })
    useImportProgressStore.getState().finishTask(progressTaskId, "done", {
      completed: 100,
      total: 100,
      currentTitle: "",
      message: "大纲生成完成",
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    useOutlineGenerationStore.getState().updateTask(taskId, {
      status: "error",
      error: message,
      message,
    })
    useImportProgressStore.getState().finishTask(progressTaskId, "error", {
      completed: 0,
      total: 100,
      currentTitle: "",
      message: `大纲生成失败: ${message}`,
    })
  }
}

export async function runOutlineRefinementTask(taskId: string, llmConfig: LlmConfig): Promise<void> {
  const task = useOutlineGenerationStore.getState().tasks.find((item) => item.id === taskId)
  if (!task) return

  const { providerConfigs } = useWikiStore.getState()
  const effectiveLlmConfig = task.modelId
    ? resolveModelConfig(task.modelId, llmConfig, providerConfigs)
    : resolveDefaultModel(llmConfig)

  if (!hasUsableLlm(effectiveLlmConfig, providerConfigs)) {
    throw new Error("请先在设置中配置并选择一个可用的 AI 模型，或在大纲弹窗中选择模型后再试。")
  }

  const abortController = new AbortController()
  const progressTaskId = useImportProgressStore.getState().startTask({
    projectPath: task.projectPath,
    kind: "outline_refinement",
    total: 100,
    currentTitle: task.displayTitle || "细化生成",
    message: "正在细化生成大纲",
    abortController,
  })

  try {
    let outlinePath: string
    if (task.selectedSectionKey) {
      outlinePath = await generateOutlineRefinementSectionFile(
        task.projectPath,
        effectiveLlmConfig,
        task.userRequest,
        task.selectedSectionKey as OutlineSectionGenerationKey,
        {
          mode: (task.writeMode as OutlineRefinementWriteMode | null) ?? undefined,
          targetPath: task.targetPath,
        },
        abortController.signal,
      )
    } else {
      const result = await generateOutlineRefinementFiles(
        task.projectPath,
        effectiveLlmConfig,
        task.userRequest,
        {
          mode: (task.writeMode as OutlineRefinementWriteMode | null) ?? undefined,
          targetPath: task.targetPath,
        },
        abortController.signal,
      )
      if (!result.primaryPath) {
        throw new Error(i18n.t("novel.outlineGenerator.refineEmpty"))
      }
      outlinePath = result.primaryPath
    }

    await refreshProjectState(task.projectPath)
    useOutlineGenerationStore.getState().updateTask(taskId, {
      status: "generated",
      outlinePath,
      message: task.selectedSectionKey && task.displayTitle
        ? i18n.t("novel.outlineGenerator.sectionGenerated", { title: task.displayTitle })
        : i18n.t("novel.outlineGenerator.refineGenerated"),
      error: null,
    })
    useImportProgressStore.getState().finishTask(progressTaskId, "done", {
      completed: 100,
      total: 100,
      currentTitle: "",
      message: task.displayTitle ? `${task.displayTitle} 细化完成` : "细化生成完成",
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    useOutlineGenerationStore.getState().updateTask(taskId, {
      status: "error",
      error: message,
      message,
    })
    useImportProgressStore.getState().finishTask(progressTaskId, "error", {
      completed: 0,
      total: 100,
      currentTitle: "",
      message: `细化生成失败: ${message}`,
    })
  }
}

export async function openGeneratedOutline(taskId: string): Promise<void> {
  const task = useOutlineGenerationStore.getState().tasks.find((item) => item.id === taskId)
  if (!task?.outlinePath) return
  const content = await readFile(task.outlinePath)
  useWikiStore.getState().setActiveView("sources")
  useWikiStore.getState().setSelectedFile(task.outlinePath)
  useWikiStore.getState().setFileContent(content)
  useOutlineGenerationStore.getState().updateTask(taskId, {
    status: "generated",
    message: i18n.t("novel.outlineGenerator.openedNotification"),
  })
}

async function getUniqueSourceListPath(projectPath: string, fileName: string): Promise<string> {
  const sourcesDir = `${normalizePath(projectPath)}/raw/sources`
  const firstPath = `${sourcesDir}/${fileName}`
  if (!(await fileExists(firstPath))) return firstPath

  const extensionIndex = fileName.lastIndexOf(".")
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : ""
  for (let index = 2; index <= 99; index += 1) {
    const candidate = `${sourcesDir}/${stem}-${index}${extension}`
    if (!(await fileExists(candidate))) return candidate
  }
  return `${sourcesDir}/${stem}-${Date.now()}${extension}`
}

export async function addOutlineFileToSourceList(projectPath: string, outlinePath: string): Promise<string> {
  const pp = normalizePath(projectPath)
  const normalizedOutlinePath = normalizePath(outlinePath)
  const sourcesDir = `${pp}/raw/sources`
  await createDirectory(sourcesDir)

  const content = await readFile(normalizedOutlinePath)
  const targetPath = await getUniqueSourceListPath(pp, getFileName(normalizedOutlinePath))
  await writeFile(targetPath, content)

  await refreshProjectState(projectPath)
  return targetPath
}

export async function addOutlineTaskToSourceList(taskId: string): Promise<string | null> {
  const task = useOutlineGenerationStore.getState().tasks.find((item) => item.id === taskId)
  if (!task?.outlinePath) return null
  return addOutlineFileToSourceList(task.projectPath, task.outlinePath)
}

export function createOutlineIngestTask(projectPath: string, outlinePath: string): string {
  return useOutlineGenerationStore.getState().createTask({
    projectPath: normalizePath(projectPath),
    kind: "ingest",
    outlinePath: normalizePath(outlinePath),
    status: "ingesting",
    message: i18n.t("novel.outlineGenerator.ingestingNotification"),
    error: null,
  })
}

export class OutlineIngestNotReadyError extends Error {
  constructor() {
    super(i18n.t("novel.outlineGenerator.ingestNoLlm"))
    this.name = "OutlineIngestNotReadyError"
  }
}

export function assertOutlineIngestLlmReady(): void {
  const state = useWikiStore.getState()
  const runtimeLlmConfig = resolveNovelModel(state.llmConfig, state.novelConfig, "extract")
  if (!hasUsableLlm(runtimeLlmConfig, state.providerConfigs)) {
    throw new OutlineIngestNotReadyError()
  }
}

export const BULK_OUTLINE_INGEST_CONCURRENCY = 2

export interface OutlineIngestFailure {
  name: string
  path: string
  reason: string
}

export interface BulkOutlineIngestResult {
  total: number
  succeeded: number
  failed: number
  cancelled?: boolean
  failures: OutlineIngestFailure[]
}

export interface RunOutlineIngestPathsOptions {
  onProgressTaskStarted?: (taskId: string) => void
}

export interface OutlineIngestTaskResult {
  success: boolean
  outlinePath: string
  outlineFileName: string
  error?: string
  truncated?: boolean
  bodyLength?: number
  originalLength?: number
  bodyBudget?: number
}

export interface RunOutlineIngestTaskOptions {
  signal?: AbortSignal
  parentProgressId?: string
  manageProgress?: boolean
}

function getOutlineFileName(outlinePath: string): string {
  return outlinePath.split("/").pop()?.replace(".md", "") || "大纲"
}

function buildOutlineIngestFailureReason(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function getOutlineIngestCancelledMessage(): string {
  return i18n.t("novel.outlineGenerator.ingestCancelledNotification")
}

function finalizeOutstandingIngestTasks(taskIds: string[], cancelled: boolean): void {
  const message = cancelled
    ? getOutlineIngestCancelledMessage()
    : i18n.t("novel.outlineGenerator.ingestFailedNotification")
  for (const taskId of taskIds) {
    const task = useOutlineGenerationStore.getState().tasks.find((item) => item.id === taskId)
    if (task?.status !== "ingesting") continue
    useOutlineGenerationStore.getState().updateTask(taskId, {
      status: "error",
      message,
      error: message,
    })
  }
}

function buildBulkIngestProgressMessage(result: BulkOutlineIngestResult): string {
  if (result.cancelled) {
    return i18n.t("novel.outlineGenerator.bulkIngestCancelledProgress", {
      succeeded: result.succeeded,
      total: result.total,
    })
  }
  if (result.failed > 0) {
    const preview = result.failures
      .slice(0, 3)
      .map((failure) => `${failure.name}: ${failure.reason}`)
      .join("；")
    return i18n.t("novel.outlineGenerator.bulkIngestProgressWithFailures", {
      succeeded: result.succeeded,
      failed: result.failed,
      preview,
    })
  }
  return i18n.t("novel.outlineGenerator.bulkIngestProgressDone", {
    succeeded: result.succeeded,
    total: result.total,
  })
}

export function formatBulkOutlineIngestResult(result: BulkOutlineIngestResult): string {
  if (result.total === 0) {
    return i18n.t("novel.outlineGenerator.bulkIngestEmpty")
  }
  if (result.cancelled) {
    return i18n.t("novel.outlineGenerator.bulkIngestCancelled", {
      succeeded: result.succeeded,
      failed: result.failed,
      total: result.total,
    })
  }
  if (result.failed === 0) {
    return i18n.t("novel.outlineGenerator.bulkIngestResult", {
      total: result.total,
      succeeded: result.succeeded,
      failed: result.failed,
    })
  }

  const lines = result.failures
    .slice(0, 5)
    .map((failure) => `· ${failure.name}: ${failure.reason}`)
  const extra = result.failures.length > 5
    ? `\n${i18n.t("novel.outlineGenerator.bulkIngestMoreFailures", { count: result.failures.length - 5 })}`
    : ""

  return [
    i18n.t("novel.outlineGenerator.bulkIngestResultWithFailures", {
      total: result.total,
      succeeded: result.succeeded,
      failed: result.failed,
    }),
    ...lines,
  ].join("\n") + extra
}

type OutlineExtractOutcome =
  | { kind: "success"; path: string; taskId: string; ingestResult: OutlineIngestResult }
  | { kind: "failure"; path: string; taskId: string; reason: string }
  | { kind: "skipped"; path: string; taskId: string }

export async function runOutlineIngestPaths(
  projectPath: string,
  outlinePaths: string[],
  options?: RunOutlineIngestPathsOptions,
): Promise<BulkOutlineIngestResult> {
  assertOutlineIngestLlmReady()

  const pp = normalizePath(projectPath)
  const normalizedPaths = outlinePaths.map((path) => normalizePath(path))
  if (normalizedPaths.length === 0) {
    return { total: 0, succeeded: 0, failed: 0, failures: [] }
  }

  const abortController = new AbortController()
  const signal = abortController.signal
  const taskIds = normalizedPaths.map((outlinePath) => createOutlineIngestTask(pp, outlinePath))
  const progressTaskId = useImportProgressStore.getState().startTask({
    projectPath: pp,
    kind: "outline",
    total: normalizedPaths.length,
    currentTitle: getOutlineFileName(normalizedPaths[0] ?? ""),
    message: i18n.t("novel.outlineGenerator.bulkIngesting"),
    abortController,
    concurrency: BULK_OUTLINE_INGEST_CONCURRENCY,
    activeTitles: [],
  })
  options?.onProgressTaskStarted?.(progressTaskId)

  const failures: OutlineIngestFailure[] = []
  const extractProgress = {
    completed: 0,
    inFlight: new Set<string>(),
  }

  function publishExtractProgress(): void {
    const activeTitles = [...extractProgress.inFlight]
    useImportProgressStore.getState().updateTask(progressTaskId, {
      completed: extractProgress.completed,
      currentTitle: activeTitles[0] ?? "",
      activeTitles,
      concurrency: BULK_OUTLINE_INGEST_CONCURRENCY,
      message: activeTitles.length > 1
        ? i18n.t("novel.outlineGenerator.bulkIngestParallel", {
          active: activeTitles.length,
          concurrency: BULK_OUTLINE_INGEST_CONCURRENCY,
        })
        : i18n.t("novel.outlineGenerator.bulkIngesting"),
    })
  }

  const extractOutcomes = (await mapWithConcurrency(
    normalizedPaths,
    BULK_OUTLINE_INGEST_CONCURRENCY,
    async (outlinePath, index) => {
      const outlineFileName = getOutlineFileName(outlinePath)
      const taskId = taskIds[index]!

      if (signal.aborted) {
        useOutlineGenerationStore.getState().updateTask(taskId, {
          status: "error",
          message: getOutlineIngestCancelledMessage(),
          error: getOutlineIngestCancelledMessage(),
        })
        return { kind: "skipped", path: outlinePath, taskId } satisfies OutlineExtractOutcome
      }

      extractProgress.inFlight.add(outlineFileName)
      publishExtractProgress()

      useOutlineGenerationStore.getState().updateTask(taskId, {
        status: "ingesting",
        message: i18n.t("novel.outlineGenerator.ingestingNotification"),
        error: null,
      })

      try {
        const ingestResult = await ingestOutline(pp, outlinePath, signal, { skipSync: true })
        if (ingestResult.failureReason === "no_llm") {
          const reason = i18n.t("novel.outlineGenerator.ingestNoLlm")
          useOutlineGenerationStore.getState().updateTask(taskId, {
            status: "error",
            message: reason,
            error: reason,
          })
          return { kind: "failure", path: outlinePath, taskId, reason } satisfies OutlineExtractOutcome
        }
        if (!ingestResult.snapshot) {
          const reason = i18n.t("novel.outlineGenerator.ingestFailedNotification")
          useOutlineGenerationStore.getState().updateTask(taskId, {
            status: "error",
            message: reason,
            error: reason,
          })
          return { kind: "failure", path: outlinePath, taskId, reason } satisfies OutlineExtractOutcome
        }
        return { kind: "success", path: outlinePath, taskId, ingestResult } satisfies OutlineExtractOutcome
      } catch (err) {
        const reason = buildOutlineIngestFailureReason(err)
        useOutlineGenerationStore.getState().updateTask(taskId, {
          status: "error",
          message: reason,
          error: reason,
        })
        return { kind: "failure", path: outlinePath, taskId, reason } satisfies OutlineExtractOutcome
      } finally {
        extractProgress.inFlight.delete(outlineFileName)
        if (!signal.aborted) {
          extractProgress.completed += 1
        } else {
          const task = useOutlineGenerationStore.getState().tasks.find((item) => item.id === taskId)
          if (task?.status === "ingesting") {
            useOutlineGenerationStore.getState().updateTask(taskId, {
              status: "error",
              message: getOutlineIngestCancelledMessage(),
              error: getOutlineIngestCancelledMessage(),
            })
          }
        }
        publishExtractProgress()
      }
    },
    { signal },
  )).filter((outcome): outcome is OutlineExtractOutcome => outcome != null)

  const cancelled = signal.aborted
  const extractSuccesses = extractOutcomes.filter(
    (outcome): outcome is Extract<OutlineExtractOutcome, { kind: "success" }> => outcome.kind === "success",
  )

  for (const outcome of extractOutcomes) {
    if (outcome.kind === "failure") {
      failures.push({
        name: getOutlineFileName(outcome.path),
        path: outcome.path,
        reason: outcome.reason,
      })
    }
  }

  let succeeded = 0
  let syncCompleted = 0

  for (const item of extractSuccesses) {
    if (signal.aborted) break

    const outlineFileName = getOutlineFileName(item.path)
    useImportProgressStore.getState().updateTask(progressTaskId, {
      completed: syncCompleted,
      currentTitle: i18n.t("novel.outlineGenerator.bulkIngestSyncing", { name: outlineFileName }),
      activeTitles: [outlineFileName],
      concurrency: 1,
      message: i18n.t("novel.outlineGenerator.bulkIngestSyncing", { name: outlineFileName }),
    })

    try {
      await syncSnapshotToMemory(pp, item.ingestResult.snapshot!, {
        deferStructuredMemoryExport: true,
        deferDerivedRebuild: true,
      })
      const successMessage = item.ingestResult.truncated
        ? i18n.t("novel.outlineGenerator.ingestSuccessTruncatedNotification", {
          used: item.ingestResult.bodyLength,
          total: item.ingestResult.originalLength,
          budget: item.ingestResult.bodyBudget,
        })
        : i18n.t("novel.outlineGenerator.ingestSuccessNotification")
      useOutlineGenerationStore.getState().updateTask(item.taskId, {
        status: "done",
        message: successMessage,
        error: null,
      })
      succeeded += 1
    } catch (err) {
      const reason = buildOutlineIngestFailureReason(err)
      useOutlineGenerationStore.getState().updateTask(item.taskId, {
        status: "error",
        message: reason,
        error: reason,
      })
      failures.push({
        name: outlineFileName,
        path: item.path,
        reason,
      })
    } finally {
      syncCompleted += 1
      useImportProgressStore.getState().updateTask(progressTaskId, {
        completed: syncCompleted,
        activeTitles: [],
      })
    }
  }

  if (succeeded > 0) {
    await finalizeProjectMemoryRebuild(pp)
    await refreshProjectState(pp)
  }

  const result: BulkOutlineIngestResult = {
    total: normalizedPaths.length,
    succeeded,
    failed: failures.length,
    cancelled: cancelled || undefined,
    failures,
  }

  useImportProgressStore.getState().finishTask(
    progressTaskId,
    cancelled ? "cancelled" : failures.length > 0 ? "error" : "done",
    {
      completed: syncCompleted,
      total: normalizedPaths.length,
      currentTitle: "",
      activeTitles: [],
      message: buildBulkIngestProgressMessage(result),
    },
  )

  finalizeOutstandingIngestTasks(taskIds, cancelled)

  return result
}

export function startOutlineIngestTask(projectPath: string, outlinePath: string): string {
  const taskId = createOutlineIngestTask(projectPath, outlinePath)
  void runOutlineIngestTask(taskId)
  return taskId
}

function collectOutlineMarkdownPaths(
  nodes: Array<{ path: string; name: string; is_dir: boolean; children?: Array<{ path: string; name: string; is_dir: boolean; children?: unknown[] }> }>,
): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      paths.push(...collectOutlineMarkdownPaths(node.children as Array<{ path: string; name: string; is_dir: boolean; children?: Array<{ path: string; name: string; is_dir: boolean; children?: unknown[] }> }>))
      continue
    }
    if (!node.is_dir && node.name.endsWith(".md")) {
      paths.push(normalizePath(node.path))
    }
  }
  return paths
}

export async function runBulkOutlineIngest(projectPath: string): Promise<BulkOutlineIngestResult> {
  const pp = normalizePath(projectPath)
  let outlinePaths: string[] = []

  try {
    const tree = await listDirectory(`${pp}/wiki/outlines`)
    outlinePaths = collectOutlineMarkdownPaths(tree as Array<{ path: string; name: string; is_dir: boolean; children?: Array<{ path: string; name: string; is_dir: boolean; children?: unknown[] }> }>)
      .sort((a, b) => a.localeCompare(b, "zh-CN"))
  } catch {
    return { total: 0, succeeded: 0, failed: 0, failures: [] }
  }

  return runOutlineIngestPaths(pp, outlinePaths)
}

export async function runOutlineIngestTask(
  taskId: string,
  options: RunOutlineIngestTaskOptions = {},
): Promise<OutlineIngestTaskResult | null> {
  const task = useOutlineGenerationStore.getState().tasks.find((item) => item.id === taskId)
  if (!task?.outlinePath) return null

  const outlinePath = task.outlinePath
  const outlineFileName = getOutlineFileName(outlinePath)
  const manageProgress = options.manageProgress !== false
  const abortController = options.signal ? null : new AbortController()
  const signal = options.signal ?? abortController!.signal
  let progressTaskId = options.parentProgressId

  if (manageProgress && !progressTaskId) {
    progressTaskId = useImportProgressStore.getState().startTask({
      projectPath: task.projectPath,
      kind: "outline",
      total: 1,
      currentTitle: outlineFileName,
      message: "正在提取大纲记忆",
      abortController: abortController ?? undefined,
    })
  }

  try {
    useOutlineGenerationStore.getState().updateTask(taskId, {
      status: "ingesting",
      message: i18n.t("novel.outlineGenerator.ingestingNotification"),
      error: null,
    })
    const ingestResult = await ingestOutline(task.projectPath, outlinePath, signal)
    const snapshot = ingestResult.snapshot

    if (ingestResult.failureReason === "no_llm") {
      const reason = i18n.t("novel.outlineGenerator.ingestNoLlm")
      useOutlineGenerationStore.getState().updateTask(taskId, {
        status: "error",
        message: reason,
        error: reason,
      })
      if (manageProgress && progressTaskId) {
        useImportProgressStore.getState().finishTask(progressTaskId, "error", {
          completed: 0,
          total: 1,
          currentTitle: "",
          message: `${outlineFileName} 提取失败：${reason}`,
        })
      }
      return { success: false, outlinePath, outlineFileName, error: reason }
    }

    if (snapshot) {
      await refreshProjectState(task.projectPath)
    }

    const successMessage = snapshot
      ? ingestResult.truncated
        ? i18n.t("novel.outlineGenerator.ingestSuccessTruncatedNotification", {
          used: ingestResult.bodyLength,
          total: ingestResult.originalLength,
          budget: ingestResult.bodyBudget,
        })
        : i18n.t("novel.outlineGenerator.ingestSuccessNotification")
      : i18n.t("novel.outlineGenerator.ingestFailedNotification")
    const errorMessage = snapshot ? undefined : i18n.t("novel.outlineGenerator.ingestFailedNotification")

    useOutlineGenerationStore.getState().updateTask(taskId, {
      status: snapshot ? "done" : "error",
      message: successMessage,
      error: errorMessage ?? null,
    })

    if (manageProgress && progressTaskId) {
      useImportProgressStore.getState().finishTask(progressTaskId, snapshot ? "done" : "error", {
        completed: snapshot ? 1 : 0,
        total: 1,
        currentTitle: "",
        message: snapshot
          ? ingestResult.truncated
            ? i18n.t("novel.outlineGenerator.ingestProgressTruncated", {
              name: outlineFileName,
              used: ingestResult.bodyLength,
              total: ingestResult.originalLength,
            })
            : `${outlineFileName} 提取完成`
          : `${outlineFileName} 提取失败`,
      })
    }

    return {
      success: Boolean(snapshot),
      outlinePath,
      outlineFileName,
      error: errorMessage,
      truncated: ingestResult.truncated,
      bodyLength: ingestResult.bodyLength,
      originalLength: ingestResult.originalLength,
      bodyBudget: ingestResult.bodyBudget,
    }
  } catch (err) {
    const message = buildOutlineIngestFailureReason(err)
    useOutlineGenerationStore.getState().updateTask(taskId, {
      status: "error",
      message,
      error: message,
    })
    if (manageProgress && progressTaskId) {
      useImportProgressStore.getState().finishTask(progressTaskId, "error", {
        completed: 0,
        total: 1,
        currentTitle: "",
        message: `${outlineFileName} 提取失败：${message}`,
      })
    }
    return { success: false, outlinePath, outlineFileName, error: message }
  }
}
