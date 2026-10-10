import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * 守卫：拆书库里的 LLM 调用必须走 callAnalysisModelText。
 *
 * 这 8 个文件过去各自直接调 streamChat，因此「模型只输出思考、没有输出正文」
 * 这条流在整条拆书链路上无处重试（用户实测：文风分析连续两次失败，
 * 报错为「模型只输出了 17,331 / 20,644 字符的思考内容，但没有输出正文」）。
 * 逐个改完之后加这道守卫，避免以后新增调用点时又绕过去。
 */
const ANALYSIS_FILES = [
  "style-analysis-adapter.ts",
  "story-analysis-adapter.ts",
  "verification-engine.ts",
  "six-dimension-engine.ts",
  "character-llm-recognizer.ts",
  "character-extraction-engine.ts",
  "workbench-adapter.ts",
  "skill-generator.ts",
]

describe("拆书库调用守卫", () => {
  for (const file of ANALYSIS_FILES) {
    it(`${file} 不再直接调用 streamChat`, () => {
      const source = readFileSync(resolve(__dirname, file), "utf8")
      // `streamChat(` 只在真正发起调用时出现；`Parameters<typeof streamChat>[0]`
      // 这类类型用法没有紧跟的左括号，因此不会误报。
      expect(source).not.toMatch(/streamChat\(/)
    })
  }

  it("共享实现自身仍然调用 streamChat（否则守卫等于没守住）", () => {
    const source = readFileSync(resolve(__dirname, "analysis-model-call.ts"), "utf8")
    expect(source).toMatch(/streamChat\(/)
  })
})

/**
 * 守卫：这三个调用点原本把 `{ reasoning: llmConfig.reasoning }` 当 streamChat 的
 * 请求覆盖项传下去，迁移到 callAnalysisModelText 时必须用 baseOverrides 原样带上。
 *
 * 为什么不能省：其它 provider 都走 effectiveReasoning()（overrides?.reasoning ?? config.reasoning，
 * 见 llm-providers.ts:686），所以省掉是等价的；但 buildGoogleBody 是**直接**读
 * overrides?.reasoning（llm-providers.ts:1303/1305）。省掉之后，Gemini 用户在设置里
 * 选的 thinking 档位（off/low/medium/custom）会被静默忽略，
 * 退化成 googleModelSupportsThinkingConfig 的默认分支。
 */
const REASONING_PASSTHROUGH_FILES = [
  "style-analysis-adapter.ts",
  "story-analysis-adapter.ts",
  "verification-engine.ts",
]

describe("拆书库 reasoning 覆盖项透传守卫", () => {
  for (const file of REASONING_PASSTHROUGH_FILES) {
    it(`${file} 仍把 llmConfig.reasoning 作为 baseOverrides 传下去`, () => {
      const source = readFileSync(resolve(__dirname, file), "utf8")
      expect(source).toContain("baseOverrides: { reasoning: llmConfig.reasoning }")
    })
  }
})
