/**
 * 报告取证层（P1-7）。
 *
 * 报告 Agent 升级为「先用工具取证、再写结论」之后，需要一个统一的**证据池**：
 * 分析师的工具只能读到它，引文校验也只认它。两者共用同一份记录推导，于是
 * 「工具查得到」与「引文算数」天然一致 —— 模型无法引用一个它根本没查到的原话。
 *
 * 之所以从 `SimulationEvent[]` 再推一层 `ReportRecord`：原始事件有
 * `timelineEvent` 与 `agent`+`action` 两种来源（新老引擎各写一种），
 * 分散在各处判断会让每个工具都重复一遍。这里收口成一种形状。
 */

import type { SimulationEvent } from "./types"

export interface ReportRecord {
  nodeIndex: number
  round: number
  actorName: string
  /** 角色原话/原文，逐字保留，不做任何改写 —— 它就是引文的唯一依据 */
  content: string
  timestamp: string
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/**
 * 抽取可被引用的记录。
 *
 * 只保留**有角色原话**的事件：`node-start` / `node-complete` / `info` 这些引擎
 * 提示既不是角色发言，也不该成为证据。空白内容同样丢掉，否则空串会让
 * `includes("")` 之类的判断意外通过。
 */
export function toReportRecords(events: SimulationEvent[]): ReportRecord[] {
  const records: ReportRecord[] = []

  for (const event of events) {
    const timeline = event.timelineEvent
    if (timeline) {
      const content = nonEmpty(timeline.content)
      if (content) {
        records.push({
          nodeIndex: timeline.nodeIndex,
          round: timeline.round,
          actorName: timeline.actorName || "未知角色",
          content,
          timestamp: timeline.timestamp,
        })
      }
      continue
    }

    // 老路径：agent + action
    const content = nonEmpty(event.action?.content)
    if (!content) continue
    records.push({
      nodeIndex: event.node?.index ?? -1,
      round: event.round ?? 0,
      actorName: event.agent?.name || "未知角色",
      content,
      timestamp: event.timestamp,
    })
  }

  return records
}

/** 首尾成对出现的引号/书名号，引用时常见，比对前应剥掉。 */
const WRAPPING_PAIRS: [string, string][] = [
  ["「", "」"],
  ["『", "』"],
  ["“", "”"],
  ['"', '"'],
  ["'", "'"],
  ["《", "》"],
]

/**
 * 归一化引文：折叠所有空白为单个空格、去掉首尾空白、剥掉首尾成对的引号。
 * 只做「排版级」归一化，绝不改写用词 —— 逐字引用的要求不能被归一化洗掉。
 */
export function normalizeQuote(text: string): string {
  let result = text.replace(/\s+/g, " ").trim()
  let changed = true
  while (changed) {
    changed = false
    for (const [open, close] of WRAPPING_PAIRS) {
      if (result.length > open.length + close.length &&
          result.startsWith(open) && result.endsWith(close)) {
        result = result.slice(open.length, result.length - close.length).trim()
        changed = true
      }
    }
  }
  return result
}

/** 引文常见的「角色名：原话」前缀。 */
const SPEAKER_PREFIX = /^([^：:\n]{1,20})[：:]\s*(.+)$/s

/**
 * 比对用的形式：在 `normalizeQuote` 之上再抹掉所有空白。
 *
 * 为什么比对与展示要分开：模型引用时常在换行处改写成空格（`我要\n走了。` →
 * `我要 走了。`），而原文并无空格。这是纯排版差异，不该判为编造。但直接把
 * `normalizeQuote` 改成抹空白又会让展示出的引文粘成一坨，所以只在这里抹。
 */
function matchForm(text: string): string {
  return normalizeQuote(text).replace(/\s+/g, "")
}

export interface EvidenceAudit {
  /** 参与校验的引文条数（空白引文不计入） */
  total: number
  verified: number
  /** 未能逐字对上的引文原文，供界面/日志展示 */
  unverified: string[]
}

/**
 * 校验引文是否**逐字**来自事件记录。
 *
 * 判定规则（宽进严出）：
 * - 抹掉空白后与某条记录内容互为子串即通过（允许截取片段）
 * - 允许带「角色名：」前缀，剥掉前缀再比 —— 这是引用的常规写法，
 *   前缀里的角色名不算改写原话
 *
 * 不允许：把两条不同事件的话拼起来。拼接后是全新的字符串，任何单条记录都
 * 不包含它，于是会被判为未通过 —— 这正是要挡住的「看起来像证据的编造」。
 */
export function verifyEvidence(
  quotes: string[],
  events: SimulationEvent[],
): EvidenceAudit {
  const contents = toReportRecords(events).map((r) => matchForm(r.content))
  const unverified: string[] = []
  let total = 0

  for (const raw of quotes) {
    const normalized = normalizeQuote(raw ?? "")
    if (!normalized) continue
    total++

    const candidates = [matchForm(normalized)]
    const match = SPEAKER_PREFIX.exec(normalized)
    if (match) candidates.push(matchForm(match[2].trim()))

    const ok = candidates.some(
      (candidate) =>
        candidate.length > 0 &&
        contents.some((content) => content.includes(candidate)),
    )
    if (!ok) unverified.push(raw)
  }

  return { total, verified: total - unverified.length, unverified }
}
