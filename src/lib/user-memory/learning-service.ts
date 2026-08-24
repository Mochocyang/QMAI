import type { LlmConfig } from "@/stores/wiki-store"
import { streamChat } from "@/lib/llm-client"
import { buildUserMemoryExtractionPrompt, computeUserMessageHash, parseUserMemoryExtraction } from "./extractor"
import { governUserMemoryConfig } from "./governance"
import { consumeUserMemoryLearningBudget } from "./learning-budget"
import { evaluateUserMemoryCandidate } from "./prefilter"
import {
  loadGlobalUserMemoryConfig,
  normalizeGlobalUserMemoryConfig,
  saveGlobalUserMemoryConfig,
  upsertAutomaticUserMemoryRule,
} from "./store"
import type { ParsedUserMemoryRule } from "./extractor"
import type { UserMemoryScope, UserMemorySurface } from "./types"

type StorageLike = Pick<Storage, "getItem" | "setItem">

interface UserMemoryLearningInput {
  message: string
  llmConfig: LlmConfig
  surface?: UserMemorySurface
  projectKey?: string
  sessionKey?: string
  scope?: UserMemoryScope
}

interface UserMemoryLearningResult {
  status: "disabled" | "ignored" | "unchanged" | "learned" | "budget_exhausted" | "failed"
  added: number
}

interface LearningDependencies {
  storage?: StorageLike
  runExtractor?: (prompt: string, llmConfig: LlmConfig) => Promise<string>
}

const inFlight = new Map<string, Promise<UserMemoryLearningResult>>()
const queuedBatches = new Map<string, { items: UserMemoryLearningInput[]; timer: ReturnType<typeof setTimeout> | null }>()

function runtimeStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage } catch { return null }
}

async function runDefaultExtractor(prompt: string, llmConfig: LlmConfig): Promise<string> {
  let content = ""
  let error: Error | null = null
  await streamChat(llmConfig, [
    { role: "system", content: "你只负责提取全局用户习惯，并严格返回指定 JSON。" },
    { role: "user", content: prompt },
  ], {
    onToken: (token) => { content += token },
    onDone: () => {},
    onError: (nextError) => { error = nextError },
  }, undefined, {
    temperature: 0.1,
    max_tokens: 1200,
    skipUserMemory: true,
  })
  if (error) throw error
  return content
}

function inferredScope(memory: ParsedUserMemoryRule, inputs: UserMemoryLearningInput[]): {
  scope: UserMemoryScope
  projectKey: string | null
  sessionKey: string | null
} {
  const explicit = inputs.find((input) => input.scope)
  const projectKey = inputs.every((input) => input.projectKey === inputs[0]?.projectKey) ? inputs[0]?.projectKey ?? null : null
  const sessionKey = inputs.every((input) => input.sessionKey === inputs[0]?.sessionKey) ? inputs[0]?.sessionKey ?? null : null
  const explicitlySessionScoped = inputs.some((input) => /(?:本次会话|当前会话|这次对话|本轮对话)/.test(input.message))
  if (explicitlySessionScoped && sessionKey) return { scope: "session", projectKey, sessionKey }
  if (explicit?.scope === "session" && sessionKey) return { scope: "session", projectKey, sessionKey }
  if (explicit?.scope === "project" && projectKey) return { scope: "project", projectKey, sessionKey: null }
  if (projectKey && ["writing_preference", "outline_preference", "workflow_preference"].includes(memory.category)) {
    return { scope: "project", projectKey, sessionKey: null }
  }
  return { scope: "global", projectKey: null, sessionKey: null }
}

export async function learnUserMemoryFromMessages(
  inputs: UserMemoryLearningInput[],
  dependencies: LearningDependencies = {},
): Promise<UserMemoryLearningResult> {
  const storage = dependencies.storage ?? runtimeStorage()
  const normalizedInputs = inputs
    .map((input) => ({ ...input, message: input.message.replace(/\s+/g, " ").trim() }))
    .filter((input) => input.message.length >= 6)
  const config = loadGlobalUserMemoryConfig(storage)
  if (!config.enabled || !config.autoLearn || config.onlyManual) return { status: "disabled", added: 0 }
  if (normalizedInputs.length === 0) return { status: "ignored", added: 0 }

  const withHashes = await Promise.all(normalizedInputs.map(async (input) => ({ input, hash: await computeUserMessageHash(input.message) })))
  const pendingInputs = withHashes.filter((item) => !config.analyzedSourceHashes.includes(item.hash))
  if (pendingInputs.length === 0) return { status: "unchanged", added: 0 }
  const operationKey = pendingInputs.map((item) => item.hash).sort().join(":")
  const pending = inFlight.get(operationKey)
  if (pending) return pending

  const operation = (async (): Promise<UserMemoryLearningResult> => {
    try {
      const inputChars = pendingInputs.reduce((sum, item) => sum + item.input.message.length, 0)
      if (!consumeUserMemoryLearningBudget(storage, config.dailyLearningLimit, inputChars)) {
        return { status: "budget_exhausted", added: 0 }
      }
      const runExtractor = dependencies.runExtractor ?? runDefaultExtractor
      const batchMessage = pendingInputs
        .map((item, index) => `消息 ${index + 1}：${item.input.message}`)
        .join("\n")
      const raw = await runExtractor(buildUserMemoryExtractionPrompt(batchMessage), pendingInputs[0]!.input.llmConfig)
      const extracted = parseUserMemoryExtraction(raw)
      let next = loadGlobalUserMemoryConfig(storage)
      const before = next.rules.length
      for (const memory of extracted) {
        const scope = inferredScope(memory, pendingInputs.map((item) => item.input))
        next = upsertAutomaticUserMemoryRule(next, { ...memory, ...scope, sourceHash: pendingInputs[0]!.hash })
      }
      next = governUserMemoryConfig(normalizeGlobalUserMemoryConfig({
        ...next,
        analyzedSourceHashes: [...new Set([...next.analyzedSourceHashes, ...pendingInputs.map((item) => item.hash)])],
        updatedAt: Date.now(),
      }))
      saveGlobalUserMemoryConfig(next, storage)
      return { status: "learned", added: Math.max(0, next.rules.length - before) }
    } catch {
      return { status: "failed", added: 0 }
    } finally {
      inFlight.delete(operationKey)
    }
  })()
  inFlight.set(operationKey, operation)
  return operation
}

export async function learnUserMemoryFromMessage(
  input: UserMemoryLearningInput,
  dependencies: LearningDependencies = {},
): Promise<UserMemoryLearningResult> {
  return learnUserMemoryFromMessages([input], dependencies)
}

export function enqueueUserMemoryLearning(input: UserMemoryLearningInput): void {
  if (!evaluateUserMemoryCandidate(input.message).shouldAnalyze) return
  const storage = runtimeStorage()
  const config = loadGlobalUserMemoryConfig(storage)
  if (!config.enabled || !config.autoLearn || config.onlyManual) return
  const key = [input.llmConfig.provider, input.llmConfig.model, input.projectKey ?? "", input.sessionKey ?? "", input.surface ?? ""].join(":")
  const current = queuedBatches.get(key) ?? { items: [], timer: null }
  current.items.push(input)
  const flush = () => {
    const batch = queuedBatches.get(key)
    if (!batch) return
    queuedBatches.delete(key)
    void learnUserMemoryFromMessages(batch.items)
  }
  if (current.timer) clearTimeout(current.timer)
  current.timer = current.items.length >= config.batchSize ? null : setTimeout(flush, 1_500)
  queuedBatches.set(key, current)
  if (current.items.length >= config.batchSize) flush()
}

export function resetUserMemoryLearningQueueForTests(): void {
  inFlight.clear()
  for (const batch of queuedBatches.values()) if (batch.timer) clearTimeout(batch.timer)
  queuedBatches.clear()
}
