import type { ToolRegistry } from "./registry"
import type { AgentRunCallbacks, AgentRunRecord, Tool } from "./types"
import { executeAgentTool, type ExecuteAgentToolResult } from "./tool-executor"
import { RequiredToolFallbackError } from "./required-tools-gate"

interface RequiredToolFallbackResult {
  attempted: boolean
  toolName?: string
  satisfiedTools: string[]
  finalContent?: string
  error?: RequiredToolFallbackError
}

/** Shared fulfillment policy for model-selected and deterministic tool calls. */
export function isRequiredToolExecutionFulfilled(
  tool: Tool | undefined,
  executed: ExecuteAgentToolResult,
): boolean {
  return Boolean(
    tool
    && executed.record.status === "done"
    && (!tool.finalizesRun || executed.finalContent?.trim()),
  )
}

export async function executeRequiredToolFallback(input: {
  missingTools: string[]
  taskGoal: string
  registry: ToolRegistry
  callbacks: AgentRunCallbacks
  record: AgentRunRecord
  signal?: AbortSignal
}): Promise<RequiredToolFallbackResult> {
  const satisfiedTools: string[] = []

  for (const toolName of input.missingTools) {
    const tool = input.registry.get(toolName)
    if (!tool?.buildRequiredToolFallbackParams) continue

    let params: Record<string, unknown>
    try {
      params = tool.buildRequiredToolFallbackParams({ taskGoal: input.taskGoal })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return {
        attempted: true,
        toolName,
        satisfiedTools,
        error: new RequiredToolFallbackError(toolName, `无法构造兜底参数：${detail}`),
      }
    }

    const executed = await executeAgentTool(
      {
        id: `required_fallback:${toolName}:${Date.now()}`,
        name: toolName,
        arguments: params,
      },
      input.registry,
      input.callbacks,
      input.signal,
    )
    input.record.toolCalls.push(executed.record)

    if (executed.record.status !== "done") {
      return {
        attempted: true,
        toolName,
        satisfiedTools,
        error: new RequiredToolFallbackError(toolName, executed.responseText),
      }
    }

    const finalContent = executed.finalContent?.trim()
    if (tool.finalizesRun && !finalContent) {
      return {
        attempted: true,
        toolName,
        satisfiedTools,
        error: new RequiredToolFallbackError(toolName, "工具执行完成，但没有交付终稿正文"),
      }
    }
    if (!isRequiredToolExecutionFulfilled(tool, executed)) {
      return {
        attempted: true,
        toolName,
        satisfiedTools,
        error: new RequiredToolFallbackError(toolName, "工具未达到必调履约条件"),
      }
    }

    satisfiedTools.push(toolName)
    if (finalContent) {
      return {
        attempted: true,
        toolName,
        satisfiedTools,
        finalContent,
      }
    }
  }

  return { attempted: false, satisfiedTools }
}
