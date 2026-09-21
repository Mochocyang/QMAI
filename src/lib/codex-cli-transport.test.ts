import { beforeEach, describe, expect, it, vi } from "vitest"
import { streamCodexCli } from "./codex-cli-transport"
import type { CodexAppServerEnvelope } from "./codex-app-server-client"
import type { LlmConfig } from "@/stores/wiki-store"

interface ThreadHandler {
  onEnvelope?: (envelope: CodexAppServerEnvelope) => void
}

const serverMock = vi.hoisted(() => {
  let handler: ThreadHandler | null = null
  let emitOnTurnStart: (emit: (envelope: CodexAppServerEnvelope) => void) => void = (emit) => {
    emit({
      method: "item/agentMessage/delta",
      params: { itemId: "a1", delta: "Connected" },
    })
    emit({
      method: "turn/completed",
      params: { turn: { id: "turn_1", status: "completed" } },
    })
  }
  const client = {
    get isolatedCwd() {
      return "/tmp"
    },
    ensureStarted: vi.fn(async () => {}),
    call: vi.fn(async (method: string) => {
      if (method === "thread/start") return { thread: { id: "thread_1" } }
      if (method !== "turn/start") return undefined
      setTimeout(() => {
        emitOnTurnStart((envelope) => handler?.onEnvelope?.(envelope))
      }, 0)
      return { turn: { id: "turn_1" } }
    }),
    registerThread: vi.fn((_threadId: string, threadHandler: ThreadHandler) => {
      handler = threadHandler
      return () => {
        handler = null
      }
    }),
    interrupt: vi.fn(async () => {}),
  }
  return {
    client,
    setTurnEmit(fn: (emit: (envelope: CodexAppServerEnvelope) => void) => void) {
      emitOnTurnStart = fn
    },
    reset() {
      handler = null
      emitOnTurnStart = (emit) => {
        emit({
          method: "item/agentMessage/delta",
          params: { itemId: "a1", delta: "Connected" },
        })
        emit({
          method: "turn/completed",
          params: { turn: { id: "turn_1", status: "completed" } },
        })
      }
    },
  }
})

vi.mock("./codex-app-server-client", () => ({
  getCodexAppServerClient: () => serverMock.client,
  CodexAppServerClient: class {},
}))

const codexCliConfig: LlmConfig = {
  provider: "codex-cli",
  apiKey: "",
  model: "gpt-5",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "",
  maxContextSize: 204800,
  apiMode: "chat_completions",
  reasoning: { mode: "auto" },
}

describe("streamCodexCli", () => {
  beforeEach(() => {
    serverMock.reset()
  })

  it("waits for the completed turn before resolving so connection tests see emitted content", async () => {
    let content = ""
    let done = false

    await streamCodexCli(codexCliConfig, [{ role: "user", content: "ping" }], {
      onToken: (token) => { content += token },
      onDone: () => { done = true },
      onError: (error) => { throw error },
    })

    expect(done).toBe(true)
    expect(content).toBe("Connected")
  })

  it("extracts the final turn failure message instead of dumping every event", async () => {
    let errorMessage = ""

    serverMock.setTurnEmit((emit) => {
      emit({
        method: "turn/completed",
        params: {
          turn: {
            id: "turn_1",
            status: "failed",
            error: { message: "unexpected status 401 Unauthorized: Incorrect API key provided: sk-test" },
          },
        },
      })
    })

    await streamCodexCli(codexCliConfig, [{ role: "user", content: "ping" }], {
      onToken: () => {},
      onDone: () => {},
      onError: (error) => { errorMessage = error.message },
    })

    expect(errorMessage).toContain("Incorrect API key provided")
  })
})