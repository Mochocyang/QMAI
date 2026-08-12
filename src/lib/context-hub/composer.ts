import { resolveContextPackTokenBudget } from "@/lib/context-budget"
import type { ContextPack } from "@/lib/novel/context-engine"
import { estimateContextTokens } from "./token-estimator"
import {
  type ContextFragmentDisposition,
  type ContextFragmentTrace,
  type ContextHubStats,
  type DependencyStamp,
} from "./types"

export interface ComposeContextInput {
  contextPack: ContextPack
  sessionSummary?: string
  dependencyStamp: DependencyStamp
  referenceContext?: string[]
  confidence?: number
  /** Explicit token budget; 0 / undefined = window-derived safe cap. */
  tokenBudget?: number
  /** Model context window in tokens (wiki-store `maxContextSize`). */
  maxContextSize?: number
}
export interface ComposedContext {
  stableCore: string
  sessionSummary: string
  dynamicContext: string
  dependencyStamp: DependencyStamp
  stats: ContextHubStats
}

interface ContextFragment {
  title: string
  text: string
  required?: boolean
  layer: "stable" | "summary" | "dynamic"
}

function section(title: string, text: string): string {
  const value = text.trim()
  return value ? `### ${title}\n${value}` : ""
}

function joinSections(fragments: ContextFragment[]): string {
  return fragments
    .map((fragment) => section(fragment.title, fragment.text))
    .filter(Boolean)
    .join("\n\n")
}

function fragmentTokens(fragment: ContextFragment): number {
  if (!fragment.text.trim()) return 0
  return estimateContextTokens(section(fragment.title, fragment.text))
}

function stableFragments(pack: ContextPack): ContextFragment[] {
  return [
    { title: "作品灵魂", text: pack.soulDoc, layer: "stable" },
    { title: "故事框架绑定", text: pack.storyFrameworkBinding, layer: "stable" },
    { title: "硬性世界规则", text: pack.canonRules, layer: "stable" },
    { title: "核心设定", text: pack.relatedSettings, layer: "stable" },
    { title: "写作风格", text: pack.writingStyle, layer: "stable" },
    { title: "大纲骨架", text: pack.outline, layer: "stable" },
  ]
}

function referenceFragments(input: ComposeContextInput): ContextFragment[] {
  return (input.referenceContext ?? []).map((value, index) => ({
    title: `显式引用 ${index + 1}`,
    text: value,
    required: true,
    layer: "dynamic" as const,
  }))
}

function dynamicFragments(input: ComposeContextInput, expanded: boolean): ContextFragment[] {
  const pack = input.contextPack
  const required: ContextFragment[] = [
    ...referenceFragments(input),
    { title: "本轮任务", text: pack.task, required: true, layer: "dynamic" },
    { title: "章节目标", text: pack.chapterGoal, required: true, layer: "dynamic" },
    { title: "必须做到", text: pack.mustDo, required: true, layer: "dynamic" },
    { title: "必须避免", text: pack.mustAvoid, required: true, layer: "dynamic" },
    { title: "本节简报", text: pack.sectionBriefing ?? "", required: true, layer: "dynamic" },
    { title: "上一章结尾", text: pack.previousChapterEnding, layer: "dynamic" },
    { title: "人物当前状态", text: pack.characterStates, layer: "dynamic" },
    { title: "伏笔状态", text: pack.foreshadowingStates, layer: "dynamic" },
    { title: "最近摘要", text: pack.recentSummaries.slice(-3).join("\n"), layer: "dynamic" },
    { title: "修订要求", text: pack.revisionDirectives, layer: "dynamic" },
  ]
  const optional: ContextFragment[] = [
    { title: "时间线", text: pack.timeline, layer: "dynamic" },
    { title: "人物认知", text: pack.cognitionStates, layer: "dynamic" },
    { title: "人物气质", text: pack.characterAuras, layer: "dynamic" },
    { title: "下一章建议", text: pack.nextChapterAdvice, layer: "dynamic" },
    { title: "任务检索命中", text: pack.searchResults, layer: "dynamic" },
    { title: "关系图检索命中", text: pack.graphSearchResults, layer: "dynamic" },
  ]
  if (expanded) {
    optional.unshift({
      title: "低置信度扩展章节原文",
      text: (pack.recentChapterContents ?? []).join("\n\n"),
      layer: "dynamic",
    })
  } else if ((pack.recentChapterContents ?? []).some((item) => item.trim())) {
    optional.unshift({
      title: "低置信度扩展章节原文",
      text: (pack.recentChapterContents ?? []).join("\n\n"),
      layer: "dynamic",
    })
  }
  return [...required, ...optional]
}

function applyBudget(
  fragments: ContextFragment[],
  availableTokens: number,
): { selected: ContextFragment[]; dropped: ContextFragment[] } {
  const selected: ContextFragment[] = []
  const dropped: ContextFragment[] = []
  let used = 0
  for (const fragment of fragments) {
    if (!fragment.text.trim()) continue
    const tokens = fragmentTokens(fragment)
    if (used + tokens <= availableTokens) {
      selected.push(fragment)
      used += tokens
    } else {
      dropped.push(fragment)
    }
  }
  return { selected, dropped }
}

function truncateWithMarker(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  const marker = "\n[内容已按上下文预算压缩]\n"
  if (maxChars <= marker.length) return value.slice(0, maxChars)
  const available = maxChars - marker.length
  const head = Math.ceil(available * 0.6)
  return `${value.slice(0, head)}${marker}${value.slice(-(available - head))}`
}

function fitFragment(fragment: ContextFragment, tokenBudget: number): ContextFragment | null {
  if (tokenBudget <= 0 || !fragment.text.trim()) return null
  if (fragmentTokens(fragment) <= tokenBudget) return fragment
  let low = 0
  let high = fragment.text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const text = truncateWithMarker(fragment.text, middle)
    if (estimateContextTokens(section(fragment.title, text)) <= tokenBudget) low = middle
    else high = middle - 1
  }
  if (low <= 0) return null
  return { ...fragment, text: truncateWithMarker(fragment.text, low) }
}

function fitPlainText(value: string, tokenBudget: number): string {
  if (!value.trim() || tokenBudget <= 0) return ""
  if (estimateContextTokens(value) <= tokenBudget) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (estimateContextTokens(truncateWithMarker(value, middle)) <= tokenBudget) low = middle
    else high = middle - 1
  }
  return truncateWithMarker(value, low)
}

function fitFragmentsProportionally(fragments: ContextFragment[], tokenBudget: number): {
  fitted: ContextFragment[]
  dropped: ContextFragment[]
} {
  const available = fragments.filter((fragment) => fragment.text.trim())
  if (estimateContextTokens(joinSections(available)) <= tokenBudget) {
    return { fitted: available, dropped: [] }
  }
  const fitted: ContextFragment[] = []
  const dropped: ContextFragment[] = []
  let remaining = tokenBudget
  for (let index = 0; index < available.length; index += 1) {
    const share = Math.floor(remaining / (available.length - index))
    const original = available[index]!
    const next = fitFragment(original, share)
    if (next) {
      fitted.push(next)
      remaining -= fragmentTokens(next)
    } else {
      dropped.push(original)
    }
  }
  return { fitted, dropped }
}

function dispositionFor(
  candidate: ContextFragment,
  injected: ContextFragment | undefined,
  dropped: boolean,
  policyExcluded = false,
): ContextFragmentDisposition {
  if (policyExcluded) return "policy_excluded"
  if (dropped || !injected) return "budget_dropped"
  if (injected.text !== candidate.text) return "truncated"
  return "kept"
}

function buildFragmentTraces(input: {
  candidates: ContextFragment[]
  injectedByTitle: Map<string, ContextFragment>
  droppedTitles: Set<string>
  policyExcludedTitles: Set<string>
}): ContextFragmentTrace[] {
  return input.candidates
    .filter((fragment) => fragment.text.trim())
    .map((candidate) => {
      const injected = input.injectedByTitle.get(candidate.title)
      const disposition = dispositionFor(
        candidate,
        injected,
        input.droppedTitles.has(candidate.title),
        input.policyExcludedTitles.has(candidate.title),
      )
      return {
        title: candidate.title,
        layer: candidate.layer,
        disposition,
        candidateEstimatedTokens: fragmentTokens(candidate),
        injectedEstimatedTokens: injected ? fragmentTokens(injected) : 0,
      }
    })
}

export function composeContext(input: ComposeContextInput): ComposedContext {
  const expanded = (input.confidence ?? 0.8) < 0.6
  const tokenBudget = resolveContextPackTokenBudget({
    maxContextSize: input.maxContextSize,
    contextTokenBudget: input.tokenBudget,
  })
  const stableBudget = Math.floor(tokenBudget * 0.4)
  const summaryBudget = Math.floor(tokenBudget * 0.15)

  const stableCandidates = stableFragments(input.contextPack).filter((f) => f.text.trim())
  const { fitted: fittedStable, dropped: droppedStable } = fitFragmentsProportionally(
    stableCandidates,
    stableBudget,
  )
  const stableCore = joinSections(fittedStable)

  const summaryCandidateText = input.sessionSummary?.trim() ?? ""
  const sessionSummary = fitPlainText(summaryCandidateText, summaryBudget)
  const stableTokens = estimateContextTokens(stableCore)
  const summaryTokens = estimateContextTokens(sessionSummary)
  const availableDynamicTokens = Math.max(0, tokenBudget - stableTokens - summaryTokens)

  const allDynamic = dynamicFragments(input, expanded)
  const requiredFragments = allDynamic.filter((fragment) => fragment.required)
  const optionalFragments = allDynamic.filter((fragment) => !fragment.required)
  // When not expanded, chapter originals are candidate-only (policy excluded from injection).
  const policyExcludedTitles = new Set<string>()
  const injectableOptional = optionalFragments.filter((fragment) => {
    if (fragment.title === "低置信度扩展章节原文" && !expanded) {
      policyExcludedTitles.add(fragment.title)
      return false
    }
    return true
  })

  const { fitted: fittedRequired, dropped: droppedRequired } = fitFragmentsProportionally(
    requiredFragments,
    availableDynamicTokens,
  )
  const requiredTokens = estimateContextTokens(joinSections(fittedRequired))
  const { selected: selectedOptional, dropped: droppedOptional } = applyBudget(
    injectableOptional,
    Math.max(0, availableDynamicTokens - requiredTokens),
  )
  const dynamicContext = joinSections([...fittedRequired, ...selectedOptional])
  const dynamicTokens = estimateContextTokens(dynamicContext)

  // Same fragment pipeline for candidate totals (unbudgeted join of all non-empty fragments).
  const summaryCandidateFragment: ContextFragment | null = summaryCandidateText
    ? { title: "会话摘要", text: summaryCandidateText, layer: "summary" }
    : null
  const candidateFragments: ContextFragment[] = [
    ...stableCandidates,
    ...(summaryCandidateFragment ? [summaryCandidateFragment] : []),
    ...requiredFragments.filter((f) => f.text.trim()),
    ...optionalFragments.filter((f) => f.text.trim()),
  ]
  const candidateTokens = candidateFragments.reduce((sum, fragment) => sum + fragmentTokens(fragment), 0)

  const injectedByTitle = new Map<string, ContextFragment>()
  for (const fragment of fittedStable) injectedByTitle.set(fragment.title, fragment)
  if (sessionSummary) {
    injectedByTitle.set("会话摘要", {
      title: "会话摘要",
      text: sessionSummary,
      layer: "summary",
    })
  }
  for (const fragment of fittedRequired) injectedByTitle.set(fragment.title, fragment)
  for (const fragment of selectedOptional) injectedByTitle.set(fragment.title, fragment)

  const droppedTitles = new Set([
    ...droppedStable.map((f) => f.title),
    ...droppedRequired.map((f) => f.title),
    ...droppedOptional.map((f) => f.title),
  ])
  if (summaryCandidateText && !sessionSummary) droppedTitles.add("会话摘要")

  const fragmentTraces = buildFragmentTraces({
    candidates: candidateFragments,
    injectedByTitle,
    droppedTitles,
    policyExcludedTitles,
  })

  const composedTokens = stableTokens + summaryTokens + dynamicTokens
  const estimatedSavedTokens = Math.max(0, candidateTokens - composedTokens)
  const estimatedSavedPercent = candidateTokens > 0
    ? Math.round((estimatedSavedTokens / candidateTokens) * 100)
    : 0

  return {
    stableCore,
    sessionSummary,
    dynamicContext,
    dependencyStamp: {
      ...input.dependencyStamp,
      kinds: [...input.dependencyStamp.kinds],
    },
    stats: {
      cacheHits: 0,
      reloaded: 0,
      empty: 0,
      fallbackUsed: 0,
      readFailed: 0,
      writeFailed: 0,
      stableTokens,
      summaryTokens,
      dynamicTokens,
      candidateTokens,
      estimatedSavedTokens,
      estimatedSavedPercent,
      expanded,
      providerCacheEnabled: stableCore.length > 0,
      budgetTokens: tokenBudget,
      composedTokens,
      utilizationPercent: tokenBudget > 0 ? Math.min(100, Math.round((composedTokens / tokenBudget) * 100)) : 0,
      fragmentTraces,
    },
  }
}
