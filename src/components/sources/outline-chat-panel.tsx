import { useRef, useCallback, useEffect, useMemo } from "react"
import { Send, X, Save, Copy, RefreshCw, FileText, Square, Plus, Trash2 } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { useOutlineChatStore, type OutlineChatMessage } from "@/stores/outline-chat-store"
import { normalizePath } from "@/lib/path-utils"
import { readFile, writeFile, listDirectory, createDirectory, fileExists } from "@/commands/fs"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import ReactMarkdown from "react-markdown"
import { useState } from "react"
import { FileEditPreview } from "@/components/chat/file-edit-preview"

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

async function generateOutlineTitle(content: string): Promise<string> {
  const lines = content.split("\n").filter(l => l.trim())
  for (const line of lines.slice(0, 5)) {
    const headingMatch = line.match(/^#+\s+(.+)/)
    if (headingMatch) return headingMatch[1].trim().slice(0, 20)
    if (line.length > 2 && line.length < 30 && !line.startsWith("-") && !line.startsWith("*")) {
      return line.trim().slice(0, 20)
    }
  }
  return `AI大纲-${new Date().toISOString().slice(0, 10)}`
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

  // Parse for file edits
  const parsed = useMemo(() => {
    if (!displayContent) return { textContent: "", edits: [], hasEdits: false }
    const { parseAgentResponse } = require("@/lib/novel/agent-parser") as typeof import("@/lib/novel/agent-parser")
    return parseAgentResponse(displayContent)
  }, [displayContent])

  const handleApplyEdits = useCallback(async (edits: import("@/lib/novel/agent-parser").FileEditAction[]) => {
    if (!projectPath) return []
    const { applyFileEdits } = await import("@/lib/novel/agent-tools")
    const results = await applyFileEdits(projectPath, edits)
    setEditResults(results)
    setEditApplied(true)
    const { listDirectory } = await import("@/commands/fs")
    const { normalizePath } = await import("@/lib/path-utils")
    const tree = await listDirectory(normalizePath(projectPath))
    useWikiStore.getState().setFileTree(tree)
    useWikiStore.getState().bumpDataVersion()
    return results
  }, [projectPath])

  return (
    <>
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown>{parsed.textContent || displayContent}</ReactMarkdown>
      </div>
      {/* File edit preview */}
      {parsed.hasEdits && !editDismissed && projectPath ? (
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
      {msg.content && !isStreaming ? (
        <div className="mt-2 flex gap-2 border-t pt-2">
          <button onClick={() => void onSaveAsOutline(msg.content)} className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-accent">
            <Save className="h-3 w-3" /> 保存为大纲
          </button>
          <button onClick={() => onCopy(msg.content, msg.id)} className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-accent">
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

  const conversations = useOutlineChatStore((s) => s.conversations)
  const activeConversationId = useOutlineChatStore((s) => s.activeConversationId)
  const streamingContent = useOutlineChatStore((s) => s.streamingContent)
  const isStreaming = useOutlineChatStore((s) => s.isStreaming)
  const createConversation = useOutlineChatStore((s) => s.createConversation)
  const setActiveConversation = useOutlineChatStore((s) => s.setActiveConversation)
  const addMessage = useOutlineChatStore((s) => s.addMessage)
  const replaceLastAssistant = useOutlineChatStore((s) => s.replaceLastAssistant)
  const removeLastMessage = useOutlineChatStore((s) => s.removeLastMessage)
  const deleteConversation = useOutlineChatStore((s) => s.deleteConversation)
  const setStreamingContent = useOutlineChatStore((s) => s.setStreamingContent)
  const setIsStreaming = useOutlineChatStore((s) => s.setIsStreaming)

  const activeConv = conversations.find((c) => c.id === activeConversationId)
  const activeMessages = activeConv?.messages ?? []

  const [input, setInput] = useState("")
  const [saveStatus, setSaveStatus] = useState("")
  const [copied, setCopied] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  // Auto-scroll
  useEffect(() => {
    const container = scrollRef.current
    if (!container || userScrolledUpRef.current) return
    container.scrollTop = container.scrollHeight
  }, [activeMessages, streamingContent])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const handleScroll = () => {
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50
      userScrolledUpRef.current = !atBottom
    }
    container.addEventListener("scroll", handleScroll)
    return () => container.removeEventListener("scroll", handleScroll)
  }, [])

  const handleSend = useCallback(async () => {
    if (!input.trim() || !project || isStreaming) return
    if (!hasUsableLlm(llmConfig)) return

    let convId = activeConversationId
    if (!convId) {
      convId = createConversation()
    }

    const userMsg: OutlineChatMessage = { id: crypto.randomUUID(), role: "user", content: input.trim() }
    addMessage(convId, userMsg)
    setInput("")
    setIsStreaming(true)
    setStreamingContent("")
    userScrolledUpRef.current = false

    try {
      const { context, sources } = await loadOutlineContext(project.path)
      const allMsgs = [...(useOutlineChatStore.getState().conversations.find(c => c.id === convId)?.messages ?? [])]

      // Agent mode: detect edit intent and add file edit instructions
      const { detectEditIntent, buildAgentSystemSuffix } = await import("@/lib/novel/agent-parser")
      const agentSuffix = detectEditIntent(input.trim()) ? buildAgentSystemSuffix("outlines") : ""
      const { listScopeFiles } = await import("@/lib/novel/agent-tools")
      const files = detectEditIntent(input.trim()) ? await listScopeFiles(project.path, "outlines") : []
      const fileListStr = files.length > 0 ? `\n\n## 当前大纲文件列表\n${files.map(f => `- ${f.name}`).join("\n")}` : ""

      const systemPrompt = `你是一个专业的小说大纲编辑助手。以下是当前小说的大纲和章节内容，请根据用户的问题进行大纲相关的讨论和创作。\n\n${context}${agentSuffix}${fileListStr}`

      const chatMessages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...allMsgs.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      ]

      let result = ""
      const controller = new AbortController()
      abortRef.current = controller

      // Add placeholder assistant message
      addMessage(convId, { id: crypto.randomUUID(), role: "assistant", content: "", sources })

      await streamChat(llmConfig, chatMessages, {
        onToken: (token) => {
          result += token
          setStreamingContent(result)
        },
        onDone: () => {},
        onError: () => {},
      }, controller.signal)

      replaceLastAssistant(convId, result, sources)
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
  }, [input, project, isStreaming, llmConfig, activeConversationId, createConversation, addMessage, replaceLastAssistant, removeLastMessage, setIsStreaming, setStreamingContent])

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
    if (!hasUsableLlm(llmConfig)) return

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
      const systemPrompt = `你是一个专业的小说大纲编辑助手。以下是当前小说的大纲和章节内容，请根据用户的问题进行大纲相关的讨论和创作。\n\n${context}`

      const chatMessages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...targetMessages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      ]

      let result = ""
      const controller = new AbortController()
      abortRef.current = controller

      addMessage(activeConversationId, { id: crypto.randomUUID(), role: "assistant", content: "", sources })

      await streamChat(llmConfig, chatMessages, {
        onToken: (token) => {
          result += token
          setStreamingContent(result)
        },
        onDone: () => {},
        onError: () => {},
      }, controller.signal)

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
  }, [project, isStreaming, llmConfig, activeConversationId, addMessage, replaceLastAssistant, setIsStreaming, setStreamingContent])

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
      const title = await generateOutlineTitle(content)
      const outlinePath = await getUniqueOutlinePath(outlinesDir, title)
      const fileName = outlinePath.split("/").pop()?.replace(/\.md$/, "") ?? title
      const mdContent = `---\ntype: outline\ntitle: "${fileName}"\n---\n\n# ${fileName}\n\n${content}\n`
      await writeFile(outlinePath, mdContent)
      const tree = await listDirectory(pp)
      useWikiStore.getState().setFileTree(tree)
      useWikiStore.getState().bumpDataVersion()
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
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend() } }}
            placeholder="输入关于大纲的问题..."
            disabled={isStreaming}
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-ring disabled:opacity-50"
          />
          {isStreaming ? (
            <button
              onClick={handleStop}
              className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground hover:bg-destructive/90"
              title="停止生成"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={() => void handleSend()}
              disabled={!input.trim()}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
