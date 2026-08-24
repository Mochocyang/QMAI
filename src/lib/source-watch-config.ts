import type { SourceWatchConfig } from "@/stores/wiki-store"
import sourceWatchDefaults from "@/lib/source-watch-defaults.json"

export const DEFAULT_SOURCE_WATCH_CONFIG: SourceWatchConfig = sourceWatchDefaults

function normalizeExtensions(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? [])
    .map((value) => value.trim().replace(/^\./, "").toLowerCase())
    .filter(Boolean))]
}

function normalizeList(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
}

export function normalizeSourceWatchConfig(config?: Partial<SourceWatchConfig> | null): SourceWatchConfig {
  return {
    enabled: config?.enabled ?? DEFAULT_SOURCE_WATCH_CONFIG.enabled,
    autoIngest: config?.autoIngest ?? DEFAULT_SOURCE_WATCH_CONFIG.autoIngest,
    includeExtensions: normalizeExtensions(config?.includeExtensions ?? DEFAULT_SOURCE_WATCH_CONFIG.includeExtensions),
    excludeExtensions: normalizeExtensions(config?.excludeExtensions ?? DEFAULT_SOURCE_WATCH_CONFIG.excludeExtensions),
    excludeDirs: normalizeList(config?.excludeDirs ?? DEFAULT_SOURCE_WATCH_CONFIG.excludeDirs),
    excludeGlobs: normalizeList(config?.excludeGlobs ?? DEFAULT_SOURCE_WATCH_CONFIG.excludeGlobs),
    maxFileSizeMb: Math.max(1, Math.min(4096, config?.maxFileSizeMb ?? DEFAULT_SOURCE_WATCH_CONFIG.maxFileSizeMb)),
  }
}
