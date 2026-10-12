/**
 * 「进行中的会话语境」持久化（P0-6）。
 *
 * 为什么不用 `zustand/middleware` 的 `persist`：本仓库没有这个中间件，持久化一律
 * 走 `.qmai/` 下的文件读写。所以这里手写一层薄封装。
 *
 * ## 存什么
 * 只存**配置输入**：模式、故事想法、目标字数、来源章节数、每节点轮次、导演开关。
 * 这解决的是最常见也最烦的那件事 —— 重新打开功能时刚才调好的那套设置还在。
 *
 * ## 刻意不存什么，以及为什么
 * 清单原本希望连 `timelineEvents` / `branches` / `debugTraces` 一起挂 `phase` 恢复。
 * 实现时收窄了范围，理由如下：
 *
 * 1. **不重复存结果数据**。这三样已经按条落在 `.qmai/simulations/results/` 下，
 *    再在会话文件里抄一份就制造了第二个来源 —— P0-2 刚修过一组「两份状态不一致、
 *    于是采访拿错快照」的缺陷，不该再引入同类结构。
 * 2. **瞬时 phase 恢复不了**。`extracting` / `framework-generating` / `simulating` /
 *    `report-generating` / `draft-generating` 这些阶段背后是一个已经消失的
 *    异步任务，恢复到这些阶段只会得到一块空面板。
 * 3. **`report-viewing` / `draft-viewing` 依赖 currentReport**，而它不在会话文件里。
 *    只恢复 phase 而不恢复报告，报告页 `activeReport` 为 null 会直接渲染成空白。
 *
 * 于是恢复后统一落在一个安全阶段，由用户从磁盘上真实存在的结果里重新选。
 * 结果数据本来就有持久的浏览入口（历史推演结果），并不依赖这个文件。
 */

import { createDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { SimulationMode } from "./types"
import { VALID_MODES } from "./framework-store"

/** 会话文件格式版本。结构变更时递增，旧文件会被安全忽略。 */
export const SIMULATION_SESSION_VERSION = 1

/** 参与持久化的配置字段。 */
export interface SimulationSessionConfig {
  mode: SimulationMode
  userIdea: string
  targetWords: number
  sourceChapters: number
  simulationRounds: number
  directorEnabled: boolean
}

export interface SimulationSessionFile extends SimulationSessionConfig {
  version: number
  savedAt: string
}

export function simulationSessionPath(projectPath: string): string {
  return normalizePath(`${projectPath}/.qmai/simulations/session.json`)
}

export function buildSimulationSessionFile(
  config: SimulationSessionConfig,
  savedAt: string = new Date().toISOString(),
): SimulationSessionFile {
  return {
    version: SIMULATION_SESSION_VERSION,
    savedAt,
    mode: config.mode,
    userIdea: config.userIdea,
    targetWords: config.targetWords,
    sourceChapters: config.sourceChapters,
    simulationRounds: config.simulationRounds,
    directorEnabled: config.directorEnabled,
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

/**
 * 严格校验后解析。任一处不合法就整体放弃并返回 `null` —— 宁可回到默认配置，
 * 也不要把半个脏对象灌进 store。
 */
export function parseSimulationSessionFile(raw: string): SimulationSessionFile | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== "object") return null
  const record = parsed as Record<string, unknown>

  if (record.version !== SIMULATION_SESSION_VERSION) return null
  if (typeof record.savedAt !== "string") return null
  if (typeof record.mode !== "string" || !VALID_MODES.includes(record.mode as SimulationMode)) {
    return null
  }
  if (typeof record.userIdea !== "string") return null
  if (!isFiniteNumber(record.targetWords)) return null
  if (!isFiniteNumber(record.sourceChapters)) return null
  if (!isFiniteNumber(record.simulationRounds)) return null
  if (typeof record.directorEnabled !== "boolean") return null

  return {
    version: SIMULATION_SESSION_VERSION,
    savedAt: record.savedAt,
    mode: record.mode as SimulationMode,
    userIdea: record.userIdea,
    targetWords: record.targetWords,
    sourceChapters: record.sourceChapters,
    simulationRounds: record.simulationRounds,
    directorEnabled: record.directorEnabled,
  }
}

export async function saveSimulationSession(
  projectPath: string,
  config: SimulationSessionConfig,
): Promise<void> {
  const path = simulationSessionPath(projectPath)
  await createDirectory(normalizePath(`${projectPath}/.qmai/simulations`))
  await writeFileAtomic(
    path,
    JSON.stringify(buildSimulationSessionFile(config), null, 2),
  )
}

/**
 * 读取会话配置。文件不存在（首次使用）或已损坏都返回 `null` —— 这两种情况
 * 都不是错误，不该阻断界面加载。
 */
export async function loadSimulationSession(
  projectPath: string,
): Promise<SimulationSessionFile | null> {
  try {
    return parseSimulationSessionFile(await readFile(simulationSessionPath(projectPath)))
  } catch {
    return null
  }
}
