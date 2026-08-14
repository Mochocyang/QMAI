import { beforeEach, describe, expect, it, vi } from "vitest"

const invokeMock = vi.hoisted(() => vi.fn())
const listenMock = vi.hoisted(() => vi.fn())

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }))

import {
  CodexAppServerClient,
  type CodexAppServerEnvelope,
} from "./codex-app-server-client"

type EventHandler = (event: { payload: unknown }) => void

describe("CodexAppServerClient", () => {
  let handlers: Map<string, EventHandler>
  let writes: CodexAppServerEnvelope[]
  let generation: number

  const emitLine = (envelope: CodexAppServerEnvelope) => {
    handlers.get("codex-app-server:event")?.({
      payload: { generation, line: JSON.stringify(envelope) },
    })
  }

  beforeEach(() => {
    handlers = new Map()
    writes = []
    generation = 1
    listenMock.mockReset()
    listenMock.mockImplementation(async (name: string, handler: EventHandler) => {
      handlers.set(name, handler)
      return () => handlers.delete(name)
    })
    invokeMock.mockReset()
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "codex_app_server_start") {
        return { generation, cwd: "/tmp/qmai-codex/workspace" }
      }
      if (command === "codex_app_server_stop") return undefined
      if (command === "codex_app_server_write") {
        const envelope = JSON.parse(String(args?.data)) as CodexAppServerEnvelope
        writes.push(envelope)
        if (envelope.method === "initialize") {
          queueMicrotask(() => emitLine({ id: envelope.id, result: { userAgent: "codex-test" } }))
        } else if (
          envelope.method === "thread/start" &&
          Array.isArray((envelope.params as Record<string, unknown> | undefined)?.dynamicTools)
        ) {
          queueMicrotask(() => emitLine({
            id: envelope.id,
            result: { thread: { id: "probe-thread" }, instructionSources: [] },
          }))
        }
        return undefined
      }
      throw new Error(`unexpected command: ${command}`)
    })
  })

  it("initializes once and correlates concurrent JSON-RPC responses by id", async () => {
    const client = new CodexAppServerClient()
    await client.ensureStarted()

    const alpha = client.call<string>("test/alpha")
    const beta = client.call<string>("test/beta")
    await Promise.resolve()
    const alphaRequest = writes.find((item) => item.method === "test/alpha")!
    const betaRequest = writes.find((item) => item.method === "test/beta")!
    emitLine({ id: betaRequest.id, result: "B" })
    emitLine({ id: alphaRequest.id, result: "A" })

    await expect(alpha).resolves.toBe("A")
    await expect(beta).resolves.toBe("B")
    expect(writes.filter((item) => item.method === "initialize")).toHaveLength(1)
    expect(writes.some((item) => item.method === "initialized")).toBe(true)
  })

  it("routes item/tool/call to the registered thread and writes DynamicToolCallResponse", async () => {
    const client = new CodexAppServerClient()
    await client.ensureStarted()
    const onDynamicToolCall = vi.fn(async () => ({
      contentItems: [{ type: "inputText" as const, text: "tool-result" }],
      success: true,
    }))
    client.registerThread("thread-1", { onDynamicToolCall })

    emitLine({
      id: 99,
      method: "item/tool/call",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-1",
        namespace: null,
        tool: "read_outline",
        arguments: { path: "QM/outlines/总纲.md" },
      },
    })
    await vi.waitFor(() => {
      expect(writes.some((item) => item.id === 99 && item.result)).toBe(true)
    })

    expect(onDynamicToolCall).toHaveBeenCalledWith(expect.objectContaining({
      tool: "read_outline",
      arguments: { path: "QM/outlines/总纲.md" },
    }))
    expect(writes.find((item) => item.id === 99)?.result).toEqual({
      contentItems: [{ type: "inputText", text: "tool-result" }],
      success: true,
    })
  })

  it("rejects all pending requests on process exit and starts a new generation only later", async () => {
    const client = new CodexAppServerClient()
    await client.ensureStarted()
    const pending = client.call("test/slow")
    await Promise.resolve()

    handlers.get("codex-app-server:exit")?.({ payload: { generation } })
    await expect(pending).rejects.toThrow("本轮请求不会自动重放")

    generation = 2
    await client.ensureStarted()
    expect(invokeMock.mock.calls.filter(([command]) => command === "codex_app_server_start")).toHaveLength(2)
    expect(writes.filter((item) => item.method === "initialize")).toHaveLength(2)
  })

  it("rejects forbidden native server requests instead of dispatching them", async () => {
    const client = new CodexAppServerClient()
    await client.ensureStarted()
    client.registerThread("thread-1", {})

    emitLine({
      id: 100,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1" },
    })
    await vi.waitFor(() => {
      expect(writes.some((item) => item.id === 100 && item.error)).toBe(true)
    })
    expect(writes.find((item) => item.id === 100)?.error?.message).toContain("禁止 Codex 原生能力")
  })

  it("times out an individual RPC without stopping or replaying the process", async () => {
    const client = new CodexAppServerClient()
    await client.ensureStarted()
    vi.useFakeTimers()
    try {
      const pending = client.call("test/timeout", undefined, 25)
      const assertion = expect(pending).rejects.toThrow("Codex app-server 调用超时：test/timeout")
      await vi.advanceTimersByTimeAsync(25)
      await assertion
      expect(invokeMock.mock.calls.filter(([command]) => command === "codex_app_server_start")).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
