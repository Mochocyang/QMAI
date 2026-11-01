/**
 * 提示词变量插值：`{{name}}` / `{{config.x}}` / `{{project.x}}` / `{{chapter.x}}` / `{{selection}}`。
 *
 * 这是声明式插件唯一"能读到宿主数据"的地方，因此它同时承担第二个职责：
 * `requiresProjectAccess` 让校验器在安装/启用阶段就判断该 action 是否需要
 * `fs:project-read`（设计 §3.3：缺权限的 action 在校验阶段就被拒绝，而不是
 * 运行时才失败 —— 用户已经把表单填完才报错是最糟的时机）。
 */

export interface InterpolationScope {
  fields: Record<string, unknown>
  config?: Record<string, unknown>
  project?: {
    bookTitle?: string
    bookTags?: string[]
    bookIntro?: string
    protagonist?: string
    setting?: string
  }
  chapter?: { title?: string; text?: string }
  selection?: string
}

/**
 * 一个正则同时认「转义」与「变量」，一次性扫完。
 *
 * 为什么不用两趟（先把 `\{{` 换占位符再插值）：两趟要在两次 replace 之间搬运
 * 占位符，占位符本身可能与原文冲突（作者真写了 `\u0000` 就露馅）。一趟扫描
 * 遇到 `\{{` 直接吐字面量 `{{`，后续的 `}}` 天然留在原文里，语义干净。
 */
const TOKEN_PATTERN = /\\\{\{|\{\{\s*([^{}]*?)\s*\}\}/g

const CONFIG_PREFIX = "config."
const PROJECT_PREFIX = "project."
const CHAPTER_PREFIX = "chapter."
const SELECTION_NAME = "selection"

/** 点路径读取（`readPath(project, "bookTags")`）；任一层不是对象就当没读到。 */
function readPath(root: unknown, path: string): unknown {
  let current: unknown = root
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/**
 * 命名空间解析顺序：`config.` → `project.` → `chapter.` → 裸名查 `fields` → `selection`。
 *
 * `fields` 在 `selection` 之前，是为了让作者能用一个同名的表单字段覆盖内置选区
 * （例如"选区"作为普通输入框）；反过来排，作者就永远抢不到这个名字。
 */
function resolveValue(name: string, scope: InterpolationScope): unknown {
  if (name.startsWith(CONFIG_PREFIX)) return readPath(scope.config, name.slice(CONFIG_PREFIX.length))
  if (name.startsWith(PROJECT_PREFIX)) return readPath(scope.project, name.slice(PROJECT_PREFIX.length))
  if (name.startsWith(CHAPTER_PREFIX)) return readPath(scope.chapter, name.slice(CHAPTER_PREFIX.length))
  const fields = scope.fields ?? {}
  if (Object.prototype.hasOwnProperty.call(fields, name)) return fields[name]
  if (name === SELECTION_NAME) return scope.selection
  return undefined
}

/** 单值转字符串；对象用 JSON 兜底，好过 `[object Object]`。 */
function stringifyScalar(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value)
  }
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    // 循环引用之类：模板渲染绝不该因此炸掉（D3 的同类原则）
    return ""
  }
}

/**
 * 值 → 文本。数组按**中文顿号**连接（设计 §3.3）：`bookTags` / 多选题的值
 * 直接进中文提示词，逗号拼接会让模型把"科幻,末世"当成一个标签。
 */
function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => stringifyScalar(item)).filter((item) => item !== "").join("、")
  }
  return stringifyScalar(value)
}

/**
 * `{{a.b}}` 替换；未知变量替换为空串并记入 `missing`。
 *
 * 未知变量**不抛错**：提示词可能为不同 action 复用，缺一个变量就让整次生成失败
 * 是过度反应。空串 + `missing` 让调用方自己决定是提示还是记日志。
 */
export function interpolate(
  template: string,
  scope: InterpolationScope,
): { text: string; missing: string[] } {
  const missing: string[] = []

  const text = template.replace(TOKEN_PATTERN, (match: string, rawName?: string) => {
    // `\{{`：作者要的是字面量。它不参与插值，也不该出现在 missing 里。
    if (rawName === undefined) return "{{"

    const name = rawName.trim()
    // `{{}}` / `{{ }}` 是写法错误：原样留下，让作者一眼看到问题，别悄悄吞掉
    if (name === "") return match

    const value = resolveValue(name, scope)
    if (value === undefined || value === null) {
      // 同一变量引用多次只记一次：missing 是给作者看的清单，不是出现次数统计
      if (!missing.includes(name)) missing.push(name)
      return ""
    }
    return formatValue(value)
  })

  return { text, missing }
}

/** 抽出模板里引用的所有变量名（去重、保留首次出现顺序），供校验器使用。 */
export function collectVariables(template: string): string[] {
  const names: string[] = []
  // 每次调用都要重置 lastIndex：带 g 的正则是有状态的，复用同一个字面量
  // 在两次调用之间会残留位置，导致第二次少匹配若干个变量。
  const pattern = new RegExp(TOKEN_PATTERN.source, "g")
  let match: RegExpExecArray | null
  while ((match = pattern.exec(template)) !== null) {
    const rawName = match[1]
    if (rawName === undefined) continue // 转义 `\{{`，不是变量
    const name = rawName.trim()
    if (name === "") continue
    if (!names.includes(name)) names.push(name)
  }
  return names
}

/**
 * 模板是否引用了项目上下文（决定是否需要 `fs:project-read`）。
 *
 * 只看变量的命名空间，不看值：这个判断发生在校验阶段，那时还没有真实项目，
 * 也因此必须纯静态 —— 依赖运行期数据会让"该 action 有没有权限"变得不确定。
 */
export function requiresProjectAccess(template: string): boolean {
  return collectVariables(template).some((name) => {
    if (name === SELECTION_NAME) return true
    return name.startsWith(PROJECT_PREFIX) || name.startsWith(CHAPTER_PREFIX)
  })
}
