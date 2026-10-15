import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import { createAntigravityStreamParser, streamAntigravityCli } from "./antigravity-cli-transport"

type EventHandler = (event: { payload: unknown }) => void

const tauriMock = vi.hoisted(() => {
  const listeners = new Map<string, Set<EventHandler>>()
  return {
    listeners,
    emit(topic: string, payload: unknown) {
      for (const handler of listeners.get(topic) ?? []) handler({ payload })
    },
    reset() {
      listeners.clear()
    },
  }
})

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (topic: string, handler: EventHandler) => {
    const handlers = tauriMock.listeners.get(topic) ?? new Set<EventHandler>()
    handlers.add(handler)
    tauriMock.listeners.set(topic, handlers)
    return () => handlers.delete(handler)
  }),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, payload?: Record<string, unknown>) => {
    if (command !== "antigravity_cli_spawn") return
    const streamId = payload?.streamId
    if (typeof streamId !== "string") throw new Error("missing stream id")
    setTimeout(() => {
      for (const line of scripted.lines) tauriMock.emit(`antigravity-cli:${streamId}`, line)
      tauriMock.emit(`antigravity-cli:${streamId}:done`, scripted.exit)
    }, 0)
  }),
}))

const scripted: { lines: string[]; exit: { code: number | null; stderr: string } } = {
  lines: [],
  exit: { code: 0, stderr: "" },
}

const config: LlmConfig = {
  provider: "antigravity-cli",
  apiKey: "",
  model: "",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 204800,
  reasoning: { mode: "auto" },
}

beforeEach(() => {
  tauriMock.reset()
  scripted.lines = []
  scripted.exit = { code: 0, stderr: "" }
})

describe("antigravity stream parser", () => {
  it("concatenates agent_response text deltas and ignores tool steps", () => {
    const parse = createAntigravityStreamParser()
    const init = parse('{"event":"init","init":{"tools":["run_command"]}}')
    const tool = parse('{"event":"step_update","step_update":{"step_type":"tool","tool_name":"run_command","text_delta":"nope"}}')
    const active = parse('{"event":"step_update","step_update":{"step_type":"agent_response","state":"ACTIVE","text_delta":"苹"}}')
    const done = parse('{"event":"step_update","step_update":{"step_type":"agent_response","state":"DONE","text_delta":"果"}}')
    expect(init.token).toBeNull()
    expect(tool.token).toBeNull()
    expect(active.token).toBe("苹")
    expect(done.token).toBe("果")
  })

  it("reports a non-success result without treating it as text", () => {
    const parse = createAntigravityStreamParser()
    const parsed = parse('{"event":"result","result":{"status":"ERROR","response":"","error":"invalid model"}}')
    expect(parsed.token).toBeNull()
    expect(parsed.terminalStatus).toBe("ERROR")
    expect(parsed.terminalError).toBe("invalid model")
  })
})

describe("streamAntigravityCli", () => {
  it("keeps a successful run when stderr only has the early login line", async () => {
    scripted.lines = [
      '{"event":"step_update","step_update":{"step_type":"agent_response","state":"DONE","text_delta":"ok"}}',
      '{"event":"result","result":{"status":"SUCCESS","response":"ok","usage":{"input_tokens":3,"output_tokens":1,"total_tokens":4}}}',
    ]
    scripted.exit = { code: 0, stderr: "You are not logged into Antigravity.\n" }
    const tokens: string[] = []
    let error: Error | null = null
    let done = false
    await streamAntigravityCli(config, [{ role: "user", content: "ping" }], {
      onToken: (token) => { tokens.push(token) },
      onDone: () => { done = true },
      onError: (err) => { error = err },
    })
    expect(tokens).toEqual(["ok"])
    expect(error).toBeNull()
    expect(done).toBe(true)
  })

  it("sends a failed result to onError", async () => {
    scripted.lines = [
      '{"event":"result","result":{"status":"ERROR","response":"","error":"invalid model selection"}}',
    ]
    scripted.exit = { code: 1, stderr: "" }
    let error: Error | null = null
    await streamAntigravityCli(config, [{ role: "user", content: "ping" }], {
      onToken: () => {},
      onDone: () => {},
      onError: (err) => { error = err },
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain("invalid model selection")
  })
})
