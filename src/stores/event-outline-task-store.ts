import { create } from "zustand"
import { normalizeComparablePath, normalizePath } from "@/lib/path-utils"
import type { EventOutlineData, EventOutlineRequest } from "@/lib/novel/event-outline"

/**
 * 章节区「生成章节细纲」的一次任务状态。
 *
 * 状态机：generating → awaiting-confirm（等用户确认后扩写成正文）
 *         generating → error
 * 刻意**没有** done/cancelled 这些终态：细纲一旦被确认扩写，它就是那一章的正文来源，
 * 任务本身没有留在卡片区的理由，直接从 store 摘掉（见 removeTask）。
 */
export type EventOutlineTaskStatus = "generating" | "awaiting-confirm" | "error"

export interface EventOutlineTask {
  id: string
  projectPath: string
  /** 这份细纲讲的是第几章。卡片标题与后续「扩写成哪一章」都以它为准。 */
  chapterNumber: number
  request: EventOutlineRequest
  status: EventOutlineTaskStatus
  /** 解析成功的细纲；generating 与 error 时均为 null。 */
  outline: EventOutlineData | null
  /**
   * 已经收到的流式字符数，只用于「正在生成」的进度提示。
   *
   * 只存长度而不是正文：正文可能上万字，而每来一个 token 就写一次 store 会让
   * 整棵章节区重渲染。进度提示只需要一个递增的数字。
   */
  receivedChars: number
  /** 生成失败的原因，或「模型回复里解析不出细纲」的说明。 */
  error: string | null
  createdAt: number
  updatedAt: number
}

interface EventOutlineTaskStartInput {
  projectPath: string
  request: EventOutlineRequest
}

interface EventOutlineTaskState {
  tasks: EventOutlineTask[]
  /** 同项目同章号重开会替换旧任务：同一章同时挂两份细纲卡片没有可用语义。 */
  startTask: (input: EventOutlineTaskStartInput) => string
  appendProgress: (taskId: string, receivedChars: number) => void
  finishTask: (taskId: string, outline: EventOutlineData) => void
  failTask: (taskId: string, error: string) => void
  removeTask: (taskId: string) => void
}

let eventOutlineTaskCounter = 0

function normalizedProjectPath(path: string): string {
  /*
   * 判 Windows 形态要用**剥尾斜杠之前**的串：盘符形如 `C:/`，
   * 先 `.replace(/\/$/, "")` 再判就变成 `C:`，`/^[A-Za-z]:\//` 匹配不上，
   * 于是同一个盘符根目录不会被小写化 —— `C:/Book` 与 `c:/Book` 就成了两个项目。
   * 大小写归一很重要：本 store 的过滤决定了「这本书的细纲会不会出现在另一本书里」。
   *
   * 剥尾斜杠用 normalizeComparablePath：它去掉**全部**尾斜杠（`\/+$`），
   * 而手写 `.replace(/\/$/, "")` 只去一个，`C:/Book//` 会与 `C:/Book` 不相等。
   */
  const slashNormalized = normalizePath(path)
  const isWindowsPath = /^[A-Za-z]:\//.test(slashNormalized) || slashNormalized.startsWith("//")
  const comparable = normalizeComparablePath(path)
  return isWindowsPath ? comparable.toLowerCase() : comparable
}

/**
 * 取当前项目的待办细纲任务，最新的在前。
 *
 * 用项目过滤而不是把所有任务都渲染出来：切项目后不该看到上一个项目的细纲卡片，
 * 那会让用户以为细纲属于当前这本书。
 */
export function selectProjectEventOutlineTasks(
  tasks: EventOutlineTask[],
  projectPath?: string | null,
): EventOutlineTask[] {
  if (!projectPath) return []
  const projectKey = normalizedProjectPath(projectPath)
  return tasks.filter((task) => normalizedProjectPath(task.projectPath) === projectKey)
}

/**
 * 事件细纲任务 store。
 *
 * **刻意不落盘**（对比 outline-chat-store 会写 .qmai/outline-chats.json）：
 * 这是一次性的「生成 → 确认 → 写进章节」交接，确认完就变成磁盘上的章节文件本身，
 * 没有跨会话恢复的必要；写盘反而会让「上次没确认的细纲」在下次启动时诈尸。
 * 同理也不做 fs / tauri 依赖，纯内存 zustand。
 */
export const useEventOutlineTaskStore = create<EventOutlineTaskState>((set) => ({
  tasks: [],

  startTask: (input) => {
    const now = Date.now()
    const id = `event-outline-task-${++eventOutlineTaskCounter}-${now}`
    const projectKey = normalizedProjectPath(input.projectPath)
    set((state) => ({
      tasks: [
        {
          id,
          projectPath: input.projectPath,
          chapterNumber: input.request.chapterNumber,
          request: input.request,
          status: "generating" as const,
          outline: null,
          receivedChars: 0,
          error: null,
          createdAt: now,
          updatedAt: now,
        },
        ...state.tasks.filter((task) => !(
          normalizedProjectPath(task.projectPath) === projectKey &&
          task.chapterNumber === input.request.chapterNumber
        )),
      ],
    }))
    return id
  },

  appendProgress: (taskId, receivedChars) => {
    set((state) => ({
      tasks: state.tasks.map((task) => (
        task.id === taskId ? { ...task, receivedChars, updatedAt: Date.now() } : task
      )),
    }))
  },

  finishTask: (taskId, outline) => {
    set((state) => ({
      tasks: state.tasks.map((task) => (
        task.id === taskId
          ? { ...task, status: "awaiting-confirm" as const, outline, error: null, updatedAt: Date.now() }
          : task
      )),
    }))
  },

  failTask: (taskId, error) => {
    set((state) => ({
      tasks: state.tasks.map((task) => (
        task.id === taskId
          ? { ...task, status: "error" as const, outline: null, error, updatedAt: Date.now() }
          : task
      )),
    }))
  },

  removeTask: (taskId) => {
    set((state) => ({ tasks: state.tasks.filter((task) => task.id !== taskId) }))
  },
}))
