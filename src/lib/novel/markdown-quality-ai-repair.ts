import { streamChat } from "@/lib/llm-client"
import {
  buildMarkdownFormatRepairMessages,
  buildMarkdownRepairRequestOverrides,
} from "./markdown-quality-finalizer"

interface RepairMarkdownFormatWithAiOptions {
  content: string
  llmConfig: Parameters<typeof streamChat>[0]
  signal: AbortSignal
  maxTokens: number
  stream?: typeof streamChat
}

export async function repairMarkdownFormatWithAi(
  options: RepairMarkdownFormatWithAiOptions,
): Promise<string> {
  const stream = options.stream ?? streamChat
  let result = ""
  let repairError: Error | null = null
  await stream(
    options.llmConfig,
    buildMarkdownFormatRepairMessages(options.content),
    {
      onToken: (token) => {
        result += token
      },
      onDone: () => {},
      onError: (error) => {
        repairError = error
      },
    },
    options.signal,
    buildMarkdownRepairRequestOverrides(options.maxTokens),
  )
  if (repairError) throw repairError
  return result.trim()
}
