import { describe, expect, it } from "vitest"
import {
  CHAPTER_TARGET_CHARS_MAX,
  CHAPTER_TARGET_CHARS_MIN,
  DEEP_CHAPTER_DRAFT_MAX_CHARS,
  DEEP_CHAPTER_MIN_CHARS,
  DEEP_CHAPTER_TARGET_CHARS,
  buildDeepChapterBriefPrompt,
  buildDeepChapterDraftPrompt,
  buildDeepChapterExpansionPrompt,
  buildDeepChapterFinalPolishPrompt,
  buildDeepChapterRevisionPrompt,
  buildStableContextPrefix,
  resolveChapterLengthSpec,
} from "./deep-chapter-prompts"
import { DE_AI_GENERATION_RULES, DE_AI_REVISION_BOUNDARY } from "./de-ai-generation-rules"

describe("resolveChapterLengthSpec", () => {
  it("keeps the built-in defaults when no target is configured", () => {
    const spec = resolveChapterLengthSpec()

    expect(spec.targetChars).toBe(DEEP_CHAPTER_TARGET_CHARS)
    expect(spec.minChars).toBe(DEEP_CHAPTER_MIN_CHARS)
    expect(spec.draftMaxChars).toBe(DEEP_CHAPTER_DRAFT_MAX_CHARS)
    expect(spec).not.toHaveProperty("maxOutputTokens")
  })

  it("derives char thresholds from a configured chapter target (issue #8)", () => {
    const spec = resolveChapterLengthSpec(2000)

    expect(spec.targetChars).toBe(2000)
    expect(spec.minChars).toBeLessThan(2000)
    expect(spec.minChars).toBeGreaterThan(1000)
    expect(spec.draftMaxChars).toBe(2500)
    expect(spec).not.toHaveProperty("maxOutputTokens")
  })

  it("clamps unreasonable targets to the writing-settings range", () => {
    expect(resolveChapterLengthSpec(10).targetChars).toBe(CHAPTER_TARGET_CHARS_MIN)
    expect(resolveChapterLengthSpec(999999).targetChars).toBe(CHAPTER_TARGET_CHARS_MAX)
  })

  it("honors a configured target inside 1000–10000 that the old 2000–6000 clamp would have rewritten", () => {
    expect(resolveChapterLengthSpec(1500).targetChars).toBe(1500)
    expect(resolveChapterLengthSpec(8000).targetChars).toBe(8000)
  })
})

describe("chapter prompts honor the configured length spec", () => {
  it("injects the configured target into brief and draft prompts", () => {
    const spec = resolveChapterLengthSpec(2000)
    const brief = buildDeepChapterBriefPrompt("", "上下文", "继续生成下一章", 5, undefined, spec)
    const draft = buildDeepChapterDraftPrompt("", "上下文", "任务书", "继续生成下一章", 5, undefined, spec)

    expect(brief).toContain("目标约 2000 字")
    expect(draft).toContain("目标约 2000 字")
    expect(draft).toContain(`阶段3正文草稿最多 ${spec.draftMaxChars} 字`)
    expect(draft).not.toContain("目标约 3000 字")
    expect(draft).toContain("写作时遵守「本章相关材料」")
    expect(brief).not.toContain("本章相关材料")
  })

  it("injects skills after the stable cache prefix in brief, draft and revision prompts", () => {
    const outline = "# 大纲"
    const context = "上下文包"
    const skillsPrompt = "## 本次启用 Skill\n规则：combat-action"
    const prefix = buildStableContextPrefix(outline, context)
    const spec = resolveChapterLengthSpec(2000)
    const brief = buildDeepChapterBriefPrompt(outline, context, "写下一章", 5, undefined, spec, undefined, undefined, skillsPrompt)
    const draft = buildDeepChapterDraftPrompt(outline, context, "任务书", "写下一章", 5, undefined, spec, skillsPrompt)
    const revision = buildDeepChapterRevisionPrompt(outline, context, "任务书", "初稿", [], "写下一章", 5, undefined, skillsPrompt)

    for (const prompt of [brief, draft, revision]) {
      expect(prompt.startsWith(prefix)).toBe(true)
      expect(prompt).toContain(skillsPrompt)
      expect(prompt.indexOf(skillsPrompt)).toBeGreaterThan(prefix.length)
    }
  })
})

describe("chapter prompts carry the anti-AI-flavor constraint", () => {
  const outline = "# 大纲"
  const context = "上下文包"

  it("注入初稿 / 扩写 / 返修三个阶段", () => {
    const draft = buildDeepChapterDraftPrompt(outline, context, "任务书", "写下一章", 5)
    const expansion = buildDeepChapterExpansionPrompt(outline, context, "任务书", "过短正文", "写下一章", 5)
    const revision = buildDeepChapterRevisionPrompt(outline, context, "任务书", "初稿", [], "写下一章", 5)

    for (const prompt of [draft, expansion, revision]) {
      expect(prompt).toContain(DE_AI_GENERATION_RULES)
    }
  })

  it("任务书与阶段 6 局部修改都不注入", () => {
    // 任务书产出的是计划不是散文；阶段 6 由 42727a9 有意改成「只按清单局部改」，
    // 恢复去 AI 味内容等于把那次回退掉，deep-chapter-generation.spec.ts 也钉着这一点。
    const brief = buildDeepChapterBriefPrompt(outline, context, "写下一章", 5)
    const polish = buildDeepChapterFinalPolishPrompt(outline, context, "任务书", "当前正文", [], "写下一章", 5)

    expect(brief).not.toContain(DE_AI_GENERATION_RULES)
    expect(polish).not.toContain(DE_AI_GENERATION_RULES)
    expect(polish).not.toContain(DE_AI_REVISION_BOUNDARY)
  })

  it("只有返修带「不得扩大改动范围」的边界句", () => {
    const revision = buildDeepChapterRevisionPrompt(outline, context, "任务书", "初稿", [], "写下一章", 5)
    const draft = buildDeepChapterDraftPrompt(outline, context, "任务书", "写下一章", 5)

    // 返修要求「优先修复审稿指出的问题，不要无关改写」，边界句必须紧跟规则本体，
    // 否则「不要写 AI 腔」会被读成大范围重写的授权。
    expect(revision).toContain(DE_AI_REVISION_BOUNDARY)
    expect(revision.indexOf(DE_AI_REVISION_BOUNDARY)).toBeGreaterThan(revision.indexOf(DE_AI_GENERATION_RULES))
    expect(draft).not.toContain(DE_AI_REVISION_BOUNDARY)
  })

  it("规则块排在稳定缓存前缀之后", () => {
    const stableBlock = buildStableContextPrefix(outline, context)
    const prompts = [
      buildDeepChapterDraftPrompt(outline, context, "任务书", "写下一章", 5),
      buildDeepChapterExpansionPrompt(outline, context, "任务书", "过短正文", "写下一章", 5),
      buildDeepChapterRevisionPrompt(outline, context, "任务书", "初稿", [], "写下一章", 5),
    ]

    for (const prompt of prompts) {
      // 插到前缀之前会截断 DeepSeek/OpenAI 的自动前缀缓存（重复前缀约按 1/10 计费）。
      expect(prompt.startsWith(stableBlock)).toBe(true)
      expect(prompt.indexOf(DE_AI_GENERATION_RULES)).toBeGreaterThan(stableBlock.length)
    }
  })
})
