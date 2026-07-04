import { streamChat } from "@/lib/llm-client"
import { resolveDefaultModel, resolveNovelModel } from "@/lib/novel/model-resolver"
import type { LlmConfig, NovelConfig } from "@/stores/wiki-store"

export type TestableNovelModelTask = "writing" | "review" | "summary" | "extract" | "deAi" | "workflow"

export interface NovelModelTestResult {
  model: string
  content: string
  usedFallbackModel: boolean
}

const TEST_PROMPTS: Record<TestableNovelModelTask, string> = {
  writing: "你正在执行小说写作模型测试。请只回复“写作模型测试成功”。",
  workflow: "你正在执行默认模型（工作流）测试。请只回复“默认模型测试成功”。",
  review: "你正在执行小说审稿模型测试。请只回复“审稿模型测试成功”。",
  summary: "你正在执行小说摘要模型测试。请只回复“摘要模型测试成功”。",
  extract: "你正在执行小说资料提取模型测试。请只回复“提取模型测试成功”。",
  deAi: "你正在执行小说去AI味模型测试。请只回复“去AI味模型测试成功”。",
}

export async function testNovelModel(
  llmConfig: LlmConfig,
  novelConfig: NovelConfig,
  taskType: TestableNovelModelTask,
): Promise<NovelModelTestResult> {
  const effectiveConfig = taskType === "workflow"
    ? resolveDefaultModel(llmConfig)
    : resolveNovelModel(llmConfig, novelConfig, taskType)
  const model = effectiveConfig.model.trim()
  if (!model) {
    throw new Error("请先配置主模型或当前小说专用模型后再测试。")
  }

  let content = ""
  let streamError: Error | null = null

  await streamChat(
    effectiveConfig,
    [{ role: "user", content: TEST_PROMPTS[taskType] }],
    {
      onToken: (token) => {
        content += token
      },
      onDone: () => undefined,
      onError: (error) => {
        streamError = error
      },
    },
    AbortSignal.timeout(30000),
    { temperature: 0 },
  )

  if (streamError) {
    throw streamError
  }

  const trimmed = content.trim()
  if (!trimmed) {
    throw new Error("模型已连接，但没有返回可用内容。")
  }

  const usedFallbackModel = taskType === "workflow"
    ? !novelConfig.defaultLlmModel.trim()
    : taskType === "writing"
      ? true
      : !novelConfig[`${taskType}Model` as "reviewModel" | "summaryModel" | "extractModel" | "deAiModel"].trim()

  return {
    model,
    content: trimmed,
    usedFallbackModel,
  }
}
