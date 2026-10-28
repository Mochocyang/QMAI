/**
 * 通用字段渲染器：**一个组件同时服务 `action.form` 与插件 `configSchema`**（设计 §6.3）。
 *
 * 为什么不写两套表单：
 *   - 作者视角：同一个插件里"生成用的表单"和"设置页的配置"长得一样，学一次就够；
 *   - 维护视角：字段类型（6 种）与约束（必填/长度/上下界）只有一份实现，
 *     不会出现"设置页校验通过、生成表单却拦下"这种两处结论打架的问题。
 *
 * 本组件只渲染与回调，**不做校验**：校验归 `form.ts`（`validateFormValues`），
 * 因为同一套规则还要被将来的 `qmai-plugin validate` CLI 复用。这里若再校验一遍，
 * 就是个必然漂移的第二实现。
 */
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { ActionForm, FormField } from "@/lib/plugins/declarative/types"
import { cn } from "@/lib/utils"

export interface SchemaFormProps {
  form: ActionForm
  values: Record<string, unknown>
  errors?: Record<string, string>
  onChange: (values: Record<string, unknown>) => void
  disabled?: boolean
  /**
   * 需要按密码框渲染的字段（`configSchema` 里 `format: "password"` / `x-qmai-secret`）。
   *
   * secret 字段的另一半语义在 `ConfigForm`：**不回填已有值**（Rust 也不返回真值），
   * 所以输入框永远是空的，占位文案要说清"留空表示不修改"。
   */
  passwordKeys?: readonly string[]
}

/** 输入框 id 与 `<label htmlFor>` 的唯一关联点：用字段 key 而不是随机 id，测试也好写。 */
export function fieldInputId(fieldKey: string): string {
  return `schema-field-${fieldKey}`
}

/**
 * 控件原始值 → 表单值。
 *
 * 数字框为什么单独处理：`<input type="number">` 在空值时给 `""`，在清空过程中也可能
 * 给 `""`。把它原样存成 `""` 会绕过 `validateFormValues` 的 number 分支（它把空串
 * 当"没填"），于是"用户清空后仍提交上一次的旧值"。这里统一：空 → `undefined`。
 */
export function coerceFieldValue(field: FormField, raw: unknown): unknown {
  switch (field.type) {
    case "number": {
      if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined
      if (typeof raw !== "string") return undefined
      const trimmed = raw.trim()
      if (trimmed === "") return undefined
      const parsed = Number(trimmed)
      // 非法中间态（"1e"、"-"）先按原文留着，让用户能继续敲；校验阶段会报"必须是数字"
      return Number.isFinite(parsed) ? parsed : raw
    }
    case "toggle":
      return raw === true
    case "multiselect":
      return Array.isArray(raw) ? raw.map((item) => String(item)) : []
    default:
      return typeof raw === "string" ? raw : raw === undefined || raw === null ? "" : String(raw)
  }
}

/**
 * 多选的一个勾/取消。
 *
 * `maxSelected` 到顶后**不再增加**而不是报错：报错要求用户先去取消一项再勾新的，
 * 而"勾到不能再勾"是不会出错的最短路径（勾不上的那一项由界面上禁用态解释原因）。
 */
export function toggleMultiSelectValue(
  current: unknown,
  optionValue: string,
  maxSelected?: number,
): string[] {
  const selected = Array.isArray(current) ? current.map((item) => String(item)) : []
  if (selected.includes(optionValue)) return selected.filter((item) => item !== optionValue)
  if (maxSelected !== undefined && selected.length >= maxSelected) return selected
  return [...selected, optionValue]
}

function fieldControl(
  field: FormField,
  values: Record<string, unknown>,
  disabled: boolean,
  password: boolean,
  update: (value: unknown) => void,
) {
  const id = fieldInputId(field.key)
  const value = values[field.key]

  switch (field.type) {
    case "textarea":
      return (
        <Textarea
          id={id}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          rows={field.rows ?? 4}
          maxLength={field.maxLength}
          disabled={disabled}
          onChange={(event) => update(event.target.value)}
        />
      )

    case "number":
      return (
        <Input
          id={id}
          type="number"
          value={typeof value === "number" ? String(value) : typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          step={field.step}
          disabled={disabled}
          onChange={(event) => update(event.target.value)}
        />
      )

    case "select": {
      const options = field.options ?? []
      // 没有选项的下拉框必须**禁用**并说明原因：可点却什么都选不了，
      // 用户只会反复点它。选项为空是插件作者的问题，但不能让用户去猜。
      const empty = options.length === 0
      return (
        <select
          id={id}
          value={typeof value === "string" ? value : value === undefined || value === null ? "" : String(value)}
          disabled={disabled || empty}
          onChange={(event) => update(event.target.value === "" ? undefined : event.target.value)}
          className={cn(
            "h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <option value="">{empty ? "暂无可选项" : "请选择"}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )
    }

    case "multiselect": {
      const options = field.options ?? []
      const selected = Array.isArray(value) ? value.map((item) => String(item)) : []
      if (options.length === 0) {
        return (
          <p className="text-xs text-muted-foreground" data-multiselect-empty="true">
            暂无可选项
          </p>
        )
      }
      const atLimit = field.maxSelected !== undefined && selected.length >= field.maxSelected
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {options.map((option) => {
            const checked = selected.includes(option.value)
            return (
              <label
                key={option.value}
                htmlFor={`${id}-${option.value}`}
                className={cn(
                  "flex items-center gap-1.5 text-sm",
                  disabled || (atLimit && !checked) ? "opacity-60" : "cursor-pointer",
                )}
              >
                <input
                  id={`${id}-${option.value}`}
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || (atLimit && !checked)}
                  onChange={() => update(toggleMultiSelectValue(selected, option.value, field.maxSelected))}
                />
                {option.label}
              </label>
            )
          })}
        </div>
      )
    }

    case "toggle":
      return (
        <Switch
          checked={value === true}
          disabled={disabled}
          // Switch 是 role="switch" 的按钮，没有可关联的 label htmlFor；
          // 无障碍名走 aria-label（由 label 属性传入），视觉标签单独渲染。
          label={field.label}
          onChange={(next) => update(next)}
        />
      )

    case "text":
    default:
      return (
        <Input
          id={id}
          type={password ? "password" : "text"}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          disabled={disabled}
          autoComplete={password ? "new-password" : undefined}
          onChange={(event) => update(event.target.value)}
        />
      )
  }
}

export function SchemaForm({
  form,
  values,
  errors,
  onChange,
  disabled = false,
  passwordKeys,
}: SchemaFormProps) {
  const fields = form?.fields ?? []
  if (fields.length === 0) return null

  const update = (key: string, value: unknown) => {
    onChange({ ...values, [key]: value })
  }

  return (
    <div className="space-y-4" data-schema-form="true">
      {fields.map((field) => {
        const id = fieldInputId(field.key)
        const error = errors?.[field.key]
        const password = passwordKeys?.includes(field.key) ?? false
        return (
          <div key={field.key} className="space-y-1.5" data-schema-field={field.key}>
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={field.type === "toggle" ? undefined : id} className="text-sm">
                <span>{field.label}</span>
                {field.required ? (
                  <>
                    <span aria-hidden="true" className="text-destructive">
                      *
                    </span>
                    <span className="sr-only">（必填）</span>
                  </>
                ) : null}
              </Label>
              {field.type === "toggle" ? (
                fieldControl(field, values, disabled, password, (value) => update(field.key, value))
              ) : null}
            </div>

            {field.type === "toggle" ? null : fieldControl(field, values, disabled, password, (value) =>
              update(field.key, value),
            )}

            {field.description ? (
              <p className="text-xs leading-relaxed text-muted-foreground">{field.description}</p>
            ) : null}

            {error ? (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
