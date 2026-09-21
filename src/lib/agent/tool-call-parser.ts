import type { ToolCallDelta } from "./types"
import type { ToolCall } from "../llm-providers"

export function accumulateToolCalls(deltas: ToolCallDelta[]): ToolCall[] {
  const groups = new Map<number, { id: string; name: string; argsChunks: string[] }>()

  for (const delta of deltas) {
    const group = groups.get(delta.index) || { id: "", name: "", argsChunks: [] }
    if (delta.id) group.id = delta.id
    if (delta.name) group.name = delta.name
    if (delta.arguments) group.argsChunks.push(delta.arguments)
    groups.set(delta.index, group)
  }

  return Array.from(groups.values()).map((g) => {
    const argsStr = g.argsChunks.join("")
    return {
      id: g.id,
      type: "function" as const,
      function: {
        name: g.name,
        arguments: argsStr,
      },
    }
  })
}
