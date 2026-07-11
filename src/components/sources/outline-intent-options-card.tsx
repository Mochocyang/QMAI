import type { IntentClarityResult } from "@/lib/novel/outline-intent-clarity"

interface IntentOptionsCardProps {
  result: IntentClarityResult
  onSelectOption: (optionId: string, label: string, description: string) => void
}

export function IntentOptionsCard({ result, onSelectOption }: IntentOptionsCardProps) {
  if (result.clarity !== "needs_input") return null

  return (
    <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-50/30 p-3 dark:bg-amber-950/10">
      {result.analysis ? (
        <div className="mb-2 text-xs text-muted-foreground">{result.analysis}</div>
      ) : null}
      <div className="text-sm font-medium mb-2">
        {result.question || "请选择生成范围："}
      </div>
      <div className="space-y-2">
        {result.options.map((option) => (
          <button
            key={option.id}
            className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
            onClick={() => onSelectOption(option.id, option.label, option.description)}
          >
            <div className="font-medium">{option.label}</div>
            {option.description ? (
              <div className="text-xs text-muted-foreground">{option.description}</div>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  )
}
