/**
 * 声明式引擎（Tier 1）统一出口。
 *
 * 这一层零 Tauri 依赖、零副作用：C1 的插槽/对话框组件、将来的 `qmai-plugin validate`
 * CLI、以及单测都从这里进。统一出口的意义是**消费方只有一条路径** ——
 * 谁都不需要知道规则落在哪个文件，重构时也不会漏改调用点。
 */
export * from "./types"
export * from "./form"
export * from "./interpolate"
export * from "./output"
export * from "./content-pack"
