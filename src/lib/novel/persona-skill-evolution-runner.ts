/**
 * 人物 Skill 自进化的**接线层**：把引擎接到真实文件系统与真实模型上，并负责并发守卫。
 *
 * 架构与 `style-evolution-runner.ts` 完全同构（引擎只收注入 IO、接线层包办真实世界）：
 * - 模型走 `callAnalysisModelText`（**不要**改成直接 `streamChat`，那条链路对
 *   「只思考不吐字」的半截输出有整轮重发保护，`analysis-model-call.guard.spec.ts` 盯着）；
 * - 同一项目的并发守卫：调用点（`App.tsx` 的 `hydrateDeferredProjectState`）是
 *   `void` 调用且一天有多个入口，引擎的 `lastAttemptedOn` 要落盘后才生效，
 *   并发窗口必须在这里关；
 * - 排错日志追加到 `.qmai/persona-skill-evolution.log`（失败对用户静默，日志是唯一痕迹）。
 */
import { createDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { callAnalysisModelText } from "./book-analysis/analysis-model-call"
import { resolveTaskLlmConfig } from "./book-analysis/analysis-model-resolver"
import {
  loadPersonaPriorEvidence,
  type PersonaPriorEvidence,
} from "./persona-skill-learning"
import {
  loadPersonaSkillEvolutionState,
  savePersonaSkillEvolutionState,
  type PersonaSkillEvolutionState,
} from "./persona-skill-evolution-store"
import {
  parsePersonaEvolutionCandidate,
  parsePersonaPairJudgement,
  runPersonaSkillEvolutionRound,
  buildPersonaEvolutionCandidatePrompt,
  buildPersonaPairJudgePrompt,
  type PersonaSkillEvolutionIO,
  type PersonaSkillEvolutionRoundResult,
} from "./persona-skill-evolution-engine"
import {
  loadPersonaSkillIndex,
  loadPersonaSkillIndexStrict,
  personaSkillLockKey,
  readPersonaSkillDocument,
  savePersonaSkillIndex,
  snapshotPersonaSkillRevision,
  withPersonaSkillLock,
  writePersonaSkillDocument,
} from "./persona-skill-store"

/** 排错日志只留最近这么多行。 */
const MAX_LOG_LINES = 200

const inFlight = new Set<string>()

function logPath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/persona-skill-evolution.log`
}

async function appendEvolutionLog(projectPath: string, result: PersonaSkillEvolutionRoundResult): Promise<void> {
  const entry = {
    at: new Date().toISOString(),
    status: result.status,
    outcome: result.outcome,
    reason: result.reason,
    votes: result.votes,
  }
  try {
    let lines: string[] = []
    try {
      lines = (await readFile(logPath(projectPath))).split("\n").filter((line) => line.trim().length > 0)
    } catch {
      // 首次写日志：文件还不存在。
    }
    lines.push(JSON.stringify(entry))
    while (lines.length > MAX_LOG_LINES) lines.shift()
    await createDirectory(`${normalizePath(projectPath)}/.qmai`)
    await writeFileAtomic(logPath(projectPath), `${lines.join("\n")}\n`)
  } catch (error) {
    console.warn("[Persona Evolution] 写日志失败:", error instanceof Error ? error.message : error)
  }
}

/**
 * 默认模型调用：走拆书库共享的 `callAnalysisModelText`（理由见文件头，同文风 runner）。
 * 人物档案的编修与评审都要按 JSON 回答，system 提示相应收紧。
 */
async function defaultCallModel(prompt: string, role: "editor" | "judge"): Promise<string> {
  const llmConfig = resolveTaskLlmConfig({})
  const system =
    role === "editor"
      ? "你是严谨的中文小说人物档案编修者。只输出要求的 JSON，不寒暄、不解释、不加代码块围栏。"
      : "你是严格的人物档案评审。只输出要求的 JSON，不寒暄、不解释、不加代码块围栏。"
  return callAnalysisModelText(llmConfig, [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ], { cancelMessage: "用户取消人物 Skill 自进化" })
}

function buildIO(projectPath: string): PersonaSkillEvolutionIO {
  return {
    loadState: () => loadPersonaSkillEvolutionState(projectPath),
    saveState: (state) => savePersonaSkillEvolutionState(projectPath, state),
    loadIndex: () => loadPersonaSkillIndex(projectPath),
    loadDocument: (id) => readPersonaSkillDocument(projectPath, id),
    loadEvidence: async (
      characterName: string,
      aliases: readonly string[],
      chapters: readonly number[],
    ): Promise<PersonaPriorEvidence[]> => {
      const latest = Math.max(...chapters, 1)
      // currentChapter 取「最近出场章 + 1」：loadPersonaPriorEvidence 只取该章之前的
      // 章节，而进化要的恰恰是最近这次出场的原文（档案最新鲜的证据）。
      return loadPersonaPriorEvidence(projectPath, chapters, [characterName, ...aliases], latest + 1)
    },
    generateCandidate: async ({ characterName, aliases, document, evidence }) => {
      const raw = await defaultCallModel(
        buildPersonaEvolutionCandidatePrompt({ characterName, aliases, document, evidence }),
        "editor",
      )
      return parsePersonaEvolutionCandidate(raw)
    },
    judgePair: async ({ characterName, document, candidate, evidence }) => {
      const raw = await defaultCallModel(
        buildPersonaPairJudgePrompt({ characterName, document, candidate, evidence }),
        "judge",
      )
      return parsePersonaPairJudgement(raw)
    },
    /**
     * 候选落盘：快照旧版 → 写新档案 → 索引 skillRevision+1，全程同一把锁。
     * 回传写入索引里的 `updatedAt`，引擎用它记 processedAt（见 IO 接口注释）。
     */
    applyCandidate: async (id, candidateDocument) => {
      return withPersonaSkillLock(personaSkillLockKey(projectPath), async () => {
        const index = (await loadPersonaSkillIndexStrict(projectPath)) ?? { version: 1, skills: [] }
        const meta = index.skills.find((item) => item.id === id)
        if (!meta) throw new Error(`档案已不存在：${id}`)

        const current = await readPersonaSkillDocument(projectPath, id)
        if (current.trim() && current !== candidateDocument) {
          await snapshotPersonaSkillRevision(projectPath, id, meta.skillRevision, current)
        }
        await writePersonaSkillDocument(projectPath, id, candidateDocument)

        const updatedAt = new Date().toISOString()
        const skills = index.skills.map((item) =>
          item.id === id
            ? { ...item, skillRevision: item.skillRevision + 1, updatedAt }
            : item,
        )
        await savePersonaSkillIndex(projectPath, { version: 1, skills })
        return { updatedAt }
      })
    },
  }
}

export interface PersonaSkillEvolutionRunDeps {
  callModel?: (prompt: string, role: "editor" | "judge") => Promise<string>
  now?: string
  rng?: () => number
}

/**
 * 跑一个项目的人物 Skill 进化 tick。
 *
 * **永不抛错**：异常收敛成 `incomplete` 结果或 `null`（已有并发轮次时）。
 * 调用方（`App.tsx`）是 `void` 调用的，抛出去会变成未处理的 Promise 拒绝。
 */
export async function runPersonaSkillEvolutionTick(
  projectPath: string,
  deps: PersonaSkillEvolutionRunDeps = {},
): Promise<PersonaSkillEvolutionRoundResult | null> {
  const key = normalizePath(projectPath)
  if (!key) return null

  if (inFlight.has(key)) return null
  inFlight.add(key)

  try {
    const io = buildIO(key)
    const wrappedIO: PersonaSkillEvolutionIO = deps.callModel
      ? {
          ...io,
          generateCandidate: async (input) => {
            const raw = await deps.callModel!(buildPersonaEvolutionCandidatePrompt(input), "editor")
            return parsePersonaEvolutionCandidate(raw)
          },
          judgePair: async (input) => {
            const raw = await deps.callModel!(buildPersonaPairJudgePrompt(input), "judge")
            return parsePersonaPairJudgement(raw)
          },
        }
      : io

    const result = await runPersonaSkillEvolutionRound(wrappedIO, { now: deps.now, rng: deps.rng })
    await appendEvolutionLog(key, result)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const state: PersonaSkillEvolutionState | null = await loadPersonaSkillEvolutionState(key).catch(() => null)
    if (!state) return null
    const result: PersonaSkillEvolutionRoundResult = {
      status: "incomplete",
      reason: `人物 Skill 进化启动失败：${message}`,
      state,
    }
    await appendEvolutionLog(key, result)
    return result
  } finally {
    inFlight.delete(key)
  }
}

/** 供测试清理进程内守卫。 */
export function __resetPersonaSkillEvolutionInFlightForTesting(): void {
  inFlight.clear()
}
