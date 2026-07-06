/**
 * 框架库统计聚合 — 供记忆中心只读展示
 */

import type { PlotFrameworkLibrary } from "./plot-framework"

export interface PlotFrameworkSummary {
  total: number
  mainCount: number
  subCount: number
  tightCount: number
  standardCount: number
  looseCount: number
  /** 未评定节奏的框架数 */
  unratedCount: number
  /** 最近更新的框架（按 updatedAt 降序，最多5个） */
  recentTitles: Array<{
    title: string
    line: "main" | "sub"
    pacing: "tight" | "standard" | "loose" | undefined
  }>
}

export function summarizePlotFrameworkLibrary(library: PlotFrameworkLibrary): PlotFrameworkSummary {
  const frameworks = library.frameworks
  const total = frameworks.length
  const mainCount = frameworks.filter((f) => f.line === "main").length
  const subCount = frameworks.filter((f) => f.line === "sub").length
  const tightCount = frameworks.filter((f) => f.pacing === "tight").length
  const standardCount = frameworks.filter((f) => f.pacing === "standard").length
  const looseCount = frameworks.filter((f) => f.pacing === "loose").length
  const unratedCount = frameworks.filter((f) => !f.pacing).length

  const recentTitles = [...frameworks]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5)
    .map((f) => ({ title: f.title, line: f.line, pacing: f.pacing }))

  return { total, mainCount, subCount, tightCount, standardCount, looseCount, unratedCount, recentTitles }
}
