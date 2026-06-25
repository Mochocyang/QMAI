import type { ForeshadowingStore } from "./foreshadowing-tracker"

export interface ForeshadowingDebtItem {
  id: string
  name: string
  description: string
  status: "planted" | "advanced" | "resolved"
  plantedChapter: number
  lastAdvancedChapter?: number
  chaptersSincePlanted: number
  chaptersSinceAdvanced?: number
  debtLevel: "critical" | "warning" | "normal"
}

export interface ForeshadowingDebtReport {
  items: ForeshadowingDebtItem[]
  totalUnresolved: number
  criticalCount: number
  warningCount: number
  debtScore: number
  thresholds: { plantedStale: number; advancedStale: number; densityLimit: number }
}

export interface ForeshadowingDebtOptions {
  plantedStale?: number
  advancedStale?: number
  densityLimit?: number
}

const DEFAULT_PLANTED_STALE = 5
const DEFAULT_ADVANCED_STALE = 10
const DEFAULT_DENSITY_LIMIT = 5

export function analyzeForeshadowingDebt(
  store: ForeshadowingStore,
  currentChapter: number,
  options?: ForeshadowingDebtOptions,
): ForeshadowingDebtReport {
  const plantedStale = options?.plantedStale ?? DEFAULT_PLANTED_STALE
  const advancedStale = options?.advancedStale ?? DEFAULT_ADVANCED_STALE
  const densityLimit = options?.densityLimit ?? DEFAULT_DENSITY_LIMIT

  const unresolved = store.items.filter((item) => item.status !== "resolved")

  const items: ForeshadowingDebtItem[] = unresolved.map((item) => {
    const chaptersSincePlanted = currentChapter - item.plantedChapter
    const lastAdvancedChapter = item.advancedChapters.length > 0
      ? Math.max(...item.advancedChapters)
      : undefined
    const chaptersSinceAdvanced = lastAdvancedChapter
      ? currentChapter - lastAdvancedChapter
      : undefined

    let debtLevel: "critical" | "warning" | "normal" = "normal"

    if (item.status === "planted" && chaptersSincePlanted >= plantedStale) {
      debtLevel = "critical"
    } else if (item.status === "advanced" && chaptersSinceAdvanced && chaptersSinceAdvanced >= advancedStale) {
      debtLevel = "warning"
    }

    return {
      id: item.id,
      name: item.name,
      description: item.description,
      status: item.status,
      plantedChapter: item.plantedChapter,
      lastAdvancedChapter,
      chaptersSincePlanted,
      chaptersSinceAdvanced,
      debtLevel,
    }
  })

  const criticalCount = items.filter((item) => item.debtLevel === "critical").length
  const warningCount = items.filter((item) => item.debtLevel === "warning").length

  let debtScore = 100
  debtScore -= criticalCount * 15
  debtScore -= warningCount * 5
  debtScore -= Math.max(0, unresolved.length - 5) * 2
  debtScore = Math.max(0, debtScore)

  return {
    items,
    totalUnresolved: unresolved.length,
    criticalCount,
    warningCount,
    debtScore,
    thresholds: { plantedStale, advancedStale, densityLimit },
  }
}