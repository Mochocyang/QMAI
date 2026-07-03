import { invoke } from "@tauri-apps/api/core"
import type { StdioTransport } from "./json-rpc"

export interface TauriStdioTransportOptions {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
}

export class TauriStdioTransport implements StdioTransport {
  private pid: number | null = null
  private startPromise: Promise<number> | null = null

  constructor(private readonly options: TauriStdioTransportOptions) {}

  async start(): Promise<number> {
    if (this.pid !== null) return this.pid
    if (!this.startPromise) {
      this.startPromise = invoke<number>("mcp_stdio_spawn", {
        options: this.options,
      }).then((pid) => {
        this.pid = pid
        return pid
      })
    }
    return this.startPromise
  }

  async send(data: string): Promise<void> {
    const pid = await this.start()
    await invoke<void>("mcp_stdio_write", { pid, data })
  }

  async receive(timeoutMs?: number): Promise<string | null> {
    const pid = await this.start()
    return await invoke<string | null>("mcp_stdio_read", { pid, timeoutMs })
  }

  async close(): Promise<void> {
    if (this.pid === null) return
    const pid = this.pid
    this.pid = null
    this.startPromise = null
    await invoke<void>("mcp_stdio_kill", { pid })
  }
}
