import { describe, expect, it, vi } from "vitest"

import {
  buildMarkdownFormatRepairMessages,
  buildMarkdownRepairRequestOverrides,
  estimateMarkdownRepairTokens,
  finalizeStructuredMarkdownMessage,
  MARKDOWN_AI_REPAIR_MAX_INPUT_TOKENS,
  MARKDOWN_AI_REPAIR_PROMPT_TOKEN_OVERHEAD,
  planMarkdownAiRepair,
} from "./markdown-quality-finalizer"

// 生产侧的 FinalizeStructuredMarkdownOptions 未导出，这里从函数签名反推 AI 修复回调的
// 真实契约（{ content, maxTokens } -> Promise<string>），避免测试按旧签名手写 mock。
type MarkdownRepairWithAi = Parameters<
  typeof finalizeStructuredMarkdownMessage
>[1]["repairWithAi"]

describe("finalizeStructuredMarkdownMessage", () => {
  it("全文 markdown 围栏即使只有一个标题也必须本地去除围栏", async () => {
    const repairWithAi = vi.fn<MarkdownRepairWithAi>()

    const finalMessage = await finalizeStructuredMarkdownMessage(
      "```markdown\n# 唯一标题\n```",
      { enabled: true, repairWithAi, onFailure: vi.fn() },
    )

    expect(finalMessage).toBe("# 唯一标题")
    expect(repairWithAi).not.toHaveBeenCalled()
  })

  it("让全文 markdown 围栏进入本地修复并返回最终消息正文", async () => {
    const repairWithAi = vi.fn<MarkdownRepairWithAi>()
    const source = "```markdown\n人物设定\n\n- 姓名：林川\n- 目标：复仇\n```"

    const finalMessage = await finalizeStructuredMarkdownMessage(source, {
      enabled: true,
      repairWithAi,
      onFailure: vi.fn(),
    })

    expect(finalMessage).toBe("# 人物设定\n\n- 姓名：林川\n- 目标：复仇")
    expect(repairWithAi).not.toHaveBeenCalled()
  })

  it("保留尾部合法保存协议且只修复协议前正文", async () => {
    const protocol = '```json\n{"outlineSaveRequest":{"fileName":"人物.md"}}\n```'
    const source = `\`\`\`markdown\n人物设定\n\n- 姓名：林川\n- 目标：复仇\n\`\`\`\n\n${protocol}`

    const finalMessage = await finalizeStructuredMarkdownMessage(source, {
      enabled: true,
      repairWithAi: vi.fn<MarkdownRepairWithAi>(),
      onFailure: vi.fn(),
    })

    expect(finalMessage).toBe(`# 人物设定\n\n- 姓名：林川\n- 目标：复仇\n\n${protocol}`)
  })

  it.each([
    { name: "单换行", separator: "\n", newline: "\n" },
    { name: "CRLF", separator: "\r\n", newline: "\r\n" },
    { name: "紧邻", separator: "", newline: "\n" },
  ])("$name 保存协议不进入 AI 输入", async ({ separator, newline }) => {
    const body = "| 人物 | 目标 |\n| --- | --- |\n| 林川 | 复仇 |"
    const protocol = [
      "```json",
      '{"outlineSaveRequest":{"fileName":"人物.md"}}',
      "```",
    ].join(newline)
    const repairWithAi = vi.fn(async ({ content }: { content: string }) => content)

    const finalMessage = await finalizeStructuredMarkdownMessage(
      `${body}${separator}${protocol}`,
      { enabled: true, repairWithAi, onFailure: vi.fn() },
    )

    expect(repairWithAi).toHaveBeenCalledTimes(1)
    expect(repairWithAi).toHaveBeenCalledWith({
      content: body,
      maxTokens: expect.any(Number),
    })
    expect(repairWithAi.mock.calls[0]?.[0]).not.toContain("outlineSaveRequest")
    expect(finalMessage.endsWith(protocol)).toBe(true)
  })

  it("普通问答禁用时原样返回且不调用 AI", async () => {
    const repairWithAi = vi.fn(async () => "不应调用")
    const source = "建议先确认人物动机，再决定后续情节。"

    await expect(finalizeStructuredMarkdownMessage(source, {
      enabled: false,
      repairWithAi,
      onFailure: vi.fn(),
    })).resolves.toBe(source)
    expect(repairWithAi).not.toHaveBeenCalled()
  })

  it("本地候选不完整时以首次原文调用 AI 且最多一次", async () => {
    const source = "| 人物 | 目标 |\n| --- | --- |\n| 林川 | 复仇 |"
    const repairWithAi = vi.fn(async () => source)

    await finalizeStructuredMarkdownMessage(source, {
      enabled: true,
      repairWithAi,
      onFailure: vi.fn(),
    })

    expect(repairWithAi).toHaveBeenCalledTimes(1)
    expect(repairWithAi).toHaveBeenCalledWith({
      content: source,
      maxTokens: expect.any(Number),
    })
  })

  it("第三检仍失败时保留严格完整且问题更少的候选", async () => {
    const source = "- **林川\n- 目标：复仇"
    const aiCandidate = "# **林川\n- 目标：复仇"
    const onFailure = vi.fn()

    const finalMessage = await finalizeStructuredMarkdownMessage(source, {
      enabled: true,
      repairWithAi: vi.fn(async () => aiCandidate),
      onFailure,
    })

    expect(finalMessage).toBe(aiCandidate)
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  it("AI 删除任一表格行时拒绝覆盖并保留首次原文", async () => {
    const source = "| 人物 | 目标 |\n| --- | --- |\n| 林川 | 复仇 |\n| 苏晚 | 守城 |"
    const droppedRow = "# 人物目标\n| --- | --- |\n| 林川 | 复仇 |"

    const finalMessage = await finalizeStructuredMarkdownMessage(source, {
      enabled: true,
      repairWithAi: vi.fn(async () => droppedRow),
      onFailure: vi.fn(),
    })

    expect(finalMessage).toBe(source)
  })
})

describe("Markdown AI repair token budget", () => {
  it("按中文、英文单词、符号和换行在本地估算 token", () => {
    expect(estimateMarkdownRepairTokens("中文abcde!\n")).toBe(5)
  })

  it("emoji 和罕见 Unicode 至少按每个码点一个 token 估算", () => {
    expect(estimateMarkdownRepairTokens("😀".repeat(10))).toBeGreaterThanOrEqual(10)
    expect(estimateMarkdownRepairTokens("🜁𐍈§※")).toBeGreaterThanOrEqual(4)
  })

  it("密集标点不做三分之一折算", () => {
    expect(estimateMarkdownRepairTokens("!！?？※§"))
      .toBeGreaterThanOrEqual(6)
  })

  it("4680 emoji 必须超过输入预算并旁路 AI", () => {
    const plan = planMarkdownAiRepair("😀".repeat(4680))

    expect(plan.estimatedInputTokens).toBeGreaterThan(MARKDOWN_AI_REPAIR_MAX_INPUT_TOKENS)
    expect(plan.shouldCallAi).toBe(false)
  })

  it("输入预算边界内允许 AI，超出一个 token 立即旁路", () => {
    const maxBodyTokens = MARKDOWN_AI_REPAIR_MAX_INPUT_TOKENS
      - MARKDOWN_AI_REPAIR_PROMPT_TOKEN_OVERHEAD

    expect(planMarkdownAiRepair("中".repeat(maxBodyTokens)).shouldCallAi).toBe(true)
    expect(planMarkdownAiRepair("中".repeat(maxBodyTokens + 1)).shouldCallAi).toBe(false)
  })

  it("输出预算随正文增长且限制在 256 到 4096", () => {
    expect(planMarkdownAiRepair("短正文").maxOutputTokens).toBe(256)
    const largePlan = planMarkdownAiRepair("中".repeat(3000))
    expect(largePlan.maxOutputTokens).toBeGreaterThanOrEqual(3000)
    expect(largePlan.maxOutputTokens).toBeLessThanOrEqual(4096)
  })

  it("把动态输出预算映射到 streamChat 支持的 max_tokens", () => {
    expect(buildMarkdownRepairRequestOverrides(768)).toEqual({
      temperature: 0,
      max_tokens: 768,
    })
  })

  it("超长结构化正文直接旁路 AI", async () => {
    const maxBodyTokens = MARKDOWN_AI_REPAIR_MAX_INPUT_TOKENS
      - MARKDOWN_AI_REPAIR_PROMPT_TOKEN_OVERHEAD
    const source = `| 人物 | 目标 |\n| --- | --- |\n| 林川 | ${"中".repeat(maxBodyTokens + 1)} |`
    const repairWithAi = vi.fn(async () => "不应调用")
    const onFailure = vi.fn()

    const finalMessage = await finalizeStructuredMarkdownMessage(source, {
      enabled: true,
      repairWithAi,
      onFailure,
    })

    expect(repairWithAi).not.toHaveBeenCalled()
    expect(finalMessage).toBe(source)
    expect(onFailure).toHaveBeenCalledTimes(1)
  })
})

describe("buildMarkdownFormatRepairMessages", () => {
  it("只生成一条包含短规则和正文的用户消息", () => {
    const body = "# 人物设定\n\n林川决定复仇。"
    const messages = buildMarkdownFormatRepairMessages(body)

    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe("user")
    expect(messages[0]?.content).toContain("只修复下列正文的 Markdown 格式")
    expect(messages[0]?.content).toContain("只返回修复后的正文")
    expect(messages[0]?.content.endsWith(body)).toBe(true)
  })
})
