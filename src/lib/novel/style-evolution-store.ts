/**
 * 文风自进化的**项目级状态**：开关、打开日节律、探针缓存、轮次历史。
 *
 * 落盘在 `<项目>/.qmai/style-evolution.json`，与 `writing-style.json` 同级。
 * 按项目分文件（而不是全局一份）：每本书的文风各自进化，A 书攒的打开日
 * 不该让 B 书也跟着分析。
 *
 * ── 两条与其他 store 不同的约定 ──────────────────────────────────
 *   ① **不调 `bumpDataVersion()`。** 那个函数的语义是「项目数据变了，
 *      文风库/写作区重读」。打开日计数变化与它无关：挂上去之后，用户每打开
 *      一次项目都会触发一次全应用重读文风库与写作区。界面刷新由本模块
 *      自己的 `subscribeStyleEvolution` 承担。
 *   ② **读取时做严格夹取。** 盘上的文件可能来自早期版本、手工编辑，或一次
 *      半途失败的写入。最危险的是 `nextThreshold: 0`：它会让
 *      `count(1) >= 0` 恒真 ⇒ **每次打开都分析**，用户的「每 3/4/5 次」
 *      被彻底绕过，而且静默发生。所以非法值一律夹回合法区间。
 */
import { createDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import {
  emptyScheduleState,
  THRESHOLD_RANGE,
  type StyleEvolutionScheduleState,
  type StyleEvolutionThreshold,
} from "./style-evolution-schedule"
import { METRIC_KEYS, type StyleMetricVector } from "./style-evolution-metrics"

/** 轮次历史的上限。它的唯一用途是面板上的历史列表，不必无限增长。 */
export const MAX_ROUND_HISTORY = 100

export type StyleEvolutionRoundOutcome = "bootstrap" | "kept" | "reverted" | "incomplete"

/** 「一轮完整跑完」的结论集合：只有这些才许推进节律计数。 */
export const COMPLETED_ROUND_OUTCOMES: StyleEvolutionRoundOutcome[] = ["bootstrap", "kept", "reverted"]

export interface StyleEvolutionRound {
  /** 这一轮所属的打开日（本地 `YYYY-MM-DD`）。 */
  at: string
  /** 第几轮，从 1 开始。 */
  round: number
  outcome: StyleEvolutionRoundOutcome
  /** 人类可读的原因，直接显示在面板上。 */
  reason?: string
  distanceCandidate?: number
  distanceBase?: number
  /** 本轮写出的候选预设 id（incomplete 时没有）。 */
  stylePresetId?: string
  /** 候选预设的 `sourceBook`；回滚与清理都要按它找。 */
  sourceBook?: string
}

/**
 * 探针缓存。
 *
 * ⚠️ **只缓存指标，绝不缓存距离。** 距离的参照物是目标 T（holdout 的指标），
 * 而 T 每轮都可能变；缓存距离等于拿一把**过期的尺子**去量新候选。
 */
export interface StyleEvolutionProbe {
  stylePresetId: string
  sourceBook: string
  at: string
  metrics: StyleMetricVector
}

export interface StyleEvolutionState extends StyleEvolutionScheduleState {
  version: 1
  enabled: boolean
  probe: StyleEvolutionProbe | null
  rounds: StyleEvolutionRound[]
}

const ROUND_OUTCOMES: StyleEvolutionRoundOutcome[] = ["bootstrap", "kept", "reverted", "incomplete"]

function storePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/style-evolution.json`
}

/**
 * 初始状态：**默认关闭**，等用户显式打开。
 *
 * `nextThreshold` 必须是 3（不是 0）——写成 0 会让第 1 次打开就分析。
 */
export function emptyState(): StyleEvolutionState {
  return {
    version: 1,
    enabled: false,
    probe: null,
    rounds: [],
    ...emptyScheduleState(),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function safeText(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** 阈值只许是 {3,4,5}；其余（含 0、负数、超大值、非数字）一律回落到 3。 */
function safeThreshold(value: unknown): StyleEvolutionThreshold {
  return (THRESHOLD_RANGE as readonly number[]).includes(value as number)
    ? (value as StyleEvolutionThreshold)
    : 3
}

function safeCount(value: unknown): number {
  const n = finiteNumber(value)
  if (n === undefined || n < 0) return 0
  return Math.floor(n)
}

/**
 * 把盘上（或传入）的指标对象补成一个完整向量：缺项与非法项都当 0。
 *
 * 补全是刻意的：`distance` 会对每个键取值，缺项若留成 `undefined`，
 * `Math.abs(undefined - 0)` 得 `NaN`，整条距离就废了。
 */
function sanitizeMetrics(value: unknown): StyleMetricVector | null {
  if (!isRecord(value)) return null
  const vector = {} as StyleMetricVector
  let nonZero = false
  for (const key of METRIC_KEYS) {
    const n = finiteNumber(value[key]) ?? 0
    vector[key] = n
    if (n !== 0) nonZero = true
  }
  /*
   * 全 0 的向量直接丢弃。它意味着探针正文是空的（或整份指标都读不出来），
   * 拿它当基线只会让下一轮「看起来大幅改善」。宁可承认没有基线。
   */
  return nonZero ? vector : null
}

function sanitizeProbe(value: unknown): StyleEvolutionProbe | null {
  if (!isRecord(value)) return null
  const stylePresetId = safeText(value.stylePresetId).trim()
  // 没有 stylePresetId 就没法在回滚时找到那个预设，整条缓存无用。
  if (!stylePresetId) return null
  const metrics = sanitizeMetrics(value.metrics)
  if (!metrics) return null

  return {
    stylePresetId,
    sourceBook: safeText(value.sourceBook),
    at: safeText(value.at),
    metrics,
    // 注意：这里**刻意不读取 value.distance** —— 距离每轮重算。
  }
}

function sanitizeRound(value: unknown): StyleEvolutionRound | null {
  if (!isRecord(value)) return null
  const at = safeText(value.at).trim()
  const round = finiteNumber(value.round)
  const outcome = value.outcome
  if (!at) return null
  if (round === undefined || round < 1) return null
  if (typeof outcome !== "string" || !ROUND_OUTCOMES.includes(outcome as StyleEvolutionRoundOutcome)) {
    return null
  }

  const result: StyleEvolutionRound = {
    at,
    round,
    outcome: outcome as StyleEvolutionRoundOutcome,
  }
  const reason = safeText(value.reason)
  if (reason) result.reason = reason
  const distanceCandidate = finiteNumber(value.distanceCandidate)
  if (distanceCandidate !== undefined) result.distanceCandidate = distanceCandidate
  const distanceBase = finiteNumber(value.distanceBase)
  if (distanceBase !== undefined) result.distanceBase = distanceBase
  const stylePresetId = safeText(value.stylePresetId)
  if (stylePresetId) result.stylePresetId = stylePresetId
  const sourceBook = safeText(value.sourceBook)
  if (sourceBook) result.sourceBook = sourceBook

  return result
}

function sanitizeRounds(value: unknown): StyleEvolutionRound[] {
  if (!Array.isArray(value)) return []
  const rounds = value
    .map(sanitizeRound)
    .filter((item): item is StyleEvolutionRound => item !== null)
  return rounds.slice(-MAX_ROUND_HISTORY)
}

/** 读盘。任何异常都退化成「默认关闭」的空状态，绝不抛给调用方。 */
export async function loadStyleEvolutionState(projectPath: string): Promise<StyleEvolutionState> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(storePath(projectPath)))
  } catch {
    return emptyState()
  }

  if (!isRecord(parsed)) return emptyState()

  const lastAnalyzedOn = safeText(parsed.lastAnalyzedOn)

  return {
    version: 1,
    // 只有显式 true 才算开启：字符串 "false"、数字 1 都不行。
    enabled: parsed.enabled === true,
    lastOpenDate: safeText(parsed.lastOpenDate),
    lastAttemptedOn: safeText(parsed.lastAttemptedOn),
    openDayCount: safeCount(parsed.openDayCount),
    nextThreshold: safeThreshold(parsed.nextThreshold),
    lastAnalyzedOn: lastAnalyzedOn || null,
    probe: sanitizeProbe(parsed.probe),
    rounds: sanitizeRounds(parsed.rounds),
  }
}

type StyleEvolutionListener = (projectPath: string, state: StyleEvolutionState) => void

const listeners = new Set<StyleEvolutionListener>()

/**
 * 订阅状态变化。返回取消订阅的函数。
 *
 * 存在的理由：状态变化**不**经过 `bumpDataVersion()`（见文件头①），
 * 所以面板必须自己订阅，否则「还需 N 次打开」会一直停在打开项目时的旧值。
 */
export function subscribeStyleEvolution(listener: StyleEvolutionListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify(projectPath: string, state: StyleEvolutionState): void {
  for (const listener of [...listeners]) {
    try {
      listener(projectPath, state)
    } catch {
      // 一个订阅者出错不该影响其他订阅者，也不该让写入失败。
    }
  }
}

/** 写盘。写入前夹取一次，保证落盘的永远是合法值。 */
export async function saveStyleEvolutionState(
  projectPath: string,
  state: StyleEvolutionState,
): Promise<void> {
  const normalized: StyleEvolutionState = {
    ...state,
    version: 1,
    enabled: state.enabled === true,
    openDayCount: safeCount(state.openDayCount),
    nextThreshold: safeThreshold(state.nextThreshold),
    lastAnalyzedOn: state.lastAnalyzedOn || null,
    probe: sanitizeProbe(state.probe),
    rounds: (Array.isArray(state.rounds) ? state.rounds : [])
      .map(sanitizeRound)
      .filter((item): item is StyleEvolutionRound => item !== null)
      .slice(-MAX_ROUND_HISTORY),
  }

  await createDirectory(`${normalizePath(projectPath)}/.qmai`)
  await writeFileAtomic(storePath(projectPath), JSON.stringify(normalized, null, 2))
  notify(projectPath, normalized)
}
