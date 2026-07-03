import type { PrePlugin, PrePluginInput, PrePluginOutput } from "../pipeline"
import type { NovelTaskIntent } from "@/lib/novel/task-router"

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.5

export interface ClarificationCandidate {
  intent: NovelTaskIntent
  label: string
  confidence: number
}

export interface ConfidenceGatePluginDeps {
  threshold?: number
  getCandidates?: (userMessage: string) => ClarificationCandidate[]
  onError?: (error: Error) => void
}

const INTENT_LABELS: Record<NovelTaskIntent, string> = {
  write_chapter: "写新章节",
  continue_chapter: "续写章节",
  rewrite_chapter: "改写章节",
  polish_chapter: "润色章节",
  review_chapter: "AI 审稿",
  lint_chapter: "连贯性检查",
  generate_outline: "生成大纲",
  search_plot: "剧情搜索",
  extract_memory: "章节摄取",
  character_query: "人物查询",
  foreshadowing_query: "伏笔查询",
  timeline_query: "时间线查询",
  setting_query: "设定查询",
  general_chat: "随便聊聊",
}

export function intentToLabel(intent: NovelTaskIntent): string {
  return INTENT_LABELS[intent] || intent
}

export function createConfidenceGatePlugin(deps: ConfidenceGatePluginDeps = {}): PrePlugin {
  const { threshold = DEFAULT_CONFIDENCE_THRESHOLD, getCandidates, onError } = deps

  return {
    name: "confidence_gate",
    priority: 15,
    run: async (input: PrePluginInput): Promise<PrePluginOutput> => {
      if (!input.novelMode || !input.taskRoute) return {}

      try {
        const route = input.taskRoute

        if (route.confidence >= threshold && route.intent !== "general_chat") {
          return {}
        }

        const candidates = getCandidates
          ? getCandidates(input.userMessage)
          : buildDefaultCandidates(route)

        if (candidates.length === 0) {
          return {}
        }

        return {
          shouldStop: true,
          stopReason: "clarification_needed",
          clarificationNeeded: true,
          clarificationCandidates: candidates,
          clarificationUserMessage: input.userMessage,
        }
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
        return {}
      }
    },
  }
}

function buildDefaultCandidates(route: { intent: NovelTaskIntent; confidence: number }): ClarificationCandidate[] {
  const candidates: ClarificationCandidate[] = [
    { intent: route.intent, label: intentToLabel(route.intent), confidence: route.confidence },
  ]

  const commonSuggestions: NovelTaskIntent[] = [
    "continue_chapter",
    "rewrite_chapter",
    "polish_chapter",
    "review_chapter",
    "general_chat",
  ]

  for (const intent of commonSuggestions) {
    if (intent !== route.intent && candidates.length < 4) {
      candidates.push({
        intent,
        label: intentToLabel(intent),
        confidence: 0,
      })
    }
  }

  return candidates
}
