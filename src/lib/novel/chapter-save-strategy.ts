type ChapterSaveStrategy =
  | {
    action: "direct_next_chapter"
  }
  | {
    action: "direct_explicit_target_new"
    targetChapterNumber: number
  }

/** 正文里写明了第 N 章就存到第 N 章；没有章号才顺延到下一章。是否已经保存过不影响这次保存。 */
export function decideChapterSaveStrategy(input: {
  generatedTargetChapterNumber: number | null
}): ChapterSaveStrategy {
  if (input.generatedTargetChapterNumber && input.generatedTargetChapterNumber > 0) {
    return {
      action: "direct_explicit_target_new",
      targetChapterNumber: input.generatedTargetChapterNumber,
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
