import type { CodexSpeedMode } from "@/lib/codex-cli-speed"
import type { ReasoningConfig } from "@/stores/wiki-store"

const ACP_MODEL_ALIASES: Record<string, string> = {
  auto: "default",
  "composer-2": "composer-2.5",
}

const EFFORT_SUFFIX = /[-_](extra-high|xhigh|minimal|medium|high|none|low|max)$/i
const FAST_SUFFIX = /[-_]fast$/i
const THINKING_SUFFIX = /[-_]thinking$/i
const ACP_FAST_PARAM = /(?:^|[\[,])\s*fast\s*=\s*(true|false)(?:[,\]]|$)/i

export type CursorSpeedMode = CodexSpeedMode
export const DEFAULT_CURSOR_SPEED_MODE: CursorSpeedMode = "fast"

export function inferCursorSpeedModeFromModel(model: string): CursorSpeedMode {
  const trimmed = model.trim()
  if (!trimmed) return DEFAULT_CURSOR_SPEED_MODE
  const parameterized = ACP_FAST_PARAM.exec(trimmed)
  if (parameterized) {
    return parameterized[1].toLowerCase() === "true" ? "fast" : "standard"
  }
  const id = trimmed.replace(/\[.*$/, "")
  if (FAST_SUFFIX.test(id)) return "fast"
  if (id.toLowerCase().startsWith("cursor-")) return "standard"
  return DEFAULT_CURSOR_SPEED_MODE
}

export function resolveCursorSpeedMode(
  value: unknown,
  model?: string,
): CursorSpeedMode {
  if (value === "fast" || value === "standard") return value
  return inferCursorSpeedModeFromModel(model ?? "")
}

export function toCursorAcpEffort(reasoning?: Pick<ReasoningConfig, "mode">): string | undefined {
  switch (reasoning?.mode) {
    case "low":
    case "medium":
    case "high":
      return reasoning.mode
    case "max":
      return "xhigh"
    default:
      return undefined
  }
}

/** CLI `--list-models` id → ACP `availableModels[].name`. */
export function toCursorAcpModelId(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ""
  if (trimmed === "default") return "default"

  const parameterized = trimmed.includes("[") ? trimmed.replace(/\[.*$/, "").trim() : trimmed
  let id = parameterized
  if (id.toLowerCase().startsWith("cursor-")) {
    id = id.slice("cursor-".length)
  }
  id = id.replace(FAST_SUFFIX, "")
  id = id.replace(EFFORT_SUFFIX, "")
  id = id.replace(THINKING_SUFFIX, "")

  const alias = ACP_MODEL_ALIASES[id.toLowerCase()] ?? ACP_MODEL_ALIASES[trimmed.toLowerCase()]
  return alias ?? id
}

export function toCursorAcpModelIds(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const mapped: string[] = []
  for (const id of ids) {
    const acpId = toCursorAcpModelId(id)
    if (!acpId || seen.has(acpId)) continue
    seen.add(acpId)
    mapped.push(acpId)
  }
  return mapped
}

const ACP_REVERSE_ALIASES: Record<string, string[]> = {
  "composer-2.5": ["composer-2"],
}

let cachedCursorCliCatalog: string[] = []

export function rememberCursorCliCatalog(ids: readonly string[]): void {
  cachedCursorCliCatalog = ids.map((id) => id.trim()).filter(Boolean)
}

export function getCursorCliCatalog(): readonly string[] {
  return cachedCursorCliCatalog
}

function normalizeEffortToken(raw: string): string {
  const value = raw.trim().toLowerCase()
  if (value === "extra-high" || value === "max") return "xhigh"
  return value
}

export function inferCursorEffortFromModel(model: string): string | undefined {
  const trimmed = model.trim()
  if (!trimmed) return undefined
  const parameterized = /(?:^|[\[,])\s*effort\s*=\s*([^,\]]+)/i.exec(trimmed)
  if (parameterized?.[1]) return normalizeEffortToken(parameterized[1])
  const id = trimmed.replace(/\[.*$/, "").replace(FAST_SUFFIX, "")
  const match = id.match(/[-_](extra-high|xhigh|minimal|medium|high|none|low|max)$/i)
  return match?.[1] ? normalizeEffortToken(match[1]) : undefined
}

export function toCursorAcpModelValue(
  model: string,
  fast?: boolean,
  effort?: string,
): string {
  const acp = toCursorAcpModelId(model)
  if (!acp) return ""
  const params: string[] = []
  const effortValue = effort?.trim()
  if (effortValue) params.push(`effort=${effortValue}`)
  if (fast === true) params.push("fast=true")
  else if (fast === false) params.push("fast=false")
  return params.length === 0 ? acp : `${acp}[${params.join(",")}]`
}

export function cliModelToAcpValue(model: string): string {
  const trimmed = model.trim()
  if (!trimmed || trimmed === "default" || trimmed === "auto") return ""
  const acp = toCursorAcpModelId(trimmed)
  if (!acp || acp === "default") return ""
  const baseId = trimmed.replace(/\[.*$/, "")
  const hasFastSuffix = FAST_SUFFIX.test(baseId)
  const hasCursorPrefix = baseId.toLowerCase().startsWith("cursor-")
  const effort = inferCursorEffortFromModel(trimmed)
  if (trimmed.includes("[")) {
    return toCursorAcpModelValue(acp, inferCursorSpeedModeFromModel(trimmed) === "fast", effort)
  }
  if (!hasFastSuffix && !hasCursorPrefix && !effort) return acp
  return toCursorAcpModelValue(acp, hasFastSuffix ? true : hasCursorPrefix ? false : undefined, effort)
}

function scoreCursorCliId(id: string, fast: boolean, effort?: string): number {
  const idFast = inferCursorSpeedModeFromModel(id) === "fast"
  const idEffort = inferCursorEffortFromModel(id)
  let score = 0
  if (idFast === fast) score += 4
  else score -= 3
  if (effort) {
    if (idEffort === effort) score += 4
    else if (idEffort) score -= 2
  } else if (!idEffort) {
    score += 2
  }
  return score
}

function heuristicCursorCliIds(acpId: string, fast: boolean, effort?: string): string[] {
  const aliases = ACP_REVERSE_ALIASES[acpId] ?? []
  const out: string[] = []
  const push = (value: string) => {
    if (value && !out.includes(value)) out.push(value)
  }
  const decorate = (stem: string) => {
    if (effort && fast) push(`${stem}-${effort}-fast`)
    if (effort) push(`${stem}-${effort}`)
    if (fast) push(`${stem}-fast`)
    push(stem)
  }
  for (const alias of aliases) {
    decorate(alias)
    decorate(`cursor-${alias}`)
  }
  decorate(acpId.toLowerCase().startsWith("cursor-") ? acpId : `cursor-${acpId}`)
  decorate(acpId)
  return out
}

export function pickCursorCliCatalogId(
  acpId: string,
  fast: boolean,
  effort?: string,
  catalog: readonly string[] = getCursorCliCatalog(),
): string {
  const target = toCursorAcpModelId(acpId)
  if (!target || target === "default") return "default"

  const matches = catalog.filter((id) => toCursorAcpModelId(id) === target)
  if (matches.length > 0) {
    return matches.slice().sort((left, right) => {
      const delta = scoreCursorCliId(right, fast, effort) - scoreCursorCliId(left, fast, effort)
      return delta !== 0 ? delta : left.localeCompare(right)
    })[0]!
  }

  const heuristics = heuristicCursorCliIds(target, fast, effort)
  if (catalog.length > 0) {
    const byLower = new Map(catalog.map((id) => [id.toLowerCase(), id]))
    for (const candidate of heuristics) {
      const hit = byLower.get(candidate.toLowerCase())
      if (hit) return hit
    }
  }
  return heuristics[0] ?? target
}

export function toCursorHttpModel(model: string): string {
  const trimmed = model.trim()
  if (!trimmed || trimmed === "auto" || trimmed === "default") return "default"
  return trimmed
}

export interface CursorAcpCatalogModel {
  name?: string
  modelId: string
}

export interface ParsedCursorAcpModel {
  name: string
  effort?: string
  reasoning?: string
  fast?: boolean
  thinking?: boolean
}

function parseAcpBool(raw: string): boolean | undefined {
  const value = raw.trim().toLowerCase()
  if (value === "true") return true
  if (value === "false") return false
  return undefined
}

function cliDeclaresFast(model: string): boolean {
  return FAST_SUFFIX.test(model.replace(/\[.*$/, ""))
}

/** Parse ACP `availableModels[].modelId` such as `grok-4.6[effort=high,fast=true]`. */
export function parseCursorAcpModelId(modelId: string): ParsedCursorAcpModel {
  const trimmed = modelId.trim()
  const bracket = trimmed.indexOf("[")
  const rawName = (bracket >= 0 ? trimmed.slice(0, bracket) : trimmed).trim()
  const name = toCursorAcpModelId(rawName) || rawName
  if (bracket < 0) return { name }

  const parsed: ParsedCursorAcpModel = { name }
  const params = trimmed.slice(bracket + 1).replace(/\]\s*$/, "")
  for (const part of params.split(",")) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    const key = part.slice(0, eq).trim().toLowerCase()
    const value = part.slice(eq + 1).trim()
    if (key === "effort") parsed.effort = normalizeEffortToken(value)
    else if (key === "reasoning") parsed.reasoning = normalizeEffortToken(value)
    else if (key === "fast") parsed.fast = parseAcpBool(value)
    else if (key === "thinking") parsed.thinking = parseAcpBool(value)
  }
  return parsed
}

function requiredAcpEffort(acp: ParsedCursorAcpModel): string | undefined {
  return acp.effort ?? acp.reasoning
}

export function cliIdMatchesAcp(cliId: string, acp: ParsedCursorAcpModel): boolean {
  const family = toCursorAcpModelId(cliId)
  if (!family || family !== acp.name) return false

  const requiredEffort = requiredAcpEffort(acp)
  const cliEffort = inferCursorEffortFromModel(cliId)
  if (requiredEffort) {
    if (cliEffort !== requiredEffort) return false
  } else if (cliEffort) {
    return false
  }

  return cliDeclaresFast(cliId) === (acp.fast === true)
}

function scoreCliAgainstAcp(cliId: string, acp: ParsedCursorAcpModel): number {
  let score = 0
  const base = cliId.replace(/\[.*$/, "").toLowerCase()
  if (acp.name && base.includes(acp.name.toLowerCase())) score += 2
  const thinkingStem = base.replace(FAST_SUFFIX, "").replace(EFFORT_SUFFIX, "")
  if (acp.thinking === true && THINKING_SUFFIX.test(thinkingStem)) score += 1
  else if (acp.thinking !== true && !THINKING_SUFFIX.test(thinkingStem)) score += 1
  return score
}

/**
 * Keep at most one CLI catalog id per ACP `modelId`.
 * Drops CLI variants that cannot realize the ACP params (e.g. gemini medium).
 */
export function filterCursorCliByAcp(
  cliIds: readonly string[],
  acpModels: readonly CursorAcpCatalogModel[],
): string[] {
  if (acpModels.length === 0) {
    throw new Error("ACP catalog 为空，无法过滤 Cursor CLI 模型。")
  }

  const catalog = cliIds.map((id) => id.trim()).filter(Boolean)
  const picked: string[] = []
  const seen = new Set<string>()

  for (const model of acpModels) {
    const modelId = model.modelId?.trim()
    if (!modelId) continue
    const parsed = parseCursorAcpModelId(modelId)
    if (!parsed.name) continue
    const matches = catalog.filter((id) => cliIdMatchesAcp(id, parsed))
    if (matches.length === 0) continue
    const best = matches.slice().sort((left, right) => {
      const delta = scoreCliAgainstAcp(right, parsed) - scoreCliAgainstAcp(left, parsed)
      return delta !== 0 ? delta : left.localeCompare(right)
    })[0]!
    if (seen.has(best)) continue
    seen.add(best)
    picked.push(best)
  }

  return picked
}
