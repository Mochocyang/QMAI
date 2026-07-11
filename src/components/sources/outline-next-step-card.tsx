import type { NextStepRecommendation } from "@/lib/novel/outline-next-step"

interface NextStepCardProps {
  recommendation: NextStepRecommendation
  onSelectRecommendation: (recId: string, label: string) => void
}

export function NextStepCard({ recommendation, onSelectRecommendation }: NextStepCardProps) {
  if (!recommendation.recommendations || recommendation.recommendations.length === 0) return null

  return (
    <div className="mt-3 rounded-md border border-sky-500/30 bg-sky-50/30 p-3 dark:bg-sky-950/10">
      <div className="text-sm font-medium mb-2">接下来想做什么？</div>
      <div className="space-y-2">
        {recommendation.recommendations.map((rec) => (
          <button
            key={rec.id}
            className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
            onClick={() => onSelectRecommendation(rec.id, rec.label)}
          >
            <div className="font-medium">{rec.label}</div>
            {rec.reason ? (
              <div className="text-xs text-muted-foreground">{rec.reason}</div>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  )
}
