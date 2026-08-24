import type { PrePlugin, PrePluginInput, PrePluginOutput } from "../pipeline"
import type { ContextPack, TrimResult } from "@/lib/novel/context-engine"
import { resolveContextPackTokenBudget } from "@/lib/context-budget"
import { getEffectiveMaxContextSize } from "@/lib/llm-providers"

interface TrimContextPluginDeps {
  contextPackToPromptFn?: (pack: ContextPack, tokenBudget?: number, options?: { excludeOutline?: boolean }) => string
  trimContextPackFn?: (pack: ContextPack, tokenBudget?: number, options?: { excludeOutline?: boolean }) => TrimResult
  tokenBudget?: number
  excludeOutline?: boolean
  onError?: (error: Error) => void
  onVirtualTool?: (
    event: "start" | "end",
    name: string,
    data: { callId?: string; params?: Record<string, unknown>; result?: string; status?: string },
  ) => void
}

export function createTrimContextPlugin(deps: TrimContextPluginDeps = {}): PrePlugin {
  const { contextPackToPromptFn, trimContextPackFn, tokenBudget, excludeOutline, onError, onVirtualTool } = deps

  return {
    name: "trim_context",
    priority: 50,
    run: async (input: PrePluginInput): Promise<PrePluginOutput> => {
      if (!input.novelMode || !input.contextPack) return {}

      let callId: string | undefined
      if (onVirtualTool) {
        callId = `trim_context_${Date.now()}`
        const budget = tokenBudget ?? resolveTokenBudget(input)
        onVirtualTool("start", "trim_context", {
          callId,
          params: {
            tokenBudget: budget,
            excludeOutline,
          },
        })
      }

      try {
        const budget = tokenBudget ?? resolveTokenBudget(input)
        let trimmedPrompt: string
        let trimResult: TrimResult | null = null

        if (trimContextPackFn) {
          trimResult = trimContextPackFn(input.contextPack, budget, { excludeOutline })
          trimmedPrompt = trimResult.prompt
        } else if (contextPackToPromptFn) {
          trimmedPrompt = contextPackToPromptFn(input.contextPack, budget, { excludeOutline })
        } else {
          const mod = await import("@/lib/novel/context-engine")
          trimResult = mod.trimContextPack(input.contextPack, budget, { excludeOutline })
          trimmedPrompt = trimResult.prompt
        }

        if (onVirtualTool && callId) {
          const resultData: Record<string, unknown> = {
            tokenBudget: budget,
            promptLength: trimmedPrompt.length,
          }
          if (trimResult) {
            resultData.originalChars = trimResult.originalChars
            resultData.finalChars = trimResult.finalChars
            resultData.trimmedChars = trimResult.trimmedChars
            resultData.trimmedFields = trimResult.trimmedFields
            if (trimResult.partiallyTrimmedField) {
              resultData.partiallyTrimmedField = trimResult.partiallyTrimmedField
            }
          }
          onVirtualTool("end", "trim_context", {
            callId,
            result: JSON.stringify(resultData),
            status: "done",
          })
        }

        return { novelSystemPrompt: trimmedPrompt }
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
        if (onVirtualTool && callId) {
          onVirtualTool("end", "trim_context", {
            callId,
            result: error instanceof Error ? error.message : String(error),
            status: "error",
          })
        }
        return {}
      }
    },
  }
}

function resolveTokenBudget(input: PrePluginInput): number {
  const llmConfig = input.agentConfig?.llmConfig
  const maxContextSize = llmConfig ? getEffectiveMaxContextSize(llmConfig) : undefined
  return resolveContextPackTokenBudget({ maxContextSize })
}
