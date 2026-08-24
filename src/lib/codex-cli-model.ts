export const DEFAULT_CODEX_CLI_MODEL = "gpt-5.6-terra"
const LEGACY_DEFAULT_CODEX_CLI_MODEL = "gpt-5.4-mini"

export const CODEX_CLI_SUGGESTED_MODELS = [
  DEFAULT_CODEX_CLI_MODEL,
  "gpt-5.6-sol",
  "gpt-5.6-luna",
] as const

export function migrateLegacyDefaultCodexCliModel(model: string | undefined): string {
  const normalized = model?.trim() ?? ""
  if (!normalized || normalized === LEGACY_DEFAULT_CODEX_CLI_MODEL) {
    return DEFAULT_CODEX_CLI_MODEL
  }
  return normalized
}
