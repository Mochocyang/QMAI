/**
 * 声明式插件（Tier 1）的类型契约。
 *
 * 字段名与 `plugin.json` 里的 camelCase **逐字对齐**（`maxItems` / `maxSelected` /
 * `maxContextTokens` …）：清单由 Rust 侧透传，这里若换成 snake_case，前端就得在
 * 每个消费点做一次翻译，漏改一处就是「默认值静默失效」这种最难查的 bug。
 *
 * 本目录全部是纯逻辑：不 import `@tauri-apps/api`、不碰 `window`、不读文件、不发请求。
 * 这样它能被单独测试（本仓 Vitest 是 `environment: "node"`），也能被将来的
 * `qmai-plugin validate` CLI 直接复用 —— 校验规则只有一份，宿主与 CLI 才不会漂移。
 */

export type FieldType = "text" | "textarea" | "number" | "select" | "multiselect" | "toggle"

/**
 * 六种字段类型（设计 §3.2：本期只做 6 种）。
 *
 * 单独导出常量数组，供 `normalizeForm` 做白名单判断：类型写错的插件降级成 `text`
 * 而不是被丢弃，理由见 `form.ts` 里 `normalizeField` 的注释。
 */
export const FIELD_TYPES: readonly FieldType[] = [
  "text",
  "textarea",
  "number",
  "select",
  "multiselect",
  "toggle",
]

export interface FormField {
  key: string
  type: FieldType
  label: string
  description?: string
  placeholder?: string
  required?: boolean
  default?: unknown
  maxLength?: number
  rows?: number
  min?: number
  max?: number
  step?: number
  maxSelected?: number
  options?: Array<{ value: string; label: string }>
}

export interface ActionForm {
  fields: FormField[]
}

export interface ActionPrompt {
  system: string
  user: string
}

export type OutputMode = "list" | "text" | "json"

/**
 * 输出目标（设计 D2）：`kind` 是**枚举**，不是路径。
 *
 * 声明式插件虽然不跑代码，但它驱动宿主写项目；一旦允许任意路径，等于给了它
 * 间接的完全写权限，正好抵消 Tier 1 的安全优势。
 */
export interface OutputTarget {
  kind: "project-field" | "insert-at-cursor" | "clipboard" | "chapter-note"
  field?: string
  label: string
  confirm?: boolean
}

export interface ActionOutput {
  mode: OutputMode
  presentation?: "chips" | "markdown" | "plain"
  maxItems?: number
  targets: OutputTarget[]
}

export interface DeclarativeAction {
  id: string
  title: string
  description?: string
  slot?: string
  form?: ActionForm
  prompt: ActionPrompt
  output: ActionOutput
  model?: { strategy?: "current"; minContextTokens?: number }
  limits?: { timeoutMs?: number; maxOutputTokens?: number }
}

export interface ContentPackItem {
  id: string
  title: string
  body: string
  tags?: string[]
}

export interface ContentPack {
  id: string
  title: string
  description?: string
  slot?: string
  items: ContentPackItem[]
  actions?: OutputTarget[]
}
