import type { Tool } from "../types"
import { buildContextPack } from "@/lib/novel/context-engine"
import type { TaskRouteResult } from "@/lib/novel/task-router"

export function createLoadContextTool(
  projectPath: string,
  userMessage: string,
  taskRoute: TaskRouteResult,
): Tool {
  return {
    name: "load_context",
    description:
      "虚拟工具：根据意图路由加载项目上下文（大纲、最近章节、记忆、伏笔等 21 个数据源）。由管道前置链自动执行，LLM 不直接调用。",
    category: "virtual",
    parameters: {},
    execute: async () => {
      try {
        const pack = await buildContextPack(projectPath, userMessage, taskRoute?.chapterNumber)
        const contextStr = pack.soulDoc
          ? `【作品灵魂】\n${pack.soulDoc}\n\n【上下文数据源】\n共加载 ${Object.keys(pack).length} 个数据源`
          : `【上下文数据源】\n共加载 ${Object.keys(pack).length} 个数据源`
        return contextStr
      } catch (e) {
        return `错误：加载上下文失败 - ${e instanceof Error ? e.message : String(e)}`
      }
    },
  }
}
