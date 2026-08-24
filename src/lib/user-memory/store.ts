import type {
  AutomaticUserMemoryRuleInput,
  GlobalUserMemoryConfig,
  ManualUserMemoryRuleInput,
  UserMemoryCategory,
  UserMemoryRule,
  UserMemoryScope,
  UserMemoryStatus,
  UserMemorySurface,
} from "./types"
import { resetUserMemoryLearningBudget } from "./learning-budget"

export const GLOBAL_USER_MEMORY_STORAGE_KEY = "qmai.global-user-memory.v1"
export const GLOBAL_USER_MEMORY_CHANGED_EVENT = "qmai:global-user-memory-changed"

type StorageLike = Pick<Storage, "getItem" | "setItem">

const CATEGORIES = new Set<UserMemoryCategory>([
  "output_style", "writing_preference", "outline_preference", "workflow_preference",
  "interaction_preference", "format_preference", "constraint", "manual",
])
const SURFACES = new Set<UserMemorySurface>([
  "all", "ai-chat", "ai-outline", "chapter-writing", "book-analysis", "review", "analysis",
])
const SCOPES = new Set<UserMemoryScope>(["global", "project", "session"])
const STATUSES = new Set<UserMemoryStatus>(["candidate", "active", "conflicted", "expired"])

const DEFAULT_MAX_RULES = 300
const DEFAULT_MAX_ANALYZED_HASHES = 5_000
const DEFAULT_MAX_STORAGE_BYTES = 2_000_000

function defaultConfig(): GlobalUserMemoryConfig {
  return {
    version: 2,
    enabled: true,
    autoLearn: true,
    autoRead: true,
    rules: [],
    analyzedSourceHashes: [],
    deletedFingerprints: [],
    updatedAt: 0,
    onlyManual: false,
    dailyLearningLimit: 20,
    batchSize: 3,
    candidatePromotionThreshold: 2,
    maxRules: DEFAULT_MAX_RULES,
    maxAnalyzedHashes: DEFAULT_MAX_ANALYZED_HASHES,
    maxStorageBytes: DEFAULT_MAX_STORAGE_BYTES,
  }
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
}

function normalizeSurfaces(value: unknown): UserMemorySurface[] {
  const values = uniqueStrings(value).filter((item): item is UserMemorySurface => SURFACES.has(item as UserMemorySurface))
  return values.length > 0 ? values : ["all"]
}

function normalizeCategory(value: unknown): UserMemoryCategory {
  return typeof value === "string" && CATEGORIES.has(value as UserMemoryCategory)
    ? value as UserMemoryCategory
    : "manual"
}

function finiteNonNegative(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function normalizeScope(value: unknown): UserMemoryScope {
  return typeof value === "string" && SCOPES.has(value as UserMemoryScope)
    ? value as UserMemoryScope
    : "global"
}

function normalizeStatus(value: unknown, source: UserMemoryRule["source"]): UserMemoryStatus {
  if (typeof value === "string" && STATUSES.has(value as UserMemoryStatus)) return value as UserMemoryStatus
  return source === "manual" ? "active" : "active"
}

export function userMemoryRuleFingerprint(rule: string, category: UserMemoryCategory): string {
  return `${category}:${rule.replace(/\s+/g, " ").trim().toLocaleLowerCase()}`
}

function normalizeRule(value: unknown): UserMemoryRule | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<UserMemoryRule>
  const rule = typeof raw.rule === "string" ? raw.rule.trim() : ""
  if (!rule) return null
  const category = normalizeCategory(raw.category)
  const source = raw.source === "automatic" ? "automatic" : "manual"
  const createdAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : 0
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `memory:${createdAt}:${rule.length}`,
    rule,
    category,
    source,
    surfaces: normalizeSurfaces(raw.surfaces),
    confidence: typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.max(0, Math.min(1, raw.confidence))
      : raw.source === "automatic" ? 0.5 : 1,
    evidenceSummary: typeof raw.evidenceSummary === "string" ? raw.evidenceSummary.trim() : "",
    sourceHash: typeof raw.sourceHash === "string" && raw.sourceHash.trim() ? raw.sourceHash.trim() : null,
    fingerprint: typeof raw.fingerprint === "string" && raw.fingerprint.trim()
      ? raw.fingerprint.trim()
      : userMemoryRuleFingerprint(rule, category),
    enabled: raw.enabled !== false,
    createdAt,
    updatedAt: typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt,
    scope: normalizeScope(raw.scope),
    projectKey: typeof raw.projectKey === "string" && raw.projectKey.trim() ? raw.projectKey.trim() : null,
    sessionKey: typeof raw.sessionKey === "string" && raw.sessionKey.trim() ? raw.sessionKey.trim() : null,
    status: normalizeStatus(raw.status, source),
    evidenceCount: positiveInteger(raw.evidenceCount, 1),
    lastEvidenceAt: finiteNonNegative(raw.lastEvidenceAt, createdAt),
    expiresAt: typeof raw.expiresAt === "number" && Number.isFinite(raw.expiresAt) ? raw.expiresAt : null,
    usageCount: finiteNonNegative(raw.usageCount, 0),
    lastUsedAt: typeof raw.lastUsedAt === "number" && Number.isFinite(raw.lastUsedAt) ? raw.lastUsedAt : null,
    positiveFeedback: finiteNonNegative(raw.positiveFeedback, 0),
    negativeFeedback: finiteNonNegative(raw.negativeFeedback, 0),
    conflictsWith: uniqueStrings(raw.conflictsWith),
  }
}

function pruneRules(rules: UserMemoryRule[], maxRules: number): UserMemoryRule[] {
  if (rules.length <= maxRules) return rules
  const manual = rules.filter((rule) => rule.source === "manual")
  const slots = Math.max(0, maxRules - manual.length)
  const statusRank: Record<UserMemoryStatus, number> = { active: 3, conflicted: 2, candidate: 1, expired: 0 }
  const automatic = rules
    .filter((rule) => rule.source === "automatic")
    .sort((left, right) => (
      statusRank[right.status ?? "active"] - statusRank[left.status ?? "active"]
      || right.confidence - left.confidence
      || (right.usageCount ?? 0) - (left.usageCount ?? 0)
      || right.updatedAt - left.updatedAt
    ))
    .slice(0, slots)
  const keep = new Set([...manual, ...automatic].map((rule) => rule.id))
  return rules.filter((rule) => keep.has(rule.id))
}

function estimatedConfigBytes(config: GlobalUserMemoryConfig): number {
  return JSON.stringify(config).length * 2
}

function enforceStorageByteLimit(config: GlobalUserMemoryConfig): GlobalUserMemoryConfig {
  if (estimatedConfigBytes(config) <= config.maxStorageBytes) return config
  const removable = config.rules
    .filter((rule) => rule.source === "automatic")
    .sort((left, right) => {
      const rank: Record<UserMemoryStatus, number> = { expired: 0, candidate: 1, conflicted: 2, active: 3 }
      return rank[left.status ?? "active"] - rank[right.status ?? "active"]
        || left.confidence - right.confidence
        || (left.usageCount ?? 0) - (right.usageCount ?? 0)
        || left.updatedAt - right.updatedAt
    })
  let rules = [...config.rules]
  for (const rule of removable) {
    rules = rules.filter((item) => item.id !== rule.id)
    const next = { ...config, rules }
    if (estimatedConfigBytes(next) <= config.maxStorageBytes) return next
  }
  return { ...config, rules }
}

export function normalizeGlobalUserMemoryConfig(value: unknown): GlobalUserMemoryConfig {
  if (!value || typeof value !== "object") return defaultConfig()
  const raw = value as Partial<GlobalUserMemoryConfig>
  const rules = Array.isArray(raw.rules)
    ? raw.rules.map(normalizeRule).filter((rule): rule is UserMemoryRule => Boolean(rule))
    : []
  const dedupedRules = rules.filter((rule, index, all) => all.findIndex((item) => item.id === rule.id) === index)
  const maxRules = positiveInteger(raw.maxRules, DEFAULT_MAX_RULES)
  const maxAnalyzedHashes = positiveInteger(raw.maxAnalyzedHashes, DEFAULT_MAX_ANALYZED_HASHES)
  const normalized: GlobalUserMemoryConfig = {
    version: 2,
    enabled: raw.enabled !== false,
    autoLearn: raw.autoLearn !== false,
    autoRead: raw.autoRead !== false,
    rules: pruneRules(dedupedRules, maxRules),
    analyzedSourceHashes: uniqueStrings(raw.analyzedSourceHashes).slice(-maxAnalyzedHashes),
    deletedFingerprints: uniqueStrings(raw.deletedFingerprints),
    updatedAt: typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
    onlyManual: raw.onlyManual === true,
    dailyLearningLimit: positiveInteger(raw.dailyLearningLimit, 20),
    batchSize: positiveInteger(raw.batchSize, 3),
    candidatePromotionThreshold: positiveInteger(raw.candidatePromotionThreshold, 2),
    maxRules,
    maxAnalyzedHashes,
    maxStorageBytes: positiveInteger(raw.maxStorageBytes, DEFAULT_MAX_STORAGE_BYTES),
  }
  return enforceStorageByteLimit(normalized)
}

export function loadGlobalUserMemoryConfig(storage: StorageLike | null = defaultStorage()): GlobalUserMemoryConfig {
  if (!storage) return defaultConfig()
  try {
    const raw = storage.getItem(GLOBAL_USER_MEMORY_STORAGE_KEY)
    return raw ? normalizeGlobalUserMemoryConfig(JSON.parse(raw)) : defaultConfig()
  } catch {
    return defaultConfig()
  }
}

export function saveGlobalUserMemoryConfig(config: GlobalUserMemoryConfig, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return
  const normalized = normalizeGlobalUserMemoryConfig(config)
  try {
    storage.setItem(GLOBAL_USER_MEMORY_STORAGE_KEY, JSON.stringify(normalized))
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(GLOBAL_USER_MEMORY_CHANGED_EVENT))
  } catch {
    // 用户记忆不可用不应阻断主流程。
  }
}

function createId(now: number): string {
  try {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `memory:${crypto.randomUUID()}`
      : `memory:${now}:${Math.random().toString(36).slice(2)}`
  } catch {
    return `memory:${now}:${Math.random().toString(36).slice(2)}`
  }
}

export function addManualUserMemoryRule(
  config: GlobalUserMemoryConfig,
  input: ManualUserMemoryRuleInput,
  now = Date.now(),
): GlobalUserMemoryConfig {
  const rule = input.rule.trim()
  if (!rule) return config
  const fingerprint = userMemoryRuleFingerprint(rule, input.category)
  return normalizeGlobalUserMemoryConfig({
    ...config,
    rules: [...config.rules, {
      id: createId(now),
      rule,
      category: input.category,
      source: "manual",
      surfaces: input.surfaces,
      confidence: 1,
      evidenceSummary: "用户手动添加",
      sourceHash: null,
      fingerprint,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      scope: input.scope ?? "global",
      projectKey: input.projectKey ?? null,
      sessionKey: input.sessionKey ?? null,
      status: "active",
      evidenceCount: 1,
      lastEvidenceAt: now,
      expiresAt: null,
      usageCount: 0,
      lastUsedAt: null,
      positiveFeedback: 0,
      negativeFeedback: 0,
      conflictsWith: [],
    }],
    updatedAt: now,
  })
}

export function upsertAutomaticUserMemoryRule(
  config: GlobalUserMemoryConfig,
  input: AutomaticUserMemoryRuleInput,
  now = Date.now(),
): GlobalUserMemoryConfig {
  const rule = input.rule.trim()
  if (!rule || !input.sourceHash.trim()) return config
  const fingerprint = userMemoryRuleFingerprint(rule, input.category)
  const analyzedSourceHashes = [...new Set([...config.analyzedSourceHashes, input.sourceHash])]
  if (config.deletedFingerprints.includes(fingerprint)) {
    return { ...config, analyzedSourceHashes, updatedAt: now }
  }
  const existingIndex = config.rules.findIndex((item) => item.fingerprint === fingerprint)
  const nextRule: UserMemoryRule = existingIndex >= 0
    ? {
        ...config.rules[existingIndex]!,
        rule,
        category: input.category,
        surfaces: [...new Set([...config.rules[existingIndex]!.surfaces, ...input.surfaces])],
        confidence: Math.max(config.rules[existingIndex]!.confidence, input.confidence),
        evidenceSummary: input.evidenceSummary.trim(),
        sourceHash: input.sourceHash,
        fingerprint,
        updatedAt: now,
        evidenceCount: (config.rules[existingIndex]!.evidenceCount ?? 1) + 1,
        lastEvidenceAt: now,
      }
    : {
        id: createId(now),
        rule,
        category: input.category,
        source: "automatic",
        surfaces: input.surfaces,
        confidence: Math.max(0, Math.min(1, input.confidence)),
        evidenceSummary: input.evidenceSummary.trim(),
        sourceHash: input.sourceHash,
        fingerprint,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        scope: input.scope ?? "global",
        projectKey: input.projectKey ?? null,
        sessionKey: input.sessionKey ?? null,
        status: "candidate",
        evidenceCount: 1,
        lastEvidenceAt: now,
        expiresAt: now + (input.scope === "session" ? 24 : 30 * 24) * 60 * 60 * 1000,
        usageCount: 0,
        lastUsedAt: null,
        positiveFeedback: 0,
        negativeFeedback: 0,
        conflictsWith: [],
      }
  const rules = existingIndex >= 0
    ? config.rules.map((item, index) => index === existingIndex ? nextRule : item)
    : [...config.rules, nextRule]
  return normalizeGlobalUserMemoryConfig({ ...config, rules, analyzedSourceHashes, updatedAt: now })
}

export function updateUserMemoryRule(
  config: GlobalUserMemoryConfig,
  id: string,
  patch: Pick<Partial<UserMemoryRule>, "rule" | "category" | "surfaces" | "enabled">,
  now = Date.now(),
): GlobalUserMemoryConfig {
  return normalizeGlobalUserMemoryConfig({
    ...config,
    rules: config.rules.map((item) => {
      if (item.id !== id) return item
      const rule = typeof patch.rule === "string" && patch.rule.trim() ? patch.rule.trim() : item.rule
      const category = patch.category ?? item.category
      return {
        ...item,
        ...patch,
        rule,
        category,
        fingerprint: userMemoryRuleFingerprint(rule, category),
        updatedAt: now,
      }
    }),
    updatedAt: now,
  })
}

export function setUserMemoryRuleEnabled(config: GlobalUserMemoryConfig, id: string, enabled: boolean, now = Date.now()): GlobalUserMemoryConfig {
  return updateUserMemoryRule(config, id, { enabled }, now)
}

export function deleteUserMemoryRule(config: GlobalUserMemoryConfig, id: string, now = Date.now()): GlobalUserMemoryConfig {
  const target = config.rules.find((item) => item.id === id)
  if (!target) return config
  const deletedFingerprints = target.source === "automatic"
    ? [...new Set([...config.deletedFingerprints, target.fingerprint])]
    : config.deletedFingerprints
  return normalizeGlobalUserMemoryConfig({
    ...config,
    rules: config.rules.filter((item) => item.id !== id),
    deletedFingerprints,
    updatedAt: now,
  })
}

export function updateGlobalUserMemorySettings(
  config: GlobalUserMemoryConfig,
  patch: Pick<Partial<GlobalUserMemoryConfig>, "enabled" | "autoLearn" | "autoRead" | "onlyManual">,
  now = Date.now(),
): GlobalUserMemoryConfig {
  return normalizeGlobalUserMemoryConfig({ ...config, ...patch, updatedAt: now })
}

interface GlobalUserMemoryStats {
  totalRules: number
  manualRules: number
  candidateRules: number
  activeRules: number
  conflictedRules: number
  expiredRules: number
  estimatedBytes: number
  maxStorageBytes: number
}

export function getGlobalUserMemoryStats(config: GlobalUserMemoryConfig): GlobalUserMemoryStats {
  return {
    totalRules: config.rules.length,
    manualRules: config.rules.filter((rule) => rule.source === "manual").length,
    candidateRules: config.rules.filter((rule) => rule.status === "candidate").length,
    activeRules: config.rules.filter((rule) => (rule.status ?? "active") === "active").length,
    conflictedRules: config.rules.filter((rule) => rule.status === "conflicted").length,
    expiredRules: config.rules.filter((rule) => rule.status === "expired").length,
    estimatedBytes: estimatedConfigBytes(config),
    maxStorageBytes: config.maxStorageBytes,
  }
}

export function exportGlobalUserMemoryJson(config: GlobalUserMemoryConfig): string {
  return JSON.stringify(normalizeGlobalUserMemoryConfig(config), null, 2)
}

export function clearGlobalUserMemoryConfig(storage: StorageLike | null = defaultStorage()): void {
  saveGlobalUserMemoryConfig(defaultConfig(), storage)
  resetUserMemoryLearningBudget(storage)
}
