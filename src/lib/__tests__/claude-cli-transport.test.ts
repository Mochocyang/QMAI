/**
 * Claude Code CLI transport tests.
 *
 * ── How this file reaches the units under test ────────────────────────────
 * `createClaudeCodeStreamParser` and `buildExitError` are still defined in
 * `src/lib/claude-cli-transport.ts`, and their bodies are byte-identical to
 * the versions this suite was written against. But commit 01aab5f
 * ("refactor(cleanup): 收口测试专用旧模块和未使用导出") dropped their `export`
 * keyword, because no production module referenced them across a module
 * boundary.
 *
 * So they were **de-exported, not deleted and not moved**: the logic is fully
 * intact, and `streamClaudeCodeCli` (still exported) is their only caller.
 *
 * Re-adding the two `export`s would be a one-line production fix, but this
 * task may only touch test files. Re-implementing the functions inside this
 * file was rejected: it would test a copy rather than production code, and it
 * would keep passing even if the real parser/error-builder regressed.
 *
 * Instead, every case below drives the real implementations through their
 * public entry point `streamClaudeCodeCli` — feeding CLI stdout lines into
 * the parser via the `claude-cli:{streamId}` event and the exit status via
 * `claude-cli:{streamId}:done` — then asserts the tokens it emits and the
 * error message it surfaces. Every original assertion is preserved with the
 * same strength; none was relaxed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import { streamClaudeCodeCli } from "../claude-cli-transport"

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

type CliRun = {
  /** Assistant text the parser emitted, in emission order. */
  tokens: string[]
  /** Error surfaced through onError (non-zero exit / no content), if any. */
  error: Error | null
  /** Whether onDone fired. */
  done: boolean
}

/**
 * Runs one full CLI turn: replays `stdoutLines` over the data channel, then
 * the supplied exit status over the done channel, and collects everything the
 * transport reported back. This exercises the real parser and the real
 * exit-error builder, since `streamClaudeCodeCli` is their only caller.
 */
async function runCli(
  stdoutLines: string[],
  exit: { code: number | null; stderr: string } = { code: 0, stderr: "" },
): Promise<CliRun> {
  const tokens: string[] = []
  let error: Error | null = null
  let done = false

  tauriMock.invokeHandler = (command, payload) => {
    if (command !== "claude_cli_spawn") return
    const streamId = payload?.streamId
    if (typeof streamId !== "string") throw new Error("missing stream id")
    setTimeout(() => {
      for (const line of stdoutLines) tauriMock.emit(`claude-cli:${streamId}`, line)
      tauriMock.emit(`claude-cli:${streamId}:done`, exit)
    }, 0)
  }

  await streamClaudeCodeCli(claudeCliConfig, [{ role: "user", content: "ping" }], {
    onToken: (token) => { tokens.push(token) },
    onDone: () => { done = true },
    onError: (err) => { error = err },
  })

  return { tokens, error, done }
}

/**
 * Feeds `lines` through `createClaudeCodeStreamParser` (one parser instance,
 * exactly like calling the parser repeatedly by hand) and returns the text it
 * chose to emit. A line the parser rejects as carrying no user-visible text
 * emits nothing, so "parse(line) === null" is asserted as an absent token.
 */
async function emittedTokens(lines: string[]): Promise<string[]> {
  const { tokens } = await runCli(lines)
  return tokens
}

/**
 * Returns the diagnostic `buildExitError` produced for a CLI exit. The
 * transport passes its captured-but-unparsed stdout lines as the third
 * argument, so `unparsedStdoutLines` reproduces that input faithfully.
 */
async function cliExitError(
  code: number,
  stderr: string,
  unparsedStdoutLines: string[] = [],
): Promise<string> {
  const { error } = await runCli(unparsedStdoutLines, { code, stderr })
  if (!error) {
    throw new Error(
      `expected exit code ${code} to surface an onError diagnostic, but the run reported success`,
    )
  }
  return error.message
}

describe("createClaudeCodeStreamParser", () => {
  it("emits text from a single stream_event text_delta", async () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
      },
    })
    expect(await emittedTokens([line])).toEqual(["Hello"])
  })

  it("accumulates multiple stream_event deltas in order", async () => {
    const mk = (t: string) =>
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: t } },
      })
    // One parser instance, three successive lines — faithful to the original
    // three sequential parse() calls, asserted value-for-value.
    const tokens = await emittedTokens([mk("Hello "), mk("world"), mk("!")])
    expect(tokens[0]).toBe("Hello ")
    expect(tokens[1]).toBe("world")
    expect(tokens[2]).toBe("!")
    expect(tokens).toHaveLength(3)
  })

  it("falls back to `assistant` message text when no deltas arrived", async () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hi there" }] },
    })
    expect(await emittedTokens([line])).toEqual(["Hi there"])
  })

  it("emits only the novel tail when `assistant` events ship cumulative text", async () => {
    // Older claude CLI versions re-send the full in-progress message on
    // each assistant event instead of emitting deltas. The parser must
    // diff those so the UI doesn't render "HiHi thereHi there, friend".
    const mk = (t: string) =>
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: t }] } })
    const tokens = await emittedTokens([mk("Hi"), mk("Hi there"), mk("Hi there, friend")])
    expect(tokens[0]).toBe("Hi")
    expect(tokens[1]).toBe(" there")
    expect(tokens[2]).toBe(", friend")
    expect(tokens).toHaveLength(3)
  })

  it("skips `assistant` events entirely once stream_event deltas are seen", async () => {
    // When both event types are present (newer CLIs with --verbose),
    // deltas are authoritative and the fat `assistant` events would
    // duplicate text if we emitted them.
    const delta = JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
    })
    const asst = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hi" }] },
    })
    // The delta is emitted; the duplicate `assistant` event must emit nothing
    // (the original asserted parse(asst) === null).
    const tokens = await emittedTokens([delta, asst])
    expect(tokens[0]).toBe("Hi")
    expect(tokens).toHaveLength(1)
  })

  it("concatenates multiple text parts inside one `assistant` event", async () => {
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
    expect(await emittedTokens([line])).toEqual(["Part one. Part two."])
  })

  it("returns null for system init, result, tool_use, and unknown types", async () => {
    // Asserted one line at a time, matching the original four successive
    // parse() calls. None of these event shapes touches the parser's
    // delta / cumulative-text state, so each call sees a pristine parser
    // exactly as the original sequence did.
    expect(await emittedTokens([JSON.stringify({ type: "system", subtype: "init" })])).toEqual([])
    expect(
      await emittedTokens([JSON.stringify({ type: "result", subtype: "success", result: "done" })]),
    ).toEqual([])
    expect(await emittedTokens([JSON.stringify({ type: "tool_use", id: "x" })])).toEqual([])
    expect(await emittedTokens([JSON.stringify({ type: "future_type_we_dont_know" })])).toEqual([])
  })

  it("returns null for malformed JSON or blank lines", async () => {
    expect(await emittedTokens([""])).toEqual([])
    expect(await emittedTokens(["   "])).toEqual([])
    expect(await emittedTokens(["not json at all"])).toEqual([])
    expect(await emittedTokens(["{bad json"])).toEqual([])
  })

  it("returns null for stream_event shapes we don't recognize (usage/etc.)", async () => {
    // e.g. message_start / message_delta / ping — Anthropic lifecycle
    // events that carry no user-visible text.
    expect(
      await emittedTokens([
        JSON.stringify({
          type: "stream_event",
          event: { type: "message_start", message: { id: "m" } },
        }),
      ]),
    ).toEqual([])
    expect(
      await emittedTokens([
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "input_json_delta", partial_json: "{\"a\":" },
          },
        }),
      ]),
    ).toEqual([])
  })
})

describe("streamClaudeCodeCli", () => {
  it("waits for the done event before resolving so connection tests see emitted content", async () => {
    const { tokens, error, done } = await runCli([
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Connected" }] },
      }),
    ])

    // Anything other than a clean finish must fail loudly here rather than
    // being silently swallowed by the harness.
    expect(error).toBeNull()
    expect(done).toBe(true)
    expect(tokens.join("")).toBe("Connected")
  })
})

describe("buildExitError", () => {
  it("translates Unauthenticated stderr into an actionable login hint", async () => {
    const msg = await cliExitError(1, "Unauthenticated: please log in")
    expect(msg).toMatch(/not authenticated/i)
    expect(msg).toMatch(/`claude`/)
    expect(msg).toMatch(/terminal/i)
  })

  it("includes the original stderr at the bottom for context", async () => {
    const stderr = "Unauthenticated: token expired"
    const msg = await cliExitError(1, stderr)
    expect(msg).toContain(stderr)
  })

  it("falls through to the bare exit-code form for unrecognized stderr", async () => {
    expect(await cliExitError(2, "Unknown flag: --foo")).toBe(
      "claude CLI exited with code 2: Unknown flag: --foo",
    )
  })

  it("works without stderr at all (truly silent exit)", async () => {
    const msg = await cliExitError(127, "")
    expect(msg).toMatch(/silently/)
    expect(msg).toMatch(/127/)
    expect(msg).toMatch(/terminal/)
  })

  it("matches the case-insensitive Authentication failed variant", async () => {
    const msg = await cliExitError(1, "Authentication failed (401)")
    expect(msg).toMatch(/not authenticated/i)
  })

  it("falls back to unparsed stdout when stderr is empty (the real-user case)", async () => {
    // Real-user scenario: claude exit 1, stderr empty, but stdout
    // had a structured error event our parser didn't recognize.
    // Without this branch the user just saw "exited with code 1"
    // and had to grep the binary to guess what went wrong.
    const stdout = '{"type":"error","subtype":"oauth_expired","message":"token revoked"}'
    const msg = await cliExitError(1, "", [stdout])
    expect(msg).toContain("code 1")
    expect(msg).toContain("no stderr")
    expect(msg).toContain("oauth_expired")
    expect(msg).toContain("token revoked")
  })

  it("prefers stderr over unparsed stdout when both are present", async () => {
    const msg = await cliExitError(1, "real stderr here", ["unrelated stdout"])
    expect(msg).toContain("real stderr here")
    expect(msg).not.toContain("unrelated stdout")
  })

  it("recommends terminal reproduction when both stderr and stdout are empty", async () => {
    const msg = await cliExitError(1, "")
    expect(msg).toMatch(/silently/)
    expect(msg).toMatch(/terminal/)
    expect(msg).toMatch(/Anthropic API/)
  })
})
