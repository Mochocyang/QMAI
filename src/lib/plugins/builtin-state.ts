import { BUILTIN_PLUGINS, builtinPlugin, type BuiltinPluginId } from "./builtin"

/**
 * 内置插件的开关状态。
 *
 * 为什么要单独一个模块（而不是塞进 zustand store）：
 *   1. **网页搜索的闸门在非 React 代码里**（`lib/web-search.ts` 被普通函数调用），
 *      它需要一个不依赖 React 上下文的同步读取入口；
 *   2. 开关变了之后，导航栏（shell）、页面（content-area）、搜索闸门三处都要响应，
 *      用 `useSyncExternalStore` 比往全局 store 里塞一份更容易保证一致。
 *
 * 存储用 localStorage，故意**不跟随项目**：内置插件是应用级开关，
 * 换一本书不该让「审查中心」突然冒出来。
 */

const STORAGE_KEY = "qmai-builtin-plugins-v1"

type StateMap = Partial<Record<BuiltinPluginId, boolean>>

const listeners = new Set<() => void>()

/** 缓存一份快照，保证 `useSyncExternalStore` 拿到稳定引用（否则每次 render 都会重渲染）。 */
let cache: StateMap | null = null

function defaultState(): StateMap {
  const state: StateMap = {}
  for (const plugin of BUILTIN_PLUGINS) state[plugin.id] = plugin.defaultEnabled
  return state
}

function parse(raw: string | null): StateMap {
  if (!raw) return defaultState()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 存储损坏时回到默认值，而不是让整个插件页崩掉。
    return defaultState()
  }
  if (!parsed || typeof parsed !== "object") return defaultState()

  const state = defaultState()
  const record = parsed as Record<string, unknown>
  for (const plugin of BUILTIN_PLUGINS) {
    const value = record[plugin.id]
    // 只认真正的 boolean：老版本存了 "false" 字符串之类的东西不能被当成 false。
    if (typeof value === "boolean") state[plugin.id] = value
  }
  return state
}

function read(): StateMap {
  if (cache) return cache
  let raw: string | null = null
  try {
    raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY)
  } catch {
    raw = null
  }
  cache = parse(raw)
  return cache
}

function emit() {
  for (const listener of listeners) listener()
}

/** 订阅开关变化；返回取消订阅函数。 */
export function subscribeBuiltinPlugins(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 供 `useSyncExternalStore` 用的快照（引用稳定）。 */
export function builtinPluginsSnapshot(): StateMap {
  return read()
}

/** 某个内置插件当前是否开启（未配置过则用清单里的默认值）。 */
export function isBuiltinPluginEnabled(id: BuiltinPluginId): boolean {
  const state = read()
  const explicit = state[id]
  if (typeof explicit === "boolean") return explicit
  return builtinPlugin(id)?.defaultEnabled ?? true
}

/** 某个视图当前是否可用（没有内置插件管辖的视图一律可用）。 */
export function isBuiltinViewEnabled(view: string | undefined | null): boolean {
  if (!view) return true
  const owner = BUILTIN_PLUGINS.find((plugin) => plugin.view === view)
  if (!owner) return true
  return isBuiltinPluginEnabled(owner.id)
}

export function setBuiltinPluginEnabled(id: BuiltinPluginId, enabled: boolean): void {
  const next: StateMap = { ...read(), [id]: enabled }
  cache = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 存不进去也要让本次会话生效：内存里的 cache 已经改了。
    // 静默失败是有意的 —— 弹一个"保存失败"的 toast 对用户没有可执行的动作。
  }
  emit()
}

/** 把某个内置插件恢复成清单里的默认值（用于"恢复默认"）。 */
export function resetBuiltinPlugin(id: BuiltinPluginId): void {
  const next: StateMap = { ...read() }
  delete next[id]
  cache = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* 同上 */
  }
  emit()
}

/** 测试用：清掉缓存，让下一次读取重新走 localStorage。 */
export function __resetBuiltinPluginCacheForTests(): void {
  cache = null
  listeners.clear()
}

export const BUILTIN_PLUGINS_STORAGE_KEY = STORAGE_KEY
