import { createDirectory, fileExists, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { PlotFramework, PlotFrameworkBeats } from "./plot-framework"

export type DismantlingChapterStatus = "pending" | "running" | "done" | "failed"

export interface DismantlingChapter {
  id: string
  chapterNumber: number
  title: string
  content: string
  status: DismantlingChapterStatus
  error?: string
}

export interface DismantlingAnalysis {
  id: string
  chapterIds: string[]
  title: string
  createdAt: number
  markdown: string
  structureMemory: string[]
}

export interface DismantlingProject {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  chapters: DismantlingChapter[]
  analyses: DismantlingAnalysis[]
  structureMemory: string[]
  useInChat?: boolean
}

export interface DismantlingLibrary {
  version: 1
  projects: DismantlingProject[]
  selectedProjectId?: string | null
}

export interface DismantlingBatchOptions {
  selectedChapterIds: string[]
  batchSize: number
}

const DEFAULT_LIBRARY: DismantlingLibrary = {
  version: 1,
  projects: [],
  selectedProjectId: null,
}

export const DISMANTLING_NO_PREPROCESSING_NEEDED = "no preprocessing needed"

export function getDismantlingLibraryPath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/dismantling/library.json`
}

export function getDismantlingLibraryDir(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/dismantling`
}

export async function loadDismantlingLibrary(projectPath: string): Promise<DismantlingLibrary> {
  const path = getDismantlingLibraryPath(projectPath)
  if (!(await fileExists(path))) return { ...DEFAULT_LIBRARY }
  try {
    const parsed = JSON.parse(await readFile(path)) as Partial<DismantlingLibrary>
    return normalizeDismantlingLibrary(parsed)
  } catch {
    return { ...DEFAULT_LIBRARY }
  }
}

export async function saveDismantlingLibrary(projectPath: string, library: DismantlingLibrary): Promise<void> {
  await createDirectory(getDismantlingLibraryDir(projectPath)).catch(() => {})
  await writeFile(getDismantlingLibraryPath(projectPath), JSON.stringify(normalizeDismantlingLibrary(library), null, 2))
}

export function normalizeDismantlingLibrary(input: Partial<DismantlingLibrary> | null | undefined): DismantlingLibrary {
  const projects = dedupeDismantlingProjects(
    Array.isArray(input?.projects) ? input.projects.map(normalizeDismantlingProject).filter(Boolean) : [],
  )
  const selectedProjectId = projects.some((project) => project.id === input?.selectedProjectId)
    ? input?.selectedProjectId
    : projects[0]?.id ?? null
  return {
    version: 1,
    projects,
    selectedProjectId,
  }
}

export function normalizeDismantlingProjectTitle(title: string): string {
  return title
    .normalize("NFKC")
    .trim()
    .replace(/\.(txt|md|mdx|doc|docx)$/i, "")
    .replace(/\s+/g, "")
    .toLowerCase()
}

export function shouldReadDismantlingOriginalFile(preprocessedText: string): boolean {
  return preprocessedText.trim().toLowerCase() === DISMANTLING_NO_PREPROCESSING_NEEDED
}

function dedupeDismantlingProjects(projects: DismantlingProject[]): DismantlingProject[] {
  const seen = new Set<string>()
  return projects.filter((project) => {
    const key = normalizeDismantlingProjectTitle(project.title)
    if (!key) return true
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeDismantlingProject(input: Partial<DismantlingProject> | null | undefined): DismantlingProject {
  const now = Date.now()
  const chapters = Array.isArray(input?.chapters)
    ? input.chapters.map((chapter, index) => normalizeDismantlingChapter(chapter, index + 1))
    : []
  const analyses = Array.isArray(input?.analyses)
    ? input.analyses.map(normalizeDismantlingAnalysis)
    : []
  return {
    id: input?.id || `dismantling-${now}`,
    title: input?.title || "未命名拆文作品",
    createdAt: Number(input?.createdAt) || now,
    updatedAt: Number(input?.updatedAt) || now,
    chapters,
    analyses,
    structureMemory: Array.isArray(input?.structureMemory) ? input.structureMemory.filter(Boolean) : [],
    useInChat: Boolean(input?.useInChat),
  }
}

function normalizeDismantlingChapter(input: Partial<DismantlingChapter>, fallbackNumber: number): DismantlingChapter {
  return {
    id: input.id || `chapter-${fallbackNumber}`,
    chapterNumber: Number(input.chapterNumber) || fallbackNumber,
    title: input.title || `第${fallbackNumber}章`,
    content: input.content || "",
    status: input.status ?? "pending",
    error: input.error,
  }
}

function normalizeDismantlingAnalysis(input: Partial<DismantlingAnalysis>): DismantlingAnalysis {
  return {
    id: input.id || `analysis-${Date.now()}`,
    chapterIds: Array.isArray(input.chapterIds) ? input.chapterIds : [],
    title: input.title || "拆文结果",
    createdAt: Number(input.createdAt) || Date.now(),
    markdown: input.markdown || "",
    structureMemory: Array.isArray(input.structureMemory) ? input.structureMemory.filter(Boolean) : [],
  }
}

export function splitDismantlingTextIntoChapters(text: string): DismantlingChapter[] {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .trim()
  if (!normalized) return []

  const matches = collectDismantlingChapterStarts(normalized)
  if (matches.length === 0) {
    return [{
      id: "chapter-001",
      chapterNumber: 1,
      title: "第1章",
      content: normalized,
      status: "pending",
    }]
  }

  return matches.map((match, index) => {
    const start = match.index
    const nextStart = matches[index + 1]?.index ?? normalized.length
    const raw = normalized.slice(start, nextStart).trim()
    const { title, content } = splitDismantlingChapterSegment(raw, index + 1)
    const chapterNumber = extractDismantlingChapterNumber(title) ?? index + 1
    return {
      id: `chapter-${String(chapterNumber).padStart(3, "0")}`,
      chapterNumber,
      title,
      content,
      status: "pending",
    }
  })
}

export function extractDismantlingChapterNumber(value: string): number | null {
  const normalized = value.normalize("NFKC")
  const digitMatches = [...normalized.matchAll(/(?:第\s*0*(\d+)\s*[章节回]|chapter\s*0*(\d+))/gi)]
  const digit = digitMatches[digitMatches.length - 1]
  if (digit) return Number.parseInt(digit[1] ?? digit[2], 10)
  const chineseMatches = [...normalized.matchAll(/第\s*([零〇一二三四五六七八九十百千万两]+)\s*[章节回]/g)]
  const chinese = chineseMatches[chineseMatches.length - 1]?.[1]
  return chinese ? parseChineseNumber(chinese) : null
}

function createDismantlingChapterHeadingPattern(): RegExp {
  const chineseNumber = "零〇一二三四五六七八九十百千万两"
  const chapterNumber = `(?:\\d+|[${chineseNumber}]+)`
  const chapterMarker = `第\\s*${chapterNumber}\\s*[章节回]`
  const volumePrefix = `(?:(?:正文卷|第\\s*${chapterNumber}\\s*卷|[^\\n]{1,24}卷)[^\\n]{0,32}?)`
  return new RegExp(`^[ \\t]*(?:#{1,3}[ \\t]*)?(?:${volumePrefix}[ \\t]*)?(?:${chapterMarker}[^\\n]*|chapter[ \\t]*\\d+[^\\n]*)$`, "gim")
}

function collectDismantlingChapterStarts(text: string): { index: number }[] {
  const lineMatches = [...text.matchAll(createDismantlingChapterHeadingPattern())]
    .map((match) => ({ index: match.index ?? 0 }))
  const inlineMatches = [...text.matchAll(createDismantlingInlineChapterPattern())]
    .map((match) => ({ index: (match.index ?? 0) + (match[1]?.length ?? 0) }))
  return inlineMatches.length > lineMatches.length ? inlineMatches : lineMatches
}

function createDismantlingInlineChapterPattern(): RegExp {
  const chineseNumber = "零〇一二三四五六七八九十百千万两"
  const chapterNumber = `(?:\\d+|[${chineseNumber}]+)`
  const chapterMarker = `第\\s*${chapterNumber}\\s*[章节回]`
  const volumePrefix = `(?:(?:正文卷|第\\s*${chapterNumber}\\s*卷|[^。！？!?\\n]{1,24}卷)[^。！？!?\\n]{0,32}?)`
  return new RegExp(`(^|\\n|\\s{2,})((?:#{1,3}[ \\t]*)?(?:${volumePrefix}[ \\t]*)?(?:${chapterMarker}|chapter[ \\t]*\\d+))`, "gim")
}

function splitDismantlingChapterSegment(raw: string, fallbackNumber: number): { title: string; content: string } {
  const [firstLine = `第${fallbackNumber}章`, ...bodyLines] = raw.split("\n")
  const cleanedFirstLine = cleanDismantlingChapterTitle(firstLine)
  if (bodyLines.length > 0 && cleanedFirstLine.length <= 100) {
    return {
      title: cleanedFirstLine,
      content: bodyLines.join("\n").trim(),
    }
  }
  return splitInlineDismantlingChapter(raw, fallbackNumber)
}

function splitInlineDismantlingChapter(raw: string, fallbackNumber: number): { title: string; content: string } {
  const cleaned = cleanDismantlingChapterTitle(raw)
  const markerMatch = cleaned.match(/^(.*?(?:第\s*(?:\d+|[零〇一二三四五六七八九十百千万两]+)\s*[章节回]|chapter\s*\d+))/i)
  const marker = markerMatch?.[1]?.trim() || `第${fallbackNumber}章`
  const afterMarker = cleaned.slice(marker.length).trim()
  const beforePunctuation = afterMarker.split(/[。！？!?]/)[0]?.trim() ?? ""
  const titleTail = beforePunctuation.split(/\s+/)[0]?.trim() ?? ""
  const title = [marker, titleTail].filter(Boolean).join(" ")
  const contentStart = Math.min(cleaned.length, title.length)
  return {
    title,
    content: cleaned.slice(contentStart).trim(),
  }
}

function cleanDismantlingChapterTitle(value: string): string {
  return value
    .replace(/^\s*#{1,3}\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
}

function parseChineseNumber(value: string): number | null {
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 }
  let total = 0
  let section = 0
  let number = 0
  let seen = false
  for (const char of value) {
    if (digits[char] !== undefined) {
      number = digits[char]
      seen = true
      continue
    }
    const unit = units[char]
    if (!unit) return null
    seen = true
    if (unit === 10000) {
      section = (section + (number || 1)) * unit
      total += section
      section = 0
    } else {
      section += (number || 1) * unit
    }
    number = 0
  }
  const result = total + section + number
  return seen && result > 0 ? result : null
}

export function selectNextDismantlingBatch(
  project: DismantlingProject,
  options: DismantlingBatchOptions,
): DismantlingChapter[] {
  const selected = new Set(options.selectedChapterIds)
  const batchSize = Math.max(1, Math.min(10, Math.floor(options.batchSize || 1)))
  return project.chapters
    .filter((chapter) => selected.has(chapter.id) && chapter.status !== "done")
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
    .slice(0, batchSize)
}

/**
 * 构建拆文提示词的稳定前缀（章节内容块）。
 * 阶段0-5 的所有提示词都以该前缀开头，使 API 供应商的前缀缓存命中。
 */
export function buildDismantlingCachePrefix(
  projectTitle: string,
  chapters: DismantlingChapter[],
): string {
  return [
    `拆文作品：${projectTitle}`,
    "",
    "章节内容：",
    chapters.map((chapter) => [
      `### ${chapter.title}`,
      `章节序号：${chapter.chapterNumber}`,
      chapter.content,
    ].join("\n")).join("\n\n"),
  ].join("\n")
}

export function buildDismantlingAnalysisPrompt(input: {
  projectTitle: string
  chapters: DismantlingChapter[]
}): string {
  return [
    buildDismantlingCachePrefix(input.projectTitle, input.chapters),
    "",
    "你是小说拆文分析助手。请把下面章节拆成可复用的写法结构，结果写入独立拆文记忆库。",
    "",
    "重要边界：",
    "- 拆文结果只服务写作结构参考，不得把原作人物、设定、剧情当成当前小说事实。",
    "- 不要复述大段原文，不要输出可替代原文的连续文本。",
    "- 只输出结构化写法分析，重点分析章节结构、冲突推进、爽点、情绪节奏、人物作用、信息增量、结尾钩子和可复用模板。",
    "- 后续 AI 写作只能学习节奏、冲突推进、爽点安排和章节钩子，不得复用原作人物、设定、剧情和具体表达。",
    "",
    "核心心智模型（必须按此四段循环套用，这是固定方向模板，故事可以不同，方向模板要相同）：",
    "- 开局钩子：让读者保持期待感的剧情（如穿越/重生/金手指引出）。",
    "- 铺垫：塑造舞台、规则，让读者感到压力、负面情绪、加深期待（配角衬托、规则建立、压低主角）。",
    "- 爽点：反转剧情，将积累的情绪一下子释放，让读者爽到（打破规则、对比衬托、强者震慑）。",
    "- 结尾钩子：让读者继续保持期待感，衔接下一轮循环（新危机/新目标/新副本）。",
    "- 血肉层（人设、文风、对话设计、整活、玩梗、小癖好）让位作者手搓，本提示词只关注框架层。",
    "",
    "AI 必须给到强约束框架，不能只给模糊方向：每一帧都要落到具体剧情动作与读后效果，",
    "不得省略任一段，缺一段即视为拆文失败（后续大纲套用会因缺一段直接崩）。",
    "",
    "请严格按以下 Markdown 结构输出（每段都必须有具体内容，禁止留空、禁止套话）：",
    "## 本批总览",
    "## 章节拆解",
    "## 人物与关系写法",
    "## 开局钩子（具体剧情 + 读者读后的期待感来源）",
    "## 铺垫（塑造的舞台/规则 + 配角作用 + 读者压力/负面情绪来源）",
    "## 爽点（反转动作 + 情绪如何释放 + 与前两段如何形成对比）",
    "## 结尾钩子（衔接下一循环的具体悬念点）",
    "## 框架归属与衔接",
    "- 本框架属于：主线 / 支线（任选其一，明确给出）",
    "- 本框架覆盖本批章节数：N 章（据此可初判节奏功底：<=3 章紧凑型 / 4-6 章标准 / >=7 章水型）",
    "- 与上一框架衔接点：（若是首个填无；否则说明如何承接上个结尾钩子）",
    "- 与下一框架衔接点：（说明本结尾钩子如何引出下一个开局钩子）",
    "## 可复用结构记忆",
    "- 一句话可复用模板：（例如 先压后扬，规则打破 / 强敌逼近→反手反杀→新威胁浮现）",
    "- 节奏写法要点：（3 条以内，仅描述节奏与冲突推进，不复述人物剧情）",
    "- 章节结构：本批用到的章节结构特征（如每章末尾留立即行动压力）",
    "",
    "硬性要求：",
    "1. 开局钩子、铺垫、爽点、结尾钩子四段缺一不可，每段必须给出具体剧情动作与读者效果说明。",
    "2. 不得把任一段写成笼统的「有铺垫」「有爽点」式套话，必须落到本批真实章节。",
    "3. 主线/支线归属必须明确，不可省略。",
    "4. 可复用模板必须是一句话的方向模板，可被其他故事套用，不含本作人物设定。",
  ].join("\n")
}

export function buildDismantlingWebResearchPrompt(input: {
  projectTitle: string
  userRequest: string
  webResearchContext: string
}): string {
  return [
    "你是小说拆文与市场趋势分析助手。请基于用户指定的网页资料或联网搜索资料，输出网页热门分析。",
    "",
    "重要边界：",
    "- 本结果只写入独立拆文记忆库，不要写入当前小说事实、章节记忆或大纲记忆。",
    "- 只能提炼题材趋势、开篇结构、卖点、爽点、冲突推进、读者期待和可复用写法。",
    "- 不要复述网页大段原文，不要复制原作人物、设定、剧情和具体表达。",
    "- 如果网页资料不足，请直接说明资料不足，并列出还需要补充的资料方向。",
    "",
    `拆文作品：${input.projectTitle}`,
    `用户要求：${input.userRequest}`,
    "",
    input.webResearchContext,
    "",
    "请按以下 Markdown 结构输出：",
    "## 网页热门分析",
    "## 题材与卖点趋势",
    "## 开篇与章节节奏",
    "## 冲突、爽点与钩子",
    "## 可复用结构记忆",
  ].join("\n")
}

export function extractStructureMemoryFromAnalysis(markdown: string): string[] {
  const sectionMatch = markdown.match(/##\s*可复用结构记忆\s*\n([\s\S]*)$/)
  const raw = sectionMatch?.[1] ?? markdown
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
    .filter((line) => line.length >= 6)
    .slice(0, 30)
}
/**
 * 从拆文 markdown 中提取"开局钩子 / 铺垫 / 爽点 / 结尾钩子"四段框架。
 * 依赖 buildDismantlingAnalysisPrompt 输出的段标题。每段以 ## 下一个标题或文末为结束。
 * 四段任一不足都返回 null，避免半成品框架污染后续大纲套用。
 */
export function extractPlotFrameworkBeatsFromAnalysis(markdown: string): PlotFrameworkBeats | null {
  const hook = readDismantlingSection(markdown, /##\s*开局钩子[^\n]*\n/)
  const buildup = readDismantlingSection(markdown, /##\s*铺垫[^\n]*\n/)
  const payoff = readDismantlingSection(markdown, /##\s*爽点[^\n]*\n/)
  const endingHook = readDismantlingSection(markdown, /##\s*结尾钩子[^\n]*\n/)
  if (!hook || !buildup || !payoff || !endingHook) return null
  return { hook, buildup, payoff, endingHook }
}

/** 从拆文 markdown 中提取框架归属与衔接信息（主线/支线 + 与上下框架衔接点）。 */
export function extractPlotFrameworkLineageFromAnalysis(markdown: string): {
  line: "main" | "sub" | null
  prevConnector?: string
  nextConnector?: string
  reusableTemplate?: string
  pacingChapterCount?: number
} {
  const lineageRaw = readDismantlingSection(markdown, /##\s*框架归属与衔接\s*\n/)
  if (!lineageRaw) return { line: null }
  const lineMatch = lineageRaw.match(/属于：(主线|支线|main|sub)/)
  let line: "main" | "sub" | null = null
  if (lineMatch) {
    const v = lineMatch[1]
    if (v === "主线" || v === "main") line = "main"
    else if (v === "支线" || v === "sub") line = "sub"
  }
  const prev = parseLabeledLine(lineageRaw, /与上一框架衔接点[：:]/)
  const next = parseLabeledLine(lineageRaw, /与下一框架衔接点[：:]/)
  const coverage = parseLabeledLine(lineageRaw, /覆盖本批章节数[：:]/)
  const pacingChapterCount = coverage ? extractFirstInteger(coverage) : undefined
  const reusableRaw = readDismantlingSection(markdown, /##\s*可复用结构记忆\s*\n/)
  const TEMPLATE_RE = /一句话可复用模板[：:]\s*(.+)/
  const reusableTemplate = reusableRaw?.match(TEMPLATE_RE)?.[1]?.trim()
  return {
    line,
    prevConnector: prev,
    nextConnector: next,
    reusableTemplate,
    pacingChapterCount,
  }
}

export function buildPlotFrameworkDraftFromAnalysis(input: {
  analysisId: string
  markdown: string
  rangeChapterIds: string[]
  sourceDismantlingProjectId: string
  sourceDismantlingProjectTitle: string
  createdAt?: number
}): PlotFramework | null {
  const beats = extractPlotFrameworkBeatsFromAnalysis(input.markdown)
  if (!beats) return null
  const lineage = extractPlotFrameworkLineageFromAnalysis(input.markdown)
  const createdAt = input.createdAt ?? Date.now()
  const safeAnalysisId = input.analysisId.trim() || String(createdAt)
  const reusableTemplate = lineage.reusableTemplate ?? ""

  return {
    id: `framework-${safeAnalysisId}`,
    title: reusableTemplate || `${input.sourceDismantlingProjectTitle || "拆文"}剧情框架`,
    beats,
    rangeChapterIds: input.rangeChapterIds,
    line: lineage.line ?? "main",
    characters: [],
    foreshadowing: [],
    reusableTemplate,
    directionHints: "由拆文四段自动生成的基础框架；可通过“提取框架”进一步补充方向指引、角色作用和伏笔。",
    handcraftHints: "作者手搓留白：请在章纲阶段用人设卡、文风、对话设计、整活或玩梗补充血肉层。",
    sourceDismantlingProjectId: input.sourceDismantlingProjectId || undefined,
    sourceDismantlingProjectTitle: input.sourceDismantlingProjectTitle || undefined,
    prevConnector: lineage.prevConnector,
    nextConnector: lineage.nextConnector,
    createdAt,
    updatedAt: createdAt,
  }
}

function readDismantlingSection(markdown: string, headerRe: RegExp): string | null {
  const start = markdown.search(headerRe)
  if (start === -1) return null
  const match = markdown.match(headerRe)!
  const after = markdown.slice(start + match[0].length)
  const nextHeader = after.search(/^##\s/m)
  const body = nextHeader === -1 ? after : after.slice(0, nextHeader)
  return body.trim() || null
}

function parseLabeledLine(block: string, labelRe: RegExp): string | undefined {
  const m = block.match(labelRe)
  if (!m) return undefined
  const idx = m.index! + m[0].length
  const rest = block.slice(idx)
  const lineEnd = rest.search(/\n/)
  const text = (lineEnd === -1 ? rest : rest.slice(0, lineEnd)).trim()
  if (!text || text === "无" || text === "—" || text === "-") return undefined
  return text
}

function extractFirstInteger(text: string): number | undefined {
  const m = text.match(/\d+/)
  return m ? Number.parseInt(m[0], 10) : undefined
}

export function buildDismantlingReferenceDirective(input: {
  title: string
  structureMemory: string[]
}): string {
  if (input.structureMemory.length === 0) return ""
  return [
    "## 参考拆文结构",
    `当前用户选择参考拆文作品：${input.title}`,
    "",
    "使用规则：",
    "- 只学习节奏、冲突推进、爽点安排和章节钩子。",
    "- 不得复用原作人物、不得复用原作设定、不得复用原作剧情、不得复用原作具体表达。",
    "- 拆文结构不是当前小说记忆，不得把它当成当前小说已经发生的事实。",
    "",
    "可参考的结构记忆：",
    ...input.structureMemory.map((item) => `- ${item}`),
  ].join("\n")
}
