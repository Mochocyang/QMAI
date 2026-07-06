/**
 * 故事框架持久化
 *
 * 将 StoryFramework 以 Markdown 文档（YAML frontmatter + 正文）的形式
 * 持久化到项目的 .qmai/simulations 目录下，并提供加载 / 删除 / 推演结果
 * 存取能力。
 */

import {
  createDirectory,
  deleteFile,
  listDirectory,
  readFile,
  writeFileAtomic,
} from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { parseFrontmatter } from "@/lib/frontmatter"
import type { FileNode } from "@/types/wiki"
import type {
  SimulationMode,
  SimulationReport,
  SimulationResultStatus,
  SimulationResumePoint,
  StoryDraft,
  StoryFramework,
  StoryNode,
  TimelineEvent,
  RumorEvent,
  SimulationDebugTrace,
} from "./types"
import type { SerializedSimulationSnapshot } from "./simulation-serializer"

const SIM_ROOT = ".qmai/simulations"
const FRAMEWORKS_DIR = `${SIM_ROOT}/frameworks`
const RESULTS_DIR = `${SIM_ROOT}/results`

const VALID_MODES: SimulationMode[] = [
  "event-driven",
  "free-emergence",
  "decision-tree",
  "hybrid",
]

// ── 路径辅助 ──

function frameworksDir(projectPath: string): string {
  return `${normalizePath(projectPath)}/${FRAMEWORKS_DIR}`
}

function frameworkFilePath(projectPath: string, frameworkId: string): string {
  return `${frameworksDir(projectPath)}/${frameworkId}.md`
}

function frameworkResultsDir(projectPath: string, frameworkId: string): string {
  return `${normalizePath(projectPath)}/${RESULTS_DIR}/${frameworkId}`
}

// ── 目录初始化 ──

/**
 * 创建 .qmai/simulations/{frameworks,results,bindings} 目录。
 * createDirectory 内部使用 create_dir_all，已存在时不会报错。
 */
export async function ensureSimulationDirs(projectPath: string): Promise<void> {
  const root = `${normalizePath(projectPath)}/${SIM_ROOT}`
  await createDirectory(`${root}/frameworks`)
  await createDirectory(`${root}/results`)
  await createDirectory(`${root}/bindings`)
}

// ── Markdown 互转 ──

function yamlString(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  return `"${escaped}"`
}

/** 将 StoryFramework 序列化为 Markdown 文档。 */
export function frameworkToMarkdown(framework: StoryFramework): string {
  const lines: string[] = []
  lines.push("---")
  lines.push(`id: ${yamlString(framework.id)}`)
  lines.push(`type: "story-framework"`)
  lines.push(`title: ${yamlString(framework.title)}`)
  if (framework.shortTitle) {
    lines.push(`shortTitle: ${yamlString(framework.shortTitle)}`)
  }
  lines.push(`createdAt: ${yamlString(framework.createdAt)}`)
  lines.push(`sourceChapters: ${framework.sourceChapters}`)
  lines.push(`targetWords: ${framework.targetWords}`)
  lines.push(`simulationMode: ${yamlString(framework.simulationMode)}`)
  lines.push(`userIdea: ${yamlString(framework.userIdea ?? "")}`)
  lines.push("---")
  lines.push("")
  lines.push("## 前提")
  lines.push("")
  lines.push(framework.premise || "（无前提）")
  lines.push("")
  lines.push("## 故事节点")
  lines.push("")

  const sorted = [...framework.nodes].sort((a, b) => a.index - b.index)
  for (const node of sorted) {
    lines.push(`### 节点 ${node.index} 【${node.phase}】 ${node.title}`)
    lines.push(`- 核心冲突：${node.coreConflict}`)
    lines.push(`- 涉及角色：${node.involvedCharacters.join("、")}`)
    lines.push(`- 目标：${node.goal}`)
    lines.push(`- 承接前因：${node.causeFromPrev}`)
    lines.push(`- 预期结果：${node.expectedOutcome}`)
    lines.push("")
  }
  return lines.join("\n")
}

function fmStr(v: string | string[] | undefined): string {
  if (v === undefined) return ""
  if (Array.isArray(v)) return v.join(", ")
  return v
}

/** 提取 body 中某个二级标题（## heading）下的内容，直到下一个二级标题。 */
function extractSection(body: string, heading: string): string {
  const lines = body.split("\n")
  let capturing = false
  const captured: string[] = []
  for (const line of lines) {
    const isH2 = /^##\s+/.test(line)
    if (isH2) {
      if (capturing) break // 到达下一个 ## 章节
      const headingText = line.replace(/^##\s+/, "").trim()
      if (headingText === heading || headingText.startsWith(heading)) {
        capturing = true
      }
      continue
    }
    if (capturing) captured.push(line)
  }
  return captured.join("\n").trim()
}

function parseNodeHeader(
  line: string,
  fallbackIndex: number,
): { index: number; phase: StoryNode["phase"]; title: string } {
  const indexMatch = line.match(/节点\s*(\d+)/)
  const index = indexMatch ? parseInt(indexMatch[1], 10) : fallbackIndex
  const phaseMatch = line.match(/【(起|承|转|合)】/)
  const phase = phaseMatch ? (phaseMatch[1] as StoryNode["phase"]) : "起"

  let title = ""
  const bracketEnd = line.lastIndexOf("】")
  if (bracketEnd >= 0) {
    title = line.slice(bracketEnd + 1).trim()
  }
  if (!title) {
    title = line.replace(/节点\s*\d+\s*【[起承转合]】/, "").trim()
  }
  if (!title) title = "未命名节点"
  return { index, phase, title }
}

function parseNodeBody(block: string): {
  coreConflict: string
  involvedCharacters: string[]
  goal: string
  causeFromPrev: string
  expectedOutcome: string
} {
  const result = {
    coreConflict: "",
    involvedCharacters: [] as string[],
    goal: "",
    causeFromPrev: "",
    expectedOutcome: "",
  }
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim()
    if (!line.startsWith("-")) continue
    const m = line.match(/^-\s*(.+?)[：:]\s*(.*)$/)
    if (!m) continue
    const key = m[1].trim()
    const value = m[2].trim()
    switch (key) {
      case "核心冲突":
        result.coreConflict = value
        break
      case "涉及角色":
        result.involvedCharacters = value
          ? value
              .split(/[,，、]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : []
        break
      case "目标":
        result.goal = value
        break
      case "承接前因":
        result.causeFromPrev = value
        break
      case "预期结果":
        result.expectedOutcome = value
        break
      default:
        break
    }
  }
  return result
}

function parseNodes(nodesSection: string): StoryNode[] {
  const nodes: StoryNode[] = []
  const blocks = nodesSection.split(/^###\s+/m)
  let order = 0
  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed || !trimmed.startsWith("节点")) continue
    order += 1
    const lines = trimmed.split("\n")
    const { index, phase, title } = parseNodeHeader(lines[0], order)
    const body = lines.slice(1).join("\n")
    const fields = parseNodeBody(body)
    nodes.push({
      index,
      phase,
      title,
      coreConflict: fields.coreConflict,
      involvedCharacters: fields.involvedCharacters,
      goal: fields.goal,
      causeFromPrev: fields.causeFromPrev,
      expectedOutcome: fields.expectedOutcome,
    })
  }
  return nodes
}

/**
 * 将 Markdown 文档解析回 StoryFramework。
 * 解析尽量健壮：缺失字段使用默认值，frontmatter 异常时尽量恢复。
 */
export function markdownToFramework(
  content: string,
  fallbackId?: string,
): StoryFramework | null {
  try {
    const { frontmatter, body } = parseFrontmatter(content)
    const fm = (frontmatter ?? {}) as Record<string, string | string[]>

    const id = fmStr(fm.id) || fallbackId || `fw-${Date.now()}`
    const title = fmStr(fm.title) || "未命名框架"
    const shortTitleValue = fmStr(fm.shortTitle)
    const shortTitle = shortTitleValue || undefined
    const createdAt = fmStr(fm.createdAt) || new Date().toISOString()
    const sourceChapters = parseInt(fmStr(fm.sourceChapters), 10) || 0
    const targetWords = parseInt(fmStr(fm.targetWords), 10) || 0
    const modeValue = fmStr(fm.simulationMode)
    const simulationMode: SimulationMode = VALID_MODES.includes(
      modeValue as SimulationMode,
    )
      ? (modeValue as SimulationMode)
      : "hybrid"
    const userIdeaValue = fmStr(fm.userIdea)
    const userIdea = userIdeaValue || undefined

    const premise = extractSection(body, "前提")
    const nodesSection = extractSection(body, "故事节点")
    const nodes = parseNodes(nodesSection)

    return {
      id,
      title,
      shortTitle,
      premise,
      targetWords,
      simulationMode,
      userIdea,
      sourceChapters,
      nodes,
      createdAt,
    }
  } catch {
    return null
  }
}

// ── 框架 CRUD ──

/** 将框架保存为 MD 文档。 */
export async function saveFramework(
  projectPath: string,
  framework: StoryFramework,
): Promise<void> {
  await ensureSimulationDirs(projectPath)
  const md = frameworkToMarkdown(framework)
  await writeFileAtomic(frameworkFilePath(projectPath, framework.id), md)
}

/** 加载所有框架，按 createdAt 降序排列。 */
export async function loadFrameworks(
  projectPath: string,
): Promise<StoryFramework[]> {
  let entries: FileNode[]
  try {
    entries = await listDirectory(frameworksDir(projectPath))
  } catch {
    return []
  }

  const frameworks: StoryFramework[] = []
  for (const entry of entries) {
    if (entry.is_dir) continue
    if (!entry.name.toLowerCase().endsWith(".md")) continue
    try {
      const content = await readFile(entry.path)
      const id = entry.name.replace(/\.md$/i, "")
      const fw = markdownToFramework(content, id)
      if (fw) frameworks.push(fw)
    } catch {
      // 跳过无法读取的文件
    }
  }

  frameworks.sort((a, b) => {
    if (a.createdAt < b.createdAt) return 1
    if (a.createdAt > b.createdAt) return -1
    return 0
  })
  return frameworks
}

/** 删除框架及其关联的推演结果。 */
export async function deleteFramework(
  projectPath: string,
  frameworkId: string,
): Promise<void> {
  try {
    await deleteFile(frameworkFilePath(projectPath, frameworkId))
  } catch {
    // 框架文件可能不存在
  }

  // 删除该框架下的所有推演结果文件
  const resultsPath = frameworkResultsDir(projectPath, frameworkId)
  try {
    const entries = await listDirectory(resultsPath)
    for (const entry of entries) {
      if (!entry.is_dir) {
        try {
          await deleteFile(entry.path)
        } catch {
          // 跳过无法删除的文件
        }
      }
    }
  } catch {
    // 结果目录可能不存在
  }
}

// ── 推演结果存取 ──

function simulationResultToMarkdown(
  report: SimulationReport,
  draft?: StoryDraft,
): string {
  const lines: string[] = []
  lines.push("# 推演结果")
  lines.push("")
  lines.push(`- 框架ID：${report.frameworkId}`)
  lines.push(`- 仿真模式：${report.mode}`)
  lines.push(`- 生成时间：${report.createdAt}`)
  lines.push("")
  lines.push("## 推荐")
  lines.push(report.recommendation || "（无推荐）")
  lines.push("")
  lines.push("## 分支")
  for (const branch of report.branches) {
    lines.push(`### ${branch.title}`)
    lines.push(`- 概率：${branch.probability}`)
    lines.push(`- 摘要：${branch.summary}`)
    if (branch.recommendation) lines.push("- 推荐：是")
  }
  lines.push("")
  lines.push("## 角色分析")
  for (const ca of report.characterAnalyses) {
    lines.push(`### ${ca.name}`)
    lines.push(`- 一致性评分：${ca.consistencyScore}`)
  }
  if (draft) {
    lines.push("")
    lines.push("## 草稿")
    lines.push(`- 总字数：${draft.totalWords}`)
    for (const ch of draft.chapters) {
      lines.push(`### ${ch.title}（对应节点 ${ch.correspondingNode}）`)
    }
  }
  return lines.join("\n")
}

/**
 * 保存推演结果，同时写入 JSON（结构化）与 MD（人类可读）。
 * @returns resultId
 */
export async function saveSimulationResult(
  projectPath: string,
  frameworkId: string,
  report: SimulationReport,
  draft?: StoryDraft,
  timelineEvents?: TimelineEvent[],
  agentSnapshot?: SerializedSimulationSnapshot,
  rumors?: RumorEvent[],
  debugTraces?: SimulationDebugTrace[],
  options?: {
    status?: SimulationResultStatus
    partialReason?: string
    resume?: SimulationResumePoint | null
  },
): Promise<string> {
  await ensureSimulationDirs(projectPath)
  const resultId = `result-${Date.now()}`
  const dir = frameworkResultsDir(projectPath, frameworkId)
  await createDirectory(dir)

  const payload = {
    report,
    draft: draft ?? null,
    timelineEvents: timelineEvents ?? [],
    agentSnapshot: agentSnapshot ?? null,
    rumors: rumors ?? [],
    debugTraces: debugTraces ?? [],
    status: options?.status ?? "complete",
    partialReason: options?.partialReason ?? null,
    resume: options?.resume ?? null,
  }
  await writeFileAtomic(`${dir}/${resultId}.json`, JSON.stringify(payload, null, 2))
  await writeFileAtomic(
    `${dir}/${resultId}.md`,
    simulationResultToMarkdown(report, draft),
  )
  return resultId
}

/** 删除指定的推演结果。 */
export async function deleteSimulationResult(
  projectPath: string,
  frameworkId: string,
  resultId: string,
): Promise<void> {
  const dir = frameworkResultsDir(projectPath, frameworkId)
  try {
    await deleteFile(`${dir}/${resultId}.json`)
  } catch {
    // 文件可能不存在
  }
  try {
    await deleteFile(`${dir}/${resultId}.md`)
  } catch {
    // 文件可能不存在
  }
}

/** 加载框架的所有推演结果，按 report.createdAt 降序排列。 */
export async function loadSimulationResults(
  projectPath: string,
  frameworkId: string,
): Promise<{
  id: string
  report: SimulationReport
  draft?: StoryDraft | null
  timelineEvents?: TimelineEvent[]
  agentSnapshot?: SerializedSimulationSnapshot | null
  rumors?: RumorEvent[]
  debugTraces?: SimulationDebugTrace[]
  status: SimulationResultStatus
  partialReason?: string | null
  resume?: SimulationResumePoint | null
}[]> {
  const dir = frameworkResultsDir(projectPath, frameworkId)
  let entries: FileNode[]
  try {
    entries = await listDirectory(dir)
  } catch {
    return []
  }

  const results: {
    id: string
    report: SimulationReport
    draft?: StoryDraft | null
    timelineEvents?: TimelineEvent[]
    agentSnapshot?: SerializedSimulationSnapshot | null
    rumors?: RumorEvent[]
    debugTraces?: SimulationDebugTrace[]
    status: SimulationResultStatus
    partialReason?: string | null
    resume?: SimulationResumePoint | null
  }[] = []
  for (const entry of entries) {
    if (entry.is_dir) continue
    if (!entry.name.toLowerCase().endsWith(".json")) continue
    try {
      const content = await readFile(entry.path)
      const parsed = JSON.parse(content) as {
        report: SimulationReport
        draft?: StoryDraft | null
        timelineEvents?: TimelineEvent[]
        agentSnapshot?: SerializedSimulationSnapshot | null
        rumors?: RumorEvent[]
        debugTraces?: SimulationDebugTrace[]
        status?: SimulationResultStatus
        partialReason?: string | null
        resume?: SimulationResumePoint | null
      }
      if (parsed && parsed.report) {
        results.push({
          id: entry.name.replace(/\.json$/i, ""),
          report: parsed.report,
          draft: parsed.draft ?? null,
          timelineEvents: parsed.timelineEvents ?? [],
          agentSnapshot: parsed.agentSnapshot ?? null,
          rumors: parsed.rumors ?? [],
          debugTraces: parsed.debugTraces ?? [],
          status: parsed.status ?? "complete",
          partialReason: parsed.partialReason ?? null,
          resume: parsed.resume ?? null,
        })
      }
    } catch {
      // 跳过无法解析的文件
    }
  }

  results.sort((a, b) => {
    if (a.report.createdAt < b.report.createdAt) return 1
    if (a.report.createdAt > b.report.createdAt) return -1
    return 0
  })
  return results
}
