import { useRef, useCallback, useEffect, useMemo } from "react"
import { X, Save, Copy, RefreshCw, FileText, Plus, Trash2 } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { useOutlineChatStore, type OutlineChatMessage } from "@/stores/outline-chat-store"
import { normalizePath } from "@/lib/path-utils"
import { refreshProjectState } from "@/lib/project-refresh"
import { readFile, writeFile, listDirectory, createDirectory, fileExists } from "@/commands/fs"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import ReactMarkdown from "react-markdown"
import { useState } from "react"
import { FileEditPreview } from "@/components/chat/file-edit-preview"
import { ChatDockControls } from "@/components/chat/chat-dock-controls"
import { TooltipProvider } from "@/components/ui/tooltip"
import { OUTLINE_SECTION_GENERATION_CONFIGS } from "@/lib/novel/outline-generation"
import { prepareOutlineSaveDraft } from "@/lib/outline-save"
import { resolveUserVisibleReasoning } from "@/lib/user-visible-reasoning"
import { runDeepOutlineGeneration } from "@/lib/novel/deep-outline-generation"
import { resolveNovelModel } from "@/lib/novel/model-resolver"
import { createDeepThinkingStreamRenderer } from "@/lib/deep-thinking-stream"
import { ChatInput } from "@/components/chat/chat-input"
import {
  buildWebResearchContext,
  collectWebResearch,
  shouldUseWebResearch,
} from "@/lib/web-research"

async function loadOutlineContext(projectPath: string): Promise<{ context: string; sources: string[] }> {
  const pp = normalizePath(projectPath)
  const sections: string[] = []
  const sources: string[] = []

  try {
    const outlinesDir = `${pp}/wiki/outlines`
    const tree = await listDirectory(outlinesDir)
    for (const file of tree.slice(0, 10)) {
      if (file.name.endsWith(".md")) {
        try {
          const content = await readFile(`${outlinesDir}/${file.name}`)
          const trimmed = content.length > 3000 ? content.slice(0, 3000) + "\n...(已截断)" : content
          sections.push(`【${file.name.replace(/\.md$/, "")}】\n${trimmed}`)
          sources.push(`大纲: ${file.name.replace(/\.md$/, "")}`)
        } catch { /* skip */ }
      }
    }
  } catch { /* no outlines dir */ }

  try {
    const chaptersDir = `${pp}/wiki/chapters`
    const tree = await listDirectory(chaptersDir)
    const chapterFiles = tree.filter(f => f.name.endsWith(".md")).slice(-5)
    for (const file of chapterFiles) {
      try {
        const content = await readFile(`${chaptersDir}/${file.name}`)
        const preview = content.length > 1500 ? content.slice(0, 1500) + "\n...(已截断)" : content
        sections.push(`【章节:${file.name.replace(/\.md$/, "")}】\n${preview}`)
        sources.push(`章节: ${file.name.replace(/\.md$/, "")}`)
      } catch { /* skip */ }
    }
  } catch { /* no chapters dir */ }

  return { context: sections.join("\n\n---\n\n"), sources }
}

async function getUniqueOutlinePath(outlinesDir: string, title: string): Promise<string> {
  const fileName = `${title}.md`
  const firstPath = `${outlinesDir}/${fileName}`
  if (!(await fileExists(firstPath))) return firstPath
  for (let i = 2; i <= 99; i++) {
    const candidate = `${outlinesDir}/${title}-${i}.md`
    if (!(await fileExists(candidate))) return candidate
  }
  return `${outlinesDir}/${title}-${Date.now()}.md`
}

function separateThinking(text: string): { thinking: string | null; answer: string } {
  const thinkParts: string[] = []
  let answer = text.replace(/<(think|thinking)>([\s\S]*?)<\/\1>/gi, (_match, _tag, inner) => {
    thinkParts.push(String(inner).trim())
    return ""
  })

  const openMatch = answer.match(/<(think|thinking)>([\s\S]*)$/i)
  if (openMatch && openMatch.index !== undefined) {
    thinkParts.push(openMatch[2].trim())
    answer = answer.slice(0, openMatch.index)
  }

  return {
    thinking: thinkParts.length > 0 ? thinkParts.filter(Boolean).join("\n\n") : null,
    answer: answer.trim(),
  }
}

function OutlineThinkingBlock({ content, open }: { content: string; open: boolean }) {
  const lines = content.split("\n").filter((line) => line.trim())
  return (
    <div className="mb-2 rounded-md border border-dashed border-amber-500/30 bg-amber-50/50 px-3 py-2 text-xs dark:bg-amber-950/20">
      <div className="mb-1.5 flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
        <span className={open ? "animate-pulse" : undefined}>💭</span>
        <span className="font-medium">{open ? "思考中..." : "思考过程"}</span>
        <span className="text-[10px] text-amber-600/60 dark:text-amber-500/60">{lines.length} 行</span>
      </div>
      <div className="max-h-72 overflow-y-auto border-t border-amber-500/20 pt-2 pr-1 whitespace-pre-wrap break-words font-mono leading-5 text-amber-800/80 dark:text-amber-300/70">
        {content}
      </div>
    </div>
  )
}

function OutlineAssistantMessage({ msg, index, isStreaming, streamingContent, activeMessagesLength, copied, projectPath, onSaveAsOutline, onCopy, onRegenerate }: {
  msg: import("@/stores/outline-chat-store").OutlineChatMessage
  index: number
  isStreaming: boolean
  streamingContent: string
  activeMessagesLength: number
  copied: string | null
  projectPath: string | null
  onSaveAsOutline: (content: string) => Promise<void>
  onCopy: (content: string, id: string) => void
  onRegenerate: (index: number) => Promise<void>
}) {
  const [editApplied, setEditApplied] = useState(false)
  const [editResults, setEditResults] = useState<import("@/lib/novel/agent-tools").FileEditResult[]>([])
  const [editDismissed, setEditDismissed] = useState(false)

  const displayContent = msg.content || (isStreaming && index === activeMessagesLength - 1 ? streamingContent : "")
  const { thinking, answer } = useMemo(() => separateThinking(displayContent), [displayContent])
  const actionContent = answer || displayContent

  // Parse for file edits
  const parsed = useMemo(() => {
    if (!answer) return { textContent: "", edits: [], hasEdits: false }
    const { parseAgentResponse } = require("@/lib/novel/agent-parser") as typeof import("@/lib/novel/agent-parser")
    return parseAgentResponse(answer)
  }, [answer])

  const handleApplyEdits = useCallback(async (edits: import("@/lib/novel/agent-parser").FileEditAction[]) => {
    if (!projectPath) return []
    const { applyFileEdits } = await import("@/lib/novel/agent-tools")
    const results = await applyFileEdits(projectPath, edits)
    setEditResults(results)
    setEditApplied(true)
    await refreshProjectState(projectPath)
    return results
  }, [projectPath])

  return (
    <>
      {thinking ? <OutlineThinkingBlock content={thinking} open={isStreaming} /> : null}
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown>{parsed.textContent || answer}</ReactMarkdown>
      </div>
      {/* File edit preview */}
      {parsed.hasEdits && !editDismissed && projectPath && !isStreaming ? (
        <FileEditPreview
          edits={parsed.edits}
          onApply={handleApplyEdits}
          onDismiss={() => setEditDismissed(true)}
          applied={editApplied}
          results={editResults}
        />
      ) : null}
      {/* Sources */}
      {msg.sources && msg.sources.length > 0 && !isStreaming ? (
        <details className="mt-2 border-t pt-2">
          <summary className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <FileText className="h-3 w-3" />
            引用资料（{msg.sources.length}）
          </summary>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {msg.sources.map((src, si) => <li key={si}>• {src}</li>)}
          </ul>
        </details>
      ) : null}
      {/* Action buttons */}
      {actionContent && !isStreaming ? (
        <div className="mt-2 flex gap-2 border-t pt-2">
          <button onClick={() => void onSaveAsOutline(actionContent)} className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-accent">
            <Save className="h-3 w-3" /> 保存为大纲
          </button>
          <button onClick={() => onCopy(actionContent, msg.id)} className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-accent">
            <Copy className="h-3 w-3" /> {copied === msg.id ? "已复制" : "复制"}
          </button>
          <button onClick={() => void onRegenerate(index)} disabled={isStreaming} className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50">
            <RefreshCw className="h-3 w-3" /> 重新生成
          </button>
        </div>
      ) : null}
    </>
  )
}

export function OutlineChatPanel({ onClose }: { onClose: () => void }) {
  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const novelConfig = useWikiStore((s) => s.novelConfig)

  const conversations = useOutlineChatStore((s) => s.conversations)
  const activeConversationId = useOutlineChatStore((s) => s.activeConversationId)
  const streamingContent = useOutlineChatStore((s) => s.streamingContent)
  const isStreaming = useOutlineChatStore((s) => s.isStreaming)
  const loaded = useOutlineChatStore((s) => s.loaded)
  const createConversation = useOutlineChatStore((s) => s.createConversation)
  const setActiveConversation = useOutlineChatStore((s) => s.setActiveConversation)
  const addMessage = useOutlineChatStore((s) => s.addMessage)
  const replaceLastAssistant = useOutlineChatStore((s) => s.replaceLastAssistant)
  const removeLastMessage = useOutlineChatStore((s) => s.removeLastMessage)
  const deleteConversation = useOutlineChatStore((s) => s.deleteConversation)
  const setStreamingContent = useOutlineChatStore((s) => s.setStreamingContent)
  const setIsStreaming = useOutlineChatStore((s) => s.setIsStreaming)
  const loadFromDisk = useOutlineChatStore((s) => s.loadFromDisk)

  const [inputValue, setInputValue] = useState("")

  // 加载持久化的历史记录
  useEffect(() => {
    if (!loaded) {
      void loadFromDisk()
    }
  }, [loaded, loadFromDisk])

  const activeConv = conversations.find((c) => c.id === activeConversationId)
  const activeMessages = activeConv?.messages ?? []

  const [saveStatus, setSaveStatus] = useState("")
  const [copied, setCopied] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const lastScrollTopRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  // Auto-scroll
  useEffect(() => {
    const container = scrollRef.current
    if (!container || userScrolledUpRef.current) return
    container.scrollTop = container.scrollHeight
    lastScrollTopRef.current = container.scrollTop
  }, [activeMessages, streamingContent])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    lastScrollTopRef.current = container.scrollTop
    const handleScroll = () => {
      const currentScrollTop = container.scrollTop
      const atBottom = container.scrollHeight - currentScrollTop - container.clientHeight < 50
      if (currentScrollTop < lastScrollTopRef.current - 1) {
        userScrolledUpRef.current = true
      } else if (atBottom) {
        userScrolledUpRef.current = false
      }
      lastScrollTopRef.current = currentScrollTop
    }
    container.addEventListener("scroll", handleScroll)
    return () => container.removeEventListener("scroll", handleScroll)
  }, [])

  const handleSend = useCallback(async (inputText: string) => {
    const prompt = inputText.trim()
    if (!prompt || !project || isStreaming) return
    const effectiveLlmConfig = resolveNovelModel(llmConfig, novelConfig, "writing")
    if (!hasUsableLlm(effectiveLlmConfig)) return

    let convId = activeConversationId
    if (!convId) {
      convId = createConversation()
    }

    const userMsg: OutlineChatMessage = { id: crypto.randomUUID(), role: "user", content: prompt }
    addMessage(convId, userMsg)
    setIsStreaming(true)
    setStreamingContent("")
    userScrolledUpRef.current = false

    try {
      const { context, sources } = await loadOutlineContext(project.path)
      let outlineContext = context
      let outlineSources = [...sources]
      if (shouldUseWebResearch(prompt)) {
        const webResearch = await collectWebResearch({
          text: prompt,
          searchApiConfig: useWikiStore.getState().searchApiConfig,
          maxSearchResults: 5,
          maxImportedDocuments: 4,
        })
        const webResearchContext = buildWebResearchContext(webResearch)
        if (webResearchContext.markdown.trim()) {
          outlineContext = [outlineContext, webResearchContext.markdown].filter(Boolean).join("\n\n---\n\n")
        }
        outlineSources = [...outlineSources, ...webResearchContext.sources]
      }
      const allMsgs = [...(useOutlineChatStore.getState().conversations.find(c => c.id === convId)?.messages ?? [])]

      // Agent mode: detect edit intent and add file edit instructions
      const { detectEditIntent, buildAgentSystemSuffix } = await import("@/lib/novel/agent-parser")
      const hasEditIntent = detectEditIntent(prompt)
      const agentSuffix = hasEditIntent ? buildAgentSystemSuffix("outlines") : ""
      let fileListStr = ""
      if (hasEditIntent) {
        const { readScopeFileContents } = await import("@/lib/novel/agent-tools")
        const filesWithContent = await readScopeFileContents(project.path, "outlines")
        fileListStr = filesWithContent.length > 0
          ? `\n\n## 当前大纲文件内容（供修改定位）\n${filesWithContent.map(f => `### ${f.name}\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n")}`
          : "\n\n## 当前大纲文件列表\n(暂无大纲文件)"
      }

      const historyMessages: ChatMessage[] = allMsgs.map(m => ({ role: m.role as "user" | "assistant", content: m.content }))
      let result = ""
      const appendToResult = (token: string) => {
        result += token
        setStreamingContent(result)
      }
      const deepStream = createDeepThinkingStreamRenderer()
      const updateDeepResult = (content: string) => {
        result = content
        setStreamingContent(result)
      }
      const appendThinkingBlock = (content: string) => updateDeepResult(deepStream.updateThinking(content))
      const controller = new AbortController()
      abortRef.current = controller

      // Add placeholder assistant message
      addMessage(convId, { id: crypto.randomUUID(), role: "assistant", content: "", sources: outlineSources })

      if (hasEditIntent) {
        const systemPrompt = `你是一个专业的小说大纲编辑助手。以下是当前小说的大纲、章节内容和用户明确要求检索的网页资料，请根据用户的问题进行大纲相关的讨论和创作。\n\n${outlineContext}${agentSuffix}${fileListStr}`
        const chatMessages: ChatMessage[] = [
          { role: "system", content: systemPrompt },
          ...historyMessages,
        ]

        let thinkingOpen = false
        const appendReasoning = (token: string) => {
          if (!token) return
          if (!thinkingOpen) {
            thinkingOpen = true
            appendToResult("<think>")
          }
          appendToResult(token)
        }
        const closeReasoning = () => {
          if (!thinkingOpen) return
          thinkingOpen = false
          appendToResult("</think>")
        }

        await streamChat(effectiveLlmConfig, chatMessages, {
          onToken: (token) => {
            closeReasoning()
            appendToResult(token)
          },
          onReasoningToken: appendReasoning,
          onDone: () => {
            closeReasoning()
          },
          onError: () => {
            closeReasoning()
          },
        }, controller.signal, { reasoning: resolveUserVisibleReasoning(effectiveLlmConfig.reasoning) })
      } else {
        await runDeepOutlineGeneration(
          {
            llmConfig: effectiveLlmConfig,
            userRequest: prompt,
            context: outlineContext,
            historyMessages,
          },
          {
            onThinking: appendThinkingBlock,
            onFinalContent: (content) => updateDeepResult(deepStream.appendFinal(content)),
          },
          undefined,
          controller.signal,
        )
      }

      replaceLastAssistant(convId, result, outlineSources)
      setStreamingContent("")
    } catch {
      // If aborted, keep partial content
      const partial = useOutlineChatStore.getState().streamingContent
      if (partial) {
        replaceLastAssistant(convId!, partial)
      } else {
        removeLastMessage(convId!)
      }
      setStreamingContent("")
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [project, isStreaming, llmConfig, novelConfig, activeConversationId, createConversation, addMessage, replaceLastAssistant, removeLastMessage, setIsStreaming, setStreamingContent])

  const handleGenerateSection = useCallback((title: string, requestHint: string) => {
    void handleSend(`请继续生成「${title}」。${requestHint} 请基于已有大纲、章节内容和项目记忆直接输出该分项内容，结构清晰，可保存为大纲。`)
  }, [handleSend])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    // Force stop streaming state immediately in case abort doesn't trigger catch
    const partial = useOutlineChatStore.getState().streamingContent
    if (partial && activeConversationId) {
      replaceLastAssistant(activeConversationId, partial)
    }
    setStreamingContent("")
    setIsStreaming(false)
    abortRef.current = null
  }, [activeConversationId, replaceLastAssistant, setStreamingContent, setIsStreaming])

  const handleRegenerate = useCallback(async (msgIndex: number) => {
    if (!project || isStreaming || !activeConversationId) return
    const effectiveLlmConfig = resolveNovelModel(llmConfig, novelConfig, "writing")
    if (!hasUsableLlm(effectiveLlmConfig)) return

    // Remove messages from msgIndex onwards
    const conv = useOutlineChatStore.getState().conversations.find(c => c.id === activeConversationId)
    if (!conv) return
    const targetMessages = conv.messages.slice(0, msgIndex)

    // Update store
    useOutlineChatStore.setState((s) => ({
      conversations: s.conversations.map(c =>
        c.id === activeConversationId ? { ...c, messages: targetMessages } : c
      ),
    }))

    setIsStreaming(true)
    setStreamingContent("")
    userScrolledUpRef.current = false

    try {
      const { context, sources } = await loadOutlineContext(project.path)
      const chatMessages: ChatMessage[] = [
        ...targetMessages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      ]
      const lastUserRequest = [...targetMessages].reverse().find((message) => message.role === "user")?.content ?? "请基于已有大纲重新生成。"

      let result = ""
      const deepStream = createDeepThinkingStreamRenderer()
      const updateDeepResult = (content: string) => {
        result = content
        setStreamingContent(result)
      }
      const appendThinkingBlock = (content: string) => updateDeepResult(deepStream.updateThinking(content))
      const controller = new AbortController()
      abortRef.current = controller

      addMessage(activeConversationId, { id: crypto.randomUUID(), role: "assistant", content: "", sources })

      await runDeepOutlineGeneration(
        {
          llmConfig: effectiveLlmConfig,
          userRequest: lastUserRequest,
          context,
          historyMessages: chatMessages,
        },
        {
          onThinking: appendThinkingBlock,
          onFinalContent: (content) => updateDeepResult(deepStream.appendFinal(content)),
        },
        undefined,
        controller.signal,
      )

      replaceLastAssistant(activeConversationId, result, sources)
      setStreamingContent("")
    } catch {
      const partial = useOutlineChatStore.getState().streamingContent
      if (partial) replaceLastAssistant(activeConversationId, partial)
      setStreamingContent("")
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [project, isStreaming, llmConfig, novelConfig, activeConversationId, addMessage, replaceLastAssistant, setIsStreaming, setStreamingContent])

  const handleCopy = useCallback((content: string, id: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(id)
      setTimeout(() => setCopied(null), 2000)
    }).catch(() => {})
  }, [])

  const handleSaveAsOutline = useCallback(async (content: string) => {
    if (!project) return
    setSaveStatus("保存中...")
    try {
      const pp = normalizePath(project.path)
      const outlinesDir = `${pp}/wiki/outlines`
      await createDirectory(outlinesDir)
      const existingFiles = await listDirectory(outlinesDir).catch(() => [])
      const existingTitles = existingFiles
        .filter((file) => file.name.endsWith(".md"))
        .map((file) => file.name.replace(/\.md$/i, "").trim())
        .filter(Boolean)
      const draft = prepareOutlineSaveDraft(content, existingTitles)
      const outlinePath = await getUniqueOutlinePath(outlinesDir, draft.title)
      const fileName = outlinePath.split("/").pop()?.replace(/\.md$/, "") ?? draft.title
      const body = draft.content.replace(/^#\s+.+(?:\r?\n){1,2}/, "").trim()
      const mdContent = `---\ntype: outline\ntitle: "${fileName}"\n---\n\n# ${fileName}\n\n${body}\n`
      await writeFile(outlinePath, mdContent)
      await refreshProjectState(pp)
      setSaveStatus(`已保存：${fileName}`)
    } catch (err) {
      setSaveStatus(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [project])

  return (
    <div className="flex h-full flex-col border-border bg-background">
      {/* Header with conversation tabs */}
      <div className="flex items-center gap-1 border-b px-2 py-1.5 overflow-x-auto">
        <button
          onClick={() => { createConversation() }}
          className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          title="新建大纲对话"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        {conversations.map((conv) => (
          <button
            key={conv.id}
            onClick={() => setActiveConversation(conv.id)}
            className={`group shrink-0 flex items-center gap-1 rounded px-2 py-1 text-xs ${
              conv.id === activeConversationId ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            <span className="max-w-[100px] truncate">{conv.title}</span>
            <Trash2
              className="h-3 w-3 opacity-0 group-hover:opacity-100 hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id) }}
            />
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {saveStatus && <span className="text-xs text-muted-foreground">{saveStatus}</span>}
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {activeMessages.length === 0 && !isStreaming ? (
          <p className="text-center text-xs text-muted-foreground py-8">
            输入关于大纲的问题或指令，AI 会基于当前大纲和章节内容进行回答和创作。
          </p>
        ) : null}
        {activeMessages.map((msg, i) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
              msg.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground"
            }`}>
              {msg.role === "assistant" ? (
                <OutlineAssistantMessage
                  msg={msg}
                  index={i}
                  isStreaming={isStreaming}
                  streamingContent={streamingContent}
                  activeMessagesLength={activeMessages.length}
                  copied={copied}
                  projectPath={project?.path ?? null}
                  onSaveAsOutline={handleSaveAsOutline}
                  onCopy={handleCopy}
                  onRegenerate={handleRegenerate}
                />
              ) : (
                <span>{msg.content}</span>
              )}
            </div>
          </div>
        ))}
        {isStreaming && streamingContent && activeMessages.length > 0 && activeMessages[activeMessages.length - 1]?.content === "" ? null : (
          isStreaming && streamingContent && activeMessages[activeMessages.length - 1]?.role !== "assistant" ? (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{streamingContent}</ReactMarkdown>
                </div>
              </div>
            </div>
          ) : null
        )}
      </div>

      {/* Input */}
      <div className="border-t px-3 py-2">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {OUTLINE_SECTION_GENERATION_CONFIGS.map((config) => (
            <button
              key={config.key}
              type="button"
              onClick={() => handleGenerateSection(config.title, config.requestHint)}
              disabled={isStreaming}
              className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent disabled:opacity-50"
            >
              {config.title}
            </button>
          ))}
        </div>
      </div>
      <ChatInput
        onSend={(text) => void handleSend(text)}
        onStop={handleStop}
        isStreaming={isStreaming}
        placeholder="输入关于大纲的问题..."
        value={inputValue}
        onChange={setInputValue}
        footerControls={
          <TooltipProvider delay={200}>
            <div className="flex items-center gap-2 flex-nowrap overflow-x-auto">
              <ChatDockControls />
            </div>
          </TooltipProvider>
        }
      />
    </div>
  )
}
