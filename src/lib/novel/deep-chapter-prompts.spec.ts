import { describe, expect, it } from "vitest"
import {
  CHAPTER_SYSTEM_PROMPT,
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
    expect(draft).toContain("「本章相关材料」只是路径清单，不是正文")
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

  it("规则本体已上移到 system，三个阶段都不再在 user 里重复携带", () => {
    const draft = buildDeepChapterDraftPrompt(outline, context, "任务书", "写下一章", 5)
    const expansion = buildDeepChapterExpansionPrompt(outline, context, "任务书", "过短正文", "写下一章", 5)
    const revision = buildDeepChapterRevisionPrompt(outline, context, "任务书", "初稿", [], "写下一章", 5)

    // 规则排在阶段指令之后 → 每阶段全价重发。现在只由 system 携带一次。
    for (const prompt of [draft, expansion, revision]) {
      expect(prompt).not.toContain(DE_AI_GENERATION_RULES)
    }
    expect(CHAPTER_SYSTEM_PROMPT).toContain(DE_AI_GENERATION_RULES)
  })

  it("任务书与阶段 6 局部修改都不在 user 里塞规则本体", () => {
    // 任务书产出的是计划不是散文；阶段 6 由 42727a9 有意改成「只按清单局部改」，
    // 恢复去 AI 味内容等于把那次回退掉，deep-chapter-generation.spec.ts 也钉着这一点。
    // 规则本体现在统一在 CHAPTER_SYSTEM_PROMPT（引擎级），两个阶段都不再重复携带。
    const brief = buildDeepChapterBriefPrompt(outline, context, "写下一章", 5)
    const polish = buildDeepChapterFinalPolishPrompt(outline, context, "任务书", "当前正文", [], "写下一章", 5)

    expect(brief).not.toContain(DE_AI_GENERATION_RULES)
    expect(polish).not.toContain(DE_AI_GENERATION_RULES)
    // 42727a9 的护栏保持：阶段 6 的 user 里不出现这套规则相关的任何文案。
    // 规则升到 system 后的「不扩大改写范围」由 CHAPTER_SYSTEM_PROMPT 第 3 条承担，
    // 不侵入各阶段提示词。
    expect(polish).not.toContain(DE_AI_REVISION_BOUNDARY)
    expect(CHAPTER_SYSTEM_PROMPT).toContain("不得据此改写范围之外")
  })

  it("只有返修带「不得扩大改动范围」的边界句", () => {
    const revision = buildDeepChapterRevisionPrompt(outline, context, "任务书", "初稿", [], "写下一章", 5)
    const draft = buildDeepChapterDraftPrompt(outline, context, "任务书", "写下一章", 5)

    // 返修要求「优先修复审稿指出的问题，不要无关改写」，边界句必须钉在
    // system 里那套规则的适用范围上，否则「不要写 AI 腔」会被读成大范围重写的授权。
    // 规则本体在 system（更早），边界句必须在 user 的稳定前缀之后才生效。
    expect(revision).toContain(DE_AI_REVISION_BOUNDARY)
    expect(CHAPTER_SYSTEM_PROMPT).toContain(DE_AI_GENERATION_RULES)
    expect(revision.indexOf(DE_AI_REVISION_BOUNDARY)).toBeGreaterThan(
      revision.indexOf(buildStableContextPrefix(outline, context)),
    )
    expect(draft).not.toContain(DE_AI_REVISION_BOUNDARY)
  })

  it("规则不进 user 提示词，因此永远不会截断稳定缓存前缀", () => {
    const stableBlock = buildStableContextPrefix(outline, context)
    const prompts = [
      buildDeepChapterDraftPrompt(outline, context, "任务书", "写下一章", 5),
      buildDeepChapterExpansionPrompt(outline, context, "任务书", "过短正文", "写下一章", 5),
      buildDeepChapterRevisionPrompt(outline, context, "任务书", "初稿", [], "写下一章", 5),
    ]

    for (const prompt of prompts) {
      // user 必须以前缀开头（DeepSeek/OpenAI 的自动前缀缓存从这里算起）。
      expect(prompt.startsWith(stableBlock)).toBe(true)
      // 规则本体不在 user 里——它在 system，排在整条请求的最前面，
      // 既不会截断 P，也不会随阶段内容变化而重发。
      expect(prompt).not.toContain(DE_AI_GENERATION_RULES)
    }
  })
})
