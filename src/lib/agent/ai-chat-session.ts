import { AgentRunner } from "./runner"
import type { ToolRegistry } from "./registry"
import type { AgentConfig, AgentMessage, AgentRunCallbacks, AgentRunRecord } from "./types"
import { scopeAgentConfigTools } from "./tool-scope"

export interface RunAiChatSessionCallbacks {
  onText: (chunk: string) => void
  onToolEvent?: AgentRunCallbacks["onToolEvent"]
  onActivityEvent?: AgentRunCallbacks["onActivityEvent"]
  onDone: () => void
  onError: (error: Error) => void
}

export interface RunAiChatSessionInput {
  userMessage: string
  projectPath?: string
  agentConfig: AgentConfig
  registry: ToolRegistry
  messages: AgentMessage[]
  callbacks: RunAiChatSessionCallbacks
  enabledToolNames?: string[] | null
  signal?: AbortSignal
  agentRunner?: Pick<AgentRunner, "run">
}

export async function runAiChatSession(input: RunAiChatSessionInput): Promise<AgentRunRecord> {
  const runner = input.agentRunner ?? new AgentRunner()
  const scopedAgentConfig = scopeAgentConfigTools(input.agentConfig, input.enabledToolNames)

  return runner.run(
    {
      ...scopedAgentConfig,
      projectPath: input.projectPath ?? scopedAgentConfig.projectPath,
      taskGoal: input.userMessage,
      requestOverrides: scopedAgentConfig.requestOverrides,
    },
    input.registry,
    input.messages,
    {
      onText: input.callbacks.onText,
      onToolCall: () => {},
      onToolResult: () => {},
      onToolError: () => {},
      onToolEvent: input.callbacks.onToolEvent,
      onActivityEvent: input.callbacks.onActivityEvent,
      onDone: input.callbacks.onDone,
      onError: input.callbacks.onError,
    },
    input.signal,
  )
}
