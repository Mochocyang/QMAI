import { describe, expect, it } from "vitest"

import { diagnoseOutputTruncation, type OutputTruncationContext } from "./llm-client"

/**
 * 「输出被截断」的**对症**解决建议。
 *
 * 旧文案一律说「提高最大输出 token 后重试」，但按 `planLlmRequestBudget` 的算法，
 * 实际发出的 max_tokens = min(目标输出, 用户声明上限, 窗口−输入−脚手架)。
 * 截断时卡住的**未必是用户上限**：窗口被长上下文挤占时，输出会被压到下限，
 * 这时叫用户去调输出上限是**错的**（调了也没用，因为决定值不是它）。
 * 用户 2026-11-02 要求：先分析当前模型与卡点，再给对应解法。
 *
 * 这里把判断做成纯函数：给不同的上下文，断言它指向正确的旋钮。
 */

function context(overrides: Partial<OutputTruncationContext> = {}): OutputTruncationContext {
  return {
    model: "deepseek-chat",
    provider: "deepseek",
    sentOutputTokens: 4_096,
    declaredOutputCap: 4_096,
    windowTokens: 65_536,
    ...overrides,
  }
}

describe("diagnoseOutputTruncation", () => {
  it("说清是哪套配置截断的（模型名进正文）", () => {
    const text = diagnoseOutputTruncation(context())
    expect(text).toContain("deepseek-chat")
  })

  it("发出值已被用户上限卡住：明确指向「提高输出上限」", () => {
    const text = diagnoseOutputTruncation(context({ sentOutputTokens: 4_096, declaredOutputCap: 4_096 }))

    expect(text).toContain("输出上限")
    // 上限已是决定值：这条建议在此分支成立。
    expect(text).toContain("4,096")
  })

  it("发出值低于用户上限：明说调上限没用，改指窗口/输入", () => {
    /*
     * 窗口只剩这么多空间给输出（长上下文/大资料包把窗口占了）。
     * 此时叫用户调「输出上限」是误导：那个旋钮根本不是决定值。
     */
    const text = diagnoseOutputTruncation(context({
      sentOutputTokens: 512,
      declaredOutputCap: 32_000,
      windowTokens: 8_192,
    }))

    expect(text).toContain("不是「输出上限」")
    expect(text).toContain("调高输出上限不会改善")
    // 指向真正有效的旋钮：上下文窗口 / 注入内容 / 换更大窗口模型。
    expect(text).toContain("上下文窗口")
  })

  it("任何分支都给出「输入继续」这条通用出路（半截内容已保留）", () => {
    for (const capBound of [true, false]) {
      const text = diagnoseOutputTruncation(
        capBound
          ? context({ sentOutputTokens: 4_096, declaredOutputCap: 4_096 })
          : context({ sentOutputTokens: 512, declaredOutputCap: 32_000 }),
      )
      expect(text).toContain("继续")
    }
  })

  it("上下文缺失时不崩，退回通用文案", () => {
    const text = diagnoseOutputTruncation(undefined)

    expect(text).toContain("输出被截断")
    expect(text).toContain("继续")
  })
})
