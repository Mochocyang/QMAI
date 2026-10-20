import { readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { applyAgentActivityEvent, resolveAgentStageTitle, settleRunningAgentStages } from "@/lib/agent/activity-trace"
import { applyAgentToolActivityEvent, applyAgentToolEvent, settleRunningAgentToolCalls } from "@/lib/agent/tool-events"
import type { AgentActivityEvent, AgentRunRecord, AgentStageTrace, AgentToolEvent } from "@/lib/agent/types"

export type WritingRunStatus = "running" | "needs_input" | "completed" | "failed" | "cancelled" | "interrupted"
type ProgressStage = Pick<AgentStageTrace, "id" | "title" | "status" | "startedAt" | "finishedAt">
type ProgressTool = Pick<AgentRunRecord["toolCalls"][number], "id" | "parentCallId" | "name" | "status" | "startedAt" | "finishedAt">
export interface WritingProgressIssue {
  kind: "tool_error" | "approval_required" | "input_required" | "error"
  message: string
  toolCallId?: string
}
export interface WritingProgress {
  schemaVersion: 1
  runId: string
  projectPath: string
  conversationId: string
  progressPath: string
  conversationPath: string
  status: WritingRunStatus
  revision: number
  startedAt: number
  updatedAt: number
  finishedAt?: number
  currentStage: ProgressStage | null
  stages: ProgressStage[]
  tools: ProgressTool[]
  issues: WritingProgressIssue[]
  persistenceError?: string
}

export interface WritingProgressIo {
  read(path: string): Promise<string>
  write(path: string, contents: string): Promise<void>
}

const statuses: WritingRunStatus[] = ["running", "needs_input", "completed", "failed", "cancelled", "interrupted"]
const STORAGE_ERROR = "写作进度保存失败；当前查询仍可读取内存进度，磁盘快照可能滞后。"

/** 进度通道只输出错误类别，不转发可能包含请求、正文或凭据的原始异常。 */
export function summarizeWritingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/轮次/.test(message)) return "已达到最大调用轮次，请减少引用内容或拆分任务。"
  if (/上下文|context/i.test(message)) return "模型上下文不足，请缩短输入或调整模型上下文设置。"
  if (/401|403|api.?key|认证|鉴权/i.test(message)) return "模型认证失败，请检查模型配置。"
  if (/429|限流|rate.?limit/i.test(message)) return "模型服务限流，请稍后重试。"
  if (/timeout|超时/i.test(message)) return "写作执行超时。"
  if (/network|fetch|econn|连接|断流|网络|断开/i.test(message)) return "模型连接或网络传输失败。"
  if (/必需工具|必要工具|Required.*tool|未.*调用.*工具/i.test(message)) return "本轮未成功调用必需的写作工具，未完成写作任务。"
  return "写作执行失败，未能完成本轮任务。"
}

function identifier(value: string): string {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : "unknown"
}

function eventId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_:.-]/g, "_").slice(0, 128)
}

export function writingProgressPath(projectPath: string, runId: string): string {
  if (identifier(runId) !== runId) throw new Error("写作任务 runId 无效")
  return `${normalizePath(projectPath)}/.qmai/writing-runs/${runId}.json`
}

function stageView(stage: AgentStageTrace): ProgressStage {
  return {
    id: stage.id, title: stage.id === "preparing" ? "准备写作上下文" : resolveAgentStageTitle(stage.id, "执行阶段"),
    status: stage.status, startedAt: stage.startedAt, finishedAt: stage.finishedAt,
  }
}

function toolView(tool: AgentRunRecord["toolCalls"][number]): ProgressTool {
  return {
    id: tool.id, parentCallId: tool.parentCallId, name: tool.name, status: tool.status,
    startedAt: tool.startedAt, finishedAt: tool.finishedAt,
  }
}

export function createWritingProgressStore(io: WritingProgressIo = { read: readFile, write: writeFileAtomic }) {
  const entries = new Map<string, ReturnType<typeof createEntry>>()

  function createEntry(initial: WritingProgress) {
    let state = initial
    let stages: AgentStageTrace[] = initial.stages.map((stage) => ({ ...stage, summary: "", events: [] }))
    let tools: AgentRunRecord["toolCalls"] = initial.tools.map((tool) => ({ ...tool, params: {}, result: "" }))
    let timer: ReturnType<typeof setTimeout> | undefined
    let queue = Promise.resolve()
    let pendingWrites = 0
    let lastWriteAt = 0
    const listeners = new Set<() => void>()
    const snapshot = (): WritingProgress => structuredClone(state)
    const notify = () => { for (const listener of listeners) listener() }
    function change(update: Partial<WritingProgress>) {
      state = { ...state, ...update, revision: state.revision + 1, updatedAt: Date.now() }
      notify()
    }
    function flush(): Promise<void> {
      if (timer) { clearTimeout(timer); timer = undefined }
      pendingWrites += 1
      const next = queue.then(async () => {
        if (state.persistenceError) change({ persistenceError: undefined })
        const writtenRevision = state.revision
        let succeeded = false
        try {
          await io.write(state.progressPath, JSON.stringify(snapshot(), null, 2))
          succeeded = true
        } catch (error) {
          change({ persistenceError: STORAGE_ERROR })
          throw error
        } finally {
          lastWriteAt = Date.now()
          pendingWrites -= 1
          if (succeeded && pendingWrites === 0 && state.revision !== writtenRevision && state.status === "running") schedule()
        }
      })
      queue = next.catch(() => {})
      return next
    }
    function schedule() {
      if (timer || pendingWrites > 0) return
      timer = setTimeout(() => { void flush().catch(() => {}) }, Math.max(0, lastWriteAt + 1000 - Date.now()))
    }
    function publish() {
      // 归并行为复用 UI；丢弃内容与事件历史，只保留进度字段。
      stages = stages.map((stage) => ({
        ...stageView(stage), summary: "", events: [],
        ...(stage.id === "preparing" && stages.length > 1 && stage.status === "running" ? { status: "done", finishedAt: Date.now() } : {}),
      }))
      const views = stages.map(stageView)
      const currentStage = [...views].reverse().find((stage) => stage.status === "running" || stage.status === "approval_required")
        ?? views[views.length - 1] ?? null
      change({ stages: views, tools: tools.map(toolView), currentStage })
      schedule()
    }
    function issue(value: WritingProgressIssue) {
      change({ issues: [...state.issues, value].slice(-20) })
    }
    return {
      snapshot, flush,
      activity(event: AgentActivityEvent) {
        if (state.status !== "running") return
        stages = applyAgentActivityEvent(stages, {
          ...event, id: eventId(event.id), stageId: identifier(event.stageId),
          title: "执行阶段", content: "", sourceRefs: undefined,
        })
        publish()
      },
      tool(event: AgentToolEvent) {
        if (state.status !== "running") return
        const safe: AgentToolEvent = {
          ...event, name: identifier(event.name), callId: eventId(event.callId),
          parentCallId: event.parentCallId ? eventId(event.parentCallId) : undefined,
          params: {}, result: event.type === "approval_required" ? "需要确认" : "", preview: undefined,
        }
        tools = applyAgentToolEvent(tools, safe).map((tool) => ({
          ...tool, result: "", preview: undefined,
          status: tool.id === safe.callId && event.type === "cancelled" ? "cancelled" : tool.status,
        }))
        stages = applyAgentToolActivityEvent(stages, safe)
        if (event.type === "error" || event.type === "approval_required") {
          issue({ kind: event.type === "error" ? "tool_error" : "approval_required", toolCallId: safe.callId,
            message: event.type === "error" ? `工具 ${safe.name} 执行出错。` : `工具 ${safe.name} 需要用户确认，尚未执行。` })
        }
        publish()
      },
      async finish(status: Exclude<WritingRunStatus, "running">, problem?: WritingProgressIssue) {
        if (state.status !== "running") return
        const now = Date.now()
        const settled = status === "completed" || status === "needs_input" ? "done" : status === "failed" ? "error" : "cancelled"
        stages = settleRunningAgentStages(stages, settled, now) ?? []
        tools = settleRunningAgentToolCalls(tools, settled, now) ?? []
        if (problem) issue(problem)
        const views = stages.map(stageView)
        change({ status, finishedAt: now, stages: views, tools: tools.map(toolView), currentStage: views[views.length - 1] ?? null })
        // 串行队列执行时才获取最新快照，旧的排队写入也不能覆盖终态。
        await flush()
      },
      async wait(afterRevision: number, waitMs: number) {
        if (state.revision !== afterRevision || state.status !== "running" || waitMs === 0) return
        await new Promise<void>((resolve) => {
          const done = () => { clearTimeout(timeout); listeners.delete(done); resolve() }
          const timeout = setTimeout(done, waitMs)
          listeners.add(done)
          if (state.revision !== afterRevision || state.status !== "running") done()
        })
      },
    }
  }

  return {
    async start(input: { projectPath: string; runId: string; conversationId: string }) {
      const projectPath = normalizePath(input.projectPath)
      const path = writingProgressPath(projectPath, input.runId)
      const now = Date.now()
      const stage: ProgressStage = { id: "preparing", title: "准备写作上下文", status: "running", startedAt: now }
      const entry = createEntry({
        schemaVersion: 1, ...input, projectPath, progressPath: path,
        conversationPath: `${projectPath}/.qmai/chats/${input.conversationId}.json`,
        status: "running", revision: 1, startedAt: now, updatedAt: now,
        currentStage: stage, stages: [stage], tools: [], issues: [],
      })
      entries.set(path, entry)
      try { await entry.flush() } catch {
        entries.delete(path)
        throw new Error("无法保存初始写作进度，任务未启动。")
      }
      return entry
    },
    async get(input: { projectPath: string; runId: string; afterRevision?: number; waitMs?: number }) {
      const { afterRevision, waitMs = 0 } = input
      if (afterRevision !== undefined && (!Number.isSafeInteger(afterRevision) || afterRevision < 0)) throw new Error("afterRevision 必须是非负整数")
      if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 30_000) throw new Error("waitMs 必须是 0 到 30000 的整数")
      const path = writingProgressPath(input.projectPath, input.runId)
      let entry = entries.get(path)
      if (!entry) {
        let saved: WritingProgress
        try { saved = JSON.parse(await io.read(path)) as WritingProgress } catch { throw new Error("找不到或无法读取该写作任务的进度") }
        if (saved?.schemaVersion !== 1 || saved.runId !== input.runId || saved.projectPath !== normalizePath(input.projectPath)
          || !statuses.includes(saved.status) || !Number.isSafeInteger(saved.revision)
          || !Array.isArray(saved.stages) || !Array.isArray(saved.tools) || !Array.isArray(saved.issues)) throw new Error("写作进度文件无效")
        entry = createEntry(saved)
        entries.set(path, entry)
        // 本进程没有此任务；磁盘遗留的运行状态来自已结束的应用进程。
        if (saved.status === "running") await entry.finish("interrupted", { kind: "error", message: "任务在软件关闭前未完成，请重新发起。" }).catch(() => {})
      }
      if (afterRevision !== undefined) await entry.wait(afterRevision, waitMs)
      const progress = entry.snapshot()
      return { ...progress, changed: afterRevision === undefined || progress.revision !== afterRevision }
    },
  }
}

export type WritingProgressStore = ReturnType<typeof createWritingProgressStore>
export const writingProgressStore = createWritingProgressStore()
