import { extractChapterNumber } from "./task-router"

export type GoldenThreeChapterOutputMode = "first_chapter_with_directions" | "chapter_only"

export interface GoldenThreeChapterRequest {
  enabled: boolean
  targetChapter?: 1 | 2 | 3
  outputMode?: GoldenThreeChapterOutputMode
  requestedFirstThree: boolean
}

const disabledGoldenThreeChapterRequest: GoldenThreeChapterRequest = {
  enabled: false,
  requestedFirstThree: false,
}

/**
 * 黄金三章只看章号 1–3。章号来自调用方已解析的目标，否则用与任务路由相同的
 * 第N章解析。开篇/开局/黄金三章这类词不再单独触发，避免和模型抢判。
 */
export function detectGoldenThreeChapterRequest(text: string, chapterNumber?: number): GoldenThreeChapterRequest {
  const normalized = text.trim()
  if (!normalized) return disabledGoldenThreeChapterRequest

  const resolved = typeof chapterNumber === "number" && chapterNumber > 0
    ? chapterNumber
    : extractChapterNumber(normalized)

  if (resolved === 1) {
    return {
      enabled: true,
      targetChapter: 1,
      outputMode: "first_chapter_with_directions",
      requestedFirstThree: false,
    }
  }
  if (resolved === 2 || resolved === 3) {
    return {
      enabled: true,
      targetChapter: resolved,
      outputMode: "chapter_only",
      requestedFirstThree: false,
    }
  }
  return disabledGoldenThreeChapterRequest
}

export function buildGoldenThreeChapterDirective(result: GoldenThreeChapterRequest | undefined): string {
  if (!result?.enabled || !result.targetChapter || !result.outputMode) return ""

  const outputRules = result.outputMode === "first_chapter_with_directions"
    ? [
        "输出策略：只生成第一章正文，正文结束后给出“第二章写作方向”和“第三章写作方向”。",
        "第二章写作方向：强调冲突升级、阻力加重、代价扩大，让主角必须继续行动。",
        "第三章写作方向：明确阶段主线，建立长期期待，并让读者知道后续故事追什么、怕什么、盼什么。",
      ]
    : [
        `输出策略：只生成第${result.targetChapter}章正文，不输出后续方向、分析、说明或写作建议。`,
      ]

  return [
    "## 黄金三章写作约束",
    ...outputRules,
    "硬性边界：",
    "- 前 300-500 字内必须进入主体事件、危机、任务、冲突或异常。",
    "- 主角必须尽早登场，并用行动推动局面变化。",
    "- 穿越、前世、背景、设定只一笔带过，不展开成独立剧情。",
    "- 禁止长环境描写、长氛围描写、长心理描写和大段世界观说明。",
    "- 每段必须推动故事、冲突、人物关系、行动或期待。",
    "- 第一章结尾必须留下可承接第二章的钩子。",
  ].join("\n")
}
