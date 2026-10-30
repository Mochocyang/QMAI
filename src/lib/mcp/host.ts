import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { isTauri } from "@/lib/platform"
import { handleMcpToolCall } from "./dispatch"

// The native event listener outlives React refreshes. Keep its dispatch current
// during development without reloading the editor or losing background tasks.
let dispatchToolCall = handleMcpToolCall
if (import.meta.hot) {
  import.meta.hot.accept("./dispatch", (next) => {
    if (next) dispatchToolCall = next.handleMcpToolCall
  })
}

interface McpRequest {
  id: string
  method: string
  params?: unknown
}

export async function startMcpHost(): Promise<() => void> {
  if (!isTauri()) return () => {}
  return listen<McpRequest>("mcp-request", (event) => {
    const request = event.payload
    void dispatchToolCall(request.params)
      .then((result) => invoke("mcp_respond", { id: request.id, body: { ok: true, result } }))
      .catch((error: unknown) => invoke("mcp_respond", {
        id: request.id,
        body: { ok: false, message: error instanceof Error ? error.message : String(error) },
      }))
  })
}
