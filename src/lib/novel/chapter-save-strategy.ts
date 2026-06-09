export type ChapterSaveStrategy =
  | {
    action: "direct_next_chapter"
  }
  | {
    action: "direct_explicit_target_new"
    targetChapterNumber: number
  }

export function decideChapterSaveStrategy(input: {
  selectedChapterNumber: number | null
  selectedChapterHasBody: boolean
  generatedTargetChapterNumber: number | null
  generatedTargetExists: boolean
}): ChapterSaveStrategy {
  if (
    input.generatedTargetChapterNumber &&
    input.generatedTargetChapterNumber > 0 &&
    input.generatedTargetChapterNumber !== input.selectedChapterNumber
  ) {
    if (!input.generatedTargetExists) {
      return {
        action: "direct_explicit_target_new",
        targetChapterNumber: input.generatedTargetChapterNumber,
      }
    }
  }

  return {
    action: "direct_next_chapter",
  }
}

export function detectGeneratedTargetChapterNumber(content: string): number | null {
  const match = content.match(/第\s*(\d+)\s*章/)
  if (match?.[1]) return Number.parseInt(match[1], 10)
  return null
}
