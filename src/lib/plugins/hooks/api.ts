/**
 * 钩子清单的 Tauri 命令封装（`plugins_hooks`）。
 *
 * 与 `declarative/api.ts` 同一容错口径：**读命令失败 → 空数组 + warn**，不崩、不空白。
 * 钩子是另一个并行任务在 Rust 侧加的，前端先落地就必须做到"命令不存在时宿主照常
 * 生成"——否则一次并行开发期的时序差异会被误判成"整个插件系统挂了"。
 *
 * **每命令只 warn 一次**：命令未注册时，每次 LLM 请求都会失败一次，逐次打印会把
 * 控制台刷满，把真正的错误埋掉。第一条带完整原因，够定位；后续静默降级。
 *
 * 第三方清单在这里**归一化**再交出去：钩子声明是插件作者写的 JSON，脏数据（未知
 * 事件名、缺 impl、priority 是字符串）必须在入口收住，不能漏进调度器的判定逻辑 ——
 * 调度器要保证"10 条行为可预测"，就不能同时处理"字段可能是任意值"。
 */
import { invoke } from "@tauri-apps/api/core"
import {
  isHookEvent,
  type HookEvent,
  type PluginHookDeclaration,
  type PluginHookView,
} from "./types"

/** 已警告过的命令（见文件头：每命令只 warn 一次）。 */
const warnedCommands = new Set<string>()

function warnCommandUnavailable(command: string, cause: unknown): void {
  if (warnedCommands.has(command)) return
  warnedCommands.add(command)
  console.warn(
    `[plugins] 命令 ${command} 不可用（可能尚未注册），已按空结果降级，界面不受影响：`,
    cause,
  )
}

/** 仅供测试：清空"已警告"记录，让每个用例都能观察到第一条告警。 */
export function resetHooksApiWarnings(): void {
  warnedCommands.clear()
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

/**
 * 有限数字（`timeoutMs` / `priority` 共用）。
 *
 * 非法值返回 `undefined` 而不是 0：0 有自己的语义（`priority: 0` 是默认档），
 * 把"写错了"和"就是 0"混成一档，作者永远查不出自己的字段名拼错了。
 */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/**
 * 归一化一条 `plugins_hooks()` 返回项。
 *
 * 丢弃条件只有两条 —— **没有身份/没有事件/没有实现**（调度器无法为它做任何判定）：
 *   - `on` 不是已知事件 → 丢。未知事件没有超时预算、没有失败策略，留着只会静默不生效；
 *   - `impl` 不是 prompt/process → 丢；
 *   - `pluginId` 为空 → 丢（界面无法提示是"哪个插件"没生效）。
 *
 * 反之，**故意不丢**"prompt 但没写 template"这类声明错误：留着它，运行期会给出
 * 可读错误（"钩子模板必须包含 {{text}}"）并进 failures，作者一眼能看到自己漏了什么。
 * 直接丢掉才是真正的静默失效。
 */
export function normalizeHookView(raw: unknown): PluginHookView | null {
  const record = asRecord(raw)
  if (!record) return null

  const pluginId = nonEmptyString(record.pluginId)
  if (!pluginId) return null

  const hookRecord = asRecord(record.hook)
  if (!hookRecord) return null
  if (!isHookEvent(hookRecord.on)) return null

  const impl = hookRecord.impl
  if (impl !== "prompt" && impl !== "process") return null

  const hook: PluginHookDeclaration = {
    on: hookRecord.on as HookEvent,
    impl,
  }

  const template = nonEmptyString(hookRecord.template)
  if (template !== undefined) hook.template = template
  const tool = nonEmptyString(hookRecord.tool)
  if (tool !== undefined) hook.tool = tool
  const priority = finiteNumber(hookRecord.priority)
  if (priority !== undefined) hook.priority = priority
  const timeoutMs = finiteNumber(hookRecord.timeoutMs)
  // 非正超时没有意义（0ms 会让钩子永远不生效），按"没写"处理让事件默认值接手。
  if (timeoutMs !== undefined && timeoutMs > 0) hook.timeoutMs = timeoutMs
  // gate 只认显式 true：`gate: "yes"` / `gate: 1` 这类模糊值一律当 false（fail-open 才是安全默认）。
  if (hookRecord.gate === true) hook.gate = true

  return {
    pluginId,
    pluginName: nonEmptyString(record.pluginName) ?? pluginId,
    hook,
  }
}

/** 归一化整个数组（非数组 → 空数组）。 */
export function normalizeHookViews(raw: unknown): PluginHookView[] {
  if (!Array.isArray(raw)) return []
  const views: PluginHookView[] = []
  for (const item of raw) {
    const view = normalizeHookView(item)
    if (view) views.push(view)
  }
  return views
}

/**
 * 拉取钩子清单（命令不存在/失败 → 空数组 + warn，不崩）。
 *
 * 不做模块级缓存/subscribe 的原因：钩子的消费点是**每次请求前后的调度**（同步拿到
 * 清单即可用），不像工具描述符要进 `buildAgentConfig` 的同步路径。清单按需拉取，
 * 少一层缓存也就少一处"启用插件后缓存没刷新"的坑。将来若插件中心的展示需要实时
 * 快照，再按 `tool-sync` 的形状补一层，不动这里的契约。
 */
export async function fetchPluginHooks(): Promise<PluginHookView[]> {
  try {
    const raw = await invoke<unknown>("plugins_hooks")
    return normalizeHookViews(raw)
  } catch (cause) {
    warnCommandUnavailable("plugins_hooks", cause)
    return []
  }
}
