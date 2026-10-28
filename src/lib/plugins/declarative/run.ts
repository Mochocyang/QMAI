/**
 * 声明式 action 的**执行编排**（设计 §3.6）。
 *
 * 一段 action 的执行只有四步，但每一步都必须能被单一测试覆盖住：
 *
 *   插值（interpolate）→ 调模型（deps.llm.call）→ 解析（parseOutput）→ 返回
 *
 * **为什么 LLM 调用器是注入的**：这个仓的模型客户端（`src/lib/llm-client.ts`）
 * 依赖 store、provider 配置、用量计费与网络。若本文件直接 import 它，
 *   1. 单元测试就再也跑不进 Node（tsconfig 的测试环境是 node，没有 Tauri/store）；
 *   2. "模型从哪来"会焊死在这里，将来接"当前模型""指定模型""插件 provider"三种
 *      策略都得回来改这个函数。
 * 注入之后，本文件只认一个三行接口（`LlmCaller`），接线任务只需提供实现。
 *
 * 本文件同样**不抛解析错误**：`parseOutput` 永不抛错（设计 D3），降级结果原样返回，
 * 由 UI 决定怎么展示（空列表与降级必须渲染不同，见 ActionDialog 的注释）。
 */
import { interpolate, collectVariables } from "./interpolate"
import { parseOutput, type ParsedOutput } from "./output"
import type { DeclarativeAction } from "./types"

/**
 * 流式生成器。
 *
 * `onDelta` 收的是**增量片段**（不是累计文本）：累计交给调用方自己拼，
 * 这样 UI 可以用函数式 setState 追加，不会因为并发片段丢字。
 */
export interface LlmCaller {
  /** 流式生成；onDelta 每来一段文本调用一次；返回完整文本 */
  call(
    input: { system: string; user: string; maxOutputTokens?: number },
    onDelta: (text: string) => void,
    signal: AbortSignal,
  ): Promise<{ text: string }>
}

export interface RunActionDeps {
  llm: LlmCaller
  /** 读项目上下文（无项目时返回 null） */
  readProject?: () => Promise<InterpolationScopeProject | null>
  readChapter?: () => Promise<InterpolationScopeChapter | null>
  getSelection?: () => string | undefined
  getConfig: (pluginId: string) => Promise<Record<string, unknown>>
}

/** 与 `interpolate` 的 `InterpolationScope` 命名空间保持同一形状（不另造一套）。 */
type InterpolationScopeProject = {
  bookTitle?: string
  bookTags?: string[]
  bookIntro?: string
  protagonist?: string
  setting?: string
}

type InterpolationScopeChapter = { title?: string; text?: string }

export interface RunActionResult {
  parsed: ParsedOutput
  /** 模板里引用了但运行时拿不到的变量名（去重）。仅供日志/作者排查，不打断生成。 */
  missing: string[]
}

/**
 * 被中止时抛出的可识别错误。
 *
 * 为什么单独一个类而不是直接用 `DOMException("AbortError")`：宿主各处都会 catch
 * 一堆 `unknown`，用 `instanceof` / `isRunActionAborted` 判断"是我主动停的"
 * 才不会把用户的「停止」显示成「生成失败」。
 */
export class RunActionAbortedError extends Error {
  constructor(message = "已停止生成") {
    super(message)
    this.name = "RunActionAbortedError"
  }
}

/** 识别中止：既认我们自己的错误，也认底层 client 原样抛出的 AbortError。 */
export function isRunActionAborted(error: unknown): boolean {
  if (error instanceof RunActionAbortedError) return true
  if (error instanceof Error && error.name === "AbortError") return true
  return false
}

/**
 * 一个"永远失败"的 LLM 调用器，用于接线未完成时的占位。
 *
 * 失败信息必须是**人话**并且指向原因（接线任务未完成），不能写成 "LLM error"：
 * 用户看到按钮点了没反应会去卸载插件，作者看到会以为自己的提示词写错了。
 */
export function createUnavailableLlmCaller(message: string): LlmCaller {
  return {
    call() {
      return Promise.reject(new Error(message))
    },
  }
}

/**
 * `run-action` 允许的最大链式层数（设计 §4.1「让 AI 扩写」只到"一次再加工"）。
 *
 * 3 层是**上限而不是配额**：链越长，用户越难预期要花多少 token、失败时也越难
 * 指出是哪一步坏了；而每一层都要弹一次模型调用，深度失控就等于把一次点击变成
 * 一串计费请求。
 */
export const MAX_RUN_ACTION_CHAIN_DEPTH = 3

/** 链式调用被拒绝时抛出的错误（可识别，便于 UI 与作者排查区分）。 */
export class RunActionChainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RunActionChainError"
  }
}

/** 调用栈里的一帧统一写成 `<pluginId>:<actionId>`；也接受裸 `actionId`（视为同一插件）。 */
export function formatChainFrame(pluginId: string, actionId: string): string {
  return `${pluginId}:${actionId}`
}

/** 解析一帧；格式不认识时返回 `null`（由调用方报可读错误，不静默通过）。 */
export function parseChainFrame(frame: string): { pluginId: string; actionId: string } | null {
  if (typeof frame !== "string") return null
  const trimmed = frame.trim()
  if (trimmed === "") return null
  const index = trimmed.indexOf(":")
  if (index === -1) return { pluginId: "", actionId: trimmed }
  const pluginId = trimmed.slice(0, index).trim()
  const actionId = trimmed.slice(index + 1).trim()
  if (actionId === "") return null
  return { pluginId, actionId }
}

/**
 * 校验"这一次 `run-action` 还能不能跑"。
 *
 * 三条拒绝理由，缺一条就会真出事故：
 *   1. **跨插件**：`run-action` 只能指向同一插件内的 action。跨插件链是隐式依赖 ——
 *      卸载其中一个，另一个就静默失效，而安装期查不出来（那时两边可能都还没装齐）。
 *   2. **环**：A→B→A 会让一次点击无限地互相调用，用户只能靠杀进程停下来。
 *   3. **深度 > 3**：见 `MAX_RUN_ACTION_CHAIN_DEPTH`。
 *
 * 做成纯函数并**在唯一的执行入口**（`runDeclarativeAction`）里调用：判定写在每个
 * 调用点，就一定会漏掉某个调用点。
 *
 * @param pluginId 目标 action 所属插件
 * @param actionId 目标 action id
 * @param stack    本次调用栈（已经跑过的帧），最后一帧是"当前正在跑的那个"
 * @throws RunActionChainError 中文原因，可直接展示
 */
export function assertRunnableChain(
  pluginId: string,
  actionId: string,
  stack: readonly string[],
): void {
  const plugin = typeof pluginId === "string" ? pluginId.trim() : ""
  const action = typeof actionId === "string" ? actionId.trim() : ""
  if (plugin === "" || action === "") {
    throw new RunActionChainError("链式调用缺少插件或动作标识，已拒绝执行。")
  }

  const frames = Array.isArray(stack) ? stack : []
  const depth = frames.length + 1
  if (depth > MAX_RUN_ACTION_CHAIN_DEPTH) {
    throw new RunActionChainError(
      `链式调用层数过深（第 ${depth} 层，最多 ${MAX_RUN_ACTION_CHAIN_DEPTH} 层），已拒绝执行。`,
    )
  }

  for (const raw of frames) {
    const frame = parseChainFrame(raw)
    if (!frame) {
      throw new RunActionChainError(`调用栈里有一帧无法识别（${String(raw)}），已拒绝执行。`)
    }
    // 裸 actionId 视为同一插件（见 formatChainFrame 的注释）
    const framePlugin = frame.pluginId === "" ? plugin : frame.pluginId
    if (framePlugin !== plugin) {
      throw new RunActionChainError(
        `「运行动作」只能指向同一插件内的动作：当前插件是 ${plugin}，调用栈里出现了 ${framePlugin}。`,
      )
    }
    if (frame.actionId === action) {
      throw new RunActionChainError(
        `链式调用出现环：${formatChainFrame(plugin, action)} 已经在本次调用栈里（${frames.join(" → ")}）。`,
      )
    }
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new RunActionAbortedError()
}

/** 模板里出现的变量名（system + user 去重，保持首次出现顺序）。 */
function collectTemplateVariables(system: string, user: string): string[] {
  const names: string[] = []
  for (const name of [...collectVariables(system), ...collectVariables(user)]) {
    if (!names.includes(name)) names.push(name)
  }
  return names
}

/**
 * 读上下文。
 *
 * **读失败不打断生成**：项目可能还没保存、章节可能没打开，此时模型仍能基于表单
 * 生成有价值的内容（变量插成空串而已）。把"读不到项目"升级成"生成失败"会让
 * 用户在完全无关的时机被拦住。失败原因进 `console.warn`，供作者排查。
 */
async function readSafely<T>(label: string, reader?: () => Promise<T | null>): Promise<T | null> {
  if (!reader) return null
  try {
    return await reader()
  } catch (cause) {
    console.warn(`[plugins] 读取${label}失败，已按空值继续：`, cause)
    return null
  }
}

/**
 * 执行一个声明式 action。
 *
 * @param values  已通过 `validateFormValues` 的表单值（这里不再校验一遍）
 * @param onDelta 流式增量回调
 * @param signal  中止信号（用户点「停止」）
 * @param chain   本次链式调用栈（`run-action` 用）。默认空数组 = 顶层直接调用。
 *
 * 链式保护放在这个入口而不是每个调用点：只要将来有任何一处跑第二条 action，
 * 它必然经过这里，`assertRunnableChain` 就一定被校验到（判定漏一处就是线上事故）。
 */
export async function runDeclarativeAction(
  action: DeclarativeAction,
  pluginId: string,
  values: Record<string, unknown>,
  deps: RunActionDeps,
  onDelta: (text: string) => void,
  signal: AbortSignal,
  chain: readonly string[] = [],
): Promise<RunActionResult> {
  assertRunnableChain(pluginId, action?.id ?? "", chain)
  throwIfAborted(signal)

  const systemTemplate = action?.prompt?.system ?? ""
  const userTemplate = action?.prompt?.user ?? ""
  const variables = collectTemplateVariables(systemTemplate, userTemplate)

  /*
   * 只读"模板真的用到了"的东西。
   *
   * 理由不是省一次 IPC，而是**权限面**：`{{project.*}}` 是需要 `fs:project-read`
   * 的能力（设计 §3.3），若每个纯表单 action 都顺手读一遍项目，权限边界就变成
   * 一句空话了。
   */
  const needsConfig = variables.some((name) => name.startsWith("config."))
  const needsProject = variables.some((name) => name.startsWith("project."))
  const needsChapter = variables.some((name) => name.startsWith("chapter."))
  const needsSelection = variables.includes("selection")

  const config = needsConfig ? await readSafely("插件配置", () => deps.getConfig(pluginId)) : null
  const project = needsProject ? await readSafely("项目信息", deps.readProject) : null
  const chapter = needsChapter ? await readSafely("章节信息", deps.readChapter) : null
  const selection = needsSelection ? deps.getSelection?.() : undefined

  throwIfAborted(signal)

  const scope = {
    fields: values ?? {},
    ...(config ? { config } : {}),
    ...(project ? { project } : {}),
    ...(chapter ? { chapter } : {}),
    ...(selection !== undefined ? { selection } : {}),
  }

  const system = interpolate(systemTemplate, scope)
  const user = interpolate(userTemplate, scope)
  const missing = [...system.missing]
  for (const name of user.missing) {
    if (!missing.includes(name)) missing.push(name)
  }

  let raw = ""
  try {
    const result = await deps.llm.call(
      {
        system: system.text,
        user: user.text,
        ...(action?.limits?.maxOutputTokens !== undefined
          ? { maxOutputTokens: action.limits.maxOutputTokens }
          : {}),
      },
      onDelta,
      signal,
    )
    raw = typeof result?.text === "string" ? result.text : ""
  } catch (cause) {
    // 用户点「停止」时底层会抛 AbortError；统一换成可识别的错误类型，
    // 让上层能区分"停手"和"模型出错"。
    if (signal.aborted || isRunActionAborted(cause)) throw new RunActionAbortedError()
    throw cause
  }

  throwIfAborted(signal)

  // 解析永不抛错（设计 D3）：解析不出来就是 degraded，原文照旧带回给 UI。
  const parsed = parseOutput(raw, action?.output ?? { mode: "text", targets: [] })
  return { parsed, missing }
}
