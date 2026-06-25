import { useMemo } from "react"
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

export function buildModelSelectOptions(value: string, options: string[]): ModelSelectOption[] {
  const current = value.trim()
  const fetched = Array.from(new Set(options.map((item) => item.trim()).filter(Boolean)))
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

  const hasFetchedModels = options.length > 0

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
        <select
          value={value.trim() || "__empty__"}
          onChange={(event) => {
            const selected = event.target.value
            if (selected !== "__empty__") {
              onChange(selected)
            }
          }}
          className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
        >
          <option value="__empty__">{selectPlaceholder}</option>
          {selectOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
