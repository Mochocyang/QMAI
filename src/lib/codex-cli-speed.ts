export type CodexSpeedMode = "standard" | "fast"

export const DEFAULT_CODEX_SPEED_MODE: CodexSpeedMode = "standard"

export function resolveCodexSpeedMode(value: unknown): CodexSpeedMode {
  return value === "fast" ? "fast" : DEFAULT_CODEX_SPEED_MODE
}

/**
 * Codex app-server exposes the Fast catalog tier as `priority`. Standard mode
 * deliberately omits the field so QMAI remains compatible with older CLIs.
 */
export function codexAppServerServiceTier(value: unknown): "priority" | undefined {
  return resolveCodexSpeedMode(value) === "fast" ? "priority" : undefined
}
