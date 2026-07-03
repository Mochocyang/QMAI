import type { PrePlugin, PrePluginInput, PrePluginOutput } from "../pipeline"
import { routeTask } from "@/lib/novel/task-router"

export interface RouteTaskPluginDeps {
  onVirtualTool?: (
    event: "start" | "end",
    name: string,
    data: { callId?: string; params?: Record<string, unknown>; result?: string; status?: string },
  ) => void
}

export function createRouteTaskPlugin(deps: RouteTaskPluginDeps = {}): PrePlugin {
  const { onVirtualTool } = deps
  return {
    name: "route_task",
    priority: 10,
    run: async (input: PrePluginInput): Promise<PrePluginOutput> => {
      if (!input.novelMode) return {}
      let callId: string | undefined
      if (onVirtualTool) {
        callId = `route_task_${Date.now()}`
        onVirtualTool("start", "route_task", {
          callId,
          params: { userMessage: input.userMessage },
        })
      }
      const result = routeTask(input.userMessage)
      if (onVirtualTool && callId) {
        onVirtualTool("end", "route_task", {
          callId,
          result: JSON.stringify(result),
          status: "done",
        })
      }
      return { taskRoute: result }
    },
  }
}
