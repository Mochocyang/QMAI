import { useState, useEffect } from "react"
import i18n from "@/i18n"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { isTauri, pickDirectory } from "@/lib/platform"
import { useChatStore } from "@/stores/chat-store"
import { useOutlineChatStore } from "@/stores/outline-chat-store"
import { openProject, fileExists } from "@/commands/fs"
import { getLastProject, saveLastProject, loadLlmConfig, loadAiChatModel, loadAiWorkflowMode, loadDefaultLlmModel, loadEmbeddingConfig, loadProviderConfigs, loadActivePresetId, loadProxyConfig, loadNovelMode, loadNovelConfig, loadRevisionFeedbackWindowConfig, loadTheme, loadMaxHistoryMessages, loadUiFontFamily, loadUiBodyFontFamily, loadUiBodyFontPx, loadUiBodyLineHeight, loadUiBodyLetterSpacing, loadUiBodyMarginX, loadUiBodySafeBottom, loadVisualStyle, saveLlmConfig, loadLastReadChapter, loadSearchApiConfig, loadOutlineWorkflowMode, loadAiChatReasoningDepth, loadAiOutlineReasoningDepth } from "@/lib/project-store"
import { loadReviewItems, loadChatHistory, saveChatHistory, saveReviewItems } from "@/lib/persist"
import { initializeAiOutlineModelFromStorage } from "@/lib/ai-outline-model-initialization"
import { setupAutoSave, teardownAutoSave } from "@/lib/auto-save"
import { flushAppState } from "@/lib/web-store"
import { flushPendingChapterSave } from "@/lib/chapter-save-flush"
import { checkForAppUpdate } from "@/lib/app-updater"
import { confirmAppQuit } from "@/components/uitest/models/model-draft-guard"
import { restoreUiTestWorkspace, readUiTestWorkspacePreference } from "@/lib/ui-test-workspace-preferences"
import { UiTestShell } from "@/components/uitest/ui-test-shell"
import { formatAppTitle } from "@/lib/app-title"
import { resetProjectState } from "@/lib/reset-project-state"
import { findLlmPresetById } from "@/components/settings/llm-presets"
import { resolveConfig } from "@/components/settings/preset-resolver"
import { toast } from "@/lib/toast"
import type { WikiProject } from "@/types/wiki"
import { applyTheme, watchSystemTheme } from "@/lib/theme-utils"
import { applyBodyTypography, applyBodyFontFamily, applyUiFontFamily } from "@/lib/font-settings"
import { applyVisualStyle } from "@/lib/visual-style-settings"
import { isChapterPathInProject, normalizePath } from "@/lib/path-utils"
import { useWritingStatsStore } from "@/stores/writing-stats-store"
import { runUserMemoryMaintenance } from "@/lib/user-memory/maintenance"
import { initializeProjectContextCache } from "@/lib/context-hub/context-hub"
import { useEnsureAiChatModel } from "@/lib/ensure-ai-chat-model"

function App() {
  useEnsureAiChatModel()
  const project = useWikiStore((s) => s.project)
  const setProject = useWikiStore((s) => s.setProject)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const uiFontSizeScale = useWikiStore((s) => s.uiFontSizeScale)
  const uiFontFamily = useWikiStore((s) => s.uiFontFamily)
  const uiBodyFontFamily = useWikiStore((s) => s.uiBodyFontFamily)
  const uiBodyFontPx = useWikiStore((s) => s.uiBodyFontPx)
  const uiBodyLineHeight = useWikiStore((s) => s.uiBodyLineHeight)
  const uiBodyLetterSpacing = useWikiStore((s) => s.uiBodyLetterSpacing)
  const uiBodyMarginX = useWikiStore((s) => s.uiBodyMarginX)
  const uiBodySafeBottom = useWikiStore((s) => s.uiBodySafeBottom)
  const visualStyle = useWikiStore((s) => s.visualStyle)
  const communitySummaryError = useWikiStore((s) => s.communitySummaryError)
  const setCommunitySummaryError = useWikiStore((s) => s.setCommunitySummaryError)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  /** 全书正文字数由 writingStatsStore 统一维护（窗口标题与底部状态栏共用）。 */
  const appTitleTotalWordCount = useWritingStatsStore((s) => s.totalChars)
  const [, setShowCreateDialog] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    runUserMemoryMaintenance()
  }, [])

  function isCurrentProject(proj: WikiProject): boolean {
    const current = useWikiStore.getState().project
    if (!current || current.id !== proj.id) return false
    return normalizePath(current.path) === normalizePath(proj.path)
  }

  async function hydrateProjectSideStores(proj: WikiProject): Promise<void> {
    try {
      const savedReview = await loadReviewItems(proj.path)
      if (savedReview.length > 0 && isCurrentProject(proj)) {
        useReviewStore.getState().setItems(savedReview)
      }
    } catch (err) {
      console.warn("[startup] 加载审查项失败:", err)
    }

    try {
      const savedChat = await loadChatHistory(proj.path)
      if (isCurrentProject(proj)) {
        useChatStore.getState().setLoadedRunStates(savedChat.runStates)
        if (savedChat.conversations.length > 0) {
          useChatStore.getState().setConversations(savedChat.conversations)
          useChatStore.getState().setMessages(savedChat.messages)
          const sorted = [...savedChat.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
          if (sorted[0]) {
            useChatStore.getState().setActiveConversation(sorted[0].id)
          }
        }
      }
    } catch (err) {
      console.warn("[startup] 加载聊天历史失败:", err)
    }

    try {
      if (!isCurrentProject(proj)) return
      await useOutlineChatStore.getState().loadFromDisk()
    } catch (err) {
      console.warn("[startup] 加载大纲 AI 对话历史失败:", err)
    }
  }

  async function hydrateProjectBackgroundServices(proj: WikiProject): Promise<void> {
    if (!isTauri()) return
    if (!isCurrentProject(proj)) return

    try {
      const { restoreQueue: restoreDedupQueue } = await import("@/lib/dedup-queue")
      await restoreDedupQueue(proj.id, proj.path)
    } catch (err) {
      console.error("恢复去重队列失败:", err)
    }

    if (!isCurrentProject(proj)) return

    try {
      const {
        restoreForeshadowingCleanupQueue,
      } = await import("@/lib/foreshadowing-cleanup-queue")
      await restoreForeshadowingCleanupQueue(proj.id, proj.path)
    } catch (err) {
      console.error("恢复伏笔清理队列失败:", err)
    }
  }

  async function hydrateDeferredProjectState(proj: WikiProject): Promise<void> {
    await hydrateProjectBackgroundServices(proj)
    if (!isCurrentProject(proj)) return
    await hydrateProjectSideStores(proj)
    if (!isCurrentProject(proj)) return
    // v3 新增：加载技能收藏（全局存储，但需 project path 用于 originProjectPath 标记）
    try {
      const { useFavoriteSkillStore } = await import("@/stores/favorite-skill-store")
      await useFavoriteSkillStore.getState().load(proj.path)
    } catch (err) {
      console.warn("[startup] 加载技能收藏失败:", err)
    }
  }

  useEffect(() => {
    document.documentElement.style.fontSize = `${Math.round(uiFontSizeScale * 100)}%`
  }, [uiFontSizeScale])

  useEffect(() => {
    applyUiFontFamily(uiFontFamily)
  }, [uiFontFamily])

  // 正文字体独立应用：只写 --qmai-body-font-family，不碰界面字体。
  useEffect(() => {
    applyBodyFontFamily(uiBodyFontFamily)
  }, [uiBodyFontFamily])

  /*
   * 正文排版参数：一次写齐 5 个 CSS 变量。
   *
   * 为什么合并成一个 effect 而不是 5 个：它们共用同一个写入函数
   * applyBodyTypography，拆成 5 个 effect 会写 5 次。
   *
   * ── 这个写法各自由什么保证（三种失效模式，别混为一谈）──
   *   1. 字段**漏写**（少一个 key）→ 类型系统保证：参数是必填对象的字段，
   *      少一个就是 TS2345。这是类型系统唯一能保证的一件事。
   *   2. 字段**串味**（lineHeight 配成 uiBodySafeBottom）→ 类型系统**无感**
   *      （五个值都是 number），由界面守卫里的"配对"断言保证。
   *   3. 函数**内部**漏写某条 setProperty → 类型系统同样无感，
   *      由 font-settings.spec.ts 保证。
   *   4. 下面依赖数组**漏项** → 由界面守卫里的依赖数组断言保证。
   * （早先这里写的是"5 个参数是否都被应用由类型系统保证"—— 那样说把
   *  1 和 2/3/4 混作一件事，会让后来者以为覆盖比实际更强。已改正。）
   *
   * 正文字号由「倍数」改为绝对 px：正文自此**不随界面字号缩放**
   * （用户已确认接受）。上限 32px 低于旧模型理论上限 40.5px，
   * 故裁切风险下降。
   */
  useEffect(() => {
    applyBodyTypography({
      fontPx: uiBodyFontPx,
      lineHeight: uiBodyLineHeight,
      letterSpacing: uiBodyLetterSpacing,
      marginX: uiBodyMarginX,
      safeBottom: uiBodySafeBottom,
    })
  }, [uiBodyFontPx, uiBodyLineHeight, uiBodyLetterSpacing, uiBodyMarginX, uiBodySafeBottom])

  useEffect(() => {
    applyVisualStyle("classic")
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
    let isClosing = false // 确认通过后的保存期间，挡住重复的关闭请求
    if (isTauri()) {
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        getCurrentWindow().onCloseRequested(async (event) => {
          // 先同步阻止本次关闭：确认与保存都是异步的，不先阻止窗口会先被销毁。
          event.preventDefault()
          if (isClosing) return
          if (!(await confirmAppQuit())) return
          isClosing = true

          // LLM 模型配置走 app-state 防抖写入；关窗前必须立刻 flush，否则自定义模型会丢失。
          await flushAppState().catch((err) => console.error("关闭前保存应用配置失败:", err))

          // 章节正文自动保存间隔是 3 分钟；关窗前必须把待落盘的那一份写下去，
          // 否则最后几分钟写的字会随窗口一起消失。
          await flushPendingChapterSave().catch((err) => console.error("关闭前保存章节正文失败:", err))

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
                chatState.runStates,
              ).catch((err) => console.error("关闭前保存聊天历史失败:", err))
            }
            const reviewState = useReviewStore.getState()
            if (reviewState.items.length > 0) {
              await saveReviewItems(project.path, reviewState.items)
                .catch((err) => console.error("关闭前保存审查项失败:", err))
            }
          }

          // 保存完成后强制销毁窗口。不能改用 close()：它会再触发一次 close-requested，
          // 而这里已阻止关闭，会变成「永远关不掉」。
          await getCurrentWindow().destroy().catch((err) => console.error("关闭窗口失败:", err))
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
        applyVisualStyle("classic")
        const savedUiFontFamily = await loadUiFontFamily()
        if (savedUiFontFamily) {
          useWikiStore.getState().setUiFontFamily(savedUiFontFamily)
          applyUiFontFamily(savedUiFontFamily)
        }

        // 正文字体与界面字体各自独立读回，缺一不可
        const savedUiBodyFontFamily = await loadUiBodyFontFamily()
        if (savedUiBodyFontFamily) {
          useWikiStore.getState().setUiBodyFontFamily(savedUiBodyFontFamily)
          applyBodyFontFamily(savedUiBodyFontFamily)
        }

        /*
         * 正文排版参数：逐项读回。返回 null 表示"这个键从来没有存过"，
         * 此时保留 store 的默认值（默认值来自 font-settings.ts 的单一来源）。
         * 注意 setUiBodyMarginX(null) 是合法的：它表示"跟随窗口"，
         * 所以这里的判断是"读回值非 null 才写"，而不是"非 null 就用 null"。
         *
         * 正文字号要把**界面字号**传进去：老设置是"界面字号 × 正文倍数"
         * 相乘得到的，迁移时不乘界面字号会让界面 150% 的用户发现正文变小。
         * uiFontSizeScale 就是本组件第 41 行的 selector，可直接用。
         *
         * ⚠ 不要把它加进本 effect 的依赖数组。这个初始化 effect 的依赖是
         * 空的（`}, []`，见文件里 init 那个 effect 的结尾），只跑一次；
         * 加上去会让用户每改一次界面字号就重跑整个初始化（包含
         * openProject 打开上次的项目）。这里的取值是安全的：
         * wiki-store 的 uiFontSizeScale 初值由模块加载期的
         * readStoredUiFontSizeScale() 同步算出，首帧就已经是正确值。
         */
        const savedBodyFontPx = await loadUiBodyFontPx(uiFontSizeScale)
        if (savedBodyFontPx !== null) useWikiStore.getState().setUiBodyFontPx(savedBodyFontPx)
        const savedBodyLineHeight = await loadUiBodyLineHeight()
        if (savedBodyLineHeight !== null) useWikiStore.getState().setUiBodyLineHeight(savedBodyLineHeight)
        const savedBodyLetterSpacing = await loadUiBodyLetterSpacing()
        if (savedBodyLetterSpacing !== null) useWikiStore.getState().setUiBodyLetterSpacing(savedBodyLetterSpacing)
        const savedBodyMarginX = await loadUiBodyMarginX()
        if (savedBodyMarginX !== null) useWikiStore.getState().setUiBodyMarginX(savedBodyMarginX)
        const savedBodySafeBottom = await loadUiBodySafeBottom()
        if (savedBodySafeBottom !== null) useWikiStore.getState().setUiBodySafeBottom(savedBodySafeBottom)

        const savedConfig = await loadLlmConfig()
        if (savedConfig) {
          useWikiStore.getState().setLlmConfig(savedConfig)
        }
        const savedAiChatModel = await loadAiChatModel()
        if (savedAiChatModel) {
          useWikiStore.getState().setAiChatModel(savedAiChatModel)
        }
        await initializeAiOutlineModelFromStorage()
        const savedAiWorkflowMode = await loadAiWorkflowMode()
        if (savedAiWorkflowMode) {
          useWikiStore.getState().setAiWorkflowMode(savedAiWorkflowMode)
        }
        const savedOutlineWorkflowMode = await loadOutlineWorkflowMode()
        if (savedOutlineWorkflowMode) {
          useWikiStore.getState().setOutlineWorkflowMode(savedOutlineWorkflowMode)
        }
        useWikiStore.getState().setAiChatReasoningDepth(await loadAiChatReasoningDepth())
        useWikiStore.getState().setAiOutlineReasoningDepth(await loadAiOutlineReasoningDepth())
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
          const preset = findLlmPresetById(savedActivePreset)
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
        const savedSearchApiConfig = await loadSearchApiConfig()
        if (savedSearchApiConfig) {
          useWikiStore.getState().setSearchApiConfig(savedSearchApiConfig)
        }
        const savedProxy = await loadProxyConfig()
        if (savedProxy) {
          useWikiStore.getState().setProxyConfig(savedProxy)
        }
        await i18n.changeLanguage("zh")
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
        // 启动后检查更新：发现新版本会弹窗询问是否下载安装。
        //
        // 这一行在 26f80ee（"fix(ui): 调整对话输入框与界面资源"）里被误删，
        // 之后 checkForAppUpdate 再无调用者，整个 app-updater 模块被
        // tree-shake 掉 —— v4.0.0 到 v4.1.1 的 6 个版本，用户打开旧版本
        // 都收不到更新提示。回归守卫见 app-updater-wiring.test.ts。
        //
        // 这里刻意不套 UI 测试版的编译期开关：src/lib/ui-test.ts 里那个常量
        // 已硬编码为 true，且 vite.config.ts 没有对应的构建期替换，套上就是
        // 恒假 —— 调用写了也等于没写，而 tsc 与测试都不会报错。
        // 非 Tauri 环境与非 Windows 平台由 checkForAppUpdate 内部自行返回。
        void checkForAppUpdate()
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
    if (!project?.path) {
      useWritingStatsStore.getState().reset()
      return
    }

    let cancelled = false

    // 全书字数与今日写作统计都收在 writingStatsStore 里：窗口标题、目录里的
    // 字数、底部状态栏读的是同一个数字，不再各算一遍（此前是三份独立实现，
    // 口径一旦漂移，三处会显示三个不同的总字数）。
    const loadWritingStats = async () => {
      const stats = useWritingStatsStore.getState()
      await stats.initializeProject(project.path)
      if (cancelled) return
      await stats.refreshTotalChars()
    }

    void loadWritingStats()

    return () => {
      cancelled = true
    }
  }, [dataVersion, project?.path])

  useEffect(() => {
    const title = formatAppTitle(project?.name, appTitleTotalWordCount)
    document.title = title
    if (isTauri()) {
      import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
        .catch(() => {})
    }
  }, [appTitleTotalWordCount, project?.name])

  async function handleProjectOpened(proj: WikiProject) {
    const uiTestPreference = readUiTestWorkspacePreference(proj.id)
    await resetProjectState()
    await initializeProjectContextCache(proj.path)

    setProject(proj)
    useWikiStore.getState().clearTransientTaskState()
    // 默认开启小说模式
    useWikiStore.getState().setNovelMode(true)
    const projectNovelConfig = await loadNovelConfig(proj.id, proj.path)
    if (projectNovelConfig && isCurrentProject(proj)) {
      useWikiStore.getState().setNovelConfig(projectNovelConfig)
    }
    const projectRevisionFeedbackWindowConfig = await loadRevisionFeedbackWindowConfig(proj.id, proj.path)
    if (isCurrentProject(proj)) {
      useWikiStore.getState().setRevisionFeedbackWindowConfig(projectRevisionFeedbackWindowConfig)
    }
    setSelectedFile(null)
    useWikiStore.getState().setFileContent("")
    setActiveView("wiki")
    useWikiStore.getState().setScheduledImportConfig({
      enabled: false,
      path: `${proj.path}/raw/sources`,
      interval: 60,
      lastScan: null,
    })
    useWikiStore.getState().bumpDataVersion()
    await saveLastProject(proj)

    // 自动打开最后阅读的章节和AI会话窗口（必须属于当前项目，避免跨书残留）
    try {
      if (isCurrentProject(proj)) {
        const lastChapterPath = await loadLastReadChapter(proj.id)
        if (
          isCurrentProject(proj) &&
          lastChapterPath &&
          isChapterPathInProject(lastChapterPath, proj.path)
        ) {
          const exists = await fileExists(lastChapterPath)
          if (exists && isCurrentProject(proj)) {
            setSelectedFile(lastChapterPath)
          }
        }
      }
    } catch (err) {
      console.error("加载最后阅读章节失败:", err)
    }
    if (isCurrentProject(proj)) {
      useWikiStore.getState().setChatExpanded(true)
    }

    if (uiTestPreference && isCurrentProject(proj)) {
      await restoreUiTestWorkspace(proj, uiTestPreference)
    }

    // 文件树由新版外壳通过 refreshProjectFileTree 加载；重队列/定时导入/审查/聊天后置 hydration。
    void hydrateDeferredProjectState(proj)
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
    // Clear all per-project state BEFORE flipping back to the welcome screen
    // so old data cannot leak in via any async render pass.
    await resetProjectState()
    setProject(null)
    setFileTree([])
    setSelectedFile(null)
    useWikiStore.getState().setFileContent("")
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        "正在打开…"
      </div>
    )
  }

  return (
    <UiTestShell
      project={project}
      onCreateProject={() => setShowCreateDialog(true)}
      onOpenProject={handleOpenProject}
      onSelectProject={handleSelectRecent}
      onSwitchProject={handleSwitchProject}
      onProjectOpened={handleProjectOpened}
    />
  )
}

export default App
