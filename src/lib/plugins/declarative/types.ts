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
  /**
   * 选项来自插件工具而不是清单里的静态列表。
   *
   * 为什么需要它：「书名生成」要让用户勾选书架上的书，而那些书只有运行时才知道。
   * 静态 `options` 写不出这种东西，插件也不能自己画界面（那会打破「宿主渲染」的边界）。
   *
   * 形状：`{ tool: "list_shelf_books", valueField: "id", labelField: "title" }`
   * 宿主渲染表单前先调这个工具，把返回的数组映射成选项。
   */
  optionsFrom?: { tool: string; valueField?: string; labelField?: string; args?: Record<string, unknown> }
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
 * 输出/条目目标的白名单（设计 D2：**枚举**，不是路径）。
 *
 * `run-action` 是内容包条目专用的第五种（设计 §4.1「让 AI 扩写」）：它什么都不写，
 * 只是**再跑同一插件内的另一个 action**。把它收进同一份白名单，而不是让前端
 * 另开一条旁路，是因为"插件能触发什么"必须只有一处清单 —— 白名单一旦分裂，
 * 权限审核看的就不是实际能跑的那一份。
 */
export type OutputTargetKind =
  | "project-field"
  | "insert-at-cursor"
  | "clipboard"
  | "chapter-note"
  | "run-action"

/**
 * 输出目标（设计 D2）：`kind` 是**枚举**，不是路径。
 *
 * 声明式插件虽然不跑代码，但它驱动宿主写项目；一旦允许任意路径，等于给了它
 * 间接的完全写权限，正好抵消 Tier 1 的安全优势。
 */
export interface OutputTarget {
  kind: OutputTargetKind
  field?: string
  /** `kind === "run-action"` 时必填：指向**同一插件内**的另一个 action */
  actionId?: string
  label: string
  confirm?: boolean
}

/**
 * 这个 target 是否可用于「运行另一个 action」。
 *
 * 只允许指向**同一插件内**的 action（调用方先按 `pluginId` 过滤再调本函数）：
 * 跨插件链式调用会形成隐式依赖 —— 卸载其中一个就让另一个静默失效，
 * 而宿主在安装期根本查不出来（那时两边可能都还没装齐）。
 *
 * 抽成类型守卫而不是各处手写 `kind === "run-action" && actionId`：缺 `actionId`
 * 的 `run-action` 是个"点了没反应"的死按钮，这种判断漏一处就是一次线上投诉。
 */
export function isRunnableTarget(target: OutputTarget): target is OutputTarget & { actionId: string } {
  return target.kind === "run-action" && typeof target.actionId === "string" && target.actionId.trim() !== ""
}

export interface ActionOutput {
  mode: OutputMode
  /**
   * 期望的顶层结构（JSON Schema 子集）。缺失时不校验结构，只做"能 parse"判断。
   *
   * 这里只取 `type` 一个键（`array` / `object` / `string`）做**顶层**校验：
   * 完整 JSON Schema 校验在 Rust 侧另有一套（`validate_against_schema`），
   * 两处各管一段。前端若"顺手"实现完整校验，就会与后端行为漂移，
   * 作者在安装期与运行时看到两种结论。
   */
  schema?: unknown
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
  /**
   * 调模型**之前**要跑的插件工具，用来取宿主上下文里没有的素材。
   *
   * 典型场景：「书名生成」要读书架上的书，而 `{{project.*}}` 只给当前打开的那一本。
   * 没有它，那份素材只能让用户手动粘进一个空文本框 —— 那不是一个能交付的体验。
   *
   * 形状：`[{ var: "material", tool: "collect_writing_material", args: { ids: "{{books}}" } }]`
   * 结果按**字符串**放进模板变量（插件负责把结构化数据拍平成可读文本）。
   */
  prepare?: { var?: string; tool?: string; args?: Record<string, unknown> }[]
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
