import type { Tool } from "../types"
import { routeTask } from "@/lib/novel/task-router"

export function createRouteTaskTool(userMessage: string): Tool {
  return {
    name: "route_task",
    description: "虚拟工具：识别用户消息的小说任务意图（如续写、改写、生成大纲等），返回意图与置信度。由管道前置链自动执行，LLM 不直接调用。",
    category: "virtual",
    parameters: {},
    execute: async () => {
      const route = routeTask(userMessage)
      return JSON.stringify({
        intent: route.intent,
        confidence: route.confidence,
      })
    },
  }
}
