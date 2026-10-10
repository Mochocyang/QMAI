import { streamChat } from "@/lib/llm-client"
import {
  CHAPTER_DISCUSS_REPAIR_MAX_TOKENS,
  buildChapterDiscussRepairMessages,
} from "./chapter-discuss-protocol"
import { repairJsonProtocolWithAi } from "./discuss-protocol-shared"

interface RepairChapterDiscussProtocolOptions {
  content: string
  module: string
  llmConfig: Parameters<typeof streamChat>[0]
  signal: AbortSignal
  maxTokens?: number
  stream?: typeof streamChat
}

/**
 * 章节共创「补协议」：模型只给了推演正文、没给 chapter_discuss 协议块时，
 * 用一次便宜的确定性调用把它已经表达出的判断与方向转写成协议。
 *
 * 与大纲侧行为一致：只转写、不创作；失败时抛出原始错误，不伪装成空修复。
 * 底层修复轮机械见 discuss-protocol-shared。
 */
export async function repairChapterDiscussProtocolWithAi(
  options: RepairChapterDiscussProtocolOptions,
): Promise<string> {
  return repairJsonProtocolWithAi({
    messages: buildChapterDiscussRepairMessages({
      content: options.content,
      module: options.module,
    }),
    maxTokens: options.maxTokens ?? CHAPTER_DISCUSS_REPAIR_MAX_TOKENS,
    llmConfig: options.llmConfig,
    signal: options.signal,
    stream: options.stream,
  })
}
