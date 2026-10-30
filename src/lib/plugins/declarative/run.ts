/**
 * 声明式 action 的**执行编排**（设计 §3.6）。
 *
 * 一段 action 的执行只有四步，但每一步都必须能被单一测试覆盖住：
 *
 *   权限闸门 → 插值（interpolate）→ 调模型（deps.llm.call）→ 解析（parseOutput）
 *
 * 闸门之所以单独成一步、并排在插值之前：插值就是"把项目正文读进来"的那一步，
 * 权限判定一旦晚于它，隐私与计费上的损失都已经发生（详见 `runDeclarativeAction`
 * 里的注释）。
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
import { interpolate, collectVariables, requiresProjectAccess } from "./interpolate"
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
  /**
   * 调用**同一插件**声明的 MCP 工具。
   *
   * 为什么 action 需要它：有些动作的素材不在宿主上下文里 ——「书名生成」要读
   * 书架上的书，而 `{{project.*}}` 只给当前打开的那一本。没有这个入口，
   * 那份素材只能让用户手动粘贴，体验就是一个空的大文本框。
   *
   * 失败语义与读项目不同：读项目失败静默降级（少一点上下文也能生成），
   * 而取素材失败**必须中止** —— 没有素材就生成书名，模型只能凭空编。
   */
  invokeTool?: (toolName: string, args: Record<string, unknown>) => Promise<string>
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

/** 读项目内容所必需的能力（设计 §3.3）。 */
export const PROJECT_READ_PERMISSION = "fs:project-read"

/**
 * 缺 `fs:project-read` 却又引用了项目上下文时抛出的错误（可识别，便于 UI 区分）。
 *
 * 为什么单独一个类而不是普通 `Error`：这不是"生成失败"——模型没被调用、一个字都没
 * 发出去，用户该做的是去插件中心重新授权，而不是重试或调表单。UI 靠 `instanceof`
 * 决定显示哪套文案（见 `ActionDialog`）。
 */
export class MissingProjectPermissionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MissingProjectPermissionError"
  }
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
 * @param grantedPermissions 该插件**已被用户授予**的权限（`PluginSummary.grantedPermissions`）。
 *        必传且**故意没有默认值**：给 `[]` 默认值会让"忘了传权限"的调用点静默变成
 *        "没有权限"，反过来默认放行又等于拆掉闸门。调用方必须显式面对这件事。
 * @param values  已通过 `validateFormValues` 的表单值（这里不再校验一遍）
 * @param onDelta 流式增量回调
 * @param signal  中止信号（用户点「停止」）
 * @param chain   本次链式调用栈（`run-action` 用）。默认空数组 = 顶层直接调用。
 *
 * 链式保护放在这个入口而不是每个调用点：只要将来有任何一处跑第二条 action，
 * 它必然经过这里，`assertRunnableChain` 就一定被校验到（判定漏一处就是线上事故）。
 */
/**
 * action 的「准备步骤」失败。
 *
 * 与 `readSafely` 的静默降级刻意相反：准备步骤是**用户明确要的数据**
 * （如书架内容），拿不到就没有可分析的东西。此时继续生成只会得到一批
 * 编造的书名，用户还得自己发现「AI 根本没看我的书」。宁可停下来说清楚。
 */
export class RunActionPrepareError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RunActionPrepareError"
  }
}

/**
 * 执行 action 声明的前置工具调用，把结果并进模板变量。
 *
 * 声明形状（`plugin.json`）：
 *   "prepare": [{ "var": "material", "tool": "collect_writing_material", "args": {...} }]
 *
 * `args` 里的事件值也走一次插值（`{{books}}`），所以勾选了哪些书能传进工具。
 * 结果统一按**字符串**放进变量：模板只做文本替换，不做结构化访问 ——
 * 让插件把 JSON 拍平成可读文本，比在宿主里再造一层访问器简单得多。
 */
async function runPrepareSteps(
  steps: readonly { var?: string; tool?: string; args?: Record<string, unknown> }[],
  actionTitle: string,
  deps: RunActionDeps,
  scope: { fields: Record<string, unknown> },
): Promise<Record<string, string>> {
  const collected: Record<string, string> = {}
  if (steps.length === 0) return collected

  if (!deps.invokeTool) {
    throw new RunActionPrepareError(
      `「${actionTitle}」需要先调用插件工具取素材，但当前环境没有提供调用能力（请确认插件已启用并在运行）。`,
    )
  }

  for (const step of steps) {
    const toolName = typeof step?.tool === "string" ? step.tool.trim() : ""
    if (!toolName) {
      throw new RunActionPrepareError(`「${actionTitle}」的准备步骤缺少 tool 声明。`)
    }
    // args 里可以带 {{变量}}，让用户勾选的书单能传进去
    const interpolatedArgs: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(step.args ?? {})) {
      if (typeof value === "string") {
        interpolatedArgs[key] = interpolate(value, scope).text
      } else {
        interpolatedArgs[key] = value
      }
    }

    let raw: string
    try {
      raw = await deps.invokeTool(toolName, interpolatedArgs)
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      throw new RunActionPrepareError(
        `「${actionTitle}」取素材失败（${toolName}）：${reason}`,
      )
    }

    const varName = typeof step.var === "string" && step.var.trim() ? step.var.trim() : toolName
    collected[varName] = extractMaterial(raw)
  }
  return collected
}

/**
 * 从工具返回里取出给模型看的正文。
 *
 * 插件工具普遍返回 JSON（`{status, material, ...}`）。直接把它塞进提示词会让模型
 * 读到一堆字段名和转义符。这里优先取约定字段 `material` / `text` / `content`，
 * 都取不到才退回原文 —— 于是「作者按约定返回」和「作者返回了别的形状」都能用。
 */
function extractMaterial(raw: string): string {
  if (typeof raw !== "string") return ""
  const trimmed = raw.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return trimmed
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    for (const key of ["material", "text", "content", "result"]) {
      const value = parsed?.[key]
      if (typeof value === "string" && value.trim()) return value
    }
  } catch {
    // 不是 JSON 就是纯文本，原样返回
  }
  return trimmed
}

export async function runDeclarativeAction(
  action: DeclarativeAction,
  pluginId: string,
  grantedPermissions: readonly string[],
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

  /*
   * 权限闸门（设计 §3.3）：引用了 `{{project.*}}` / `{{chapter.*}}` / `{{selection}}`
   * 的 action，其插件必须获批 `fs:project-read`，否则拒绝执行。
   *
   * **为什么必须在模型调用之前**：过了这一步的代码会先把项目/章节真读出来、插进
   * 提示词，再交给模型。闸门晚一步，损失就是三重且不可撤回的：
   *   1. 用户的正文已经出了本机（隐私）；
   *   2. 一次模型请求已经计费（钱）；
   *   3. 插件已经拿到了它没有被授权的数据，事后报错也追不回来。
   * 所以顺序是"先判定资格，再读上下文，最后才发请求"——拒绝路径上不产生任何 I/O。
   *
   * 为什么闸门放在执行入口而不是校验器：校验器（SDK）看的是清单声明，管不到
   * "老清单 / 手改注册表 / 用户只批准了一部分权限"这三种真实情况。这里查的是
   * **用户实际授予**的那份权限，是最后一道、也是唯一一道能兜住的闸门。
   */
  const needsProjectAccess =
    requiresProjectAccess(systemTemplate) || requiresProjectAccess(userTemplate)
  // 运行时兜底：拿不到清单就当"什么都没授予"。失败方向只能是拒绝，绝不能放行。
  const granted = Array.isArray(grantedPermissions) ? grantedPermissions : []
  if (needsProjectAccess && !granted.includes(PROJECT_READ_PERMISSION)) {
    throw new MissingProjectPermissionError(
      `「${action?.title ?? action?.id ?? "该动作"}」需要读取你的项目内容（章节/设定），但该插件尚未获批 fs:project-read 权限。` +
        `请在插件中心停用后重新启用它，并在确认框里批准这项权限。`,
    )
  }

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

  /*
   * 执行 action 声明的前置工具调用（`prepare`），把结果并进变量。
   *
   * 放在 interpolate 之前：模板里的 `{{material}}` 要能取到刚取回来的素材。
   * 放在权限闸门之后：这一步会真的去读插件被授权的东西，资格没判完不能动手。
   */
  const prepareSteps = Array.isArray(action?.prepare) ? action.prepare : []
  const prepared =
    prepareSteps.length > 0
      ? await runPrepareSteps(
          prepareSteps,
          action?.title ?? action?.id ?? "",
          deps,
          { fields: values ?? {} },
        )
      : {}

  /*
   * 只补**用户没填**的变量。
   *
   * 方向不能反：用 `Object.assign(scope.fields, prepared)` 会让工具输出覆盖用户
   * 手填的内容 —— 用户改完输入框、点生成，却发现 AI 用的还是书架内容，
   * 而他根本没机会知道。所以是"手填优先，空缺才用工具补"。
   */
  for (const [key, value] of Object.entries(prepared)) {
    const existing = (scope.fields as Record<string, unknown>)[key]
    if (existing === undefined || existing === null || existing === "") {
      ;(scope.fields as Record<string, unknown>)[key] = value
    }
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
