import type { Tool } from "../types"
import { contextPackToPrompt } from "@/lib/novel/context-engine"
import type { ContextPack } from "@/lib/novel/context-engine"

export function createTrimContextTool(contextPack: ContextPack, targetChars: number): Tool {
  return {
    name: "trim_context",
    description:
      "虚拟工具：将 ContextPack 按 targetChars 预算裁剪为最终提示字符串。M1 阶段包装现有头尾切，M4 升级为两级裁剪。由管道前置链自动执行，LLM 不直接调用。",
    category: "virtual",
    parameters: {},
    execute: async () => {
      if (targetChars <= 0) {
        return "【上下文为空】targetChars 为 0，已跳过上下文加载"
      }
      try {
        return contextPackToPrompt(contextPack, targetChars)
      } catch (e) {
        return `错误：裁剪上下文失败 - ${e instanceof Error ? e.message : String(e)}`
      }
    },
  }
}
