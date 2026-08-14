export const DEFAULT_CODEX_CLI_TIMEOUT_MINUTES = 40
export const MAX_CODEX_CLI_TIMEOUT_MINUTES = 240

export function resolveCodexCliTimeoutMinutes(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_CODEX_CLI_TIMEOUT_MINUTES
  return Math.max(1, Math.min(MAX_CODEX_CLI_TIMEOUT_MINUTES, Math.floor(value as number)))
}

/**
 * One-time persisted-config migration. Old releases defaulted to 10 minutes,
 * and some existing users saved 20 minutes explicitly. Lift every legacy
 * value below the new default once; after the migration marker is written,
 * later deliberate user reductions remain untouched.
 */
export function migrateLegacyCodexCliTimeoutMinutes(value: number | undefined): number {
  const resolved = resolveCodexCliTimeoutMinutes(value)
  return Math.max(DEFAULT_CODEX_CLI_TIMEOUT_MINUTES, resolved)
}
