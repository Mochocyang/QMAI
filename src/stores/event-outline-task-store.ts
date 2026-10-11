import { create } from "zustand"
import { normalizeComparablePath, normalizePath } from "@/lib/path-utils"
import type { EventOutlineData, EventOutlineRequest } from "@/lib/novel/event-outline"

/**
 * 章节区「生成章节细纲」的一次任务状态。
 *
 * 状态机：
 *   generating        → awaiting-confirm  细纲生成成功，等用户确认
 *   generating        → error             细纲生成失败（failTask 会清掉 outline）
 *   awaiting-confirm  → writing           用户确认，正在按细纲生成正文
 *   writing           → （任务被摘掉）     正文已写进章节文件，交接完成
 *   writing           → awaiting-confirm  正文生成失败（writingError）**或**用户取消
 *
 * 刻意**没有** done/cancelled 这些终态：细纲一旦被确认扩写，它就是那一章的正文来源，
 * 任务本身没有留在卡片区的理由，直接从 store 摘掉（见 removeTask）。
 * 也正因为如此，「取消正文生成」不是终态 —— 它退回 awaiting-confirm，
 * 因为此时细纲已经是用户确认过的资产，不该连它一起丢。
 */
export type EventOutlineTaskStatus = "generating" | "awaiting-confirm" | "writing" | "error"

export interface EventOutlineTask {
  id: string
  projectPath: string
  /**
   * 这份细纲讲的是第几章，取自用户在向导里的指定。
   *
   * 卡片标题、`eventOutlineToProsePrompt` 的章号、落盘文件名与 frontmatter
   * 都以它为准；模型在细纲 JSON 里自报的 `chapterNumber` 一律被它覆盖
   * （见 finishTask）—— 权威只有一个，下游才不必各自设防。
   */
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
  /**
   * **正文**生成失败的原因。刻意与 `error` 分开，不复用一个字段：
   *
   * `failTask` 会把 `outline` 清空（细纲都没解析出来，留着也没用），而正文失败时
   * 用户最需要的恰恰是那份**已经确认过的细纲**留在卡片上 —— 直接点重试就行，
   * 不必再跑一次细纲生成。所以正文失败只写这个字段、状态退回 awaiting-confirm，
   * 绝不碰 `outline`。
   */
  writingError: string | null
  /**
   * 正文生成走到的工作流阶段名（`onWorkflowEvent` 里 `started` 事件的标题）。
   *
   * 不复用 `receivedChars`：正文那条链路 `onFinalContent` 只在**阶段边界**给完整
   * 文本，不是逐字流，「已收到 N 字」在这里既不是真的、也没有进度含义。
   */
  writingStage: string | null
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
  /**
   * 用户在卡片上**手改**之后写回细纲（丙-3b）。
   *
   * ⚠️ 只改 `outline` 这一个字段，**不动 `status`**：手改不是确认，
   * 这条任务仍然停在 `awaiting-confirm`（顺手改成终态会让卡片整块消失，
   * 用户看到的是「改坏了、功能没了」）。
   *
   * 为什么必须由 store 承载而不是组件本地 state：`task.outline` 是这份细纲的
   * **唯一真相**，卡片渲染与「用这份细纲写这一章」都读它。放在组件里就会有两处
   * 值，任何一处忘了走覆盖值就会出现「界面里改过、模型不知道」——正是
   * `event-outline-card.tsx` 原先那段注释担心的双份真相。
   */
  updateTaskOutline: (taskId: string, outline: EventOutlineData) => void
  failTask: (taskId: string, error: string) => void
  /** 用户确认细纲，进入正文生成。 */
  startWriting: (taskId: string) => void
  /** 正文生成的工作流阶段推进（只影响进度提示）。 */
  setWritingStage: (taskId: string, stage: string) => void
  /**
   * 正文生成失败：退回 awaiting-confirm 并记下原因。
   *
   * 退回而不是留在 writing，是让卡片上的「用这份细纲写这一章」重新出现 ——
   * 那枚按钮同时就是「重试」。`outline` 原样保留。
   */
  failWriting: (taskId: string, error: string) => void
  /** 用户主动取消正文生成：退回 awaiting-confirm，且**不**留错误（取消不是失败）。 */
  cancelWriting: (taskId: string) => void
  removeTask: (taskId: string) => void
}

let eventOutlineTaskCounter = 0

/**
 * 「哪个项目」的规范化键：本 store 内部的项目身份判定，也是调用方**外部**唯一
 * 该复用的比较口径。
 *
 * 导出它的理由不是省几个字符，而是防漂移：preview-panel 要判「这次生成捕获的
 * 项目还是不是当前项目」（丙-2b 的 N2），若那里自己写一遍 `normalizePath(a) ===
 * normalizePath(b)`，`C:/Book` 与 `c:/Book/` 就会被判成两个项目 —— 同一个项目
 * 在这两处得到相反答案，正是这类缺陷的常见形状。
 */
export function projectPathKey(path: string): string {
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
  const projectKey = projectPathKey(projectPath)
  return tasks.filter((task) => projectPathKey(task.projectPath) === projectKey)
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
    const projectKey = projectPathKey(input.projectPath)
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
          writingError: null,
          writingStage: null,
          createdAt: now,
          updatedAt: now,
        },
        ...state.tasks.filter((task) => !(
          projectPathKey(task.projectPath) === projectKey &&
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
          ? {
            ...task,
            status: "awaiting-confirm" as const,
            /*
             * 章号以**任务**为准（F8）。
             *
             * 细纲 JSON 里的 `chapterNumber` 是模型自报的，与用户在向导里指定的
             * 那一章可以不一致；而这个字段随后要同时决定三样东西：卡片标题、
             * `eventOutlineToProsePrompt` 的「写出第 N 章正文」、以及落盘文件的
             * frontmatter。三者各说各的章号是最糟的形态 —— 提示词说第 7 章、
             * 文件名与 frontmatter 说第 2 章。所以在**入 store 这一个点**上把
             * 模型自报值换成任务的章号，下游不必各自设防。
             */
            outline: { ...outline, chapterNumber: task.chapterNumber },
            error: null,
            updatedAt: Date.now(),
          }
          : task
      )),
    }))
  },

  updateTaskOutline: (taskId, outline) => {
    set((state) => ({
      tasks: state.tasks.map((task) => (
        task.id === taskId
          ? {
            ...task,
            /*
             * 章号仍以**任务**为准，理由与 finishTask 那一段完全相同（F8）：
             * 这个字段同时决定卡片标题、`eventOutlineToProsePrompt` 的「写出第 N 章正文」
             * 与落盘文件名。手改表单里刻意没有章号字段，但宽容的调用方（或将来新增的
             * 编辑入口）仍可能送来一份带旧章号的数据 —— 权威只在这一个点上建立。
             *
             * 只重建 outline 对象，**不碰 status / error / writingError 等任何别的字段**。
             */
            outline: { ...outline, chapterNumber: task.chapterNumber },
            updatedAt: Date.now(),
          }
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

  startWriting: (taskId) => {
    set((state) => ({
      tasks: state.tasks.map((task) => (
        task.id === taskId
          ? { ...task, status: "writing" as const, writingError: null, writingStage: null, updatedAt: Date.now() }
          : task
      )),
    }))
  },

  setWritingStage: (taskId, stage) => {
    set((state) => ({
      tasks: state.tasks.map((task) => (
        task.id === taskId ? { ...task, writingStage: stage, updatedAt: Date.now() } : task
      )),
    }))
  },

  failWriting: (taskId, error) => {
    set((state) => ({
      tasks: state.tasks.map((task) => (
        task.id === taskId
          ? { ...task, status: "awaiting-confirm" as const, writingError: error, writingStage: null, updatedAt: Date.now() }
          : task
      )),
    }))
  },

  cancelWriting: (taskId) => {
    set((state) => ({
      tasks: state.tasks.map((task) => (
        task.id === taskId
          ? { ...task, status: "awaiting-confirm" as const, writingError: null, writingStage: null, updatedAt: Date.now() }
          : task
      )),
    }))
  },

  removeTask: (taskId) => {
    set((state) => ({ tasks: state.tasks.filter((task) => task.id !== taskId) }))
  },
}))
