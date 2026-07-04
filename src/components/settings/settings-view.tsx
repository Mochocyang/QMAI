import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Bot,
  BookOpen,
  Database,
  ListFilter,
  Palette,
  Network,
  History,
  Wrench,
  HelpCircle,
  MessageCircle,
  HeartHandshake,
  Archive,
  FileText,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import i18n from "@/i18n"
import { Button } from "@/components/ui/button"
import { PanelHeaderWithHelp } from "@/components/layout/panel-header-with-help"
import { useWikiStore } from "@/stores/wiki-store"
import { isTauri } from "@/lib/platform"
import { useChatStore } from "@/stores/chat-store"
import { loadSourceWatchConfig, saveLanguage, loadNovelConfig, loadRerankConfig } from "@/lib/project-store"
import type { SettingsDraft, DraftSetter } from "./settings-types"
import { normalizeSourceWatchConfig } from "@/lib/source-watch-config"
import type { SidebarNavConfig } from "@/lib/sidebar-nav-preferences"
import type { UiFontFamily } from "@/lib/font-settings"
import { LlmProviderSection } from "./sections/llm-provider-section"
import { EmbeddingSection } from "./sections/embedding-section"
import { RerankSection } from "./sections/rerank-section"
import { InterfaceSection } from "./sections/interface-section"
import { NovelSection } from "./sections/novel-section"
import { ClassificationSection } from "./sections/classification-section"
import { NetworkSection } from "./sections/network-section"
import { McpSection } from "./sections/mcp-section"
import { ChangelogSection } from "./sections/changelog-section"
import { MaintenanceSection } from "./sections/maintenance-section"
import { FeedbackSection } from "./sections/feedback-section"
import { UsageGuideSection } from "./sections/usage-guide-section"
import { ContactSupportSection } from "./sections/contact-support-section"
import { DataManagementSection } from "./sections/data-management-section"

type CategoryId =
  | "llm"
  | "rerank"
  | "embedding"
  | "network"
  | "mcp"
  | "interface"
  | "novel"
  | "usage-guide"
  | "maintenance"
  | "data-management"
  | "feedback"
  | "contact-support"
  | "classification"
| "changelog"

interface Category {
  id: CategoryId
  /** i18n key under settings.categories — resolved at render time so
   *  switching language in Settings → Interface takes effect without
   *  remounting this component (Bug #53). */
  labelKey: string
  /** Optional muted subtitle under the label (e.g. novel → model setup). */
  hintKey?: string
  icon: typeof Bot
}

const CATEGORIES: Category[] = [
  { id: "llm", labelKey: "settings.categories.llm", icon: Bot },
  { id: "rerank", labelKey: "settings.categories.rerank", icon: ListFilter },
  { id: "embedding", labelKey: "settings.categories.embedding", icon: Database },
  { id: "network", labelKey: "settings.categories.network", icon: Network },
  { id: "mcp", labelKey: "settings.categories.mcp", icon: Network },
  { id: "interface", labelKey: "settings.categories.interface", icon: Palette },
  { id: "novel", labelKey: "settings.categories.novel", hintKey: "settings.categories.novelHint", icon: BookOpen },
  { id: "usage-guide", labelKey: "settings.categories.usageGuide", icon: HelpCircle },
  { id: "maintenance", labelKey: "settings.categories.maintenance", icon: Wrench },
  { id: "data-management", labelKey: "settings.categories.dataManagement", icon: Archive },
  { id: "feedback", labelKey: "settings.categories.feedback", icon: MessageCircle },
  { id: "contact-support", labelKey: "settings.categories.contactSupport", icon: HeartHandshake },
  { id: "classification", labelKey: "settings.categories.classification", icon: FileText },
  { id: "changelog", labelKey: "settings.categories.changelog", icon: History },
]

/** Settings tabs that edit the shared draft and need the global Save footer. */
const CATEGORIES_WITH_SAVE_FOOTER: CategoryId[] = [
  "rerank",
  "embedding",
  "network",
  "interface",
  "novel",
]

function initialDraft(
  llm: ReturnType<typeof useWikiStore.getState>["llmConfig"],
  embed: ReturnType<typeof useWikiStore.getState>["embeddingConfig"],
  rerank: ReturnType<typeof useWikiStore.getState>["rerankConfig"],
  multimodal: ReturnType<typeof useWikiStore.getState>["multimodalConfig"],
  outputLanguage: ReturnType<typeof useWikiStore.getState>["outputLanguage"],
  proxy: ReturnType<typeof useWikiStore.getState>["proxyConfig"],
  scheduledImport: ReturnType<typeof useWikiStore.getState>["scheduledImportConfig"],
  sourceWatch: ReturnType<typeof useWikiStore.getState>["sourceWatchConfig"],
  revisionFeedbackWindowConfig: ReturnType<typeof useWikiStore.getState>["revisionFeedbackWindowConfig"],
  novelConfig: ReturnType<typeof useWikiStore.getState>["novelConfig"],
  maxHistoryMessages: number,
  uiLanguage: string,
  uiFontSizeScale: number,
  uiFontFamily: UiFontFamily,
  visualStyle: SettingsDraft["visualStyle"],
  sidebarNavConfig: SidebarNavConfig,
  projectPath?: string,
): SettingsDraft {
  // Show absolute path: if stored path is empty, show default using project path
  // If stored path is relative (legacy), prepend project path
  // If stored path is absolute, show as-is
  let displayPath = scheduledImport.path || ""
  if (!displayPath && projectPath) {
    displayPath = `${projectPath}/raw/sources`
  } else if (displayPath && projectPath && !displayPath.startsWith("/") && !displayPath.match(/^[a-zA-Z]:[/\\]/)) {
    // Legacy relative path - prepend project path for display
    displayPath = `${projectPath}/${displayPath}`
  }

  return {
    provider: llm.provider,
    apiKey: llm.apiKey,
    model: llm.model,
    ollamaUrl: llm.ollamaUrl,
    customEndpoint: llm.customEndpoint,
    azureApiVersion: llm.azureApiVersion ?? "2024-10-21",
    azureModelFamily: llm.azureModelFamily ?? "auto",
    maxContextSize: llm.maxContextSize ?? 204800,
    apiMode: llm.apiMode,
    reasoning: llm.reasoning,
    localCliIsolation: llm.localCliIsolation === true,
    embeddingEnabled: embed.enabled,
    embeddingEndpoint: embed.endpoint,
    embeddingApiKey: embed.apiKey,
    embeddingModel: embed.model,
    embeddingOutputDimensionality: embed.outputDimensionality,
    embeddingMaxChunkChars: embed.maxChunkChars,
    embeddingOverlapChunkChars: embed.overlapChunkChars,
    rerankConfig: rerank,
    multimodalEnabled: multimodal.enabled,
    multimodalUseMainLlm: multimodal.useMainLlm,
    multimodalProvider: multimodal.provider,
    multimodalApiKey: multimodal.apiKey,
    multimodalModel: multimodal.model,
    multimodalOllamaUrl: multimodal.ollamaUrl,
    multimodalCustomEndpoint: multimodal.customEndpoint,
    multimodalAzureApiVersion: multimodal.azureApiVersion ?? "2024-10-21",
    multimodalAzureModelFamily: multimodal.azureModelFamily ?? "auto",
    multimodalApiMode: multimodal.apiMode,
    multimodalConcurrency: multimodal.concurrency,
    outputLanguage,
    maxHistoryMessages,
    proxyEnabled: proxy.enabled,
    proxyUrl: proxy.url,
    proxyBypassLocal: proxy.bypassLocal,
    scheduledImportEnabled: scheduledImport.enabled,
    scheduledImportPath: displayPath,
    scheduledImportInterval: scheduledImport.interval,
    sourceWatchConfig: normalizeSourceWatchConfig(sourceWatch),
    revisionFeedbackWindowConfig,
    novelConfig,
    uiLanguage,
    uiFontSizeScale,
    uiFontFamily,
    visualStyle,
    sidebarNavConfig,
  }
}

export function SettingsView() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const activeSettingsCategory = useWikiStore((s) => s.activeSettingsCategory)
  const setActiveSettingsCategory = useWikiStore((s) => s.setActiveSettingsCategory)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const setLlmConfig = useWikiStore((s) => s.setLlmConfig)
  const embeddingConfig = useWikiStore((s) => s.embeddingConfig)
  const setEmbeddingConfig = useWikiStore((s) => s.setEmbeddingConfig)
  const rerankConfig = useWikiStore((s) => s.rerankConfig)
  const setRerankConfig = useWikiStore((s) => s.setRerankConfig)
  const multimodalConfig = useWikiStore((s) => s.multimodalConfig)
  const setMultimodalConfig = useWikiStore((s) => s.setMultimodalConfig)
  const outputLanguage = useWikiStore((s) => s.outputLanguage)
  const setOutputLanguage = useWikiStore((s) => s.setOutputLanguage)
  const proxyConfig = useWikiStore((s) => s.proxyConfig)
  const setProxyConfig = useWikiStore((s) => s.setProxyConfig)
  const scheduledImportConfig = useWikiStore((s) => s.scheduledImportConfig)
  const setScheduledImportConfig = useWikiStore((s) => s.setScheduledImportConfig)
  const sourceWatchConfig = useWikiStore((s) => s.sourceWatchConfig)
  const setSourceWatchConfig = useWikiStore((s) => s.setSourceWatchConfig)
  const revisionFeedbackWindowConfig = useWikiStore((s) => s.revisionFeedbackWindowConfig)
  const setRevisionFeedbackWindowConfig = useWikiStore((s) => s.setRevisionFeedbackWindowConfig)
  const novelConfig = useWikiStore((s) => s.novelConfig)
  const setNovelConfig = useWikiStore((s) => s.setNovelConfig)
  const maxHistoryMessages = useChatStore((s) => s.maxHistoryMessages)
  const setMaxHistoryMessages = useChatStore((s) => s.setMaxHistoryMessages)
  const uiFontSizeScale = useWikiStore((s) => s.uiFontSizeScale)
  const setUiFontSizeScale = useWikiStore((s) => s.setUiFontSizeScale)
  const uiFontFamily = useWikiStore((s) => s.uiFontFamily)
  const setUiFontFamily = useWikiStore((s) => s.setUiFontFamily)
  const visualStyle = useWikiStore((s) => s.visualStyle)
  const setVisualStyle = useWikiStore((s) => s.setVisualStyle)
  const sidebarNavConfig = useWikiStore((s) => s.sidebarNavConfig)
  const setSidebarNavConfig = useWikiStore((s) => s.setSidebarNavConfig)

  const [active, setActive] = useState<CategoryId>("llm")
  const [saved, setSaved] = useState(false)
  const [draft, setDraftState] = useState<SettingsDraft>(() =>
    initialDraft(
      llmConfig,
      embeddingConfig,
      rerankConfig,
      multimodalConfig,
      outputLanguage,
      proxyConfig,
      scheduledImportConfig,
      sourceWatchConfig,
      revisionFeedbackWindowConfig,
      novelConfig,
      maxHistoryMessages,
      i18n.language,
      uiFontSizeScale,
      uiFontFamily,
      visualStyle,
      sidebarNavConfig,
      project?.path,
    ),
  )

  useEffect(() => {
    if (!activeSettingsCategory) return
    if (CATEGORIES.some((category) => category.id === activeSettingsCategory)) {
      setActive(activeSettingsCategory)
    }
    setActiveSettingsCategory(null)
  }, [activeSettingsCategory, setActiveSettingsCategory])

  useEffect(() => {
    let cancelled = false
    loadSourceWatchConfig(project?.id).then((config) => {
      if (cancelled) return
      const normalized = normalizeSourceWatchConfig(config)
      setSourceWatchConfig(normalized)
      setDraftState((prev) => ({ ...prev, sourceWatchConfig: normalized }))
    }).catch(() => {
      if (cancelled) return
      const fallback = normalizeSourceWatchConfig()
      setSourceWatchConfig(fallback)
      setDraftState((prev) => ({ ...prev, sourceWatchConfig: fallback }))
    })
    return () => {
      cancelled = true
    }
  }, [project?.id, setSourceWatchConfig])

  useEffect(() => {
    let cancelled = false
    loadNovelConfig(project?.id, project?.path).then((config) => {
      if (cancelled || !config) return
      setNovelConfig(config)
      setDraftState((prev) => ({ ...prev, novelConfig: config }))
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [project?.id, project?.path, setNovelConfig])

  useEffect(() => {
    let cancelled = false
    loadRerankConfig(project?.id, project?.path).then((config) => {
      if (cancelled || !config) return
      setRerankConfig(config)
      setDraftState((prev) => ({ ...prev, rerankConfig: config }))
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [project?.id, project?.path, setRerankConfig])

  // Resync draft from store if it changes out-of-band (e.g. project switch).
  // IMPORTANT: keep the current draft.uiLanguage instead of re-reading
  // `i18n.language`. handleSave calls multiple zustand setters before it
  // calls `i18n.changeLanguage` at the end, and each setter triggers this
  // effect mid-save — which used to clobber the user's pending language
  // pick with the still-stale `i18n.language`. The next save would then
  // see draft.uiLanguage out of sync with i18n.language and silently
  // revert the UI to the previous language.
  useEffect(() => {
    setDraftState((prev) =>
      initialDraft(
        llmConfig,
        embeddingConfig,
        rerankConfig,
        multimodalConfig,
        outputLanguage,
        proxyConfig,
        scheduledImportConfig,
        sourceWatchConfig,
        revisionFeedbackWindowConfig,
        novelConfig,
        maxHistoryMessages,
        prev.uiLanguage,
        uiFontSizeScale,
        uiFontFamily,
        visualStyle,
        sidebarNavConfig,
        project?.path,
      ),
    )
  }, [
    llmConfig,
    embeddingConfig,
    rerankConfig,
    multimodalConfig,
    outputLanguage,
    proxyConfig,
    scheduledImportConfig,
    sourceWatchConfig,
    revisionFeedbackWindowConfig,
    novelConfig,
    maxHistoryMessages,
    uiFontSizeScale,
    uiFontFamily,
    visualStyle,
    sidebarNavConfig,
    project,
  ])

  const setDraft: DraftSetter = useCallback((key, value) => {
    setDraftState((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSave = useCallback(async () => {
    const {
      saveLlmConfig,
      saveEmbeddingConfig,
      saveRerankConfig,
      saveMultimodalConfig,
      saveProxyConfig,
      saveScheduledImportConfig,
      saveSourceWatchConfig,
      saveRevisionFeedbackWindowConfig,
      saveNovelConfig,
      saveDefaultLlmModel,
      saveOutputLanguage,
      saveMaxHistoryMessages,
      saveUiFontSizeScale,
      saveUiFontFamily,
      saveVisualStyle,
    } = await import("@/lib/project-store")

    const newLlm = {
      provider: draft.provider,
      apiKey: draft.apiKey,
      model: draft.model,
      ollamaUrl: draft.ollamaUrl,
      customEndpoint: draft.customEndpoint,
      azureApiVersion: draft.provider === "azure" ? draft.azureApiVersion.trim() : undefined,
      azureModelFamily: draft.provider === "azure" ? draft.azureModelFamily : undefined,
      maxContextSize: draft.maxContextSize,
      apiMode: draft.provider === "custom" ? draft.apiMode : undefined,
      reasoning: draft.reasoning,
      localCliIsolation: draft.localCliIsolation,
    }
    const newEmbed = {
      enabled: draft.embeddingEnabled,
      endpoint: draft.embeddingEndpoint,
      apiKey: draft.embeddingApiKey,
      model: draft.embeddingModel,
      outputDimensionality: draft.embeddingOutputDimensionality,
      maxChunkChars: draft.embeddingMaxChunkChars,
      overlapChunkChars: draft.embeddingOverlapChunkChars,
    }
    const newRerank = {
      ...draft.rerankConfig,
      apiMode: draft.rerankConfig.provider === "custom" ? draft.rerankConfig.apiMode : undefined,
      maxCandidates: Math.max(3, Math.min(30, draft.rerankConfig.maxCandidates || 12)),
    }
    const newMultimodal = {
      enabled: draft.multimodalEnabled,
      useMainLlm: draft.multimodalUseMainLlm,
      provider: draft.multimodalProvider,
      apiKey: draft.multimodalApiKey,
      model: draft.multimodalModel,
      ollamaUrl: draft.multimodalOllamaUrl,
      customEndpoint: draft.multimodalCustomEndpoint,
      azureApiVersion: draft.multimodalProvider === "azure" ? draft.multimodalAzureApiVersion.trim() : undefined,
      azureModelFamily: draft.multimodalProvider === "azure" ? draft.multimodalAzureModelFamily : undefined,
      apiMode: draft.multimodalProvider === "custom" ? draft.multimodalApiMode : undefined,
      // Clamp at save time so a hand-edited persisted store with a
      // ridiculous concurrency value (e.g. someone setting 1000 in
      // the JSON) doesn't blow up the captioning pipeline. Caption
      // calls already share the LLM endpoint with everything else;
      // going wider than ~16 just queues behind the server's batch
      // slot.
      concurrency: Math.max(1, Math.min(16, draft.multimodalConcurrency || 4)),
    }

    const newProxy = {
      enabled: draft.proxyEnabled,
      url: draft.proxyUrl.trim(),
      bypassLocal: draft.proxyBypassLocal,
    }

    setLlmConfig(newLlm)
    await saveLlmConfig(newLlm)
    setEmbeddingConfig(newEmbed)
    await saveEmbeddingConfig(newEmbed)
    setRerankConfig(newRerank)
    await saveRerankConfig(newRerank, project?.id, project?.path)
    setMultimodalConfig(newMultimodal)
    await saveMultimodalConfig(newMultimodal)
    setProxyConfig(newProxy)
    await saveProxyConfig(newProxy)
    const newSourceWatch = normalizeSourceWatchConfig(draft.sourceWatchConfig)
    setSourceWatchConfig(newSourceWatch)
    await saveSourceWatchConfig(newSourceWatch, project?.id, project?.path)
    if (project) {
      const { startProjectFileSync, stopProjectFileSync } = await import("@/lib/project-file-sync")
      if (newSourceWatch.enabled) {
        await startProjectFileSync(project, newSourceWatch).catch((err) =>
          console.error("Failed to start project file sync:", err)
        )
      } else {
        await stopProjectFileSync()
      }
    }
    // Apply the proxy env vars LIVE so the next outbound request
    // picks them up — no app restart needed. tauri-plugin-http
    // builds a fresh reqwest client per fetch and reqwest reads
    // env vars at build time, so changing them here is enough.
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core")
        await invoke<string>("set_proxy_env", { config: newProxy })
      }
    } catch (err) {
      console.warn("[settings] live network update failed; restart will still apply:", err)
    }

    const newScheduledImport = {
      enabled: draft.scheduledImportEnabled,
      path: draft.scheduledImportPath,
      interval: Math.max(1, Math.min(1440, draft.scheduledImportInterval || 60)),
      lastScan: scheduledImportConfig.lastScan,
    }
    setScheduledImportConfig(newScheduledImport)
    if (project) {
      await saveScheduledImportConfig(project.path, newScheduledImport)
      const { startScheduledImport, stopScheduledImport } = await import("@/lib/scheduled-import")
      if (
        newScheduledImport.enabled &&
        newScheduledImport.path &&
        newScheduledImport.interval > 0
      ) {
        startScheduledImport(project, newScheduledImport)
      } else {
        stopScheduledImport()
      }
    }

    setRevisionFeedbackWindowConfig(draft.revisionFeedbackWindowConfig)
    await saveRevisionFeedbackWindowConfig(draft.revisionFeedbackWindowConfig, project?.id, project?.path)

    setNovelConfig(draft.novelConfig)
    await saveNovelConfig(draft.novelConfig, project?.id, project?.path)
    await saveDefaultLlmModel(draft.novelConfig.defaultLlmModel)

    setOutputLanguage(draft.outputLanguage)
    await saveOutputLanguage(draft.outputLanguage, project?.id)
    setMaxHistoryMessages(draft.maxHistoryMessages)
    await saveMaxHistoryMessages(draft.maxHistoryMessages, project?.id, project?.path)
    setUiFontSizeScale(draft.uiFontSizeScale)
    await saveUiFontSizeScale(draft.uiFontSizeScale, project?.id, project?.path)
    setUiFontFamily(draft.uiFontFamily)
    await saveUiFontFamily(draft.uiFontFamily)
    setVisualStyle(draft.visualStyle)
    await saveVisualStyle(draft.visualStyle)
    const { applyVisualStyle } = await import("@/lib/visual-style-settings")
    applyVisualStyle(draft.visualStyle)
    setSidebarNavConfig(draft.sidebarNavConfig)

    if (draft.uiLanguage !== i18n.language) {
      await i18n.changeLanguage(draft.uiLanguage)
      await saveLanguage(draft.uiLanguage)
    }

    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [
    draft,
    project,
    setLlmConfig,
    setEmbeddingConfig,
    setRerankConfig,
    setOutputLanguage,
    setProxyConfig,
    setScheduledImportConfig,
    setSourceWatchConfig,
    setRevisionFeedbackWindowConfig,
    setNovelConfig,
    scheduledImportConfig,
    setMaxHistoryMessages,
    outputLanguage,
    setUiFontSizeScale,
    setUiFontFamily,
    setVisualStyle,
    setSidebarNavConfig,
  ])

  const body = useMemo(() => {
    switch (active) {
      case "llm":
        return <LlmProviderSection />
      case "rerank":
        return <RerankSection draft={draft} setDraft={setDraft} />
      case "embedding":
        return <EmbeddingSection draft={draft} setDraft={setDraft} />
      case "network":
        return <NetworkSection draft={draft} setDraft={setDraft} />
      case "mcp":
        return <McpSection />
      case "interface":
        return <InterfaceSection draft={draft} setDraft={setDraft} />
      case "novel":
        return <NovelSection draft={draft} setDraft={setDraft} />
      case "classification":
        return <ClassificationSection projectPath={project?.path ?? undefined} />
      case "usage-guide":
        return <UsageGuideSection />
      case "maintenance":
        return <MaintenanceSection />
      case "data-management":
        return <DataManagementSection />
      case "feedback":
        return <FeedbackSection />
      case "contact-support":
        return <ContactSupportSection />
      case "changelog":
        return <ChangelogSection />
    }
  }, [active, draft, setDraft])

  const showSaveFooter = CATEGORIES_WITH_SAVE_FOOTER.includes(active)

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar — category nav. Matches the IconSidebar's pill-on-accent
          pattern so the two navigational surfaces feel like one app. */}
      <aside className="flex w-56 shrink-0 flex-col border-r bg-brand-50/60">
        <div className="flex items-center gap-1.5 px-4 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-wider">
          <PanelHeaderWithHelp
            title={t("settings.title")}
            helpKey="settings"
            className="cursor-pointer text-muted-foreground transition-colors hover:text-primary"
          />
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {CATEGORIES.map((c) => {
            const Icon = c.icon
            const isActive = c.id === active
            
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActive(c.id)}
                aria-current={isActive ? "page" : undefined}
                className={`group mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "bg-foreground/[0.08] font-medium text-foreground ring-1 ring-border/70"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 transition-colors ${
                    isActive ? "text-primary" : "text-muted-foreground/80 group-hover:text-accent-foreground"
                  }`}
                />
                <span className="flex min-w-0 flex-1 flex-col items-start">
                  <span className="truncate">{t(c.labelKey)}</span>
                  {c.hintKey ? (
                    <span className="truncate text-[10px] leading-tight text-muted-foreground/80">
                      {t(c.hintKey)}
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto max-w-2xl">{body}</div>
        </div>

        {showSaveFooter && (
          <div className="shrink-0 border-t bg-background/80 backdrop-blur px-8 py-3">
            <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
              <p className="text-xs text-muted-foreground">
                {saved ? t("settings.savedTick") : t("settings.changeHint")}
              </p>
              <Button onClick={handleSave}>
                {saved ? t("settings.saved") : t("settings.save")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
