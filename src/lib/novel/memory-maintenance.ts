import { createDirectory, fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { loadCognitionState, cognitionToContextText } from "./character-cognition"
import { loadCharacterStates } from "./character-state"
import { loadForeshadowingTracker } from "./foreshadowing-tracker"
import { loadTimeline } from "./timeline"
import { withMemoryWriteLock } from "./memory-cleanup-policy"

export const MAINTENANCE_KINDS = ["cognition", "characters", "foreshadowing", "timeline"] as const
export type MaintenanceKind = typeof MAINTENANCE_KINDS[number]
export const MAINTENANCE_LABELS: Record<MaintenanceKind, string> = {
  cognition: "认知条目", characters: "人物状态", foreshadowing: "活跃伏笔", timeline: "时间线事件",
}
export interface MemoryMaintenanceSettings {
  version: 1
  enabled: boolean
  limits: Record<MaintenanceKind, number>
  cognitionChars: number
  lastRemindedAt: number
  modelId: string
}
export const DEFAULT_MEMORY_MAINTENANCE: MemoryMaintenanceSettings = {
  version: 1, enabled: true,
  limits: { cognition: 300, characters: 150, foreshadowing: 100, timeline: 800 },
  cognitionChars: 16000, lastRemindedAt: 0, modelId: "",
}
export interface MemoryMaintenanceOverview {
  counts: Record<MaintenanceKind, number>
  cognitionChars: number
  totalForeshadowing: number
}
export const REMINDER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000
export function memorySettingsPath(path: string): string { return `${normalizePath(path)}/.qmai/memory-maintenance.json` }
export async function loadMemoryMaintenanceSettings(path: string): Promise<MemoryMaintenanceSettings> {
  const fallback = { ...DEFAULT_MEMORY_MAINTENANCE, limits: { ...DEFAULT_MEMORY_MAINTENANCE.limits } }
  if (!await fileExists(memorySettingsPath(path))) return fallback
  const data = JSON.parse(await readFile(memorySettingsPath(path))) as Partial<MemoryMaintenanceSettings>
  if (data.version !== 1) throw new Error("无法读取记忆维护设置")
  for (const kind of MAINTENANCE_KINDS) {
    const value = data.limits?.[kind]
    if (typeof value === "number" && Number.isFinite(value) && value >= 1) fallback.limits[kind] = Math.floor(value)
  }
  return { ...fallback,
    enabled: typeof data.enabled === "boolean" ? data.enabled : fallback.enabled,
    cognitionChars: typeof data.cognitionChars === "number" && Number.isFinite(data.cognitionChars) && data.cognitionChars >= 100 ? Math.floor(data.cognitionChars) : fallback.cognitionChars,
    lastRemindedAt: typeof data.lastRemindedAt === "number" && Number.isFinite(data.lastRemindedAt) ? data.lastRemindedAt : 0,
    modelId: typeof data.modelId === "string" ? data.modelId : "",
  }
}
export async function saveMemoryMaintenanceSettings(path: string, settings: MemoryMaintenanceSettings): Promise<void> {
  if (MAINTENANCE_KINDS.some((key) => !Number.isFinite(settings.limits[key]) || settings.limits[key] < 1)
    || !Number.isFinite(settings.cognitionChars) || settings.cognitionChars < 100) throw new Error("提醒阈值必须为有效正数，认知字数阈值至少为 100。")
  await createDirectory(`${normalizePath(path)}/.qmai`)
  await writeFileAtomic(memorySettingsPath(path), JSON.stringify(settings, null, 2))
}
export async function updateMemoryMaintenanceSettings(path: string, patch: Partial<Omit<MemoryMaintenanceSettings, "version" | "lastRemindedAt">>): Promise<MemoryMaintenanceSettings> {
  return withMemoryWriteLock(path, async () => {
    const current = await loadMemoryMaintenanceSettings(path)
    const next = { ...current, ...patch, version: 1 as const }
    await saveMemoryMaintenanceSettings(path, next)
    return next
  })
}
export async function claimMemoryMaintenanceReminder(path: string, overview: MemoryMaintenanceOverview, now = Date.now()): Promise<string[]> {
  return withMemoryWriteLock(path, async () => {
    const settings = await loadMemoryMaintenanceSettings(path)
    if (!shouldRemindMemoryMaintenance(overview, settings, now)) return []
    await saveMemoryMaintenanceSettings(path, { ...settings, lastRemindedAt: now })
    return memoryMaintenanceWarnings(overview, settings)
  })
}
export async function loadMemoryMaintenanceOverview(path: string): Promise<MemoryMaintenanceOverview> {
  const [cognition, characters, foreshadowing, timeline] = await Promise.all([
    loadCognitionState(path), loadCharacterStates(path), loadForeshadowingTracker(path), loadTimeline(path),
  ])
  return {
    counts: {
      cognition: (cognition?.readerKnows.length ?? 0) + (cognition?.characters.reduce((n, c) => n + c.knows.length + c.doesNotKnow.length, 0) ?? 0),
      characters: characters.characters.length,
      foreshadowing: foreshadowing.items.filter((f) => f.status !== "resolved" && f.status !== "abandoned").length,
      timeline: timeline.entries.length,
    },
    cognitionChars: cognition ? cognitionToContextText(cognition).length : 0,
    totalForeshadowing: foreshadowing.items.length,
  }
}
export function memoryMaintenanceWarnings(overview: MemoryMaintenanceOverview, settings: MemoryMaintenanceSettings): string[] {
  const warnings = MAINTENANCE_KINDS.filter((key) => overview.counts[key] > settings.limits[key])
    .map((key) => `${MAINTENANCE_LABELS[key]} ${overview.counts[key]} 条（阈值 ${settings.limits[key]}）`)
  if (overview.cognitionChars > settings.cognitionChars) warnings.push(`认知文本 ${overview.cognitionChars} 字符（阈值 ${settings.cognitionChars}）`)
  return warnings
}
export function shouldRemindMemoryMaintenance(overview: MemoryMaintenanceOverview, settings: MemoryMaintenanceSettings, now = Date.now()): boolean {
  return settings.enabled && now - settings.lastRemindedAt >= REMINDER_COOLDOWN_MS && memoryMaintenanceWarnings(overview, settings).length > 0
}
