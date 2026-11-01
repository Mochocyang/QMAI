import { useSyncExternalStore } from "react"

import { BUILTIN_PLUGINS, type BuiltinPluginId } from "./builtin"
import {
  builtinPluginsSnapshot,
  isBuiltinPluginEnabled,
  setBuiltinPluginEnabled,
  subscribeBuiltinPlugins,
} from "./builtin-state"

/**
 * 内置插件开关的 React 绑定。
 *
 * 用 `useSyncExternalStore` 而不是往 zustand 里塞字段：开关同时被
 * 插件页、导航栏、页面路由、以及 `lib/web-search.ts` 的非 React 闸门读取，
 * 用外部 store 能让这四处天然一致，不必担心某一处忘了订阅。
 */
export function useBuiltinPluginEnabled(id: BuiltinPluginId): [boolean, (next: boolean) => void] {
  const state = useSyncExternalStore(
    subscribeBuiltinPlugins,
    builtinPluginsSnapshot,
    builtinPluginsSnapshot,
  )
  const enabled = typeof state[id] === "boolean" ? state[id]! : isBuiltinPluginEnabled(id)
  return [enabled, (next: boolean) => setBuiltinPluginEnabled(id, next)]
}

/** 整张开关表（插件页一次渲染多项时用它，避免每项各订阅一次）。 */
export function useBuiltinPluginsState(): Record<BuiltinPluginId, boolean> {
  const state = useSyncExternalStore(
    subscribeBuiltinPlugins,
    builtinPluginsSnapshot,
    builtinPluginsSnapshot,
  )
  const result = {} as Record<BuiltinPluginId, boolean>
  for (const plugin of BUILTIN_PLUGINS) {
    result[plugin.id] =
      typeof state[plugin.id] === "boolean" ? state[plugin.id]! : plugin.defaultEnabled
  }
  return result
}
