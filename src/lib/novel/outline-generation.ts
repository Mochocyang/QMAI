import { createDirectory, fileExists, listDirectory, readFile, writeFile } from "@/commands/fs"
import { streamChat } from "@/lib/llm-client"
import { getOutputLanguage } from "@/lib/output-language"
import { getFileName, normalizePath } from "@/lib/path-utils"
import { refreshProjectState } from "@/lib/project-refresh"
import i18n from "@/i18n"
import type { ChatMessage } from "@/lib/llm-providers"
import { PROMPTS } from "@/lib/novel/prompt-templates"
import { useOutlineGenerationStore } from "@/stores/outline-generation-store"
import type { LlmConfig } from "@/stores/wiki-store"
import { useWikiStore } from "@/stores/wiki-store"
import { ingestOutline } from "./chapter-ingest"
import { buildContextPack, type ContextPack } from "./context-engine"

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
  })

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
  const sectionContent = await streamOutlineSectionContent(llmConfig, context, config, userRequest)
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
    const sectionContent = await streamOutlineSectionContent(llmConfig, context, config, userRequest)
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
  })

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

  try {
    const { outlinePath } = await generateOutlineFile(task.projectPath, llmConfig, task.prompt)
    await refreshProjectState(task.projectPath)
    useOutlineGenerationStore.getState().updateTask(taskId, {
      status: "generated",
      outlinePath,
      message: i18n.t("novel.outlineGenerator.generatedNotification"),
      error: null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    useOutlineGenerationStore.getState().updateTask(taskId, {
      status: "error",
      error: message,
      message,
    })
  }
}

export async function runOutlineRefinementTask(taskId: string, llmConfig: LlmConfig): Promise<void> {
  const task = useOutlineGenerationStore.getState().tasks.find((item) => item.id === taskId)
  if (!task) return

  try {
    let outlinePath: string
    if (task.selectedSectionKey) {
      outlinePath = await generateOutlineRefinementSectionFile(
        task.projectPath,
        llmConfig,
        task.userRequest,
        task.selectedSectionKey as OutlineSectionGenerationKey,
        {
          mode: (task.writeMode as OutlineRefinementWriteMode | null) ?? undefined,
          targetPath: task.targetPath,
        },
      )
    } else {
      const result = await generateOutlineRefinementFiles(
        task.projectPath,
        llmConfig,
        task.userRequest,
        {
          mode: (task.writeMode as OutlineRefinementWriteMode | null) ?? undefined,
          targetPath: task.targetPath,
        },
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    useOutlineGenerationStore.getState().updateTask(taskId, {
      status: "error",
      error: message,
      message,
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

export async function runBulkOutlineIngest(projectPath: string): Promise<{
  total: number
  succeeded: number
  failed: number
}> {
  const pp = normalizePath(projectPath)
  let outlinePaths: string[] = []

  try {
    const tree = await listDirectory(`${pp}/wiki/outlines`)
    outlinePaths = collectOutlineMarkdownPaths(tree as Array<{ path: string; name: string; is_dir: boolean; children?: Array<{ path: string; name: string; is_dir: boolean; children?: unknown[] }> }>)
      .sort((a, b) => a.localeCompare(b, "zh-CN"))
  } catch {
    return { total: 0, succeeded: 0, failed: 0 }
  }

  let succeeded = 0
  let failed = 0

  for (const outlinePath of outlinePaths) {
    const taskId = createOutlineIngestTask(pp, outlinePath)
    await runOutlineIngestTask(taskId)
    const task = useOutlineGenerationStore.getState().tasks.find((item) => item.id === taskId)
    if (task?.status === "done") succeeded += 1
    else failed += 1
  }

  return {
    total: outlinePaths.length,
    succeeded,
    failed,
  }
}

export async function runOutlineIngestTask(taskId: string): Promise<void> {
  const task = useOutlineGenerationStore.getState().tasks.find((item) => item.id === taskId)
  if (!task?.outlinePath) return
  try {
    useOutlineGenerationStore.getState().updateTask(taskId, {
      status: "ingesting",
      message: i18n.t("novel.outlineGenerator.ingestingNotification"),
      error: null,
    })
    const snapshot = await ingestOutline(task.projectPath, task.outlinePath)
    if (snapshot) {
      await refreshProjectState(task.projectPath)
    }
    useOutlineGenerationStore.getState().updateTask(taskId, {
      status: snapshot ? "done" : "error",
      message: snapshot
        ? i18n.t("novel.outlineGenerator.ingestSuccessNotification")
        : i18n.t("novel.outlineGenerator.ingestFailedNotification"),
      error: snapshot ? null : i18n.t("novel.outlineGenerator.ingestFailedNotification"),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    useOutlineGenerationStore.getState().updateTask(taskId, {
      status: "error",
      message,
      error: message,
    })
  }
}
