/**
 * 插件配置表单（设计 §6.3）。
 *
 * 与 action 表单**共用同一个渲染器**（`SchemaForm`）：把 `configSchema.properties`
 * 转成 `FormField[]` 再交给它渲染。这样"字段类型怎么画、必填星号怎么标、错误怎么放"
 * 只有一份实现。
 *
 * 密钥字段（`format: "password"` 或 `"x-qmai-secret": true`）的额外两条规矩：
 *   1. **不回填**：Rust 的 `plugins_config_get` 对 secret 字段返回空串，界面上
 *      输入框永远是空的 —— 显示一串圆点会让人以为"值已经在这里了"；
 *   2. **单独写**：走 `plugins_config_secret_set`（内存存储、不落盘），
 *      普通字段走 `plugins_config_set`。两条命令不能合并：合并就等于要求
 *      "保存普通配置时必须重填一次密钥"。
 */
import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { declarativePluginsApi } from "@/lib/plugins/declarative/api"
import { initialFormValues, validateFormValues } from "@/lib/plugins/declarative/form"
import type { ActionForm, FieldType, FormField } from "@/lib/plugins/declarative/types"
import { toast } from "@/lib/toast"
import { SchemaForm } from "./SchemaForm"

export interface ConfigSchemaConversion {
  fields: FormField[]
  /** 需要按密码框渲染、且不落盘的字段 key */
  secretKeys: string[]
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

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function positiveInt(value: unknown): number | undefined {
  const num = finiteNumber(value)
  if (num === undefined) return undefined
  const floored = Math.floor(num)
  return floored > 0 ? floored : undefined
}

/**
 * JSON Schema 子集 → `FormField[]`。
 *
 * 只认宿主真正会渲染的形状：`string` / `number` / `integer` / `boolean` 与
 * `string + enum`。对象/数组类型的配置项**跳过**（渲染一个"填 JSON"的文本框
 * 只会制造无效输入），跳过时 `console.warn` 一句，作者能据此改清单。
 */
export function convertConfigSchema(schema: unknown): ConfigSchemaConversion {
  const source = asRecord(schema)
  const properties = asRecord(source?.properties)
  if (!properties) return { fields: [], secretKeys: [] }

  const requiredKeys = new Set<string>(
    Array.isArray(source?.required) ? (source.required as unknown[]).filter((key): key is string => typeof key === "string") : [],
  )

  const fields: FormField[] = []
  const secretKeys: string[] = []

  for (const [key, rawProperty] of Object.entries(properties)) {
    const property = asRecord(rawProperty)
    if (!property) continue

    const label = nonEmptyString(property.title) ?? key
    const enumValues = Array.isArray(property.enum) ? property.enum : undefined
    const declaredType = nonEmptyString(property.type)

    let type: FieldType
    if (enumValues && enumValues.length > 0) {
      type = "select"
    } else if (declaredType === "number" || declaredType === "integer") {
      type = "number"
    } else if (declaredType === "boolean") {
      type = "toggle"
    } else if (declaredType === "string" || declaredType === undefined) {
      type = "text"
    } else {
      console.warn(`[plugins] 配置项 ${key} 的类型 ${declaredType} 暂不支持，已跳过渲染`)
      continue
    }

    const field: FormField = { key, type, label }
    const description = nonEmptyString(property.description)
    if (description !== undefined) field.description = description
    if (requiredKeys.has(key)) field.required = true
    if (property.default !== undefined) field.default = property.default

    if (type === "select") {
      field.options = (enumValues ?? [])
        .map((value) => (typeof value === "string" || typeof value === "number" ? String(value) : undefined))
        .filter((value): value is string => value !== undefined)
        .map((value) => ({ value, label: value }))
    }

    if (type === "number") {
      const min = finiteNumber(property.minimum)
      const max = finiteNumber(property.maximum)
      if (min !== undefined) field.min = min
      if (max !== undefined) field.max = max
      const step = finiteNumber(property.multipleOf)
      if (step !== undefined && step > 0) field.step = step
    }

    if (type === "text") {
      const maxLength = positiveInt(property.maxLength)
      if (maxLength !== undefined) field.maxLength = maxLength
      const placeholder = nonEmptyString(property.placeholder)
      if (placeholder !== undefined) field.placeholder = placeholder
      // 密钥：`format: "password"`（标准写法）与 `x-qmai-secret`（本平台扩展）都算
      if (property.format === "password" || property["x-qmai-secret"] === true) {
        secretKeys.push(key)
        field.description = description ?? "不会落盘保存，留空表示不修改。"
      }
    }

    fields.push(field)
  }

  return { fields, secretKeys }
}

/**
 * 密钥字段的必填判定（与 `validateFormValues` 分开，见 `save()` 的注释）。
 *
 * 规则只有三条：**已设过的算满足**、**这次填了算满足**、两者都没有且
 * `required` 才报错。抽成纯函数是为了能直接测 —— 这段逻辑一旦错了，
 * 用户要么被迫每次重输密钥，要么在没密钥的情况下保存成功、之后运行时才炸。
 */
export function collectSecretErrors(
  fields: FormField[],
  secretKeys: string[],
  values: Record<string, unknown>,
  secretPresent: Record<string, boolean>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const key of secretKeys) {
    const field = fields.find((candidate) => candidate.key === key)
    const typed = typeof values[key] === "string" && (values[key] as string).trim() !== ""
    if (field?.required && !typed && !secretPresent[key]) {
      errors[key] = `请填写${field.label}`
    }
  }
  return errors
}

export interface ConfigFormProps {  pluginId: string
  pluginName: string
  configSchema: unknown
  onSaved?: () => void
}

export function ConfigForm({ pluginId, pluginName, configSchema, onSaved }: ConfigFormProps) {
  const { fields, secretKeys } = useMemo(() => convertConfigSchema(configSchema), [configSchema])
  const form: ActionForm = useMemo(() => ({ fields }), [fields])

  const [values, setValues] = useState<Record<string, unknown>>(() => initialFormValues({ fields }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [secretPresent, setSecretPresent] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setSaveError("")
    void declarativePluginsApi
      .configGet(pluginId)
      .then((stored) => {
        if (cancelled) return
        const next = initialFormValues({ fields })
        for (const field of fields) {
          const storedValue = stored[field.key]
          if (storedValue === undefined) continue
          // secret 字段一律留空：Rust 也不会把真值发回来，回填只会是"半截真相"
          if (secretKeys.includes(field.key)) continue
          next[field.key] = storedValue
        }
        setValues(next)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    void Promise.all(
      secretKeys.map(async (key) => [key, await declarativePluginsApi.configSecretHas(pluginId, key)] as const),
    ).then((entries) => {
      if (cancelled) return
      setSecretPresent(Object.fromEntries(entries))
    })

    return () => {
      cancelled = true
    }
    // fields/secretKeys 由 configSchema 派生，等价于 configSchema 变化
  }, [pluginId, fields, secretKeys])

  async function save() {
    /*
     * 只校验**非密钥**字段。
     *
     * 若把 secret 字段一起走 `validateFormValues`，一个 `required` 的 apiKey 会在
     * "已经存过、这次只想改别的项"时被判定为空并拦住保存 —— 用户被迫重新输密钥，
     * 而密钥本来就不回填。所以密钥的必填判定单独做：有输入或有存量才算满足。
     */
    const nonSecretFields = fields.filter((field) => !secretKeys.includes(field.key))
    const validation = validateFormValues({ fields: nonSecretFields }, values)
    if (!validation.ok) {
      setErrors(validation.errors)
      return
    }

    const secretErrors: Record<string, string> = collectSecretErrors(fields, secretKeys, values, secretPresent)
    if (Object.keys(secretErrors).length > 0) {
      setErrors(secretErrors)
      return
    }

    setErrors({})
    setSaving(true)
    setSaveError("")
    try {
      const payload: Record<string, unknown> = {}
      for (const field of nonSecretFields) {
        payload[field.key] = validation.values[field.key]
      }

      const result = await declarativePluginsApi.configSet(pluginId, payload)
      if (!result.ok) {
        // Rust 的中文原文原样展示：用户/作者据此才知道是哪一项不合规
        setSaveError(result.error ?? "保存失败，请重试。")
        return
      }

      for (const key of secretKeys) {
        const value = values[key]
        if (typeof value !== "string" || value === "") continue
        const secretResult = await declarativePluginsApi.configSecretSet(pluginId, key, value)
        if (!secretResult.ok) {
          setSaveError(secretResult.error ?? "保存密钥失败，请重试。")
          return
        }
        setSecretPresent((previous) => ({ ...previous, [key]: true }))
        // 存成功就清空输入框：密钥不回填，留着只会被下一次保存重复写入
        setValues((previous) => ({ ...previous, [key]: "" }))
      }

      toast.success(`已保存「${pluginName}」的配置`)
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  if (fields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-plugin-config="empty">
        该插件没有可配置项。
      </p>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" />
        正在读取配置…
      </div>
    )
  }

  return (
    <div className="space-y-3" data-plugin-config={pluginId}>
      <SchemaForm
        form={form}
        values={values}
        errors={errors}
        onChange={setValues}
        disabled={saving}
        passwordKeys={secretKeys}
      />

      {secretKeys.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {secretKeys
            .map((key) => `${fields.find((field) => field.key === key)?.label ?? key}${secretPresent[key] ? "（已设置）" : "（未设置）"}`)
            .join(" · ")}
        </p>
      ) : null}

      {saveError ? (
        <div
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="min-w-0 break-words">{saveError}</p>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="button" disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {saving ? "保存中…" : "保存配置"}
        </Button>
      </div>
    </div>
  )
}
