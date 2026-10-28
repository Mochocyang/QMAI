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
 */
export async function runDeclarativeAction(
  action: DeclarativeAction,
  pluginId: string,
  values: Record<string, unknown>,
  deps: RunActionDeps,
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<RunActionResult> {
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
