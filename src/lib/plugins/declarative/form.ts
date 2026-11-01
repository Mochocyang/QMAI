/**
 * 声明式表单：归一化 → 初始值 → 校验。
 *
 * 三个函数都是纯函数，宿主 UI 只负责渲染。这样拆开的原因是「清单是第三方写来的
 * JSON」：归一化把脏数据收成可用结构，初始值决定用户看到什么，校验决定能不能生成。
 * 任何一步把异常抛出去，用户在插件中心点一个按钮就会看到白屏。
 */
import { FIELD_TYPES, type ActionForm, type FieldType, type FormField } from "./types"

/** 只取「真对象」：数组与 null 都不算，避免 `fields` 写成 `[]` 时被当成对象来读属性。 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function isFieldType(value: unknown): value is FieldType {
  return typeof value === "string" && (FIELD_TYPES as readonly string[]).includes(value)
}

/** 只收有限数字：`NaN` / `Infinity` 当没写（它们一旦进了比较就是恒 false，静默失效）。 */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** 只收正整数（`maxLength` / `rows` / `maxSelected` 这类计数）。 */
function positiveInt(value: unknown): number | undefined {
  const num = finiteNumber(value)
  if (num === undefined) return undefined
  const floored = Math.floor(num)
  return floored > 0 ? floored : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

/**
 * 选项归一到 `{ value, label }[]`。
 *
 * 非法项直接跳过而不是整条字段作废：一个写错的选项不该让整个 action 从插槽里
 * 消失，用户会以为插件坏了。**没有 `value` 的选项也算非法**：`value` 是身份的
 * 唯一来源（它会被插进提示词、也要能回填），拿 label 顶替会让"显示的是玄幻、
 * 发出去的是另一串字"这种错位永远查不出来。
 */
function normalizeOptions(value: unknown): Array<{ value: string; label: string }> | undefined {
  if (!Array.isArray(value)) return undefined
  const options: Array<{ value: string; label: string }> = []
  for (const raw of value) {
    const option = asRecord(raw)
    if (!option) continue
    const optionValue = nonEmptyString(option.value)
    if (optionValue === undefined) continue
    // label 只是展示文案，缺了就用 value 兜底
    options.push({ value: optionValue, label: nonEmptyString(option.label) ?? optionValue })
  }
  return options
}

/**
 * 归一化单个字段；不可用时返回 `undefined` 表示丢弃。
 *
 * **为什么无 key 的字段要丢弃**：表单值是 `Record<key, value>`，没有 key 的字段
 * 拿了值也无处安放 —— 既不能回填、也不能插值、更不能校验。留着它只会渲染出一个
 * 填什么都没用的输入框，属于"看起来能用实则坏了"的最差形态。
 */
/** 解析 optionsFrom：缺 tool 或形状不对就当没写（宁可退回静态选项）。 */
function normalizeOptionsFrom(raw: unknown): FormField["optionsFrom"] {
  if (!raw || typeof raw !== "object") return undefined
  const source = raw as Record<string, unknown>
  const tool = typeof source.tool === "string" ? source.tool.trim() : ""
  if (!tool) return undefined
  const result: NonNullable<FormField["optionsFrom"]> = { tool }
  if (typeof source.valueField === "string" && source.valueField.trim()) {
    result.valueField = source.valueField.trim()
  }
  if (typeof source.labelField === "string" && source.labelField.trim()) {
    result.labelField = source.labelField.trim()
  }
  if (source.args && typeof source.args === "object") {
    result.args = source.args as Record<string, unknown>
  }
  return result
}
function normalizeField(raw: unknown): FormField | undefined {
  const source = asRecord(raw)
  if (!source) return undefined

  const key = nonEmptyString(source.key)
  if (key === undefined) return undefined

  // type 写错/缺失 → 降级 text，不丢字段（设计 §3.2）：我们将来加字段类型时，
  // 老插件不该被新宿主判死；用户至少还能把内容填进去。
  const type: FieldType = isFieldType(source.type) ? source.type : "text"

  const field: FormField = {
    key,
    type,
    label: nonEmptyString(source.label) ?? key,
  }
  const optionsFrom = normalizeOptionsFrom(source.optionsFrom)
  if (optionsFrom) field.optionsFrom = optionsFrom

  const description = nonEmptyString(source.description)
  if (description !== undefined) field.description = description
  const placeholder = nonEmptyString(source.placeholder)
  if (placeholder !== undefined) field.placeholder = placeholder
  if (source.required === true) field.required = true
  // default 原样保留（含 `false` / `0` / `[]`）：`!== undefined` 而不是真值判断，
  // 否则 toggle 的默认 `false` 会被当成"没写默认值"。
  if (source.default !== undefined) field.default = source.default

  const maxLength = positiveInt(source.maxLength)
  if (maxLength !== undefined) field.maxLength = maxLength
  const rows = positiveInt(source.rows)
  if (rows !== undefined) field.rows = rows
  const step = finiteNumber(source.step)
  if (step !== undefined && step > 0) field.step = step
  const maxSelected = positiveInt(source.maxSelected)
  /*
   * optionsFrom 必须显式保留：这个函数是白名单式的，没写的字段会被丢掉，
   * 而不是原样透传。漏了这一步，插件的动态选项就静默退化成空下拉 ——
   * 界面上看起来像这本书没有可选项，而真相是宿主把声明吃了。
   */
  if (maxSelected !== undefined) field.maxSelected = maxSelected

  // number 的上下界：写反了就交换，而不是报错。作者意图明确（"1 到 10"写成
  // "10 到 1"），交换后行为正确；报错则要求用户去改插件清单，代价高得多。
  let min = finiteNumber(source.min)
  let max = finiteNumber(source.max)
  if (min !== undefined && max !== undefined && min > max) {
    const swap = min
    min = max
    max = swap
  }
  if (min !== undefined) field.min = min
  if (max !== undefined) field.max = max

  // options 只属于 select/multiselect；其它类型带着 options 是写错，留着会让 UI
  // 误以为要渲染下拉框。缺 options 时给空数组（保留字段），由 UI 显示"无可选项"。
  if (type === "select" || type === "multiselect") {
    field.options = normalizeOptions(source.options) ?? []
  }

  return field
}

/** 把声明里的 form 归一化成可用字段；未知 type 降级为 text（D3 的同类原则）。 */
export function normalizeForm(form: unknown): ActionForm {
  const source = asRecord(form)
  if (!source) return { fields: [] }
  const rawFields = source.fields
  if (!Array.isArray(rawFields)) return { fields: [] }

  const fields: FormField[] = []
  for (const raw of rawFields) {
    const field = normalizeField(raw)
    if (field) fields.push(field)
  }
  return { fields }
}

/**
 * 初始值：`default` 优先，否则按类型给空值。
 *
 * `number` / `select` 故意**不设**：设成 `0` / 第一项会让用户以为"这就是我选的"，
 * 而 placeholder 至少能提示"请选择"。`multiselect` 给 `[]`、`toggle` 给 `false`，
 * 因为这两者的"空"本身就是一个合法取值，缺了反而让受控组件报警告。
 */
export function initialFormValues(form: ActionForm): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const field of form.fields) {
    if (field.default !== undefined) {
      values[field.key] = field.default
      continue
    }
    switch (field.type) {
      case "text":
      case "textarea":
        values[field.key] = ""
        break
      case "multiselect":
        values[field.key] = []
        break
      case "toggle":
        values[field.key] = false
        break
      case "number":
      case "select":
        break
    }
  }
  return values
}

export type FormValidationResult =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> }

/** 「空」的口径：没填 / null / 全空白字符串 / 空数组。`0` 与 `false` 都是有效值。 */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === "string") return value.trim() === ""
  if (Array.isArray(value)) return value.length === 0
  return false
}

/** 数字强制：`"5"` → `5`（数字输入框在不同浏览器里给字符串，不能只认 number）。 */
function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed === "") return undefined
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase()
    return trimmed === "true" || trimmed === "1"
  }
  return Boolean(value)
}

/**
 * 校验：返回 `{ ok: true, values }` 或 `{ ok: false, errors }`。
 *
 * 错误按字段 key 聚合而不是"遇到第一个就抛"：表单要一次把所有问题标红，
 * 让用户来回提交 6 次是最差的交互。
 */
export function validateFormValues(
  form: ActionForm,
  values: Record<string, unknown>,
): FormValidationResult {
  const errors: Record<string, string> = {}
  // 从副本出发：调用方的对象不该被我们改写（它通常还挂在 React state 上）。
  const coerced: Record<string, unknown> = { ...values }

  for (const field of form.fields) {
    const raw = values[field.key]

    if (isEmptyValue(raw)) {
      if (field.required) {
        errors[field.key] = `请填写${field.label}`
      }
      // 非必填的空值不做类型检查也不再强制转换：用户就是没填，把空串转成 0/false
      // 会往提示词里塞进"0"这种用户从未输入过的噪音。
      continue
    }

    switch (field.type) {
      case "text":
      case "textarea": {
        const text = typeof raw === "string" ? raw : String(raw)
        const maxLength = field.maxLength
        // 按码点计数：UTF-16 长度会把 emoji 记成 2，用户看到"只写了 3 个字却说超长"。
        if (maxLength !== undefined && Array.from(text).length > maxLength) {
          errors[field.key] = `${field.label}不能超过 ${maxLength} 个字符`
          continue
        }
        coerced[field.key] = text
        break
      }

      case "number": {
        const num = toNumber(raw)
        if (num === undefined) {
          errors[field.key] = `${field.label}必须是数字`
          continue
        }
        if (field.min !== undefined && num < field.min) {
          errors[field.key] = `${field.label}不能小于 ${field.min}`
          continue
        }
        if (field.max !== undefined && num > field.max) {
          errors[field.key] = `${field.label}不能大于 ${field.max}`
          continue
        }
        coerced[field.key] = num
        break
      }

      case "select": {
        const options = field.options ?? []
        const candidate = typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : undefined
        if (options.length === 0) {
          // 清单写了 select 却没给选项：这是插件作者的问题，但用户只会看到"填不了"，
          // 所以给一句能看懂的话，别抛异常。
          errors[field.key] = `${field.label}暂无可选项`
          continue
        }
        if (candidate === undefined || !options.some((option) => option.value === candidate)) {
          errors[field.key] = `${field.label}的选项无效`
          continue
        }
        coerced[field.key] = candidate
        break
      }

      case "multiselect": {
        if (!Array.isArray(raw)) {
          errors[field.key] = `${field.label}的选项无效`
          continue
        }
        const selected: string[] = []
        for (const item of raw) {
          if (typeof item === "string") selected.push(item)
          else if (typeof item === "number" || typeof item === "boolean") selected.push(String(item))
          // 对象/数组表达不了选项 value，跳过：渲染成 "[object Object]" 只会让用户困惑
        }
        if (field.maxSelected !== undefined && selected.length > field.maxSelected) {
          errors[field.key] = `${field.label}最多只能选 ${field.maxSelected} 项`
          continue
        }
        coerced[field.key] = selected
        break
      }

      case "toggle": {
        coerced[field.key] = toBoolean(raw)
        break
      }
    }
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values: coerced }
}
