import { describe, expect, it } from "vitest"
import {
  codexAppServerServiceTier,
  resolveCodexSpeedMode,
} from "./codex-cli-speed"

describe("Codex CLI speed mode", () => {
  it("defaults unknown and missing values to standard mode", () => {
    expect(resolveCodexSpeedMode(undefined)).toBe("standard")
    expect(resolveCodexSpeedMode("priority")).toBe("standard")
    expect(codexAppServerServiceTier(undefined)).toBeUndefined()
  })

  it("maps the user-facing fast mode to the app-server priority tier", () => {
    expect(resolveCodexSpeedMode("fast")).toBe("fast")
    expect(codexAppServerServiceTier("fast")).toBe("priority")
  })
})
