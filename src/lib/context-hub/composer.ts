import { contextPackToPrompt, type ContextPack } from "@/lib/novel/context-engine"
import { estimateContextTokens } from "./token-estimator"
import type { ContextHubStats } from "./types"

export interface ComposeContextInput {
  contextPack: ContextPack
  sessionSummary?: string
  dependencies: Record<string, number>
  referenceContext?: string[]
  confidence?: number
  tokenBudget?: number
}
export interface ComposedContext {
  stableCore: string
  sessionSummary: string
  dynamicContext: string
  dependencies: Record<string, number>
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

function dynamicFragments(input: ComposeContextInput, expanded: boolean): ContextFragment[] {
  const pack = input.contextPack
  const references = (input.referenceContext ?? []).map((value, index) => ({
    title: `显式引用 ${index + 1}`,
    text: value,
    required: true,
  }))
  const required: ContextFragment[] = [
    ...references,
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
    if (fragment.required || used + tokens <= availableTokens) {
      selected.push(fragment)
      used += tokens
    }
  }
  return selected
}

export function composeContext(input: ComposeContextInput): ComposedContext {
  const stableCore = joinSections(stableFragments(input.contextPack))
  const sessionSummary = input.sessionSummary?.trim() ?? ""
  const expanded = (input.confidence ?? 0.8) < 0.6
  const tokenBudget = Math.max(0, input.tokenBudget ?? 16_000)
  const stableTokens = estimateContextTokens(stableCore)
  const summaryTokens = estimateContextTokens(sessionSummary)
  const availableDynamicTokens = Math.max(0, tokenBudget - stableTokens - summaryTokens)
  const dynamicContext = joinSections(
    applyBudget(dynamicFragments(input, expanded), availableDynamicTokens),
  )
  const dynamicTokens = estimateContextTokens(dynamicContext)
  const candidateTokens = estimateContextTokens(contextPackToPrompt(input.contextPack))
  const composedTokens = stableTokens + summaryTokens + dynamicTokens
  const estimatedSavedTokens = Math.max(0, candidateTokens - composedTokens)
  const estimatedSavedPercent = candidateTokens > 0
    ? Math.round((estimatedSavedTokens / candidateTokens) * 100)
    : 0

  return {
    stableCore,
    sessionSummary,
    dynamicContext,
    dependencies: { ...input.dependencies },
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
    },
  }
}
