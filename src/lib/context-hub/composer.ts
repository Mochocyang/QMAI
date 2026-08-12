import { resolveContextPackTokenBudget } from "@/lib/context-budget"
import { contextPackToPrompt, type ContextPack } from "@/lib/novel/context-engine"
import { estimateContextTokens } from "./token-estimator"
import type { ContextHubStats, DependencyStamp } from "./types"

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

function stableFragments(pack: ContextPack): ContextFragment[] {
  return [
    { title: "作品灵魂", text: pack.soulDoc },
    { title: "硬性世界规则", text: pack.canonRules },
    { title: "核心设定", text: pack.relatedSettings },
    { title: "写作风格", text: pack.writingStyle },
    { title: "大纲骨架", text: pack.outline },
  ]
}

function referenceFragments(input: ComposeContextInput): ContextFragment[] {
  return (input.referenceContext ?? []).map((value, index) => ({
    title: `显式引用 ${index + 1}`,
    text: value,
    required: true,
  }))
}

function dynamicFragments(input: ComposeContextInput, expanded: boolean): ContextFragment[] {
  const pack = input.contextPack
  const required: ContextFragment[] = [
    ...referenceFragments(input),
    { title: "本轮任务", text: pack.task, required: true },
    { title: "章节目标", text: pack.chapterGoal, required: true },
    { title: "必须做到", text: pack.mustDo, required: true },
    { title: "必须避免", text: pack.mustAvoid, required: true },
    { title: "小节简报", text: pack.sectionBriefing ?? "", required: true },
    { title: "上一章结尾", text: pack.previousChapterEnding },
    { title: "人物当前状态", text: pack.characterStates },
    { title: "伏笔状态", text: pack.foreshadowingStates },
    { title: "最近摘要", text: pack.recentSummaries.slice(-3).join("\n") },
    { title: "修订要求", text: pack.revisionDirectives },
  ]
  const optional: ContextFragment[] = [
    { title: "时间线", text: pack.timeline },
    { title: "人物认知", text: pack.cognitionStates },
    { title: "人物气质", text: pack.characterAuras },
    { title: "下一章建议", text: pack.nextChapterAdvice },
    { title: "任务检索命中", text: pack.searchResults },
    { title: "关系图检索命中", text: pack.graphSearchResults },
  ]
  if (expanded) {
    optional.unshift({
      title: "低置信度扩展章节原文",
      text: (pack.recentChapterContents ?? []).join("\n\n"),
    })
  }
  return [...required, ...optional]
}

function applyBudget(
  fragments: ContextFragment[],
  availableTokens: number,
): ContextFragment[] {
  const selected: ContextFragment[] = []
  let used = 0
  for (const fragment of fragments) {
    if (!fragment.text.trim()) continue
    const tokens = estimateContextTokens(section(fragment.title, fragment.text))
    if (used + tokens <= availableTokens) {
      selected.push(fragment)
      used += tokens
    }
  }
  return selected
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
  if (estimateContextTokens(section(fragment.title, fragment.text)) <= tokenBudget) return fragment
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

function fitFragmentsProportionally(fragments: ContextFragment[], tokenBudget: number): ContextFragment[] {
  const available = fragments.filter((fragment) => fragment.text.trim())
  if (estimateContextTokens(joinSections(available)) <= tokenBudget) return available
  const result: ContextFragment[] = []
  let remaining = tokenBudget
  for (let index = 0; index < available.length; index += 1) {
    const share = Math.floor(remaining / (available.length - index))
    const fitted = fitFragment(available[index]!, share)
    if (fitted) {
      result.push(fitted)
      remaining -= estimateContextTokens(section(fitted.title, fitted.text))
    }
  }
  return result
}

export function composeContext(input: ComposeContextInput): ComposedContext {
  const expanded = (input.confidence ?? 0.8) < 0.6
  const tokenBudget = resolveContextPackTokenBudget({
    maxContextSize: input.maxContextSize,
    contextTokenBudget: input.tokenBudget,
  })
  const stableBudget = Math.floor(tokenBudget * 0.4)
  const summaryBudget = Math.floor(tokenBudget * 0.15)
  const stableCore = joinSections(fitFragmentsProportionally(stableFragments(input.contextPack), stableBudget))
  const sessionSummary = fitPlainText(input.sessionSummary?.trim() ?? "", summaryBudget)
  const stableTokens = estimateContextTokens(stableCore)
  const summaryTokens = estimateContextTokens(sessionSummary)
  const availableDynamicTokens = Math.max(0, tokenBudget - stableTokens - summaryTokens)
  const dynamicFragmentsForRequest = dynamicFragments(input, expanded)
  const requiredFragments = dynamicFragmentsForRequest.filter((fragment) => fragment.required)
  const optionalFragments = dynamicFragmentsForRequest.filter((fragment) => !fragment.required)
  const fittedRequired = fitFragmentsProportionally(requiredFragments, availableDynamicTokens)
  const requiredTokens = estimateContextTokens(joinSections(fittedRequired))
  const dynamicContext = joinSections([
    ...fittedRequired,
    ...applyBudget(optionalFragments, Math.max(0, availableDynamicTokens - requiredTokens)),
  ])
  const dynamicTokens = estimateContextTokens(dynamicContext)
  const candidateTokens = estimateContextTokens(contextPackToPrompt(input.contextPack))
    + summaryTokens
    + estimateContextTokens(joinSections(referenceFragments(input)))
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
      hits: 0,
      refreshed: 0,
      failures: 0,
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
    },
  }
}
