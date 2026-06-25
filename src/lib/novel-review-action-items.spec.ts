import { describe, expect, it } from "vitest"
import type { NovelReviewResult } from "@/lib/novel/review-adapter"
import {
  buildNovelReviewActionItem,
  buildVisibleNovelReviewActionItemsForDimensionResults,
  buildVisibleNovelReviewActionItemsForScoreDimensions,
  buildVisibleNovelReviewActionItems,
} from "./novel-review-action-items"
import type { DimensionReviewResult } from "@/lib/novel/dimension-review-adapter"

describe("novel review action items", () => {
  const result: NovelReviewResult = {
    severity: "warning",
    type: "plot",
    message: "第八章没有读取章纲目标",
    evidence: "他继续沿着上一章结尾往前走。",
    relatedMemory: "",
    suggestion: "改为围绕第八章章纲推进。",
  }

  it("keeps a stable target and issue id for AI review result actions", () => {
    const item = buildNovelReviewActionItem("E:/Book/wiki/chapters/008.md", result)

    expect(item).toMatchObject({
      id: "review|E:/Book/wiki/chapters/008.md|plot|第八章没有读取章纲目标|他继续沿着上一章结尾往前走。",
      severity: "medium",
      source: "review",
      message: "第八章没有读取章纲目标",
      detail: "plot",
      evidence: "他继续沿着上一章结尾往前走。",
      suggestion: "改为围绕第八章章纲推进。",
      targetPath: "E:/Book/wiki/chapters/008.md",
    })
  })

  it("filters ignored AI review results with the same persisted issue id", () => {
    const item = buildNovelReviewActionItem("E:/Book/wiki/chapters/008.md", result)
    const visible = buildVisibleNovelReviewActionItems("E:/Book/wiki/chapters/008.md", [result], {
      [item.id]: true,
    })

    expect(visible).toEqual([])
  })

  it("builds actionable items for a selected six-dimension review bucket", () => {
    const characterResult: NovelReviewResult = {
      severity: "warning",
      type: "character_consistency",
      message: "人物动机前后不一致",
      evidence: "他突然放弃了原本的目标。",
      relatedMemory: "",
      suggestion: "补充角色选择的心理过渡。",
    }

    const visible = buildVisibleNovelReviewActionItemsForScoreDimensions(
      "E:/Book/wiki/chapters/008.md",
      [result, characterResult],
      {},
      ["plot"],
    )

    expect(visible).toHaveLength(1)
    expect(visible[0]).toMatchObject({
      message: "第八章没有读取章纲目标",
      detail: "plot",
      targetPath: "E:/Book/wiki/chapters/008.md",
    })
  })

  it("builds actionable items directly from independent six-dimension results", () => {
    const dimensionResults: Partial<Record<"thrill" | "character", DimensionReviewResult>> = {
      thrill: {
        dimensionKey: "thrill",
        score: 72,
        status: "medium",
        summary: "主爽点兑现偏弱。",
        thinking: "## 爽感密度",
        issues: [{
          severity: "warning",
          type: "thrill",
          dimensionKey: "thrill",
          message: "主爽点兑现不足",
          evidence: "主角直接说出族谱被换。",
          relatedMemory: "",
          suggestion: "增加压抑后的反转与奖励兑现。",
          impact: "读者情绪释放不足。",
          rewriteTarget: "主角直接说出族谱被换。",
        }],
      },
      character: {
        dimensionKey: "character",
        score: 100,
        status: "pass",
        summary: "人设通过。",
        thinking: "## 人设一致",
        issues: [],
      },
    }

    const visible = buildVisibleNovelReviewActionItemsForDimensionResults(
      "E:/Book/wiki/chapters/008.md",
      dimensionResults,
      {},
      "thrill",
    )

    expect(visible).toHaveLength(1)
    expect(visible[0]).toMatchObject({
      message: "主爽点兑现不足",
      detail: "thrill",
      evidence: "主角直接说出族谱被换。",
      secondaryEvidence: "主角直接说出族谱被换。",
      suggestion: "增加压抑后的反转与奖励兑现。",
      targetPath: "E:/Book/wiki/chapters/008.md",
    })
  })
})
