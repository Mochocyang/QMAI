import { beforeEach, describe, expect, it, vi } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import { TauriStdioTransport } from "./stdio"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}))

describe("TauriStdioTransport", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("start 调用 mcp_stdio_spawn", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(123)
    const transport = new TauriStdioTransport({ command: "node", args: ["server.js"] })

    await transport.start()

    expect(invoke).toHaveBeenCalledWith("mcp_stdio_spawn", {
      options: { command: "node", args: ["server.js"] },
    })
  })

  it("send 调用 mcp_stdio_write", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(123).mockResolvedValueOnce(undefined)
    const transport = new TauriStdioTransport({ command: "node" })

    await transport.send('{"jsonrpc":"2.0"}')

    expect(invoke).toHaveBeenCalledWith("mcp_stdio_write", {
      pid: 123,
      data: '{"jsonrpc":"2.0"}',
    })
  })

  it("receive 调用 mcp_stdio_read", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(123).mockResolvedValueOnce('{"ok":true}')
    const transport = new TauriStdioTransport({ command: "node" })

    await expect(transport.receive(1000)).resolves.toBe('{"ok":true}')
    expect(invoke).toHaveBeenCalledWith("mcp_stdio_read", {
      pid: 123,
      timeoutMs: 1000,
    })
  })

  it("close 调用 mcp_stdio_kill", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(123).mockResolvedValueOnce(undefined)
    const transport = new TauriStdioTransport({ command: "node" })

    await transport.start()
    await transport.close()

    expect(invoke).toHaveBeenCalledWith("mcp_stdio_kill", { pid: 123 })
  })
})
