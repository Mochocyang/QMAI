import { describe, it, expect, vi, beforeEach } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import {
  createClaudeCodeStreamParser,
  buildExitError,
  streamClaudeCodeCli,
} from "../claude-cli-transport"

type EventHandler = (event: { payload: unknown }) => void

const tauriMock = vi.hoisted(() => {
  const listeners = new Map<string, Set<EventHandler>>()
  return {
    listeners,
    invokeHandler: undefined as undefined | ((command: string, payload?: Record<string, unknown>) => void),
    emit(topic: string, payload: unknown) {
      for (const handler of listeners.get(topic) ?? []) handler({ payload })
    },
    reset() {
      listeners.clear()
      this.invokeHandler = undefined
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
    tauriMock.invokeHandler?.(command, payload)
  }),
}))

vi.mock("@/lib/platform", () => ({
  isTauri: () => true,
}))

const claudeCliConfig: LlmConfig = {
  provider: "claude-code",
  apiKey: "",
  model: "claude-sonnet-4-6",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "",
  maxContextSize: 204800,
  apiMode: "chat_completions",
  reasoning: { mode: "auto" },
}

beforeEach(() => {
  tauriMock.reset()
})

describe("createClaudeCodeStreamParser", () => {
  it("emits text from a single stream_event text_delta", () => {
    const parse = createClaudeCodeStreamParser()
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
      },
    })
    expect(parse(line)).toBe("Hello")
  })

  it("accumulates multiple stream_event deltas in order", () => {
    const parse = createClaudeCodeStreamParser()
    const mk = (t: string) =>
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: t } },
      })
    expect(parse(mk("Hello "))).toBe("Hello ")
    expect(parse(mk("world"))).toBe("world")
    expect(parse(mk("!"))).toBe("!")
  })

  it("falls back to `assistant` message text when no deltas arrived", () => {
    const parse = createClaudeCodeStreamParser()
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hi there" }] },
    })
    expect(parse(line)).toBe("Hi there")
  })

  it("emits only the novel tail when `assistant` events ship cumulative text", () => {
    // Older claude CLI versions re-send the full in-progress message on
    // each assistant event instead of emitting deltas. The parser must
    // diff those so the UI doesn't render "HiHi thereHi there, friend".
    const parse = createClaudeCodeStreamParser()
    const mk = (t: string) =>
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: t }] } })
    expect(parse(mk("Hi"))).toBe("Hi")
    expect(parse(mk("Hi there"))).toBe(" there")
    expect(parse(mk("Hi there, friend"))).toBe(", friend")
  })

  it("skips `assistant` events entirely once stream_event deltas are seen", () => {
    // When both event types are present (newer CLIs with --verbose),
    // deltas are authoritative and the fat `assistant` events would
    // duplicate text if we emitted them.
    const parse = createClaudeCodeStreamParser()
    const delta = JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
    })
    const asst = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hi" }] },
    })
    expect(parse(delta)).toBe("Hi")
    expect(parse(asst)).toBeNull()
  })

  it("concatenates multiple text parts inside one `assistant` event", () => {
    const parse = createClaudeCodeStreamParser()
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Part one. " },
          { type: "tool_use", id: "x", name: "bash", input: {} },
          { type: "text", text: "Part two." },
        ],
      },
    })
    expect(parse(line)).toBe("Part one. Part two.")
  })

  it("returns null for system init, result, tool_use, and unknown types", () => {
    const parse = createClaudeCodeStreamParser()
    expect(parse(JSON.stringify({ type: "system", subtype: "init" }))).toBeNull()
    expect(parse(JSON.stringify({ type: "result", subtype: "success", result: "done" }))).toBeNull()
    expect(parse(JSON.stringify({ type: "tool_use", id: "x" }))).toBeNull()
    expect(parse(JSON.stringify({ type: "future_type_we_dont_know" }))).toBeNull()
  })

  it("returns null for malformed JSON or blank lines", () => {
    const parse = createClaudeCodeStreamParser()
    expect(parse("")).toBeNull()
    expect(parse("   ")).toBeNull()
    expect(parse("not json at all")).toBeNull()
    expect(parse("{bad json")).toBeNull()
  })

  it("returns null for stream_event shapes we don't recognize (usage/etc.)", () => {
    const parse = createClaudeCodeStreamParser()
    // e.g. message_start / message_delta / ping — Anthropic lifecycle
    // events that carry no user-visible text.
    expect(
      parse(
        JSON.stringify({
          type: "stream_event",
          event: { type: "message_start", message: { id: "m" } },
        }),
      ),
    ).toBeNull()
    expect(
      parse(
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "input_json_delta", partial_json: "{\"a\":" },
          },
        }),
      ),
    ).toBeNull()
  })
})

describe("streamClaudeCodeCli", () => {
  it("waits for the done event before resolving so connection tests see emitted content", async () => {
    let content = ""
    let done = false

    tauriMock.invokeHandler = (command, payload) => {
      if (command !== "claude_cli_spawn") return
      const streamId = payload?.streamId
      if (typeof streamId !== "string") throw new Error("missing stream id")
      setTimeout(() => {
        tauriMock.emit(
          `claude-cli:${streamId}`,
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "Connected" }] },
          }),
        )
        tauriMock.emit(`claude-cli:${streamId}:done`, { code: 0, stderr: "" })
      }, 0)
    }

    await streamClaudeCodeCli(claudeCliConfig, [{ role: "user", content: "ping" }], {
      onToken: (token) => { content += token },
      onDone: () => { done = true },
      onError: (error) => { throw error },
    })

    expect(done).toBe(true)
    expect(content).toBe("Connected")
  })
})

describe("buildExitError", () => {
  it("translates Unauthenticated stderr into an actionable login hint", () => {
    const msg = buildExitError(1, "Unauthenticated: please log in")
    expect(msg).toMatch(/not authenticated/i)
    expect(msg).toMatch(/`claude`/)
    expect(msg).toMatch(/terminal/i)
  })

  it("includes the original stderr at the bottom for context", () => {
    const stderr = "Unauthenticated: token expired"
    const msg = buildExitError(1, stderr)
    expect(msg).toContain(stderr)
  })

  it("falls through to the bare exit-code form for unrecognized stderr", () => {
    expect(buildExitError(2, "Unknown flag: --foo")).toBe(
      "claude CLI exited with code 2: Unknown flag: --foo",
    )
  })

  it("works without stderr at all (truly silent exit)", () => {
    const msg = buildExitError(127, "")
    expect(msg).toMatch(/silently/)
    expect(msg).toMatch(/127/)
    expect(msg).toMatch(/terminal/)
  })

  it("matches the case-insensitive Authentication failed variant", () => {
    const msg = buildExitError(1, "Authentication failed (401)")
    expect(msg).toMatch(/not authenticated/i)
  })

  it("falls back to unparsed stdout when stderr is empty (the real-user case)", () => {
    // Real-user scenario: claude exit 1, stderr empty, but stdout
    // had a structured error event our parser didn't recognize.
    // Without this branch the user just saw "exited with code 1"
    // and had to grep the binary to guess what went wrong.
    const stdout = '{"type":"error","subtype":"oauth_expired","message":"token revoked"}'
    const msg = buildExitError(1, "", stdout)
    expect(msg).toContain("code 1")
    expect(msg).toContain("no stderr")
    expect(msg).toContain("oauth_expired")
    expect(msg).toContain("token revoked")
  })

  it("prefers stderr over unparsed stdout when both are present", () => {
    const msg = buildExitError(1, "real stderr here", "unrelated stdout")
    expect(msg).toContain("real stderr here")
    expect(msg).not.toContain("unrelated stdout")
  })

  it("recommends terminal reproduction when both stderr and stdout are empty", () => {
    const msg = buildExitError(1, "", "")
    expect(msg).toMatch(/silently/)
    expect(msg).toMatch(/terminal/)
    expect(msg).toMatch(/Anthropic API/)
  })
})
