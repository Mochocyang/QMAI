import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * 守卫：下面列出的这些已知调用点必须走 callAnalysisModelText，而不是直接调 streamChat。
 *
 * 说清楚这道守卫的**实际范围**，别高估它：
 * 它是针对一份**已知文件名单**的回归绊线（tripwire），不是「拆书库所有 LLM 调用
 * 都鉴一遍」的强制规则。它**抓不到**：新出现的文件里直接调 streamChat、
 * 写成 `streamChat (`（带空格）、或先取别名再调用。真要收紧只能靠代码评审 + 扩大名单。
 *
 * 名单里的 8 个文件过去各自直接调 streamChat，因此「模型只输出思考、没有输出正文」
 * 这条流在整条拆书链路上无处重试（用户实测：文风分析连续两次失败，
 * 报错为「模型只输出了 17,331 / 20,644 字符的思考内容，但没有输出正文」）。
 * 逐个改完之后加这道守卫，避免这 8 处以后又退回直接调用。
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

/**
 * 同一道守卫的续集：这 3 个文件也属于拆书库的 LLM 调用，但落在 src/components/ 下，
 * 最初那轮迁移只扫了 src/lib/novel/book-analysis/，所以被漏掉了。
 * 其中 use-character-extraction 的两处原本把 onError 吞成 console.error，
 * 思考-only 时返回空串 -> 上层写成 personality 为空的坏画像并落盘。
 *
 * ⚠️ 这张表的解析基准是 **src/**（`resolve(__dirname, "../../..", file)`），
 * 与上面 `ANALYSIS_FILES`（裸文件名、基准是 `book-analysis/`）**不同**。
 * 跨目录的文件必须加进这一张：加进 `ANALYSIS_FILES` 会因路径不存在而
 * **ENOENT 报错**——表现为「测试报错」而不是「断言失败」，很容易被误读成守卫生效。
 */
const ANALYSIS_COMPONENT_FILES = [
  "components/novel/hooks/use-character-extraction.ts",
  "components/novel/book-analysis-view.tsx",
  /*
   * 文风自进化。这两个文件的分工是：引擎（engine）只收**注入**的 callModel，
   * 自己不碰网络——它的测试因此能完全离线；接线层（runner）才是真正把
   * callModel 接到 `callAnalysisModelText` 上的那一处。
   *
   * 两个都列进来是当**回归绊线**：将来若有人图省事在任一处改成直接调 streamChat，
   * 「模型只输出思考、没有输出正文」这条流就会绕过 callAnalysisModelText 的
   * 关思考重试——而这正是当初给整条拆书链路加这道守卫的原因。
   */
  "lib/novel/style-evolution-engine.ts",
  "lib/novel/style-evolution-runner.ts",
]

describe("拆书库调用守卫（book-analysis 目录之外的部分）", () => {
  for (const file of ANALYSIS_COMPONENT_FILES) {
    it(`${file} 不再直接调用 streamChat`, () => {
      // 本 spec 位于 src/lib/novel/book-analysis/，所以要先退到 src/ 再拼路径。
      const source = readFileSync(resolve(__dirname, "../../..", file), "utf8")
      expect(source).not.toMatch(/streamChat\(/)
    })
  }
})
