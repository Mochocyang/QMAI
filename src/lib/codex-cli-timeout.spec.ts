import { describe, expect, it } from "vitest"
import {
  DEFAULT_CODEX_CLI_TIMEOUT_MINUTES,
  migrateLegacyCodexCliTimeoutMinutes,
  resolveCodexCliTimeoutMinutes,
} from "./codex-cli-timeout"

describe("Codex CLI timeout", () => {
  it("defaults missing values to 40 minutes", () => {
    expect(DEFAULT_CODEX_CLI_TIMEOUT_MINUTES).toBe(40)
    expect(resolveCodexCliTimeoutMinutes(undefined)).toBe(40)
  })

  it("keeps explicit runtime values within the supported range", () => {
    expect(resolveCodexCliTimeoutMinutes(20)).toBe(20)
    expect(resolveCodexCliTimeoutMinutes(300)).toBe(240)
  })

  it("lifts legacy values below 40 once without lowering larger values", () => {
    expect(migrateLegacyCodexCliTimeoutMinutes(undefined)).toBe(40)
    expect(migrateLegacyCodexCliTimeoutMinutes(20)).toBe(40)
    expect(migrateLegacyCodexCliTimeoutMinutes(60)).toBe(60)
  })
})
