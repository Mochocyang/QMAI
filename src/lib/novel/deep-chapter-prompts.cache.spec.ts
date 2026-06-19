import { describe, expect, it } from "vitest"
import {
  buildDeepChapterBriefPrompt,
  buildDeepChapterDraftPrompt,
  buildDeepChapterExpansionPrompt,
  buildDeepChapterFinalPolishPrompt,
  buildDeepChapterRevisionPrompt,
} from "./deep-chapter-prompts"
import type { NovelReviewResult } from "./review-adapter"

/**
 * 阶段二回归护栏：深度章节生成的各阶段提示词必须以"大纲 + 上下文包"组成的
 * 逐字节相同前缀开头，DeepSeek / OpenAI 的自动前缀缓存才能命中这段最大内容。
 * 任何把会变内容（任务书 / 初稿 / 审稿问题）插到前缀之前的改动都会截断公共前缀、
 * 让缓存失效——这个测试就是用来在那种改动发生时立刻报警的。
 */

// 模拟真实体量：大纲约 2KB，上下文包约 12KB（深度生成里 contextPrompt 受 32k token 预算约束）。
const outline = "# 【强制遵守】作品完整大纲\n" + "第N节：主角推进族谱线索，冲突升级，结尾留钩子。\n".repeat(40)
const contextPrompt = "## 小说上下文包\n" + "人物状态 / 伏笔 / 时间线 / 记忆检索 / 图谱关系 / 章节目标。\n".repeat(330)

const reviewResults: NovelReviewResult[] = [
  { severity: "error", type: "plot", message: "测试阻断问题", evidence: "", relatedMemory: "", suggestion: "" },
]

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i += 1
  return i
}

const stages: Record<string, string> = {
  brief: buildDeepChapterBriefPrompt(outline, contextPrompt, "生成第3章", 3),
  draft: buildDeepChapterDraftPrompt(outline, contextPrompt, "写作任务书", "生成第3章", 3),
  expansion: buildDeepChapterExpansionPrompt(outline, contextPrompt, "写作任务书", "过短正文", "生成第3章", 3),
  revision: buildDeepChapterRevisionPrompt(outline, contextPrompt, "写作任务书", "初稿正文", reviewResults, "生成第3章", 3),
  polish: buildDeepChapterFinalPolishPrompt(outline, contextPrompt, "写作任务书", "当前正文", "生成第3章", 3),
}
const stageList = Object.values(stages)
// buildStableContextPrefix(outline, contextPrompt) 的输出：[outline,"上下文：",contextPrompt].join("\n")
const stableBlock = `${outline}\n上下文：\n${contextPrompt}`

describe("deep chapter prompts share a stable cacheable prefix (stage 2)", () => {
  it("every stage starts with the identical outline+context block", () => {
    for (const [name, prompt] of Object.entries(stages)) {
      expect(prompt.startsWith(stableBlock), `${name} 未以稳定上下文前缀开头`).toBe(true)
    }
  })

  it("the byte-identical prefix shared across all stages covers the whole context block", () => {
    const sharedLens = stageList.slice(1).map((p) => commonPrefixLength(stageList[0], p))
    const minShared = Math.min(...sharedLens)
    expect(minShared).toBeGreaterThanOrEqual(stableBlock.length)

    // ── 测量报告（chars/4 估算 token，与 context-budget.ts 同口径）──
    const prefixChars = stableBlock.length
    const estTok = (chars: number) => Math.round(chars / 4)
    // 写作侧实际会重复携带这段前缀的阶段：任务书 / 初稿 /（扩写）/（返修）/ 去AI味。
    // 取最常见路径：任务书 + 初稿 + 去AI味 = 3 次必然发生，扩写/返修按需。
    const writingStages = 3
    const repeatedPrefixChars = prefixChars * (writingStages - 1) // 第2、3次重复携带
    // 自动前缀缓存命中后，重复前缀约按 1/10 计费。
    const oldBilled = prefixChars * writingStages
    const newBilled = prefixChars + repeatedPrefixChars * 0.1
    const savedTok = estTok(oldBilled - newBilled)

    console.log(`[stage2] 稳定前缀 ${prefixChars} chars ≈ ${estTok(prefixChars)} tok`)
    console.log(`[stage2] 跨 5 阶段最小公共前缀 ${minShared} chars（应 ≥ ${prefixChars}）`)
    console.log(`[stage2] 写作侧3阶段重复携带前缀：旧 ${estTok(oldBilled)} tok 全价 → 新 ≈ ${estTok(newBilled)} tok（缓存命中价）`)
    console.log(`[stage2] 仅"重复前缀"一项每章约省 ${savedTok} 输入 tok（按 3 写作阶段、命中价 10% 估算）`)
    console.log(`[stage1] 审稿调用：旧 4 次串行 → 新 1 次（省 3 次完整审查 prompt + 1 次重复 buildContextPack）`)
  })
})
