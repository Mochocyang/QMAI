import type { ChatMessage, ContentBlock, RequestOverrides } from "@/lib/llm-providers"
import { compileUserMemorySkill } from "./compiler"
import {
  buildUserMemoryDecision,
  setLatestUserMemoryDecision,
  type UserMemoryDecision,
} from "./decision-trace"
import { governUserMemoryConfig } from "./governance"
import { evaluateUserMemoryRule, inferUserMemorySurface, selectUserMemoryRules } from "./selector"
import { loadGlobalUserMemoryConfig, saveGlobalUserMemoryConfig } from "./store"

type StorageLike = Pick<Storage, "getItem" | "setItem">

interface ApplyUserMemoryResult {
  messages: ChatMessage[]
  decision: UserMemoryDecision | null
}

function contentText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content
  return content.map((block) => block.type === "text" ? block.text : "").join("")
}

function appendToSystem(content: ChatMessage["content"], prompt: string): ChatMessage["content"] {
  if (typeof content === "string") return `${content.trim()}\n\n${prompt}`.trim()
  const next: ContentBlock[] = [...content, { type: "text", text: `\n\n${prompt}` }]
  return next
}

export function applyGlobalUserMemoryToMessages(
  messages: ChatMessage[],
  overrides: Pick<RequestOverrides, "skipUserMemory" | "userMemorySurface" | "userMemoryProjectKey" | "userMemorySessionKey"> = {},
  storage?: StorageLike,
): ApplyUserMemoryResult {
  if (overrides.skipUserMemory) {
    return { messages, decision: null }
  }
  const loadedConfig = loadGlobalUserMemoryConfig(storage)
  const config = governUserMemoryConfig(loadedConfig)
  const task = contentText([...messages].reverse().find((message) => message.role === "user")?.content ?? "")
  const surface = overrides.userMemorySurface ?? inferUserMemorySurface(task)
  const selectionInput = {
    task,
    surface,
    projectKey: overrides.userMemoryProjectKey,
    sessionKey: overrides.userMemorySessionKey,
    onlyManual: config.onlyManual,
  }
  const selected = config.enabled && config.autoRead
    ? selectUserMemoryRules(config.rules, selectionInput)
    : []
  const prompt = compileUserMemorySkill(selected)
  const selectedIds = new Set(selected.map((rule) => rule.id))
  const filtered = config.rules.flatMap((rule) => {
    const reason = config.enabled && config.autoRead
      ? evaluateUserMemoryRule(rule, selectionInput)
      : "disabled" as const
    if (reason) return [{ ruleId: rule.id, reason }]
    return selectedIds.has(rule.id) ? [] : [{ ruleId: rule.id, reason: "shadowed" as const }]
  })
  const decision = buildUserMemoryDecision({
    rules: config.rules,
    selected,
    filtered,
    prompt,
    surface,
    projectKey: overrides.userMemoryProjectKey,
    sessionKey: overrides.userMemorySessionKey,
  })
  // Keep latest for settings feedback UI only — generation details must use the returned decision.
  setLatestUserMemoryDecision(decision)
  if (!prompt) return { messages, decision }
  const now = Date.now()
  saveGlobalUserMemoryConfig({
    ...config,
    rules: config.rules.map((rule) => selectedIds.has(rule.id)
      ? { ...rule, usageCount: (rule.usageCount ?? 0) + 1, lastUsedAt: now }
      : rule),
    updatedAt: Math.max(config.updatedAt, now),
  }, storage)
  const systemIndex = messages.findIndex((message) => message.role === "system")
  if (systemIndex < 0) {
    return { messages: [{ role: "system", content: prompt }, ...messages], decision }
  }
  return {
    messages: messages.map((message, index) => index === systemIndex
      ? { ...message, content: appendToSystem(message.content, prompt) }
      : message),
    decision,
  }
}
