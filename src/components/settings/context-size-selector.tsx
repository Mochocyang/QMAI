import { useTranslation } from "react-i18next"
import { normalizeUserLlmContextSize } from "@/lib/llm-context-size"

const CONTEXT_PRESETS = [
  { value: 204800, label: "200K" },
  { value: 262144, label: "256K" },
  { value: 307200, label: "300K" },
  { value: 409600, label: "400K" },
  { value: 524288, label: "512K" },
  { value: 1000000, label: "1M" },
]

function formatSize(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1024) return `${Math.round(tokens / 1024)}K`
  return String(tokens)
}

export function ContextSizeSelector({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  const { t } = useTranslation()
  const normalizedValue = normalizeUserLlmContextSize(value)
  const closestIndex = CONTEXT_PRESETS.reduce((best, preset, i) => {
    return Math.abs(preset.value - normalizedValue) < Math.abs(CONTEXT_PRESETS[best].value - normalizedValue)
      ? i
      : best
  }, 0)
  const pct = (closestIndex / (CONTEXT_PRESETS.length - 1)) * 100

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">
          {t("settings.sections.llm.contextWindowValue", { value: formatSize(normalizedValue) })}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={CONTEXT_PRESETS.length - 1}
        step={1}
        value={closestIndex}
        onChange={(e) => onChange(CONTEXT_PRESETS[parseInt(e.target.value)].value)}
        className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
        style={{
          background: `linear-gradient(to right, #4f46e5 ${pct}%, #e5e7eb ${pct}%)`,
        }}
      />
      <div className="flex justify-between mt-1">
        {CONTEXT_PRESETS.map((preset, i) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => onChange(preset.value)}
            className={`text-[9px] px-0.5 ${
              i === closestIndex ? "text-primary font-bold" : "text-muted-foreground/50"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">
        {t("settings.sections.llm.contextWindowHint")}
      </p>
    </div>
  )
}
