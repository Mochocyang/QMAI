/**
 * 钩子的**运行时集成层**（设计 §5.5 / §5.6）。
 *
 * 这里只做四件事，多加一件都是在主聊天路径上加风险：
 *
 *   1. **清单缓存**：`syncPluginHooks()` 异步拉一次，消费点同步读（`getHooksFor`）。
 *      钩子的消费点是 `streamChat` 这种全应用最热的路径，绝不能在那里 await 一次 IPC。
 *   2. **零开销直通**：没有相关事件的钩子时，`takeHooksFor()` 返回 `null`、`getHooksFor()`
 *      返回**共享的空数组**（不分配、不建 Promise）。调用方拿到 `null` 就直接走原路径，
 *      逐字不变 —— 这是"绝大多数用户一个插件都没装"时的唯一正确形态。
 *   3. **重入保护**：`impl: "prompt"` 的钩子自己会调 `deps.llm.call` → `streamChat`。
 *      若 `streamChat` 无条件跑 `beforeLlmRequest`，钩子会触发钩子 → 递归 → 爆栈。
 *      钩子内部的调用一律经 `runWithHookBypass` 置位，`streamChat` 见到置位就跳过钩子链。
 *   4. **fail-open**：`runEventHooks` 自己吞掉异常并 `console.warn`。插件系统自身的
 *      任何问题**都不能让用户发不出消息**。
 *
 * 为什么依赖全是**动态 import**：`llm-client.ts` 会静态引用本文件，而本文件要用到
 * `@tauri-apps/api`（命令）、`declarative/llm-bridge`（它反过来引用 `llm-client`）、
 * `tool-sync`（引用 `plugins/api`）。静态引会形成 llm-client → runtime → llm-bridge →
 * llm-client 的环，并把 Tauri 运行时带进 Node 单测。静态图里只留纯逻辑
 * （`./types` / `./dispatcher`），宿主能力全部按需加载。
 */
import { compareHookEntries, runHooks, type RunHooksOutcome } from "./dispatcher"
import type { HookContext, HookDeps, HookEvent, PluginHookView } from "./types"
import type { LlmCaller } from "../declarative/run"

/**
 * 共享的空清单。
 *
 * **必须复用同一个实例**：消费点用 `entries.length === 0` 判空，如果每次都 `[]`
 * 就等于每次请求都多一次分配 —— 高频路径上的隐性成本，压测才看得见。
 */
const EMPTY_HOOKS: PluginHookView[] = []

/** 最近一次同步的钩子清单（空清单时就是 `EMPTY_HOOKS`）。 */
let cachedHooks: PluginHookView[] = EMPTY_HOOKS

/**
 * 按事件预分组的索引（`null` 表示"当前一个钩子都没有"）。
 *
 * 为什么要在同步时建索引而不是每次消费时 `filter`：`getHooksFor` 会在**每一次**
 * 请求前后各被调一次。同步时多做 O(n)，消费时就只是一次 Map 查询。
 */
let hooksByEvent: Map<HookEvent, PluginHookView[]> | null = null

/* ------------------------------------------------------------------ *
 * 1. 清单缓存
 * ------------------------------------------------------------------ */

function applyHooks(views: PluginHookView[]): void {
  if (views.length === 0) {
    cachedHooks = EMPTY_HOOKS
    hooksByEvent = null
    return
  }

  const index = new Map<HookEvent, PluginHookView[]>()
  for (const view of views) {
    const event = view.hook.on
    const list = index.get(event)
    if (list) list.push(view)
    else index.set(event, [view])
  }
  // 预先按调度器的确定性顺序排好（priority 升序 + pluginId 字典序）。
  // `runHooks` 内部还会再选一次，这里排序只为让"读清单"的调用方看到的顺序也可复现。
  for (const [event, list] of index) index.set(event, list.sort(compareHookEntries))

  cachedHooks = views.slice()
  hooksByEvent = index
}

/** 命令失败只 warn 一次：启动 + 每次启停都会同步，逐次打印会把真正的错误刷没。 */
let syncWarned = false

/**
 * 拉取并缓存钩子清单；启动与插件启停后调用。失败**保留旧缓存**。
 *
 * 为什么不直接用 `fetchPluginHooks()`：那个封装把"命令不可用"也降级成 `[]`，
 * 与"用户真的一个钩子都没装"无法区分 —— 一次 IPC 抖动就会把已经生效的钩子全清掉，
 * 用户会看到"插件忽然不工作了"。这里自己 invoke 一次，好在失败时**什么都不改**。
 * 归一化仍然复用 `normalizeHookViews`（第三方 JSON 的脏数据规则只有一份）。
 */
export async function syncPluginHooks(): Promise<void> {
  let views: PluginHookView[]
  try {
    const [{ invoke }, { normalizeHookViews }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("./api"),
    ])
    views = normalizeHookViews(await invoke<unknown>("plugins_hooks"))
  } catch (cause) {
    if (!syncWarned) {
      syncWarned = true
      console.warn("[plugins] 同步插件钩子清单失败，沿用上次结果（插件钩子可能不是最新）：", cause)
    }
    return
  }
  applyHooks(views)
}

/**
 * 同步读：该事件的钩子清单。无钩子时返回**共享空数组**，不分配。
 *
 * 调用方必须用 `entries.length === 0` 判空，**不要**把返回值直接丢给 `await`：
 * `await runHooks([])` 会把同步直通变成一次微任务，改变既有请求时序。
 */
export function getHooksFor(event: HookEvent): PluginHookView[] {
  if (cachedHooks.length === 0) return EMPTY_HOOKS
  const list = hooksByEvent?.get(event)
  return list !== undefined && list.length > 0 ? list : EMPTY_HOOKS
}

/**
 * 同步判定 + 取清单：**`null` 表示"这一事件没有钩子，请按原路径走"**。
 *
 * 这是所有消费点唯一该用的入口：`if (hooks) { ... await ... }` 让"无钩子"这条分支
 * 里连一个 Promise 都不会被创建。钩子内部发起的调用（重入）也在这里被挡掉。
 */
export function takeHooksFor(event: HookEvent): PluginHookView[] | null {
  if (isInsideHookCall()) return null
  const entries = getHooksFor(event)
  return entries.length === 0 ? null : entries
}

/* ------------------------------------------------------------------ *
 * 2. 重入保护（陷阱 1）
 * ------------------------------------------------------------------ */

/**
 * 当前处于「钩子内部调用」的层数。
 *
 * 为什么是计数器而不是 boolean：`impl: "prompt"` 的钩子在 `deps.llm.call` 里又会
 * 走一遍 `streamChat`，中途可能还有嵌套（钩子 → 插件工具 → 再调模型）。计数器保证
 * 只有最外层那一次真正退出时才复位。
 *
 * 已知取舍：这是**模块级**状态，没有 `AsyncLocalStorage`（WebView 里没有这个 API）。
 * 若在钩子执行期间有**另一条互不相干的请求**并发进来，它也会被跳过钩子链。
 * 前端的模型请求是用户逐个发起的，聊天/工作流都串行，这个代价换来的确定性更值。
 */
let hookCallDepth = 0

/** 是否正在执行钩子内部的调用（`streamChat` 据此跳过钩子链）。 */
export function isInsideHookCall(): boolean {
  return hookCallDepth > 0
}

/**
 * 在「钩子内部」标记下执行 `fn`：期间任何 `streamChat` 调用都**不会再触发钩子**。
 *
 * 必须包住钩子自己那一次模型调用，否则就是钩子触发钩子 → 无限递归。
 * 用 try/finally 而不是只看成功路径：钩子抛错/超时被取消时同样要复位，否则
 * 标记会永久置位，此后**所有**用户请求都不再有钩子（更难查的故障）。
 */
export async function runWithHookBypass<T>(fn: () => Promise<T>): Promise<T> {
  hookCallDepth += 1
  try {
    return await fn()
  } finally {
    hookCallDepth -= 1
  }
}

/* ------------------------------------------------------------------ *
 * 3. deps（宿主能力注入）
 * ------------------------------------------------------------------ */

let cachedLlmCaller: LlmCaller | null = null

/** 宿主模型调用器（复用声明式动作那条 `streamChat` 桥，见 `declarative/llm-bridge`）。 */
async function getHostLlmCaller(): Promise<LlmCaller> {
  if (!cachedLlmCaller) {
    const { createStreamChatLlmCaller } = await import("../declarative/llm-bridge")
    cachedLlmCaller = createStreamChatLlmCaller()
  }
  return cachedLlmCaller
}

/**
 * 组装调度器需要的 deps。
 *
 * `llm` 这里**一定要**包 `runWithHookBypass`：`dispatcher` 只保证"钩子的实现能调模型"，
 * 它不知道模型调用会绕回宿主最热的 `streamChat`。把标记做在 deps 这一层，任何
 * `impl`（prompt / 将来的代码型）都不可能绕过重入保护。
 */
export function createHookDeps(overrides: Partial<HookDeps> = {}): HookDeps {
  return {
    llm: {
      async call(input, onDelta, signal) {
        return runWithHookBypass(async () => (await getHostLlmCaller()).call(input, onDelta, signal))
      },
    },
    // process 钩子：调插件自己的工具（`plugins_invoke_tool`），文本进文本出。
    invokePluginTool: async (pluginId, tool, args) => {
      const { invokePluginToolViaTauri } = await import("../tool-sync")
      return invokePluginToolViaTauri()(pluginId, tool, args)
    },
    // 配置读取：`declarativePluginsApi.configGet` 自带容错（失败 → `{}`，不抛）。
    getConfig: async (pluginId) => {
      const { declarativePluginsApi } = await import("../declarative/api")
      return declarativePluginsApi.configGet(pluginId)
    },
    onWarn: (message) => console.warn(message),
    ...overrides,
  }
}

/**
 * deps 工厂的替换点（测试注入假模型/假工具；将来宿主若要给钩子换模型来源也从这里进）。
 * `null` = 恢复默认实现。
 */
let depsFactory: (() => HookDeps) | null = null

export function setHookDepsFactory(factory: (() => HookDeps) | null): void {
  depsFactory = factory
}

/* ------------------------------------------------------------------ *
 * 4. 统一执行入口
 * ------------------------------------------------------------------ */

export interface HookRunOptions {
  signal?: AbortSignal
  /** 覆盖事件默认超时（测试用）。 */
  timeoutMsOverride?: Partial<Record<HookEvent, number>>
}

/**
 * 跑一遍某一事件的钩子。
 *
 * 调用约定：**只在 `takeHooksFor()` 返回非 null 时调用**（这里仍会再判一次，二次保险）。
 * 返回 `null` 表示"没有可用结果，按原值继续"：
 *   - 没有钩子 / 正在钩子内部（重入）；
 *   - 钩子机制自身抛错（已 warn）。
 * 返回非 null 时，`outcome.blocked` 才是"门禁不通过"，由调用方决定怎么中止。
 */
export async function runEventHooks(
  entries: PluginHookView[],
  context: HookContext,
  options: HookRunOptions = {},
): Promise<RunHooksOutcome | null> {
  if (entries.length === 0) return null
  if (isInsideHookCall()) return null

  let outcome: RunHooksOutcome
  try {
    const deps = (depsFactory ?? createHookDeps)()
    // 整个钩子链都在 bypass 标记内：即便某个实现内部没走 `deps.llm`，而是自己
    // 起了一条模型请求，也不会回头再触发钩子（双重保险，见 `createHookDeps`）。
    outcome = await runWithHookBypass(() => runHooks(entries, context, deps, options))
  } catch (cause) {
    console.warn(`[plugins] 钩子机制在 ${context.event} 上出错，已按无钩子继续：`, cause)
    return null
  }

  // 失败的钩子要点名：否则作者只会看到"我的钩子没生效"，却不知道是超时还是报错。
  for (const failure of outcome.failures) {
    const who = failure.pluginName || failure.pluginId || "未知插件"
    console.warn(`[plugins] 插件「${who}」的 ${context.event} 钩子未生效：${failure.reason}`)
  }
  return outcome
}

/* ------------------------------------------------------------------ *
 * 仅供测试
 * ------------------------------------------------------------------ */

/** 测试专用：直接注入钩子清单（绕过 Tauri 命令）。 */
export function __setPluginHooksForTests(views: PluginHookView[]): void {
  applyHooks(views)
  syncWarned = false
}

/** 测试专用：清空缓存与重入标记。 */
export function __resetPluginHooksForTests(): void {
  applyHooks([])
  syncWarned = false
  depsFactory = null
  cachedLlmCaller = null
  hookCallDepth = 0
}
