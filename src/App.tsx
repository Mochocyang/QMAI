import { useState, useEffect } from "react"
import i18n from "@/i18n"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { isTauri, pickDirectory } from "@/lib/platform"
import { useChatStore } from "@/stores/chat-store"
import { listDirectory, openProject, fileExists } from "@/commands/fs"
import { getLastProject, saveLastProject, loadLlmConfig, loadAiChatModel, loadDefaultLlmModel, loadLanguage, loadEmbeddingConfig, loadProviderConfigs, loadActivePresetId, loadProxyConfig, loadScheduledImportConfig, saveScheduledImportConfig, loadSourceWatchConfig, loadNovelMode, loadNovelConfig, loadRevisionFeedbackWindowConfig, loadTheme, loadMaxHistoryMessages, loadUiFontFamily, loadVisualStyle, saveLlmConfig, loadLastReadChapter } from "@/lib/project-store"
import { loadReviewItems, loadChatHistory, saveChatHistory, saveReviewItems } from "@/lib/persist"
import { setupAutoSave, teardownAutoSave } from "@/lib/auto-save"
import { checkForAppUpdate } from "@/lib/app-updater"
import { initAnalytics } from "@/lib/analytics"
import { restoreQueue as restoreIngestQueue } from "@/lib/ingest-queue"
import { AppLayout } from "@/components/layout/app-layout"
import { WelcomeScreen } from "@/components/project/welcome-screen"
import { CreateProjectDialog } from "@/components/project/create-project-dialog"
import { formatAppTitle } from "@/lib/app-title"
import { resetProjectState } from "@/lib/reset-project-state"
import { LLM_PRESETS } from "@/components/settings/llm-presets"
import { resolveConfig } from "@/components/settings/preset-resolver"
import { toast } from "@/lib/toast"
import type { WikiProject } from "@/types/wiki"
import { applyTheme, watchSystemTheme } from "@/lib/theme-utils"
import { applyUiFontFamily } from "@/lib/font-settings"
import { applyVisualStyle } from "@/lib/visual-style-settings"

function App() {
  const project = useWikiStore((s) => s.project)
  const setProject = useWikiStore((s) => s.setProject)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const uiFontSizeScale = useWikiStore((s) => s.uiFontSizeScale)
  const uiFontFamily = useWikiStore((s) => s.uiFontFamily)
  const visualStyle = useWikiStore((s) => s.visualStyle)
  const communitySummaryError = useWikiStore((s) => s.communitySummaryError)
  const setCommunitySummaryError = useWikiStore((s) => s.setCommunitySummaryError)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.documentElement.style.fontSize = `${Math.round(uiFontSizeScale * 100)}%`
  }, [uiFontSizeScale])

  useEffect(() => {
    applyUiFontFamily(uiFontFamily)
  }, [uiFontFamily])

  useEffect(() => {
    applyVisualStyle(visualStyle)
  }, [visualStyle])

  // 监听社区摘要生成错误，弹窗提示
  useEffect(() => {
    if (communitySummaryError) {
      toast.error(i18n.t("novel.settings.communitySummaryFailed", { message: communitySummaryError }))
      setCommunitySummaryError(null)
    }
  }, [communitySummaryError, setCommunitySummaryError])

  // Set up auto-save once on mount
  useEffect(() => {
    setupAutoSave()

    // 注册 Tauri 窗口关闭前保存
    let unlisten: (() => void) | undefined
    let isClosing = false // 防止递归关闭
    if (isTauri()) {
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        getCurrentWindow().onCloseRequested(async (event) => {
          // 防止递归：close() 会再次触发 onCloseRequested
          if (isClosing) return
          isClosing = true

          // 阻止窗口立即关闭，等待保存完成
          event.preventDefault()

          // 关闭前执行最终保存，防止丢失最后几秒的数据
          const project = useWikiStore.getState().project
          if (project) {
            const chatState = useChatStore.getState()
            if (chatState.conversations.length > 0) {
              await saveChatHistory(
                project.path,
                chatState.conversations,
                chatState.messages,
                chatState.maxHistoryMessages,
              ).catch((err) => console.error("关闭前保存聊天历史失败:", err))
            }
            const reviewState = useReviewStore.getState()
            if (reviewState.items.length > 0) {
              await saveReviewItems(project.path, reviewState.items)
                .catch((err) => console.error("关闭前保存审查项失败:", err))
            }
          }

          // 保存完成后手动关闭窗口
          await getCurrentWindow().close()
        }).then((fn) => { unlisten = fn })
      })
    }

    return () => {
      teardownAutoSave()
      unlisten?.()
    }
  }, [])

  

  // Auto-open last project on startup
  useEffect(() => {
    async function init() {
      try {
        // 先加载和应用主题
        const savedTheme = await loadTheme()
        const themeToUse = savedTheme ?? "system"
        useWikiStore.getState().setTheme(themeToUse)
        applyTheme(themeToUse)
        const savedVisualStyle = await loadVisualStyle()
        const visualStyleToUse = savedVisualStyle ?? useWikiStore.getState().visualStyle
        useWikiStore.getState().setVisualStyle(visualStyleToUse)
        applyVisualStyle(visualStyleToUse)
        const savedUiFontFamily = await loadUiFontFamily()
        if (savedUiFontFamily) {
          useWikiStore.getState().setUiFontFamily(savedUiFontFamily)
          applyUiFontFamily(savedUiFontFamily)
        }

        const savedConfig = await loadLlmConfig()
        if (savedConfig) {
          useWikiStore.getState().setLlmConfig(savedConfig)
        }
        const savedAiChatModel = await loadAiChatModel()
        if (savedAiChatModel) {
          useWikiStore.getState().setAiChatModel(savedAiChatModel)
        }
        const savedDefaultLlmModel = await loadDefaultLlmModel()
        if (savedDefaultLlmModel) {
          useWikiStore.getState().setDefaultLlmModel(savedDefaultLlmModel)
        }
        const savedProviderConfigs = await loadProviderConfigs()
        if (savedProviderConfigs) {
          useWikiStore.getState().setProviderConfigs(savedProviderConfigs)
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
        }
        const savedEmbeddingConfig = await loadEmbeddingConfig()
        if (savedEmbeddingConfig) {
          useWikiStore.getState().setEmbeddingConfig(savedEmbeddingConfig)
        }
        const savedProxy = await loadProxyConfig()
        if (savedProxy) {
          useWikiStore.getState().setProxyConfig(savedProxy)
        }
        const savedLang = await loadLanguage()
        if (savedLang) {
          await i18n.changeLanguage(savedLang)
        }
        const savedNovelMode = await loadNovelMode()
        if (savedNovelMode !== null) {
          useWikiStore.getState().setNovelMode(savedNovelMode)
        }
        const savedMaxHistoryMessages = await loadMaxHistoryMessages()
        if (savedMaxHistoryMessages !== null) {
          useChatStore.getState().setMaxHistoryMessages(savedMaxHistoryMessages)
        }
        const savedRevisionFeedbackWindowConfig = await loadRevisionFeedbackWindowConfig()
        useWikiStore.getState().setRevisionFeedbackWindowConfig(savedRevisionFeedbackWindowConfig)
        const lastProject = await getLastProject()
        if (lastProject) {
          try {
            const proj = await openProject(lastProject.path)
            await handleProjectOpened(proj)
          } catch (err) {
            console.error("打开上次项目失败:", err)
          }
        }
      } catch (err) {
        console.error("应用初始化失败:", err)
      } finally {
        setLoading(false)
        void checkForAppUpdate()
        void initAnalytics()
      }
    }
    init()
  }, [])

  // 监听系统主题变化，当设置为跟随系统时自动切换
  const theme = useWikiStore((s) => s.theme)
  useEffect(() => {
    if (theme === "system") {
      applyTheme("system")
      const unwatch = watchSystemTheme(() => {
        applyTheme("system")
      })
      return unwatch
    } else {
      applyTheme(theme)
    }
  }, [theme])

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
    await resetProjectState()

    setProject(proj)
    useWikiStore.getState().clearTransientTaskState()
    // 默认开启小说模式
    useWikiStore.getState().setNovelMode(true)
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

    // 自动打开最后阅读的章节和AI会话窗口
    try {
      const lastChapterPath = await loadLastReadChapter()
      if (lastChapterPath) {
        const normalizedPath = lastChapterPath.replace(/\\/g, "/")
        if (normalizedPath.includes("/wiki/chapters/")) {
          const exists = await fileExists(lastChapterPath)
          if (exists) {
            setSelectedFile(lastChapterPath)
          }
        }
      }
    } catch (err) {
      console.error("加载最后阅读章节失败:", err)
    }
    useWikiStore.getState().setChatExpanded(true)

    if (isTauri()) {
      try {
        await restoreIngestQueue(proj.id, proj.path)
      } catch (err) {
        console.error("恢复摄取队列失败:", err)
      }
      try {
        const { restoreQueue: restoreDedupQueue } = await import("@/lib/dedup-queue")
        await restoreDedupQueue(proj.id, proj.path)
      } catch (err) {
        console.error("恢复去重队列失败:", err)
      }
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
    } catch (err) {
      console.error("加载定时导入配置失败:", err)
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
    } catch (err) {
      console.error("加载审查项失败:", err)
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
    } catch (err) {
      console.error("加载聊天历史失败:", err)
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
