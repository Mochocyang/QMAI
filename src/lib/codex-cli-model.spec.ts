import { describe, expect, it } from "vitest"
import {
  CODEX_CLI_SUGGESTED_MODELS,
  DEFAULT_CODEX_CLI_MODEL,
  migrateLegacyDefaultCodexCliModel,
} from "./codex-cli-model"

describe("Codex CLI model defaults", () => {
  it("uses the current 5.6 family and maps the old mini role to Terra", () => {
    expect(DEFAULT_CODEX_CLI_MODEL).toBe("gpt-5.6-terra")
    expect(CODEX_CLI_SUGGESTED_MODELS).toEqual([
      "gpt-5.6-terra",
      "gpt-5.6-sol",
      "gpt-5.6-luna",
    ])
  })

  it("migrates only the missing or exact legacy default", () => {
    expect(migrateLegacyDefaultCodexCliModel(undefined)).toBe("gpt-5.6-terra")
    expect(migrateLegacyDefaultCodexCliModel("  ")).toBe("gpt-5.6-terra")
    expect(migrateLegacyDefaultCodexCliModel("gpt-5.4-mini")).toBe("gpt-5.6-terra")
    expect(migrateLegacyDefaultCodexCliModel("gpt-5.4")).toBe("gpt-5.4")
    expect(migrateLegacyDefaultCodexCliModel(" gpt-5.6-sol ")).toBe("gpt-5.6-sol")
  })
})
