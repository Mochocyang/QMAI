import { useRef, useEffect, useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { BookOpen, Plus, Trash2, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ChatMessage, StreamingMessage } from "./chat-message"
import { setLastQueryPages, useSourceFiles } from "./chat-shared"
import { ChatInput } from "./chat-input"
import { useChatStore, chatMessagesToLLM } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { streamChat, type ChatMessage as LLMMessage } from "@/lib/llm-client"
import { executeIngestWrites } from "@/lib/ingest"
import { routeTask, buildTaskDirective } from "@/lib/novel/task-router"
import { listDirectory, readFile, writeFile, createDirectory, deleteFile } from "@/commands/fs"
import { searchWiki, tokenizeQuery } from "@/lib/search"
import { getNextChapterNumber } from "@/lib/novel/chapter-utils"
import { buildQmQuaiSystemPrompt, injectDeAiDirective } from "@/lib/novel/de-ai-adapter"
import { cleanGeneratedChapterContentForSave } from "@/lib/novel/chapter-content-cleanup"
import { normalizePath, getFileName, getRelativePath } from "@/lib/path-utils"
import { getOutputLanguage, buildLanguageReminder } from "@/lib/output-language"
import { isGreeting } from "@/lib/greeting-detector"
import { computeContextBudget } from "@/lib/context-budget"
import { getConversationTabTitle, sortConversationsByUpdatedAt } from "@/lib/workspace-layout"

function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" })
}

function ConversationTabs() {
  const { t } = useTranslation()
  const novelMode = useWikiStore((s) => s.novelMode)
  const conversations = useChatStore((s) => s.conversations)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const messages = useChatStore((s) => s.messages)
  const createConversation = useChatStore((s) => s.createConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const setActiveConversation = useChatStore((s) => s.setActiveConversation)

  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const sorted = sortConversationsByUpdatedAt(conversations)

  function getMessageCount(convId: string): number {
    return messages.filter((m) => m.conversationId === convId).length
  }

  return (
    <div className="shrink-0 border-b bg-muted/20 px-2 py-2">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-2 rounded-full"
          onClick={() => createConversation()}
        >
          <Plus className="h-3.5 w-3.5" />
          {t(novelMode ? "novel.chat.newChat" : "chat.newChat")}
        </Button>

        {sorted.length === 0 ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {t(novelMode ? "novel.chat.noConversationsYet" : "chat.noConversationsYet")}
          </span>
        ) : (
          sorted.map((conv) => {
            const isActive = conv.id === activeConversationId
            const msgCount = getMessageCount(conv.id)
            return (
              <button
                key={conv.id}
                type="button"
                className={`group flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  isActive
                    ? "border-primary/40 bg-background text-foreground shadow-sm"
                    : "border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                onClick={() => setActiveConversation(conv.id)}
                onMouseEnter={() => setHoveredId(conv.id)}
                onMouseLeave={() => setHoveredId(null)}
                title={conv.title}
              >
                <span className="max-w-[140px] truncate font-medium">
                  {getConversationTabTitle(conv.title, 10)}
                </span>
                <span className="text-[10px] opacity-70">{msgCount}</span>
                <span className="text-[10px] opacity-70">{formatDate(conv.updatedAt)}</span>
                {hoveredId === conv.id && (
                  <span
                    className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteConversation(conv.id)
                      const proj = useWikiStore.getState().project
                      if (proj) {
                        deleteFile(`${proj.path}/.qmai/chats/${conv.id}.json`).catch(() => {})
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

export function ChatPanel() {
  const { t } = useTranslation()
  useSourceFiles() // Keep source file cache warm
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const mode = useChatStore((s) => s.mode)
  const addMessage = useChatStore((s) => s.addMessage)
  const setStreaming = useChatStore((s) => s.setStreaming)
  const appendStreamToken = useChatStore((s) => s.appendStreamToken)
  const finalizeStream = useChatStore((s) => s.finalizeStream)
  const createConversation = useChatStore((s) => s.createConversation)
  const removeLastAssistantMessage = useChatStore((s) => s.removeLastAssistantMessage)
  const maxHistoryMessages = useChatStore((s) => s.maxHistoryMessages)

  // Derive active messages via selector to re-render on message changes
  const allMessages = useChatStore((s) => s.messages)
  const activeMessages = activeConversationId
    ? allMessages.filter((m) => m.conversationId === activeConversationId)
    : []

  const project = useWikiStore((s) => s.project)
  const novelMode = useWikiStore((s) => s.novelMode)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const setFileTree = useWikiStore((s) => s.setFileTree)

  const abortRef = useRef<AbortController | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const soulDialogResolverRef = useRef<((confirmed: boolean) => void) | null>(null)
  const userScrolledUpRef = useRef(false)

  const [chapterSaveStatus, setChapterSaveStatus] = useState<string>("")
  const [isSavingChapter, setIsSavingChapter] = useState(false)
  const [pendingSoulDialog, setPendingSoulDialog] = useState({ open: false, summary: "" })

  const closeSoulDialog = useCallback((confirmed: boolean) => {
    const resolver = soulDialogResolverRef.current
    soulDialogResolverRef.current = null
    setPendingSoulDialog({ open: false, summary: "" })
    resolver?.(confirmed)
  }, [])

  const requestSoulDialog = useCallback((summary: string) => {
    setPendingSoulDialog({ open: true, summary })
    return new Promise<boolean>((resolve) => {
      soulDialogResolverRef.current = resolve
    })
  }, [])

  const handleSaveAsChapter = useCallback(async (content: string) => {
    if (!project) return
    const pp = normalizePath(project.path)
    setIsSavingChapter(true)
    setChapterSaveStatus("")
    try {
      const nextNum = await getNextChapterNumber(pp)
      const paddedNum = String(nextNum).padStart(3, "0")
      const fileName = `chapter-${paddedNum}.md`
      const chapterDir = `${pp}/wiki/chapters`
      await createDirectory(chapterDir)
      const chapterPath = `${chapterDir}/${fileName}`
      const chapterTitle = `第${nextNum}章`
      const cleanedContent = cleanGeneratedChapterContentForSave(content)

      const now = new Date().toISOString().slice(0, 10)
      const frontmatter = [
        "---",
        `type: chapter`,
        `chapter_number: ${nextNum}`,
        `chapter_status: draft`,
        `title: "${chapterTitle}"`,
        `created: ${now}`,
        "---",
        "",
      ].join("\n")
      const fullContent = `${frontmatter}# ${chapterTitle}\n\n${cleanedContent}\n`

      await writeFile(chapterPath, fullContent)

      setChapterSaveStatus(t("chat.savedChapterDraft", { chapter: nextNum, defaultValue: `已保存为第${nextNum}章草稿` }))

      const tree = await listDirectory(pp)
      useWikiStore.getState().setFileTree(tree)
      useWikiStore.getState().bumpDataVersion()

      // 自动跳转到刚保存的章节
      useWikiStore.getState().setActiveView("wiki")
      useWikiStore.getState().setSelectedFile(chapterPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setChapterSaveStatus(t("chat.saveFailed", { message }))
    } finally {
      setIsSavingChapter(false)
    }
  }, [project])

  // Auto-scroll to bottom when messages change or streaming content updates
  // But stop if user manually scrolled up
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    if (!userScrolledUpRef.current) {
      container.scrollTop = container.scrollHeight
    }
  }, [activeMessages, streamingContent])

  // Detect user scroll: if user scrolls up, stop auto-scroll; if at bottom, resume
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const handleScroll = () => {
      const threshold = 50
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold
      userScrolledUpRef.current = !atBottom
    }
    container.addEventListener("scroll", handleScroll)
    return () => container.removeEventListener("scroll", handleScroll)
  }, [])

  // Reset scroll lock when streaming ends or conversation changes
  useEffect(() => {
    if (!isStreaming) {
      userScrolledUpRef.current = false
    }
  }, [isStreaming])

  useEffect(() => {
    userScrolledUpRef.current = false
  }, [activeConversationId])

  const handleSend = useCallback(
    async (text: string) => {
      // Auto-create a conversation if none is active
      let convId = useChatStore.getState().activeConversationId
      if (!convId) {
        convId = createConversation()
      }

      addMessage("user", text)
      setStreaming(true)

      // Build system prompt with wiki context using graph-enhanced retrieval
      const systemMessages: LLMMessage[] = []
      let queryRefs: { title: string; path: string }[] = []
      let langReminder: string | undefined
      const taskRoute = novelMode ? routeTask(text) : null
      const shouldUseQmQuaiSkill = taskRoute != null && (
        taskRoute.intent === "write_chapter" ||
        taskRoute.intent === "continue_chapter" ||
        taskRoute.intent === "rewrite_chapter"
      )
      const qmQuaiSystemPrompt = shouldUseQmQuaiSkill ? buildQmQuaiSystemPrompt() : ""
      // Pure greetings ("hi", "你好", "嗨") don't warrant running the whole
      // retrieval pipeline — it's slow, costs context, and drags in random
      // wiki pages the user clearly didn't ask about. Short-circuit with a
      // minimal system prompt and let the model reply conversationally.
      const greetingOnly = isGreeting(text)
      if (project && greetingOnly) {
        const outLang = getOutputLanguage(text)
        systemMessages.push({
          role: "system",
          content: [
            `你是项目「${project.name}」的资料库问答助手。`,
            "用户只是打了一个招呼，请用一两句话自然简短地回应。",
            "不要编造资料库内容，也不要假装已经检索过页面。如果用户想查询资料，请引导用户提出一个具体问题。",
            "",
            `请使用 ${outLang} 回复。`,
          ].join("\n"),
        })
        // Skip retrieval; queryRefs stays empty so no "Sources" chip is shown.
      } else if (project) {
        const pp = normalizePath(project.path)
        const dataVersion = useWikiStore.getState().dataVersion

        // ── Budget allocation (see context-budget.ts) ─────────
        // Page budget scales with the LLM's context window; we now
        // also reserve ~15% as headroom for the response so the
        // model isn't truncated mid-sentence on a packed prompt.
        const {
          indexBudget: INDEX_BUDGET,
          pageBudget: PAGE_BUDGET,
          maxPageSize: MAX_PAGE_SIZE,
        } = computeContextBudget(llmConfig.maxContextSize)

        const [rawIndex, purpose] = await Promise.all([
          readFile(`${pp}/wiki/index.md`).catch(() => ""),
          readFile(`${pp}/purpose.md`).catch(() => ""),
        ])

        // ── Phase 1: Tokenized search → top 10 ────────────────
        const searchResults = await searchWiki(pp, text, {
          rerank: true,
          topK: 10,
          rerankPurpose: "用于聊天问答时挑选最值得注入上下文的知识页面。",
        })
        const topSearchResults = searchResults.slice(0, 10)

        // ── Trim index by relevance if over budget ─────────────
        let index = rawIndex
        if (rawIndex.length > INDEX_BUDGET) {
          const tokens = tokenizeQuery(text)
          const lines = rawIndex.split("\n")
          const keptLines: string[] = []
          let keptSize = 0

          for (const line of lines) {
            const isHeader = line.startsWith("##")
            const lower = line.toLowerCase()
            const isRelevant = tokens.some((t) => lower.includes(t))

            if (isHeader || isRelevant) {
              if (keptSize + line.length + 1 <= INDEX_BUDGET) {
                keptLines.push(line)
                keptSize += line.length + 1
              }
            }
          }
          index = keptLines.join("\n")
          if (index.length < rawIndex.length) {
            index += "\n\n[...index trimmed to relevant entries...]"
          }
        }

        // ── Phase 2: Graph 1-level expansion ───────────────────
        // Note: Vector search (if enabled) is already merged into searchResults
        // by searchWiki() in search.ts — no duplicate code needed here.
        const { buildRetrievalGraph, getRelatedNodes } = await import("@/lib/graph-relevance")
        const graph = await buildRetrievalGraph(pp, dataVersion)
        const expandedIds = new Set<string>()
        const searchHitPaths = new Set(topSearchResults.map((r) => r.path))
        const graphExpansions: { title: string; path: string; relevance: number }[] = []

        for (const result of topSearchResults) {
          const fileName = getFileName(result.path)
          const nodeId = fileName.replace(/\.md$/, "")
          const related = getRelatedNodes(nodeId, graph, 3)
          for (const { node, relevance } of related) {
            if (relevance < 2.0) continue
            if (searchHitPaths.has(node.path)) continue
            if (expandedIds.has(node.id)) continue
            expandedIds.add(node.id)
            graphExpansions.push({ title: node.title, path: node.path, relevance })
          }
        }
        graphExpansions.sort((a, b) => b.relevance - a.relevance)

        // ── Phase 3 & 4: Page budget control ───────────────────
        let usedChars = 0
        type PageEntry = { title: string; path: string; content: string; priority: number }
        const relevantPages: PageEntry[] = []

        const tryAddPage = async (title: string, filePath: string, priority: number): Promise<boolean> => {
          if (usedChars >= PAGE_BUDGET) return false
          try {
            const raw = await readFile(filePath)
            const relativePath = getRelativePath(filePath, pp)
            const truncated = raw.length > MAX_PAGE_SIZE
              ? raw.slice(0, MAX_PAGE_SIZE) + "\n\n[...truncated...]"
              : raw
            if (usedChars + truncated.length > PAGE_BUDGET) return false
            usedChars += truncated.length
            relevantPages.push({ title, path: relativePath, content: truncated, priority })
            return true
          } catch { return false }
        }

        // P0: Title matches
        for (const r of topSearchResults.filter((r) => r.titleMatch)) {
          await tryAddPage(r.title, r.path, 0)
        }
        // P1: Content matches
        for (const r of topSearchResults.filter((r) => !r.titleMatch)) {
          await tryAddPage(r.title, r.path, 1)
        }
        // P2: Graph expansions
        for (const exp of graphExpansions) {
          await tryAddPage(exp.title, exp.path, 2)
        }
        // P3: Overview fallback
        if (relevantPages.length === 0) {
          await tryAddPage("Overview", `${pp}/wiki/overview.md`, 3)
        }

        const pagesContext = relevantPages.length > 0
          ? relevantPages.map((p, i) =>
              `### [${i + 1}] ${p.title}\nPath: ${p.path}\n\n${p.content}`
            ).join("\n\n---\n\n")
          : "(No wiki pages found)"

        const pageList = relevantPages.map((p, i) =>
          `[${i + 1}] ${p.title} (${p.path})`
        ).join("\n")

        const outLang = getOutputLanguage(text)

        let novelContextPreamble = ""
        if (novelMode && project && taskRoute) {
          try {
            const taskDirective = buildTaskDirective(taskRoute)
            const { buildContextPack, contextPackToPrompt } = await import("@/lib/novel/context-engine")
            const contextPack = await buildContextPack(pp, text, taskRoute.chapterNumber)
            if (contextPack.characterAuras.trim()) {
              const confirmed = await requestSoulDialog(contextPack.characterAuras)
              if (!confirmed) {
                finalizeStream("已取消本次生成，角色灵魂上下文未发送给模型。", undefined)
                abortRef.current = null
                return
              }
            }
            const novelConfig = useWikiStore.getState().novelConfig
            const budget = novelConfig.contextTokenBudget > 0 ? novelConfig.contextTokenBudget : undefined
            novelContextPreamble = contextPackToPrompt(contextPack, budget)
            if (taskDirective) {
              novelContextPreamble = taskDirective + "\n" + novelContextPreamble
            }
          } catch {}
        }

        systemMessages.push({
          role: "system",
          content: [
            qmQuaiSystemPrompt ? `## QM-QUAI 技能\n${qmQuaiSystemPrompt}` : "",
            novelMode
              ? "你是一个专业的小说写作助手。请根据提供的小说上下文包和章节内容，协助用户进行小说创作。"
              : "你是一个专业的资料库问答助手。请基于下方提供的资料内容回答问题。",
            "",
            novelMode
              ? [
                  "## 小说章节输出规则",
                  "- 如果用户要求生成、续写或改写章节，只输出可直接放入章节库的小说正文。",
                  "- 不要输出资料说明、创作说明、免责声明、后续建议、引用列表或隐藏 cited 注释。",
                  "- 不要在小说正文里写 [[资料名]]、[1]、[2] 这类资料引用标记。",
                  "- 资料只作为内部参考，不能把资料库缺失、基于现有资料等元信息写进章节。",
                ].join("\n")
              : "",
            "",
            novelMode
              ? [
                  "## 规则",
                  "- 只能基于下方小说资料、上下文包和用户要求创作，不要编写解释性回答。",
                  "- 如果资料不足，也要根据已有小说上下文自然续写，不要把“资料不足”写进正文。",
                ].join("\n")
              : [
                  "## 规则",
                  "- 只能基于下方编号资料页面回答。",
                  "- 如果资料不足，请直接说明资料不足。",
                  "- 引用资料页面时使用 [[页面名]] 格式。",
                  "- 引用具体信息时使用页码标记，例如 [1]、[2]。",
                  "- 回复末尾必须添加隐藏注释，列出你使用过的资料页码：",
                  "  <!-- cited: 1, 3, 5 -->",
                ].join("\n"),
            "",
            "请使用清晰的 Markdown 格式。",
            "",
            purpose ? `## 资料库目标\n${purpose}` : "",
            index ? `## 资料库索引\n${index}` : "",
            relevantPages.length > 0 ? `## 页面列表\n${pageList}` : "",
            `## 资料页面\n\n${pagesContext}`,
            novelContextPreamble ? `\n${novelContextPreamble}` : "",
            "",
            "---",
            "",
            `## ⚠️ 强制输出语言：${outLang}`,
            "",
            `你的整段回复必须使用 **${outLang}**。`,
            "即使上方资料内容使用其他语言，也不能影响你的回复语言。",
            `请忽略资料原文语言，只使用 ${outLang} 回复。`,
            `必要时，专有名词也应使用 ${outLang} 的常见译法或音译。`,
            "不要使用任何其他语言。本规则优先于其他所有指令。",
          ].filter(Boolean).join("\n"),
        })

        // Reminder injected later, right before the user's current message
        // (after history so it's the last system instruction the LLM sees).
        langReminder = buildLanguageReminder(text)

        // ── Agent mode: append file edit instructions if user has edit intent ──
        if (novelMode && systemMessages.length > 0) {
          const { detectEditIntent, buildAgentSystemSuffix } = await import("@/lib/novel/agent-parser")
          if (detectEditIntent(text)) {
            const lastSys = systemMessages[systemMessages.length - 1]
            if (lastSys && typeof lastSys.content === "string") {
              // 注入文件列表让 AI 知道有哪些文件可以操作
              const { listScopeFiles } = await import("@/lib/novel/agent-tools")
              const files = await listScopeFiles(pp, "chapters")
              const fileListStr = files.map(f => `- ${f.name}`).join("\n")
              lastSys.content += buildAgentSystemSuffix("chapters")
              lastSys.content += `\n\n## 当前章节文件列表\n${fileListStr || "(暂无章节文件)"}`
            }
          }
        }

        const nextQueryPages = relevantPages.map((p) => ({ title: p.title, path: p.path }))
        setLastQueryPages(nextQueryPages)
        queryRefs = [...nextQueryPages]
      }

      // ── Conversation history with count limit ────────────────
      // Only include messages from the active conversation, last N messages
      const activeConvMessages = useChatStore.getState().getActiveMessages()
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-maxHistoryMessages)

      // Prepend the language reminder onto the final user turn rather than
      // inserting a second {role:"system"} between history and the final
      // user message. vLLM / llama.cpp / Ollama drive their chat templates
      // from HF Jinja, and Qwen3-family templates enforce "system only at
      // index 0" — a mid-conversation system message gets rejected with
      // "System message must be at the beginning." (HTTP 400). OpenAI and
      // Anthropic are more lenient, but keeping a single system at the top
      // is the safest shape across every OpenAI-compatible backend.
      const historyMessages = chatMessagesToLLM(activeConvMessages)
      let llmMessages: LLMMessage[] = [...systemMessages, ...historyMessages]
      if (langReminder && historyMessages.length > 0) {
        const lastIdx = llmMessages.length - 1
        const last = llmMessages[lastIdx]
        if (last && last.role === "user") {
          llmMessages = [
            ...llmMessages.slice(0, lastIdx),
            { role: "user", content: `[${langReminder}]\n\n${last.content}` },
          ]
        }
      }

      const conversations = useChatStore.getState().conversations
      const activeConv = conversations.find(c => c.id === activeConversationId)
      const deAiMode = activeConv?.deAiMode ?? false
      if (deAiMode && llmMessages.length > 0) {
        const lastIdx = llmMessages.length - 1
        const last = llmMessages[lastIdx]
        if (last && last.role === "user" && typeof last.content === "string") {
          llmMessages = [
            ...llmMessages.slice(0, lastIdx),
            { role: "user", content: injectDeAiDirective(last.content, deAiMode) },
          ]
        }
      }

      const controller = new AbortController()
      abortRef.current = controller

      let accumulated = ""
      let thinkingOpen = false

      const appendReasoning = (token: string) => {
        if (!token) return
        if (!thinkingOpen) {
          thinkingOpen = true
          accumulated += "<think>"
          appendStreamToken("<think>")
        }
        accumulated += token
        appendStreamToken(token)
      }

      const closeReasoning = () => {
        if (!thinkingOpen) return
        thinkingOpen = false
        accumulated += "</think>"
        appendStreamToken("</think>")
      }

      await streamChat(
        llmConfig,
        llmMessages,
        {
          onToken: (token) => {
            closeReasoning()
            accumulated += token
            appendStreamToken(token)
          },
          onReasoningToken: appendReasoning,
          onDone: () => {
            closeReasoning()
            finalizeStream(accumulated, queryRefs)
            abortRef.current = null
            // save-worthy detection removed — user has direct "Save to Wiki" button on each message
          },
          onError: (err) => {
            finalizeStream(`出错：${err.message}`, undefined)
            abortRef.current = null
          },
        },
        controller.signal,
      )
    },
    [llmConfig, addMessage, setStreaming, appendStreamToken, finalizeStream, createConversation, maxHistoryMessages, requestSoulDialog],
  )

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const handleRegenerate = useCallback(async () => {
    if (isStreaming) return
    // Find the last user message in active conversation
    const active = useChatStore.getState().getActiveMessages()
    const lastUserMsg = [...active].reverse().find((m) => m.role === "user")
    if (!lastUserMsg) return
    // Remove the last assistant reply, then re-send
    removeLastAssistantMessage()
    // Small delay to let state update
    await new Promise((r) => setTimeout(r, 50))
    // Trigger send with the same text (handleSend will add a new user message,
    // so also remove the original to avoid duplication)
    // Actually: just call handleSend — but it adds a user message. To avoid dupe,
    // we remove the last user message too and let handleSend re-add it.
    const store = useChatStore.getState()
    const updatedActive = store.getActiveMessages()
    const lastUser = [...updatedActive].reverse().find((m) => m.role === "user")
    if (lastUser) {
      useChatStore.setState((s) => ({
        messages: s.messages.filter((m) => m.id !== lastUser.id),
      }))
    }
    handleSend(lastUserMsg.content)
  }, [isStreaming, removeLastAssistantMessage, handleSend])

  const handleWriteToWiki = useCallback(async () => {
    if (!project) return
    const pp = normalizePath(project.path)
    try {
      await executeIngestWrites(pp, llmConfig, undefined, undefined)
      try {
        const tree = await listDirectory(pp)
        setFileTree(tree)
      } catch {
        // ignore
      }
    } catch (err) {
      console.error("写入 wiki 失败:", err)
    }
  }, [project, llmConfig, setFileTree])

  const hasAssistantMessages = activeMessages.some((m) => m.role === "assistant")
  const showWriteButton = mode === "ingest" && !isStreaming && hasAssistantMessages

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <ConversationTabs />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!activeConversationId ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="mx-auto mb-3 h-8 w-8 opacity-30" />
              <p className="text-sm">{t(novelMode ? "novel.chat.startNewConversation" : "chat.startNewConversation")}</p>
              <p className="mt-1 text-xs opacity-60">{t(novelMode ? "novel.chat.clickNewChatToBegin" : "chat.clickNewChatToBegin")}</p>
            </div>
          </div>
        ) : (
          <>
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto px-3 py-2"
            >
              <div className="flex flex-col gap-3">
                {activeMessages.map((msg, idx) => {
                  // Check if this is the last assistant message
                  const isLastAssistant = msg.role === "assistant" &&
                    !activeMessages.slice(idx + 1).some((m) => m.role === "assistant")
                  return (
                    <ChatMessage
                      key={msg.id}
                      message={msg}
                      isLastAssistant={isLastAssistant && !isStreaming}
                      onRegenerate={isLastAssistant ? handleRegenerate : undefined}
                      novelMode={novelMode}
                      projectPath={project?.path ?? null}
                      onSaveAsChapter={handleSaveAsChapter}
                      saveStatus={chapterSaveStatus}
                      isSaving={isSavingChapter}
                    />
                  )
                })}
                {isStreaming && <StreamingMessage content={streamingContent} />}
                <div ref={bottomRef} />
              </div>
            </div>

            {showWriteButton && (
              <div className="border-t px-3 py-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleWriteToWiki}
                  className="w-full gap-2"
                >
                  <BookOpen className="h-4 w-4" />
                  {t(novelMode ? "novel.chat.writeToWiki" : "chat.writeToWiki")}
                </Button>
              </div>
            )}
          </>
        )}

        <div className="shrink-0 border-t bg-background">
          <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            isStreaming={isStreaming}
            placeholder={
              mode === "ingest"
                ? t(novelMode ? "novel.chat.ingestPlaceholder" : "chat.ingestPlaceholder")
                : t(novelMode ? "novel.chat.typeAMessage" : "chat.typeAMessage")
            }
          />
        </div>
        <Dialog open={pendingSoulDialog.open} onOpenChange={(open) => { if (!open) closeSoulDialog(false) }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>本次写作将注入角色灵魂上下文</DialogTitle>
              <DialogDescription>
                下列内容会进入本次写作上下文包。角色灵魂会增强人物气质、语言倾向和判断方式，但仍服从大纲、人物小传与当前剧情。
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-72 overflow-y-auto rounded-md border bg-muted/20 p-3 text-xs leading-6 text-muted-foreground whitespace-pre-wrap">
              {pendingSoulDialog.summary}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => closeSoulDialog(false)}>取消本次生成</Button>
              <Button onClick={() => closeSoulDialog(true)}>继续生成</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
