/**
 * 钩子机制的统一出口（设计 §5）。
 *
 * 与 `declarative/index.ts` 同一条纪律：**不导出 `api.ts`**。
 * `api.ts` 会 import `@tauri-apps/api`，一旦被 barrel 带出去，任何从
 * `@/lib/plugins/hooks` 引入类型的地方（含将来的 `qmai-plugin validate` CLI、
 * Node 里的单测）都会被迫加载 Tauri 运行时。命令封装需要它的调用点自己直连。
 */
export * from "./types"
export * from "./dispatcher"
export * from "./prompt-impl"
