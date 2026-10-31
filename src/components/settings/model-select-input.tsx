import { useMemo } from "react"
import { ChevronDown, ListFilter } from "lucide-react"
import { Input } from "@/components/ui/input"

interface ModelSelectInputProps {
  value: string
  options: string[]
  selectPlaceholder: string
  inputPlaceholder: string
  onChange: (value: string) => void
}

interface ModelSelectOption {
  value: string
  label: string
}

/**
 * 容错读取字符串。
 *
 * 为什么需要：`value` / `options` 类型上声明为 string / string[]，
 * 但它们来自持久化的设置草稿。旧版本保存的配置可能缺字段，
 * 反序列化后实际是 undefined —— 直接调 .trim() 会抛
 * 「Cannot read properties of undefined (reading 'trim')」，整个设置页白屏。
 *
 * 这类数据边界不该靠调用方保证，组件自己兜住更稳。
 */
function safeString(input: unknown): string {
  return typeof input === "string" ? input : ""
}

function buildModelSelectOptions(value: string, options: string[]): ModelSelectOption[] {
  const current = safeString(value).trim()
  // 过滤非字符串项：数组里混进 null/undefined 时同样会崩
  const fetched = Array.from(
    new Set(
      (Array.isArray(options) ? options : [])
        .map((item) => safeString(item).trim())
        .filter(Boolean),
    ),
  )
  const hasFetchedModels = fetched.length > 0
  const hasCurrentInFetched = current ? fetched.includes(current) : false
  const ordered = current && hasCurrentInFetched
    ? [current, ...fetched.filter((model) => model !== current)]
    : fetched

  if (current && hasFetchedModels && !hasCurrentInFetched) {
    return [
      { value: current, label: `当前填写：${current}（不在已拉取模型中）` },
      ...ordered.map((model) => ({ value: model, label: model })),
    ]
  }

  if (current && !hasFetchedModels) {
    return [{ value: current, label: current }]
  }

  return ordered.map((model) => ({ value: model, label: model }))
}

export function ModelSelectInput({
  value,
  options,
  selectPlaceholder,
  inputPlaceholder,
  onChange,
}: ModelSelectInputProps) {
  const selectOptions = useMemo(
    () => buildModelSelectOptions(value, options),
    [options, value],
  )

  const hasFetchedModels = Array.isArray(options) && options.length > 0

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={value}
        onValueChange={(newValue) => onChange(newValue)}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={inputPlaceholder}
        className="w-full"
      />
      {hasFetchedModels && (
        // 拉取成功后这里才是主入口：用主题色描边 + 计数说明把它和普通输入框区分开，
        // 让用户一眼看到「模型可以直接点这里选」，不必再去手动敲模型 ID。
        <div className="rounded-lg border border-primary/50 bg-primary/5 p-2">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-primary">
            <ListFilter className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            已拉取 {options.length} 个模型，点这里直接选择
          </p>
          <div className="relative">
            <select
              aria-label={selectPlaceholder}
              value={safeString(value).trim() || "__empty__"}
              onChange={(event) => {
                const selected = event.target.value
                if (selected !== "__empty__") {
                  onChange(selected)
                }
              }}
              className="h-9 w-full appearance-none rounded-md border border-primary/60 bg-background py-1 pr-9 pl-3 text-sm font-medium outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <option value="__empty__">{selectPlaceholder}</option>
              {selectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 text-primary"
              aria-hidden="true"
            />
          </div>
        </div>
      )}
    </div>
  )
}
