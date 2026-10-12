/**
 * 人物 Skill 自进化的**项目级状态**：开关、打开日节律、轮次历史。
 *
 * 落盘在 `<项目>/.qmai/persona-skill-evolution.json`。
 *
 * ── 与「文风自进化」的关系 ──────────────────────────────────────
 * 交互与节律**刻意保持一致**（用户要求：和文风 skill 那个是一样的设置方式）：
 * 同一套打开日节律（`style-evolution-schedule.ts` 的泛型纯函数直接复用）、
 * 同样的「默认关闭」「同一天最多尝试一次」「失败不消费计数」语义。
 * 区别只在引擎：文风比的是**可量化指标的距离**，人物 Skill 比的是
 * 「新档案能不能让人把这个人物写对」——没有可靠的量化尺，走达尔文式的
 * 配对评审（见 `persona-skill-evolution-engine.ts` 文件头）。
 *
 * ── 与其他 store 相同的两条约定（同 style-evolution-store）────────
 *   ① **不调 `bumpDataVersion()`**：打开日计数变化与文风库重读无关，
 *      界面刷新走本模块自己的 `subscribePersonaSkillEvolution`。
 *   ② **读取时严格夹取**：`nextThreshold: 0` 会让「每次打开都分析」静默发生。
 */
import { createDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import {
  emptyScheduleState,
  THRESHOLD_RANGE,
  type StyleEvolutionScheduleState,
  type StyleEvolutionThreshold,
} from "./style-evolution-schedule"

/** 轮次历史上限。与文风一致：它只是排错与说明的材料，不必无限增长。 */
export const MAX_ROUND_HISTORY = 100

export type PersonaSkillEvolutionOutcome = "kept" | "reverted" | "incomplete"

/** 只有这些结局才许推进节律计数（`completeRound`）；incomplete 必须留在阈值之上。 */
export const COMPLETED_ROUND_OUTCOMES: PersonaSkillEvolutionOutcome[] = ["kept", "reverted"]

export interface PersonaSkillEvolutionRound {
  /** 这一轮所属的打开日（本地 `YYYY-MM-DD`）。 */
  at: string
  /** 第几轮，从 1 开始。 */
  round: number
  outcome: PersonaSkillEvolutionOutcome
  /** 人类可读的原因（写日志；kept/reverted 时说明裁断结果）。 */
  reason?: string
  /** 本轮实际参与进化的人物名。 */
  characterNames?: string[]
  /** 每个人物的配对票数，形如 `"林清越 3-0 candidate"`。 */
  votes?: string[]
}

export interface PersonaSkillEvolutionState extends StyleEvolutionScheduleState {
  version: 1
  enabled: boolean
  rounds: PersonaSkillEvolutionRound[]
  /**
   * 上一轮**跑完**时人物索引里最近的一次学习时间戳（`max(updatedAt)`）。
   * 新素材闸门：自那之后索引没再变过（没有新的章节学习），档案就没有
   * 新证据可依，进化只会重复上一轮的结论 —— 跳过。
   */
  lastIndexedUpdatedAt: string
}

const ROUND_OUTCOMES: PersonaSkillEvolutionOutcome[] = ["kept", "reverted", "incomplete"]

function storePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/persona-skill-evolution.json`
}

/** 初始状态：**默认关闭**，等用户显式打开；首轮阈值 3（同文风，不能是 0）。 */
export function emptyPersonaEvolutionState(): PersonaSkillEvolutionState {
  return {
    version: 1,
    enabled: false,
    rounds: [],
    lastIndexedUpdatedAt: "",
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

/** 阈值只许是 {3,4,5}；其余一律回落到 3 —— 0 会让每次打开都分析。 */
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

function sanitizeRound(value: unknown): PersonaSkillEvolutionRound | null {
  if (!isRecord(value)) return null
  const at = safeText(value.at).trim()
  const round = finiteNumber(value.round)
  const outcome = value.outcome
  if (!at) return null
  if (round === undefined || round < 1) return null
  if (typeof outcome !== "string" || !ROUND_OUTCOMES.includes(outcome as PersonaSkillEvolutionOutcome)) {
    return null
  }

  const result: PersonaSkillEvolutionRound = {
    at,
    round,
    outcome: outcome as PersonaSkillEvolutionOutcome,
  }
  const reason = safeText(value.reason)
  if (reason) result.reason = reason
  if (Array.isArray(value.characterNames)) {
    const names = value.characterNames
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    if (names.length > 0) result.characterNames = names
  }
  if (Array.isArray(value.votes)) {
    const votes = value.votes.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    if (votes.length > 0) result.votes = votes
  }
  return result
}

function sanitizeRounds(value: unknown): PersonaSkillEvolutionRound[] {
  if (!Array.isArray(value)) return []
  return value
    .map(sanitizeRound)
    .filter((item): item is PersonaSkillEvolutionRound => item !== null)
    .slice(-MAX_ROUND_HISTORY)
}

/** 读盘。任何异常都退化成「默认关闭」的空状态，绝不抛给调用方。 */
export async function loadPersonaSkillEvolutionState(
  projectPath: string,
): Promise<PersonaSkillEvolutionState> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(storePath(projectPath)))
  } catch {
    return emptyPersonaEvolutionState()
  }

  if (!isRecord(parsed)) return emptyPersonaEvolutionState()

  const lastAnalyzedOn = safeText(parsed.lastAnalyzedOn)
  const lastIndexedUpdatedAt = safeText(parsed.lastIndexedUpdatedAt)

  return {
    version: 1,
    // 只有显式 true 才算开启：字符串 "false"、数字 1 都不行。
    enabled: parsed.enabled === true,
    lastOpenDate: safeText(parsed.lastOpenDate),
    lastAttemptedOn: safeText(parsed.lastAttemptedOn),
    openDayCount: safeCount(parsed.openDayCount),
    nextThreshold: safeThreshold(parsed.nextThreshold),
    lastAnalyzedOn: lastAnalyzedOn || null,
    lastIndexedUpdatedAt: lastIndexedUpdatedAt,
    rounds: sanitizeRounds(parsed.rounds),
  }
}

type PersonaEvolutionListener = (projectPath: string, state: PersonaSkillEvolutionState) => void

const listeners = new Set<PersonaEvolutionListener>()

/**
 * 订阅状态变化。面板靠它刷新（本 store 刻意不走 `bumpDataVersion()`，见文件头①）。
 * 订阅是进程级的，回调里要自己比对 projectPath。
 */
export function subscribePersonaSkillEvolution(listener: PersonaEvolutionListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify(projectPath: string, state: PersonaSkillEvolutionState): void {
  for (const listener of [...listeners]) {
    try {
      listener(projectPath, state)
    } catch {
      // 一个订阅者出错不该影响其他订阅者，也不该让写入失败。
    }
  }
}

/** 写盘。写入前夹取一次，保证落盘的永远是合法值。 */
export async function savePersonaSkillEvolutionState(
  projectPath: string,
  state: PersonaSkillEvolutionState,
): Promise<void> {
  const normalized: PersonaSkillEvolutionState = {
    ...state,
    version: 1,
    enabled: state.enabled === true,
    openDayCount: safeCount(state.openDayCount),
    nextThreshold: safeThreshold(state.nextThreshold),
    lastAnalyzedOn: state.lastAnalyzedOn || null,
    lastIndexedUpdatedAt: safeText(state.lastIndexedUpdatedAt),
    rounds: (Array.isArray(state.rounds) ? state.rounds : [])
      .map(sanitizeRound)
      .filter((item): item is PersonaSkillEvolutionRound => item !== null)
      .slice(-MAX_ROUND_HISTORY),
  }

  await createDirectory(`${normalizePath(projectPath)}/.qmai`)
  await writeFileAtomic(storePath(projectPath), JSON.stringify(normalized, null, 2))
  notify(projectPath, normalized)
}
