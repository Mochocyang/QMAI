import { getStore } from "@/lib/web-store"
import type { WikiProject } from "@/types/wiki"
import type { LlmConfig, SearchApiConfig, EmbeddingConfig, MultimodalConfig, OutputLanguage, ProviderConfigs, ProxyConfig, ClipServerConfig, ScheduledImportConfig, SourceWatchConfig, NovelConfig, RerankConfig } from "@/stores/wiki-store"
import { DEFAULT_NOVEL_CONFIG, DEFAULT_RERANK_CONFIG } from "@/stores/wiki-store"
import { normalizeSourceWatchConfig } from "@/lib/source-watch-config"
import { normalizePath } from "@/lib/path-utils"
import { readFile, writeFile, fileExists } from "@/commands/fs"

const RECENT_PROJECTS_KEY = "recentProjects"
const LAST_PROJECT_KEY = "lastProject"

export async function getRecentProjects(): Promise<WikiProject[]> {
  const store = await getStore()
  const projects = await store.get<WikiProject[]>(RECENT_PROJECTS_KEY)
  return projects ?? []
}

export async function getLastProject(): Promise<WikiProject | null> {
  const store = await getStore()
  const project = await store.get<WikiProject>(LAST_PROJECT_KEY)
  return project ?? null
}

export async function saveLastProject(project: WikiProject): Promise<void> {
  const store = await getStore()
  await store.set(LAST_PROJECT_KEY, project)
  await addToRecentProjects(project)
}

export async function addToRecentProjects(
  project: WikiProject
): Promise<void> {
  const store = await getStore()
  const existing = (await store.get<WikiProject[]>(RECENT_PROJECTS_KEY)) ?? []
  const filtered = existing.filter((p) => p.path !== project.path)
  const updated = [project, ...filtered].slice(0, 10)
  await store.set(RECENT_PROJECTS_KEY, updated)
}

const LLM_CONFIG_KEY = "llmConfig"
const AI_CHAT_MODEL_KEY = "aiChatModel"
const DEFAULT_LLM_MODEL_KEY = "defaultLlmModel"
const PROVIDER_CONFIGS_KEY = "providerConfigs"
const ACTIVE_PRESET_KEY = "activePresetId"

export async function saveLlmConfig(config: LlmConfig): Promise<void> {
  const store = await getStore()
  await store.set(LLM_CONFIG_KEY, config)
}

export async function loadLlmConfig(): Promise<LlmConfig | null> {
  const store = await getStore()
  return (await store.get<LlmConfig>(LLM_CONFIG_KEY)) ?? null
}

export async function saveAiChatModel(model: string): Promise<void> {
  const store = await getStore()
  await store.set(AI_CHAT_MODEL_KEY, model)
}

export async function loadAiChatModel(): Promise<string | null> {
  const store = await getStore()
  return (await store.get<string>(AI_CHAT_MODEL_KEY)) ?? null
}

export async function saveDefaultLlmModel(model: string): Promise<void> {
  const store = await getStore()
  await store.set(DEFAULT_LLM_MODEL_KEY, model)
}

export async function loadDefaultLlmModel(): Promise<string | null> {
  const store = await getStore()
  return (await store.get<string>(DEFAULT_LLM_MODEL_KEY)) ?? null
}

export async function saveProviderConfigs(configs: ProviderConfigs): Promise<void> {
  const store = await getStore()
  await store.set(PROVIDER_CONFIGS_KEY, configs)
}

export async function loadProviderConfigs(): Promise<ProviderConfigs | null> {
  const store = await getStore()
  return (await store.get<ProviderConfigs>(PROVIDER_CONFIGS_KEY)) ?? null
}

export async function saveActivePresetId(id: string | null): Promise<void> {
  const store = await getStore()
  await store.set(ACTIVE_PRESET_KEY, id)
}

export async function loadActivePresetId(): Promise<string | null> {
  const store = await getStore()
  return (await store.get<string | null>(ACTIVE_PRESET_KEY)) ?? null
}

const SEARCH_API_KEY = "searchApiConfig"

export async function saveSearchApiConfig(config: SearchApiConfig): Promise<void> {
  const store = await getStore()
  await store.set(SEARCH_API_KEY, config)
}

export async function loadSearchApiConfig(): Promise<SearchApiConfig | null> {
  const store = await getStore()
  return (await store.get<SearchApiConfig>(SEARCH_API_KEY)) ?? null
}

const EMBEDDING_KEY = "embeddingConfig"

export async function saveEmbeddingConfig(config: EmbeddingConfig): Promise<void> {
  const store = await getStore()
  await store.set(EMBEDDING_KEY, config)
}

export async function loadEmbeddingConfig(): Promise<EmbeddingConfig | null> {
  const store = await getStore()
  return (await store.get<EmbeddingConfig>(EMBEDDING_KEY)) ?? null
}

const MULTIMODAL_KEY = "multimodalConfig"

export async function saveMultimodalConfig(config: MultimodalConfig): Promise<void> {
  const store = await getStore()
  await store.set(MULTIMODAL_KEY, config)
}

export async function loadMultimodalConfig(): Promise<MultimodalConfig | null> {
  const store = await getStore()
  return (await store.get<MultimodalConfig>(MULTIMODAL_KEY)) ?? null
}

// IMPORTANT: Keep this key in sync with the Rust setup hook
// (src-tauri/src/proxy.rs), which reads this exact field name from
// the same `app-state.json` store at app launch to translate the
// config into HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars.
const PROXY_CONFIG_KEY = "proxyConfig"

export async function saveProxyConfig(config: ProxyConfig): Promise<void> {
  const store = await getStore()
  await store.set(PROXY_CONFIG_KEY, config)
  // Force-flush to disk. The store is opened with `autoSave: true`,
  // which is a 100ms debounce — not an immediate write. For most
  // settings that's fine, but the proxy config is on the startup
  // critical path: the Rust setup hook reads `app-state.json` on
  // launch to apply HTTP_PROXY / HTTPS_PROXY / NO_PROXY. If the
  // user saves and quits within the debounce window the disk
  // value would lag behind in-memory, and the next launch would
  // boot with the wrong proxy.
  await store.save()
}

export async function loadProxyConfig(): Promise<ProxyConfig | null> {
  const store = await getStore()
  return (await store.get<ProxyConfig>(PROXY_CONFIG_KEY)) ?? null
}

const CLIP_SERVER_CONFIG_KEY = "clipServerConfig"

export const DEFAULT_CLIP_SERVER_CONFIG: ClipServerConfig = {
  enabled: true,
  port: 19827,
}

export function normalizeClipServerConfig(config: Partial<ClipServerConfig> | null | undefined): ClipServerConfig {
  const rawPort = Number(config?.port ?? DEFAULT_CLIP_SERVER_CONFIG.port)
  const port = Number.isFinite(rawPort)
    ? Math.max(1024, Math.min(65535, Math.round(rawPort)))
    : DEFAULT_CLIP_SERVER_CONFIG.port
  return {
    enabled: config?.enabled ?? DEFAULT_CLIP_SERVER_CONFIG.enabled,
    port,
  }
}

export async function saveClipServerConfig(config: ClipServerConfig): Promise<void> {
  const store = await getStore()
  await store.set(CLIP_SERVER_CONFIG_KEY, normalizeClipServerConfig(config))
  await store.save()
}

export async function loadClipServerConfig(): Promise<ClipServerConfig> {
  const store = await getStore()
  const config = await store.get<ClipServerConfig>(CLIP_SERVER_CONFIG_KEY)
  return normalizeClipServerConfig(config)
}

const SCHEDULED_IMPORT_KEY_PREFIX = "scheduledImportConfig:"

function scheduledImportKey(projectPath: string): string {
  return `${SCHEDULED_IMPORT_KEY_PREFIX}${normalizePath(projectPath)}`
}

const SCHEDULED_IMPORT_GLOBAL_KEY = "scheduledImportConfig"

export async function saveScheduledImportConfig(projectPath: string, config: ScheduledImportConfig): Promise<void> {
  const store = await getStore()
  await store.set(scheduledImportKey(projectPath), config)
  await store.save()
}

export async function loadScheduledImportConfig(projectPath: string): Promise<ScheduledImportConfig | null> {
  const store = await getStore()
  const perProject = await store.get<ScheduledImportConfig>(scheduledImportKey(projectPath))
  if (perProject) return perProject
  // Migrate from legacy global key (pre-0.4.8)
  const legacy = await store.get<ScheduledImportConfig>(SCHEDULED_IMPORT_GLOBAL_KEY)
  if (legacy) {
    await store.set(scheduledImportKey(projectPath), legacy)
    await store.delete(SCHEDULED_IMPORT_GLOBAL_KEY)
    await store.save()
    return legacy
  }
  return null
}

export async function removeFromRecentProjects(
  path: string
): Promise<void> {
  const store = await getStore()
  const existing = (await store.get<WikiProject[]>(RECENT_PROJECTS_KEY)) ?? []
  const updated = existing.filter((p) => p.path !== path)
  await store.set(RECENT_PROJECTS_KEY, updated)
  // ALSO clear the last-project pointer if it points at the project
  // we just removed. Without this, App.tsx's startup auto-open
  // (`getLastProject()` → `openProject()` → `saveLastProject()`)
  // re-adds the removed entry back to recents on the next launch,
  // making the delete look like it didn't take. Reported by user
  // as "deleted project comes back after restart."
  const last = await store.get<WikiProject>(LAST_PROJECT_KEY)
  if (last && last.path === path) {
    await store.delete(LAST_PROJECT_KEY)
  }
}

const LANGUAGE_KEY = "language"

export async function saveLanguage(lang: string): Promise<void> {
  const store = await getStore()
  await store.set(LANGUAGE_KEY, lang)
}

export async function loadLanguage(): Promise<string | null> {
  const store = await getStore()
  return (await store.get<string>(LANGUAGE_KEY)) ?? null
}

const OUTPUT_LANGUAGE_KEY = "outputLanguage"
const PROJECT_OUTPUT_LANGUAGE_KEY = "projectOutputLanguages"
const PROJECT_FILE_SYNC_KEY = "projectFileSyncEnabled"
const SOURCE_WATCH_CONFIG_KEY = "sourceWatchConfig"

export async function saveOutputLanguage(lang: OutputLanguage, projectId?: string): Promise<void> {
  const store = await getStore()
  if (projectId) {
    const existing = (await store.get<Record<string, OutputLanguage>>(PROJECT_OUTPUT_LANGUAGE_KEY)) ?? {}
    await store.set(PROJECT_OUTPUT_LANGUAGE_KEY, { ...existing, [projectId]: lang })
  }
  await store.set(OUTPUT_LANGUAGE_KEY, lang)
}

export async function loadOutputLanguage(projectId?: string): Promise<OutputLanguage | null> {
  const store = await getStore()
  if (projectId) {
    const projectLanguages = await store.get<Record<string, OutputLanguage>>(PROJECT_OUTPUT_LANGUAGE_KEY)
    return projectLanguages?.[projectId] ?? null
  }
  return (await store.get<OutputLanguage>(OUTPUT_LANGUAGE_KEY)) ?? null
}

export async function saveProjectFileSyncEnabled(enabled: boolean, projectId?: string): Promise<void> {
  const store = await getStore()
  if (projectId) {
    const existing = (await store.get<Record<string, boolean>>(PROJECT_FILE_SYNC_KEY)) ?? {}
    await store.set(PROJECT_FILE_SYNC_KEY, { ...existing, [projectId]: enabled })
    return
  }
  const existing = (await store.get<Record<string, boolean>>(PROJECT_FILE_SYNC_KEY)) ?? {}
  await store.set(PROJECT_FILE_SYNC_KEY, { ...existing, default: enabled })
}

export async function loadProjectFileSyncEnabled(projectId?: string): Promise<boolean> {
  const store = await getStore()
  const settings = await store.get<Record<string, boolean>>(PROJECT_FILE_SYNC_KEY)
  if (projectId && settings && typeof settings[projectId] === "boolean") {
    return settings[projectId]
  }
  if (settings && typeof settings.default === "boolean") {
    return settings.default
  }
  return true
}

const SOURCE_WATCH_CONFIG_FILE = ".qmai/source-watch-config.json"

function sourceWatchConfigFilePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/${SOURCE_WATCH_CONFIG_FILE}`
}

export async function saveSourceWatchConfig(config: SourceWatchConfig, projectId?: string, projectPath?: string): Promise<void> {
  const store = await getStore()
  const normalized = normalizeSourceWatchConfig(config)
  const existing = (await store.get<Record<string, SourceWatchConfig>>(SOURCE_WATCH_CONFIG_KEY)) ?? {}
  await store.set(SOURCE_WATCH_CONFIG_KEY, {
    ...existing,
    [projectId ?? "default"]: normalized,
  })
  await store.save()
  if (projectPath) {
    try {
      await writeFile(sourceWatchConfigFilePath(projectPath), JSON.stringify(normalized, null, 2))
    } catch {
      // non-critical
    }
  }
}

export async function loadSourceWatchConfig(projectId?: string, projectPath?: string): Promise<SourceWatchConfig> {
  if (projectPath) {
    try {
      const filePath = sourceWatchConfigFilePath(projectPath)
      if (await fileExists(filePath)) {
        const raw = await readFile(filePath)
        const config = JSON.parse(raw)
        return normalizeSourceWatchConfig(config)
      }
    } catch {
      // fall through to global store
    }
  }
  const store = await getStore()
  const settings = await store.get<Record<string, SourceWatchConfig>>(SOURCE_WATCH_CONFIG_KEY)
  let config: SourceWatchConfig | undefined
  if (projectId && settings?.[projectId]) {
    config = normalizeSourceWatchConfig(settings[projectId])
  }
  if (!config && settings?.default) {
    config = normalizeSourceWatchConfig(settings.default)
  }
  if (!config) {
    const legacyEnabled = await loadProjectFileSyncEnabled(projectId)
    config = normalizeSourceWatchConfig({ enabled: legacyEnabled })
  }
  if (config && projectPath) {
    try {
      await writeFile(sourceWatchConfigFilePath(projectPath), JSON.stringify(config, null, 2))
    } catch {
      // non-critical migration
    }
  }
  return config
}

const NOVEL_MODE_KEY = "novelMode"
const PROJECT_NOVEL_MODE_KEY = "projectNovelModes"
const REVISION_FEEDBACK_WINDOW_CONFIG_KEY = "revisionFeedbackWindowConfig"
const PROJECT_REVISION_FEEDBACK_WINDOW_CONFIG_KEY = "projectRevisionFeedbackWindowConfigs"

export async function saveNovelMode(mode: boolean, projectId?: string, projectPath?: string): Promise<void> {
  const store = await getStore()
  if (projectId) {
    const existing = (await store.get<Record<string, boolean>>(PROJECT_NOVEL_MODE_KEY)) ?? {}
    await store.set(PROJECT_NOVEL_MODE_KEY, { ...existing, [projectId]: mode })
  }
  await store.set(NOVEL_MODE_KEY, mode)
  if (projectPath) {
    try {
      const { saveNovelProjectMeta, loadNovelProjectMeta } = await import("@/lib/novel/project-meta")
      const existing = await loadNovelProjectMeta(projectPath)
      if (existing) {
        await saveNovelProjectMeta(projectPath, { ...existing, novelMode: mode })
      }
    } catch {
      // non-critical
    }
  }
}

export async function loadNovelMode(projectId?: string, projectPath?: string): Promise<boolean | null> {
  if (projectPath) {
    try {
      const { loadNovelProjectMeta } = await import("@/lib/novel/project-meta")
      const meta = await loadNovelProjectMeta(projectPath)
      if (meta && typeof meta.novelMode === "boolean") {
        return meta.novelMode
      }
    } catch {
      // fall through to global store
    }
  }
  const store = await getStore()
  if (projectId) {
    const projectModes = await store.get<Record<string, boolean>>(PROJECT_NOVEL_MODE_KEY)
    if (projectModes && typeof projectModes[projectId] === "boolean") {
      return projectModes[projectId]
    }
    return null
  }
  return (await store.get<boolean>(NOVEL_MODE_KEY)) ?? null
}

export interface RevisionFeedbackWindowConfig {
  currentChapterIncludeShouldImprove: boolean
  previousChapterCarryEnabled: boolean
  lookbackChapterCount: number
  lookbackIncludeMustFixOnly: boolean
}

const DEFAULT_REVISION_FEEDBACK_WINDOW_CONFIG: RevisionFeedbackWindowConfig = {
  currentChapterIncludeShouldImprove: true,
  previousChapterCarryEnabled: true,
  lookbackChapterCount: 2,
  lookbackIncludeMustFixOnly: true,
}

const REVISION_FEEDBACK_CONFIG_FILE = ".qmai/revision-feedback-config.json"

function revisionFeedbackConfigFilePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/${REVISION_FEEDBACK_CONFIG_FILE}`
}

export async function saveRevisionFeedbackWindowConfig(
  config: RevisionFeedbackWindowConfig,
  projectId?: string,
  projectPath?: string,
): Promise<void> {
  const store = await getStore()
  if (projectId) {
    const existing = (await store.get<Record<string, RevisionFeedbackWindowConfig>>(PROJECT_REVISION_FEEDBACK_WINDOW_CONFIG_KEY)) ?? {}
    await store.set(PROJECT_REVISION_FEEDBACK_WINDOW_CONFIG_KEY, { ...existing, [projectId]: config })
  }
  await store.set(REVISION_FEEDBACK_WINDOW_CONFIG_KEY, config)
  if (projectPath) {
    try {
      await writeFile(revisionFeedbackConfigFilePath(projectPath), JSON.stringify(config, null, 2))
    } catch {
      // non-critical
    }
  }
}

export async function loadRevisionFeedbackWindowConfig(
  projectId?: string,
  projectPath?: string,
): Promise<RevisionFeedbackWindowConfig> {
  if (projectPath) {
    try {
      const filePath = revisionFeedbackConfigFilePath(projectPath)
      if (await fileExists(filePath)) {
        const raw = await readFile(filePath)
        const config = JSON.parse(raw)
        return normalizeRevisionFeedbackWindowConfig(config)
      }
    } catch {
      // fall through to global store
    }
  }
  const store = await getStore()
  let config: RevisionFeedbackWindowConfig | null = null
  if (projectId) {
    const projectConfigs = await store.get<Record<string, RevisionFeedbackWindowConfig>>(PROJECT_REVISION_FEEDBACK_WINDOW_CONFIG_KEY)
    if (projectConfigs && projectConfigs[projectId]) {
      config = normalizeRevisionFeedbackWindowConfig(projectConfigs[projectId])
    }
  }
  if (!config) {
    const globalConfig = await store.get<RevisionFeedbackWindowConfig>(REVISION_FEEDBACK_WINDOW_CONFIG_KEY)
    config = normalizeRevisionFeedbackWindowConfig(globalConfig)
  }
  if (config && projectPath) {
    try {
      await writeFile(revisionFeedbackConfigFilePath(projectPath), JSON.stringify(config, null, 2))
    } catch {
      // non-critical migration
    }
  }
  return config
}

function normalizeRevisionFeedbackWindowConfig(
  config?: Partial<RevisionFeedbackWindowConfig> | null,
): RevisionFeedbackWindowConfig {
  return {
    currentChapterIncludeShouldImprove: config?.currentChapterIncludeShouldImprove ?? DEFAULT_REVISION_FEEDBACK_WINDOW_CONFIG.currentChapterIncludeShouldImprove,
    previousChapterCarryEnabled: config?.previousChapterCarryEnabled ?? DEFAULT_REVISION_FEEDBACK_WINDOW_CONFIG.previousChapterCarryEnabled,
    lookbackChapterCount: Math.max(0, config?.lookbackChapterCount ?? DEFAULT_REVISION_FEEDBACK_WINDOW_CONFIG.lookbackChapterCount),
    lookbackIncludeMustFixOnly: config?.lookbackIncludeMustFixOnly ?? DEFAULT_REVISION_FEEDBACK_WINDOW_CONFIG.lookbackIncludeMustFixOnly,
  }
}

const NOVEL_CONFIG_KEY = "novelConfig"
const PROJECT_NOVEL_CONFIG_KEY = "projectNovelConfigs"

const NOVEL_CONFIG_FILE = ".qmai/novel-config.json"

function novelConfigFilePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/${NOVEL_CONFIG_FILE}`
}

export async function saveNovelConfig(config: NovelConfig, projectId?: string, projectPath?: string): Promise<void> {
  const store = await getStore()
  if (projectId) {
    const existing = (await store.get<Record<string, NovelConfig>>(PROJECT_NOVEL_CONFIG_KEY)) ?? {}
    await store.set(PROJECT_NOVEL_CONFIG_KEY, { ...existing, [projectId]: config })
  }
  await store.set(NOVEL_CONFIG_KEY, config)
  if (projectPath) {
    try {
      await writeFile(novelConfigFilePath(projectPath), JSON.stringify(config, null, 2))
    } catch {
      // non-critical
    }
  }
}

export async function loadNovelConfig(projectId?: string, projectPath?: string): Promise<NovelConfig | null> {
  if (projectPath) {
    try {
      const filePath = novelConfigFilePath(projectPath)
      if (await fileExists(filePath)) {
        const raw = await readFile(filePath)
        const config = JSON.parse(raw)
        return normalizeNovelConfig(config)
      }
    } catch {
      // fall through to global store
    }
  }
  const store = await getStore()
  let config: NovelConfig | null = null
  if (projectId) {
    const projectConfigs = await store.get<Record<string, NovelConfig>>(PROJECT_NOVEL_CONFIG_KEY)
    if (projectConfigs && projectConfigs[projectId]) {
      config = normalizeNovelConfig(projectConfigs[projectId])
    }
  }
  if (!config) {
    config = normalizeNovelConfig(await store.get<NovelConfig>(NOVEL_CONFIG_KEY))
  }
  if (config && projectPath) {
    try {
      await writeFile(novelConfigFilePath(projectPath), JSON.stringify(config, null, 2))
    } catch {
      // non-critical migration
    }
  }
  return config
}

const RERANK_CONFIG_KEY = "rerankConfig"
const PROJECT_RERANK_CONFIG_KEY = "projectRerankConfigs"

const RERANK_CONFIG_FILE = ".qmai/rerank-config.json"

function rerankConfigFilePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/${RERANK_CONFIG_FILE}`
}

export async function saveRerankConfig(config: RerankConfig, projectId?: string, projectPath?: string): Promise<void> {
  const store = await getStore()
  if (projectId) {
    const existing = (await store.get<Record<string, RerankConfig>>(PROJECT_RERANK_CONFIG_KEY)) ?? {}
    await store.set(PROJECT_RERANK_CONFIG_KEY, { ...existing, [projectId]: config })
  }
  await store.set(RERANK_CONFIG_KEY, config)
  if (projectPath) {
    try {
      await writeFile(rerankConfigFilePath(projectPath), JSON.stringify(config, null, 2))
    } catch {
      // non-critical
    }
  }
}

export async function loadRerankConfig(projectId?: string, projectPath?: string): Promise<RerankConfig | null> {
  if (projectPath) {
    try {
      const filePath = rerankConfigFilePath(projectPath)
      if (await fileExists(filePath)) {
        const raw = await readFile(filePath)
        const config = JSON.parse(raw)
        return normalizeRerankConfig(config)
      }
    } catch {
      // fall through to global store
    }
  }

  const store = await getStore()
  let config: RerankConfig | null = null
  if (projectId) {
    const projectConfigs = await store.get<Record<string, RerankConfig>>(PROJECT_RERANK_CONFIG_KEY)
    if (projectConfigs && projectConfigs[projectId]) {
      config = normalizeRerankConfig(projectConfigs[projectId])
    }
  }
  if (!config) {
    config = normalizeRerankConfig(await store.get<RerankConfig>(RERANK_CONFIG_KEY))
  }
  if (config && projectPath) {
    try {
      await writeFile(rerankConfigFilePath(projectPath), JSON.stringify(config, null, 2))
    } catch {
      // non-critical migration
    }
  }
  return config
}

const THEME_KEY = "theme"

export async function saveTheme(theme: "light" | "dark" | "deep-blue"): Promise<void> {
  const store = await getStore()
  await store.set(THEME_KEY, theme)
}

export async function loadTheme(): Promise<"light" | "dark" | "deep-blue" | null> {
  const store = await getStore()
  const savedTheme = await store.get<"light" | "dark" | "deep-blue">(THEME_KEY)
  return savedTheme ?? null
}

const UI_FONT_SIZE_SCALE_KEY = "uiFontSizeScale"
const MAX_HISTORY_MESSAGES_KEY = "maxHistoryMessages"

export async function saveUiFontSizeScale(scale: number, _projectId?: string, _projectPath?: string): Promise<void> {
  const store = await getStore()
  await store.set(UI_FONT_SIZE_SCALE_KEY, scale)
  await store.save()
}

export async function saveMaxHistoryMessages(max: number, _projectId?: string, _projectPath?: string): Promise<void> {
  const store = await getStore()
  await store.set(MAX_HISTORY_MESSAGES_KEY, max)
  await store.save()
}

export async function loadMaxHistoryMessages(_projectId?: string, _projectPath?: string): Promise<number | null> {
  const store = await getStore()
  const val = await store.get<number>(MAX_HISTORY_MESSAGES_KEY)
  return val ?? null
}

function normalizeNovelConfig(
  config?: Partial<NovelConfig> | null,
): NovelConfig | null {
  if (!config) return null
  return {
    contextTokenBudget: Math.max(0, config.contextTokenBudget ?? DEFAULT_NOVEL_CONFIG.contextTokenBudget),
    recentSummaryWindow: Math.max(1, Math.min(30, config.recentSummaryWindow ?? DEFAULT_NOVEL_CONFIG.recentSummaryWindow)),
    searchTopK: Math.max(1, Math.min(20, config.searchTopK ?? DEFAULT_NOVEL_CONFIG.searchTopK)),
    chapterTargetChars: Math.max(500, Math.min(20000, config.chapterTargetChars ?? DEFAULT_NOVEL_CONFIG.chapterTargetChars)),
    autoIngestOnSave: config.autoIngestOnSave ?? DEFAULT_NOVEL_CONFIG.autoIngestOnSave,
    autoExtractOnImport: config.autoExtractOnImport ?? DEFAULT_NOVEL_CONFIG.autoExtractOnImport,
    reviewBeforeSave: config.reviewBeforeSave ?? DEFAULT_NOVEL_CONFIG.reviewBeforeSave,
    deepPreviousChaptersAnalysis: config.deepPreviousChaptersAnalysis ?? DEFAULT_NOVEL_CONFIG.deepPreviousChaptersAnalysis,
    deepChapterReview: config.deepChapterReview ?? DEFAULT_NOVEL_CONFIG.deepChapterReview,
    reviewReasoningEffort: config.reviewReasoningEffort ?? DEFAULT_NOVEL_CONFIG.reviewReasoningEffort,
    writingModel: config.writingModel ?? DEFAULT_NOVEL_CONFIG.writingModel,
    reviewModel: config.reviewModel ?? DEFAULT_NOVEL_CONFIG.reviewModel,
    summaryModel: config.summaryModel ?? DEFAULT_NOVEL_CONFIG.summaryModel,
    extractModel: config.extractModel ?? DEFAULT_NOVEL_CONFIG.extractModel,
    communitySummaryEnabled: config.communitySummaryEnabled ?? DEFAULT_NOVEL_CONFIG.communitySummaryEnabled,
    communitySummaryInterval: Math.max(1, Math.min(50, config.communitySummaryInterval ?? DEFAULT_NOVEL_CONFIG.communitySummaryInterval)),
    communitySummaryAsync: config.communitySummaryAsync ?? DEFAULT_NOVEL_CONFIG.communitySummaryAsync,
  }
}

function normalizeRerankConfig(
  config?: Partial<RerankConfig> | null,
): RerankConfig | null {
  if (!config) return null
  return {
    enabled: config.enabled ?? DEFAULT_RERANK_CONFIG.enabled,
    useMainLlm: config.useMainLlm ?? DEFAULT_RERANK_CONFIG.useMainLlm,
    provider: config.provider ?? DEFAULT_RERANK_CONFIG.provider,
    apiKey: config.apiKey ?? DEFAULT_RERANK_CONFIG.apiKey,
    model: config.model ?? DEFAULT_RERANK_CONFIG.model,
    ollamaUrl: config.ollamaUrl ?? DEFAULT_RERANK_CONFIG.ollamaUrl,
    customEndpoint: config.customEndpoint ?? DEFAULT_RERANK_CONFIG.customEndpoint,
    apiMode: config.apiMode ?? DEFAULT_RERANK_CONFIG.apiMode,
    maxCandidates: Math.max(3, Math.min(30, config.maxCandidates ?? DEFAULT_RERANK_CONFIG.maxCandidates)),
  }
}
