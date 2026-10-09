import { streamChat } from "@/lib/llm-client"
import {
  buildOutlineDiscussRepairMessages,
  buildOutlineDiscussRepairRequestOverrides,
} from "./outline-discuss-protocol"

interface RepairOutlineDiscussProtocolOptions {
  content: string
  module: string
  llmConfig: Parameters<typeof streamChat>[0]
  signal: AbortSignal
  maxTokens?: number
  stream?: typeof streamChat
}

/**
 * 共创讨论轮「补协议」：模型只给了正文、没给 outline_discuss 协议块时，
 * 用一次便宜的确定性调用把它已经表达出的判断与分歧转写成协议。
 *
 * 为什么值得多花这一次调用：没有协议块就没有待拍板卡片，整轮讨论等于白跑，
 * 而模型给出的判断往往是有价值的 —— 直接判死会把有价值的内容一起丢掉
 * （实测故障就是这样：一整卷大纲被判为「共创协议格式无效」）。
 *
 * 这里只转写、不创作；解析仍由调用方负责，修复失败不影响原有报错路径。
 */
export async function repairOutlineDiscussProtocolWithAi(
  options: RepairOutlineDiscussProtocolOptions,
): Promise<string> {
  const stream = options.stream ?? streamChat
  let result = ""
  let repairError: Error | null = null
  await stream(
    options.llmConfig,
    buildOutlineDiscussRepairMessages({ content: options.content, module: options.module }),
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
    buildOutlineDiscussRepairRequestOverrides(options.maxTokens),
  )
  if (repairError) throw repairError
  return result.trim()
}
