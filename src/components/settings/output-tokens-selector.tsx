import { useTranslation } from "react-i18next"
import { normalizeUserLlmMaxOutputTokens } from "@/lib/llm-context-size"

const OUTPUT_TOKEN_PRESETS = [
  { value: 65536, label: "64K" },
  { value: 131072, label: "128K" },
  { value: 262144, label: "256K" },
  { value: 393216, label: "384K" },
]

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${Math.round(tokens / 1024)}K`
  return String(tokens)
}

/**
 * Declares how much the selected model can emit in one response — a capability
 * ceiling, not a request size. Each workflow asks for what it needs and this
 * only ever caps it, so raising the slider does not make responses longer.
 */
export function OutputTokensSelector({
  value,
  contextWindow,
  onChange,
}: {
  value: number | undefined
  contextWindow?: number
  onChange: (v: number) => void
}) {
  const { t } = useTranslation()
  const normalizedValue = normalizeUserLlmMaxOutputTokens(value)
  const closestIndex = OUTPUT_TOKEN_PRESETS.reduce((best, preset, i) => {
    return Math.abs(preset.value - normalizedValue) < Math.abs(OUTPUT_TOKEN_PRESETS[best].value - normalizedValue)
      ? i
      : best
  }, 0)
  const pct = (closestIndex / (OUTPUT_TOKEN_PRESETS.length - 1)) * 100
  // Output and input share one window. Spec sheets often list both as the same
  // size (e.g. Doubao 256K/256K); that is a valid capability, not overflow.
  // Only warn when the declared ceiling is strictly larger than the window.
  const exceedsWindow =
    typeof contextWindow === "number" && contextWindow > 0 && normalizedValue > contextWindow

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">
          {t("settings.sections.llm.maxOutputTokensValue", { value: formatTokens(normalizedValue) })}
        </span>
        {exceedsWindow ? (
          <span className="text-xs text-amber-600 dark:text-amber-500">
            {t("settings.sections.llm.maxOutputTokensExceedsWindow")}
          </span>
        ) : null}
      </div>
      <input
        type="range"
        min={0}
        max={OUTPUT_TOKEN_PRESETS.length - 1}
        step={1}
        value={closestIndex}
        onChange={(e) => onChange(OUTPUT_TOKEN_PRESETS[parseInt(e.target.value)].value)}
        className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
        style={{
          background: `linear-gradient(to right, #4f46e5 ${pct}%, #e5e7eb ${pct}%)`,
        }}
      />
      <div className="flex justify-between mt-1">
        {OUTPUT_TOKEN_PRESETS.map((preset, i) => (
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
        {t("settings.sections.llm.maxOutputTokensHint")}
      </p>
    </div>
  )
}
