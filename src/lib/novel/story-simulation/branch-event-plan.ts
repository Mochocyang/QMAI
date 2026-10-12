/**
 * P1-10：把推演报告的一条走向分支导出成「本章事件计划」。
 *
 * 在此之前，推演结果的唯一出口是「生成草稿」→ `wiki/chapters/` 正文，
 * 也就是直接从推演跳到成稿，中间没有一步可审阅、可修改的计划。而
 * `StoryBranch.summary` / `keyEvents` 与章纲 §5「核心事件链」本就同构
 * （≥6 条、每条含 what/cause/action/result/use），差的只是一个出口。
 *
 * 关键判断：**为什么必须是 LLM 生成而不是确定性映射。**
 * `keyEvents: string[]` 只给了「发生什么」。把 what 映射过去，剩下 cause /
 * action / result / use 四个字段就只能靠字符串拼接硬凑 —— 产出的是四个
 * 空壳字段冒充因果链。那正是本分支在消灭的那类「看起来有、实际是编的」数据。
 * 所以这里走 LLM，并用 `validateEventPlan` 严格校验，不合格就报错，
 * 绝不静默交出一份残缺计划。
 */

import type { ChatMessage } from "@/lib/llm-client"
import { streamChat } from "@/lib/llm-client"
import { createDirectory, fileExists, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { LlmConfig } from "@/stores/wiki-store"
import { MIN_EVENT_COUNT } from "@/lib/novel/chapter-outline-template"
import type {
  SimulationReport,
  StoryBranch,
  StoryFramework,
  StoryNode,
} from "./types"

/** 一条事件计划。字段与章纲 §5「核心事件链」一一对应。 */
export interface PlannedEvent {
  /** 发生什么 */
  what: string
  /** 起因 */
  cause: string
  /** 行动 */
  action: string
  /** 结果 */
  result: string
  /** 这条事件对本章的用处 */
  use: string
}

const FIELD_KEYS: Array<keyof PlannedEvent> = ["what", "cause", "action", "result", "use"]

/** 事件计划落盘的相对目录（在 `wiki/outlines/` 下）。 */
export const EVENT_PLAN_DIR_RELATIVE = "wiki/outlines/事件计划"

// ── 解析 ──

function pickEvents(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return []
  const events = (value as { events?: unknown }).events
  return Array.isArray(events) ? events : []
}

function toPlannedEvent(value: unknown): PlannedEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const planned = {} as PlannedEvent
  for (const key of FIELD_KEYS) {
    const raw = record[key]
    planned[key] = typeof raw === "string" ? raw.trim() : ""
  }
  return planned
}

/**
 * 从模型回复里取事件链。
 *
 * 只负责「拿到形状对的东西」：字段缺失补空串、非对象项丢弃、解析不出来就返回
 * 空数组。**不在这里抛错** —— 校验与报错统一交给 `validateEventPlan`，
 * 这样「模型没给」「模型给少了」「模型给漏了字段」三类问题只有一个出口。
 */
export function parseEventPlanReply(reply: string): PlannedEvent[] {
  const text = reply?.trim() ?? ""
  if (!text) return []

  const candidates: string[] = [text]
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  if (fenced) candidates.push(fenced[1].trim())
  const braced = /\{[\s\S]*\}/.exec(text)
  if (braced) candidates.push(braced[0])

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      const raw = pickEvents(parsed)
      if (raw.length === 0) continue
      const planned: PlannedEvent[] = []
      for (const item of raw) {
        const event = toPlannedEvent(item)
        if (event) planned.push(event)
      }
      if (planned.length > 0) return planned
    } catch {
      // 换下一个候选
    }
  }

  return []
}

// ── 校验 ──

/**
 * 校验事件链是否够得上「可执行的计划」。返回问题列表，空数组表示合格。
 *
 * 条数下限复用章纲 §5 的 `MIN_EVENT_COUNT`：两处各写一个 6 会漂移。
 */
export function validateEventPlan(events: PlannedEvent[]): string[] {
  const problems: string[] = []

  if (events.length < MIN_EVENT_COUNT) {
    problems.push(
      `事件链不足 ${MIN_EVENT_COUNT} 条（当前 ${events.length} 条），不足以支撑一章的推进。`,
    )
  }

  events.forEach((event, index) => {
    if (!event.cause.trim()) {
      problems.push(`第 ${index + 1} 个事件缺少起因，不构成因果链。`)
    }
    if (!event.result.trim()) {
      problems.push(`第 ${index + 1} 个事件缺少结果，不构成因果链。`)
    }
    if (!event.use.trim()) {
      problems.push(`第 ${index + 1} 个事件缺少作用（这条事件对本章的用处）。`)
    }
  })

  return problems
}

// ── 渲染 ──

export function buildBranchEventPlanMarkdown(input: {
  framework: StoryFramework
  node: StoryNode
  branch: StoryBranch
  events: PlannedEvent[]
  now?: Date
}): string {
  const { framework, node, branch, events } = input
  const now = input.now ?? new Date()
  const dateStr = now.toISOString().split("T")[0]
  const chapterNumber = node.index + 1

  const lines: string[] = []
  lines.push("---")
  // 刻意不是 chapter-outline：那是 17 节的完整章纲，本文只是其中的事件计划。
  // 用同一个 type 会让章纲校验把这份文件当成残缺章纲逐项报错。
  lines.push("type: chapter-event-plan")
  lines.push("source: story-simulation")
  lines.push(`framework_id: "${framework.id}"`)
  lines.push(`framework_title: "${framework.title.replace(/"/g, '\\"')}"`)
  lines.push(`branch_title: "${branch.title.replace(/"/g, '\\"')}"`)
  lines.push(`chapter_number: ${chapterNumber}`)
  lines.push(`created: ${dateStr}`)
  lines.push("---")
  lines.push("")
  lines.push(`# 第 ${chapterNumber} 章 事件计划（分支：${branch.title}）`)
  lines.push("")
  lines.push("> 由剧情推演报告导出。核心事件链与章纲 §5 同构，可直接并入本章章纲或作为撰写正文的骨架。")
  lines.push("")
  lines.push("## 本章定位")
  lines.push("")
  lines.push(`- 对应框架节点：${node.title}（${node.phase}）`)
  lines.push(`- 核心冲突：${node.coreConflict}`)
  lines.push(`- 本章目标：${node.goal}`)
  lines.push(`- 预期结果：${node.expectedOutcome}`)
  if (node.causeFromPrev) {
    lines.push(`- 承接上文：${node.causeFromPrev}`)
  }
  lines.push(`- 涉及角色：${node.involvedCharacters.join("、") || "（未指定）"}`)
  lines.push("")
  lines.push("## 分支走向")
  lines.push("")
  lines.push(`- 分支：${branch.title}（可能性：${branch.probability}）`)
  lines.push(`- 概要：${branch.summary}`)
  lines.push(`- 利：${branch.pros}`)
  lines.push(`- 弊：${branch.cons}`)
  if (branch.keyEvents.length > 0) {
    lines.push("")
    lines.push("推演中实际发生的关键事件：")
    lines.push("")
    for (const keyEvent of branch.keyEvents) {
      lines.push(`- ${keyEvent}`)
    }
  }
  lines.push("")
  lines.push("## 核心事件链")
  lines.push("")

  events.forEach((event, index) => {
    lines.push(`### 事件 ${index + 1}`)
    lines.push("")
    lines.push(`- **发生什么**：${event.what}`)
    lines.push(`- **起因**：${event.cause}`)
    lines.push(`- **行动**：${event.action}`)
    lines.push(`- **结果**：${event.result}`)
    lines.push(`- **作用**：${event.use}`)
    lines.push("")
  })

  return lines.join("\n")
}

// ── 生成 ──

function buildSystemPrompt(): string {
  return (
    "你是一位小说结构编辑。请把一段已推演出的剧情走向，拆解成一章可执行的「核心事件链」。" +
    `必须给出至少 ${MIN_EVENT_COUNT} 条事件，每条都要有明确的起因、行动和结果，前后互为因果。` +
    "只输出 JSON，不要输出任何解释性文字。"
  )
}

function buildUserPrompt(input: {
  framework: StoryFramework
  node: StoryNode
  branch: StoryBranch
  report: SimulationReport
}): string {
  const { framework, node, branch, report } = input
  const lines: string[] = []

  lines.push("【故事框架】")
  lines.push(`标题：${framework.title}`)
  lines.push("")

  lines.push("【本章对应的框架节点】")
  lines.push(`阶段：${node.phase}`)
  lines.push(`节点标题：${node.title}`)
  lines.push(`核心冲突：${node.coreConflict}`)
  lines.push(`本章目标：${node.goal}`)
  lines.push(`预期结果：${node.expectedOutcome}`)
  if (node.causeFromPrev) lines.push(`承接上文的因果：${node.causeFromPrev}`)
  lines.push(`涉及角色：${node.involvedCharacters.join("、") || "（未指定）"}`)
  lines.push("")

  lines.push("【推演选定的走向分支】")
  lines.push(`分支标题：${branch.title}`)
  lines.push(`分支概要：${branch.summary}`)
  lines.push(
    `推演中实际发生的关键事件：${branch.keyEvents.length > 0 ? branch.keyEvents.join("；") : "（无）"}`,
  )
  lines.push("")

  lines.push("【相关角色的行为分析】")
  const involved = new Set(node.involvedCharacters)
  const related = report.characterAnalyses.filter(
    (analysis) => involved.has(analysis.name) || involved.has(analysis.characterId),
  )
  if (related.length === 0) {
    lines.push("（无相关角色的行为分析数据）")
  } else {
    for (const analysis of related) {
      lines.push(`角色：${analysis.name}`)
      const nodeBehaviors = analysis.behaviors.filter((b) => b.node === node.title)
      const behaviors = nodeBehaviors.length > 0 ? nodeBehaviors : analysis.behaviors
      for (const behavior of behaviors) {
        lines.push(`  - 行为：${behavior.action}（动机：${behavior.motivation}）`)
      }
      if (analysis.stateChanges.length > 0) {
        lines.push(`  状态变化：${analysis.stateChanges.join("；")}`)
      }
    }
  }
  lines.push("")

  lines.push("【输出要求】")
  lines.push(
    `1. 输出一个 JSON 对象，形如 {"events":[{"what":"","cause":"","action":"","result":"","use":""}]}。`,
  )
  lines.push(`2. events 至少 ${MIN_EVENT_COUNT} 条，不足 ${MIN_EVENT_COUNT} 条视为不合格。`)
  lines.push("3. 每条都要有起因（cause）与结果（result），前后事件互为因果，不允许并列罗列。")
  lines.push("4. use 填这条事件对本章推进起了什么作用。")
  lines.push("5. 严格依据上面的节点目标、分支关键事件与角色行为来写，不要引入上面没有的人物或设定。")

  return lines.join("\n")
}

async function collectStream(
  config: LlmConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  let result = ""
  let streamError: Error | null = null

  await streamChat(
    config,
    messages,
    {
      onToken: (token) => {
        result += token
      },
      onDone: () => {},
      onError: (err) => {
        streamError = err
      },
    },
    signal,
  )

  if (streamError) throw streamError
  return result
}

/**
 * 让模型把一条分支拆成本章核心事件链。
 *
 * 校验不通过时抛错，而不是把残缺结果交给调用方去落盘 —— 界面上宁可看到
 * 「生成的计划不达标，请重试」，也不要存下一份支离破碎的计划文件。
 */
export async function generateBranchEventPlan(options: {
  framework: StoryFramework
  node: StoryNode
  branch: StoryBranch
  report: SimulationReport
  llmConfig: LlmConfig
  signal?: AbortSignal
}): Promise<PlannedEvent[]> {
  const { framework, node, branch, report, llmConfig, signal } = options

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: buildUserPrompt({ framework, node, branch, report }) },
  ]

  const reply = await collectStream(llmConfig, messages, signal)
  const events = parseEventPlanReply(reply)
  const problems = validateEventPlan(events)

  if (problems.length > 0) {
    throw new Error(`事件计划不达标：\n${problems.join("\n")}`)
  }

  return events
}

// ── 落点节点 ──

export interface PlanTargetNode {
  node: StoryNode
  /**
   * 是否靠「与分支同名」命中的。
   *
   * 必须把这个区分暴露出去：没命中时会退回第一个节点，界面若不说明，用户会
   * 以为计划是按他想要的那一章生成的。把判断结果变成返回值，调用方就没法
   * 「忘了说」。
   */
  matchedByTitle: boolean
}

/**
 * 决定这份事件计划该落在哪个框架节点上 —— 也就是「本章」是哪一章。
 *
 * 分支名通常就是它推进到的那一步，所以优先按标题匹配；没匹配上就退回第一个
 * 节点（至少产出一份能用的计划），但把 `matchedByTitle` 标成 false 让调用方
 * 去提示。框架没有节点时返回 null，由调用方报错，而不是随便编一个章节号。
 */
export function resolvePlanTargetNode(
  framework: StoryFramework,
  branch: StoryBranch,
): PlanTargetNode | null {
  const matched = framework.nodes.find((n) => n.title === branch.title)
  if (matched) return { node: matched, matchedByTitle: true }

  const first = framework.nodes[0]
  if (!first) return null

  return { node: first, matchedByTitle: false }
}

// ── 落盘 ──

/** 清掉文件名里不允许的字符，并确保结果不能逃出目标目录。 */
function sanitizeFileNamePart(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\.\.+/g, "-")
    .replace(/\s+/g, "")
    .trim()
  return cleaned || "未命名"
}

/**
 * 把事件计划写入 `wiki/outlines/事件计划/`。
 *
 * 同名时不覆盖，而是加时间戳另存 —— 用户可能已经在这份计划上改过字，
 * 静默覆盖会直接吃掉他的修改。
 */
export async function exportBranchEventPlan(input: {
  projectPath: string
  chapterNumber: number
  branchTitle: string
  markdown: string
}): Promise<{ path: string }> {
  const pp = normalizePath(input.projectPath)
  const targetDir = `${pp}/${EVENT_PLAN_DIR_RELATIVE}`
  await createDirectory(targetDir)

  const chapterTag = `第${String(input.chapterNumber).padStart(3, "0")}章`
  const stem = `事件计划-${chapterTag}-${sanitizeFileNamePart(input.branchTitle)}`

  let path = `${targetDir}/${stem}.md`
  if (await fileExists(path)) {
    path = `${targetDir}/${stem}-${Date.now()}.md`
  }

  await writeFileAtomic(path, input.markdown)
  return { path }
}
