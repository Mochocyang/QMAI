import type { PrePlugin, PrePluginInput, PrePluginOutput } from "../pipeline"
import { resolveTargetChapterNumberForChat } from "@/lib/novel/chapter-utils"

export interface ResolveChapterPluginDeps {
  selectedFile?: string | null
  lastGeneratedChapterNumber?: number
  onError?: (error: Error) => void
}

export function createResolveChapterPlugin(deps: ResolveChapterPluginDeps = {}): PrePlugin {
  const { selectedFile, lastGeneratedChapterNumber, onError } = deps

  return {
    name: "resolve_chapter",
    priority: 20,
    run: async (input: PrePluginInput): Promise<PrePluginOutput> => {
      if (!input.novelMode || !input.taskRoute) return {}

      try {
        const targetChapter = await resolveTargetChapterNumberForChat({
          projectPath: input.projectPath,
          userRequest: input.userMessage,
          routeIntent: input.taskRoute.intent,
          routeChapterNumber: input.taskRoute.chapterNumber,
          selectedFile,
          lastGeneratedChapterNumber,
        })
        const effective = targetChapter
          ? {
              ...input.taskRoute,
              chapterNumber: targetChapter,
              extractedParams: {
                ...input.taskRoute.extractedParams,
                chapterNumber: String(targetChapter),
              },
            }
          : input.taskRoute
        return { effectiveTaskRoute: effective }
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
        return { effectiveTaskRoute: input.taskRoute }
      }
    },
  }
}
