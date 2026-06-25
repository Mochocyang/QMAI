import { streamChat } from "@/lib/llm-client"
import { resolveNovelModel } from "@/lib/novel/model-resolver"
import type { LlmConfig, NovelConfig } from "@/stores/wiki-store"

export type TestableNovelModelTask = "writing" | "review" | "summary" | "extract"

export interface NovelModelTestResult {
  model: string
  content: string
  usedFallbackModel: boolean
}

const TEST_PROMPTS: Record<TestableNovelModelTask, string> = {
  writing: "你正在执行小说写作模型测试。请只回复“写作模型测试成功”。",
  review: "你正在执行小说审稿模型测试。请只回复“审稿模型测试成功”。",
  summary: "你正在执行小说摘要模型测试。请只回复“摘要模型测试成功”。",
  extract: "你正在执行小说资料提取模型测试。请只回复“提取模型测试成功”。",
}

export async function testNovelModel(
  llmConfig: LlmConfig,
  novelConfig: NovelConfig,
  taskType: TestableNovelModelTask,
): Promise<NovelModelTestResult> {
  const effectiveConfig = resolveNovelModel(llmConfig, novelConfig, taskType)
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

  const modelKey = `${taskType}Model` as const

  // writingModel 已移除，writing 任务始终视为回退到 AI 会话模型
  const usedFallbackModel = taskType === "writing" ? true : !novelConfig[modelKey].trim()

  return {
    model,
    content: trimmed,
    usedFallbackModel,
  }
}
