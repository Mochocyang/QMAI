import { useState, useEffect } from "react"
import i18n from "@/i18n"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { isTauri, pickDirectory } from "@/lib/platform"
import { useChatStore } from "@/stores/chat-store"
import { listDirectory, openProject, fileExists } from "@/commands/fs"
import { getLastProject, getRecentProjects, saveLastProject, loadLlmConfig, loadLanguage, loadEmbeddingConfig, loadProviderConfigs, loadActivePresetId, loadProxyConfig, loadClipServerConfig, loadScheduledImportConfig, saveScheduledImportConfig, loadSourceWatchConfig, loadNovelMode, loadNovelConfig, loadRevisionFeedbackWindowConfig, loadTheme, saveLlmConfig, saveProviderConfigs, saveActivePresetId } from "@/lib/project-store"
import { loadNovelProjectMeta } from "@/lib/novel/project-meta"
import { loadReviewItems, loadChatHistory } from "@/lib/persist"
import { setupAutoSave } from "@/lib/auto-save"
import { startClipWatcher } from "@/lib/clip-watcher"
import { checkForAppUpdate } from "@/lib/app-updater"
import { initAnalytics } from "@/lib/analytics"
import { restoreQueue as restoreIngestQueue } from "@/lib/ingest-queue"
import { AppLayout } from "@/components/layout/app-layout"
import { WelcomeScreen } from "@/components/project/welcome-screen"
import { CreateProjectDialog } from "@/components/project/create-project-dialog"
import { formatAppTitle } from "@/lib/app-title"
import { resetProjectState, resetProjectStores } from "@/lib/reset-project-state"
import { LLM_PRESETS } from "@/components/settings/llm-presets"
import { resolveConfig } from "@/components/settings/preset-resolver"
import { loadEnvLlmDefault } from "@/lib/env-llm-defaults"
import type { WikiProject } from "@/types/wiki"

function App() {
  const project = useWikiStore((s) => s.project)
  const setProject = useWikiStore((s) => s.setProject)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [loading, setLoading] = useState(true)

  // Set up auto-save and clip watcher once on mount
  useEffect(() => {
    setupAutoSave()
    startClipWatcher()
  }, [])

  

  // Auto-open last project on startup
  useEffect(() => {
    async function init() {
      try {
        // 先加载和应用主题
        const savedTheme = await loadTheme()
        if (savedTheme !== null) {
          useWikiStore.getState().setTheme(savedTheme)
          document.documentElement.classList.remove("dark", "deep-blue")
          if (savedTheme === "dark") {
            document.documentElement.classList.add("dark")
          } else if (savedTheme === "deep-blue") {
            document.documentElement.classList.add("deep-blue")
          }
        }

        const envLlmDefault = loadEnvLlmDefault()
        const savedConfig = await loadLlmConfig()
        if (savedConfig) {
          useWikiStore.getState().setLlmConfig(savedConfig)
        } else if (envLlmDefault) {
          useWikiStore.getState().setLlmConfig(envLlmDefault.config)
          await saveLlmConfig(envLlmDefault.config)
        }
        const savedProviderConfigs = await loadProviderConfigs()
        if (savedProviderConfigs) {
          useWikiStore.getState().setProviderConfigs(savedProviderConfigs)
        } else if (envLlmDefault) {
          useWikiStore.getState().setProviderConfigs(envLlmDefault.providerConfigs)
          await saveProviderConfigs(envLlmDefault.providerConfigs)
        }
        const savedActivePreset = await loadActivePresetId()
        if (savedActivePreset) {
          useWikiStore.getState().setActivePresetId(savedActivePreset)
          // Re-resolve the active preset's LlmConfig from (preset defaults
          // + saved overrides). Without this, preset default updates
          // (e.g. a corrected Anthropic model ID shipped in a release)
          // never reach users who are relying on defaults — their stored
          // `llmConfig` snapshot from a previous launch would keep the
          // old value. Overrides still win, so an explicit user choice
          // is preserved.
          const preset = LLM_PRESETS.find((p) => p.id === savedActivePreset)
          if (preset) {
            const currentFallback = useWikiStore.getState().llmConfig
            const override = (savedProviderConfigs ?? {})[savedActivePreset]
            const resolved = resolveConfig(preset, override, currentFallback)
            useWikiStore.getState().setLlmConfig(resolved)
            await saveLlmConfig(resolved)
          }
        } else if (envLlmDefault) {
          useWikiStore.getState().setActivePresetId(envLlmDefault.activePresetId)
          await saveActivePresetId(envLlmDefault.activePresetId)
        }
        const savedEmbeddingConfig = await loadEmbeddingConfig()
        if (savedEmbeddingConfig) {
          useWikiStore.getState().setEmbeddingConfig(savedEmbeddingConfig)
        }
        const savedProxy = await loadProxyConfig()
        if (savedProxy) {
          useWikiStore.getState().setProxyConfig(savedProxy)
        }
        const savedClipServer = await loadClipServerConfig()
        useWikiStore.getState().setClipServerConfig(savedClipServer)
        const savedLang = await loadLanguage()
        if (savedLang) {
          await i18n.changeLanguage(savedLang)
        }
        const savedNovelMode = await loadNovelMode()
        if (savedNovelMode !== null) {
          useWikiStore.getState().setNovelMode(savedNovelMode)
        }
        const savedRevisionFeedbackWindowConfig = await loadRevisionFeedbackWindowConfig()
        useWikiStore.getState().setRevisionFeedbackWindowConfig(savedRevisionFeedbackWindowConfig)
        const lastProject = await getLastProject()
        if (lastProject) {
          try {
            const proj = await openProject(lastProject.path)
            await handleProjectOpened(proj)
          } catch {
            // Last project no longer valid
          }
        }
      } catch {
        // ignore init errors
      } finally {
        setLoading(false)
        void checkForAppUpdate()
        void initAnalytics()
      }
    }
    init()
  }, [])

  useEffect(() => {
    const title = formatAppTitle(project?.name)
    document.title = title
    if (isTauri()) {
      import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
        .catch(() => {})
    }
  }, [project?.name])

  async function handleProjectOpened(proj: WikiProject) {
    if (isTauri()) {
      await resetProjectState()
    } else {
      resetProjectStores()
    }

    setProject(proj)
    useWikiStore.getState().clearTransientTaskState()
    const projectNovelMeta = await loadNovelProjectMeta(proj.path)
    const hasNovelStructure = await fileExists(`${proj.path}/wiki/chapters`)
    const projectNovelMode = await loadNovelMode(proj.id, proj.path)
    if (projectNovelMode !== null) {
      useWikiStore.getState().setNovelMode(projectNovelMode)
    } else if (projectNovelMeta?.novelMode || hasNovelStructure) {
      useWikiStore.getState().setNovelMode(true)
    }
    const projectNovelConfig = await loadNovelConfig(proj.id, proj.path)
    if (projectNovelConfig) {
      useWikiStore.getState().setNovelConfig(projectNovelConfig)
    }
    const projectRevisionFeedbackWindowConfig = await loadRevisionFeedbackWindowConfig(proj.id, proj.path)
    useWikiStore.getState().setRevisionFeedbackWindowConfig(projectRevisionFeedbackWindowConfig)
    setSelectedFile(null)
    setActiveView("wiki")
    useWikiStore.getState().bumpDataVersion()
    await saveLastProject(proj)

    if (isTauri()) {
      try {
        await restoreIngestQueue(proj.id, proj.path)
      } catch (err) {
        console.error("恢复摄取队列失败:", err)
      }
      import("@/lib/dedup-queue").then(({ restoreQueue }) => {
        restoreQueue(proj.id, proj.path).catch((err) =>
          console.error("恢复去重队列失败:", err)
        )
      })
    }

    try {
      const savedScheduledImport = await loadScheduledImportConfig(proj.path)
      if (savedScheduledImport) {
        let path = savedScheduledImport.path
        if (path && !path.startsWith("/") && !path.match(/^[a-zA-Z]:[/\\]/)) {
          path = `${proj.path}/${path}`
        }
        useWikiStore.getState().setScheduledImportConfig({
          ...savedScheduledImport,
          path,
        })
      } else {
        useWikiStore.getState().setScheduledImportConfig({
          enabled: false,
          path: `${proj.path}/raw/sources`,
          interval: 60,
          lastScan: null,
        })
      }
    } catch {
      // ignore
    }

    if (isTauri()) {
      const scheduledImportConfig = useWikiStore.getState().scheduledImportConfig
      if (scheduledImportConfig.enabled && scheduledImportConfig.path && scheduledImportConfig.interval > 0) {
        import("@/lib/scheduled-import").then(({ startScheduledImport }) => {
          startScheduledImport(proj, scheduledImportConfig)
        }).catch((err) =>
          console.error("启动定时导入失败:", err)
        )
      }

      import("@/lib/project-file-sync").then(async ({ startProjectFileSync, stopProjectFileSync }) => {
        const config = await loadSourceWatchConfig(proj.id, proj.path)
        useWikiStore.getState().setSourceWatchConfig(config)
        if (config.enabled) {
          startProjectFileSync(proj, config).catch((err) =>
            console.error("启动项目文件同步失败:", err)
          )
        } else {
          stopProjectFileSync().catch(() => {})
        }
      }).catch((err) => console.error("配置项目文件同步失败:", err))

      import("@/commands/clip-server").then(({ getClipServerUrl }) => {
        const clipServerConfig = useWikiStore.getState().clipServerConfig
        if (!clipServerConfig.enabled) return
        const url = getClipServerUrl(clipServerConfig)
        fetch(`${url}/project`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: proj.path }),
        }).catch(() => {})

        getRecentProjects().then((recents) => {
          const projects = recents.map((p) => ({ name: p.name, path: p.path }))
          fetch(`${url}/projects`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projects }),
          }).catch(() => {})
        }).catch(() => {})
      }).catch(() => {})
    }

    try {
      const tree = await listDirectory(proj.path)
      setFileTree(tree)
    } catch (err) {
      console.error("加载文件树失败:", err)
    }
    try {
      const savedReview = await loadReviewItems(proj.path)
      if (savedReview.length > 0) {
        useReviewStore.getState().setItems(savedReview)
      }
    } catch {
      // ignore, start fresh
    }
    try {
      const savedChat = await loadChatHistory(proj.path)
      if (savedChat.conversations.length > 0) {
        useChatStore.getState().setConversations(savedChat.conversations)
        useChatStore.getState().setMessages(savedChat.messages)
        const sorted = [...savedChat.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
        if (sorted[0]) {
          useChatStore.getState().setActiveConversation(sorted[0].id)
        }
      }
    } catch {
      // ignore, start fresh
    }
  }

  async function handleSelectRecent(proj: WikiProject) {
    try {
      const validated = await openProject(proj.path)
      await handleProjectOpened(validated)
    } catch (err) {
      window.alert(`打开项目失败：${err}`)
    }
  }

  async function handleOpenProject() {
    const path = await pickDirectory()
    if (!path) return
    try {
      const proj = await openProject(path)
      await handleProjectOpened(proj)
    } catch (err) {
      window.alert(`打开项目失败：${err}`)
    }
  }

  async function handleSwitchProject() {
    // Stop scheduled import before switching projects
    import("@/lib/scheduled-import").then(({ stopScheduledImport }) => {
      stopScheduledImport()
    }).catch(() => {})

    // Save current project's scheduled import config before clearing
    const currentProject = useWikiStore.getState().project
    if (currentProject) {
      const currentConfig = useWikiStore.getState().scheduledImportConfig
      saveScheduledImportConfig(currentProject.path, currentConfig).catch(() => {})
    }

    // Clear all per-project state BEFORE flipping back to the welcome screen
    // so old data cannot leak in via any async render pass.
    await resetProjectState()
    setProject(null)
    setFileTree([])
    setSelectedFile(null)
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading...
      </div>
    )
  }

  if (!project) {
    return (
      <>
        <WelcomeScreen
          onCreateProject={() => setShowCreateDialog(true)}
          onOpenProject={handleOpenProject}
          onSelectProject={handleSelectRecent}
        />
        <CreateProjectDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          onCreated={handleProjectOpened}
        />
      </>
    )
  }

  return (
    <>
      <AppLayout onSwitchProject={handleSwitchProject} />
      <CreateProjectDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={handleProjectOpened}
      />
    </>
  )
}

export default App
