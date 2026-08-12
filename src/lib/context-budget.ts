/**
 * Pure budget allocator for LLM request assembly.
 *
 * `maxContextSize` is the model's context window in TOKENS — it is copied
 * straight from the provider's spec sheet (Gemini 1M, Kimi 256K, …) by the
 * settings UI. Two domains are derived from it here:
 *
 *   - Token domain (`planLlmRequestBudget` and the chapter/outline planners):
 *     works in the same unit as the window, so no conversion happens at all.
 *     This is the authoritative allocator — it guarantees input + output fit.
 *   - Character domain (`computeContextBudget`): converts the token window
 *     into how many CHARACTERS of prompt text will fit, for the callers that
 *     slice raw strings. The conversion rate is language-dependent, which is
 *     what `charsPerTokenForLanguage` supplies.
 *
 * The two must never both apply a language factor to the same value: the
 * token domain already speaks tokens, so scaling it by language would count
 * the same density twice.
 */

import i18n from "@/i18n"
import { normalizeUserLlmContextSize } from "@/lib/llm-context-size"

/** Result of `computeContextBudget`. All values are character counts. */
export interface ContextBudget {
  /** How many characters of prompt text the model's token window holds,
   *  at the active language's density. Falls back to a sensible default
   *  when the caller passes 0/undefined. */
  maxCtx: number
  /** Characters NOT to be filled with prompt content — left empty so
   *  the LLM has room to write its response. */
  responseReserve: number
}

const DEFAULT_MAX_CTX = 204_800
export const RESPONSE_RESERVE_FRAC = 0.15

/** Characters per token for English-ish text — the conventional 4:1. */
const CHARS_PER_TOKEN = 4
/** Characters per token for CJK text. Deliberately 1.0 to match
 *  `src/lib/context-hub/token-estimator.ts`, which counts one CJK character
 *  as one token. A looser value here would let the character budgets admit
 *  more text than the token estimator allows, so the surplus would be packed
 *  in and then trimmed back out in `streamChat` — wasted work and lost
 *  content. Real tokenizers land around 1–1.5 chars/token, so 1.0 is the
 *  safe end. */
const CHARS_PER_TOKEN_CJK = 1

function isCjkLanguage(lang: string | undefined): boolean {
  if (!lang) return false
  const l = lang.toLowerCase()
  return l.startsWith("zh") || l.startsWith("ja") || l.startsWith("ko")
}

/**
 * How many characters one token holds in a given UI language, used to turn
 * the model's token window into a character budget.
 *
 * `lang` defaults to the active i18n language; pass an explicit value
 * (e.g. in tests) to keep the calculation deterministic.
 */
export function charsPerTokenForLanguage(lang?: string): number {
  const resolved =
    lang ?? (typeof i18n?.language === "string" ? i18n.language : undefined)
  return isCjkLanguage(resolved) ? CHARS_PER_TOKEN_CJK : CHARS_PER_TOKEN
}

/**
 * Convert the model's token window into character budgets.
 *
 * Falsy `maxContextSize` (0 / NaN / undefined) falls back to the default
 * 200K-token window so existing configs don't break.
 */
export function computeContextBudget(
  maxContextSize: number | undefined,
  charsPerToken: number = charsPerTokenForLanguage(),
): ContextBudget {
  const windowTokens =
    typeof maxContextSize === "number" && maxContextSize > 0
      ? maxContextSize
      : DEFAULT_MAX_CTX
  const density =
    typeof charsPerToken === "number" && charsPerToken > 0 ? charsPerToken : CHARS_PER_TOKEN
  const maxCtx = Math.max(1, Math.floor(windowTokens * density))

  return {
    maxCtx,
    responseReserve: Math.floor(maxCtx * RESPONSE_RESERVE_FRAC),
  }
}

/** Share of the window the novel context pack may occupy. Chosen so the
 *  default 200K-char window preserves the legacy 32K-token deep-chapter
 *  budget while smaller windows are capped down proportionally. */
const NOVEL_CONTEXT_FRAC = 0.65
/** Absolute floor so a tiny window still injects some context. */
const NOVEL_CONTEXT_TOKEN_FLOOR = 4_000

/**
 * Token budget for the novel context pack (`contextPackToPrompt`).
 *
 * The novel context (memory, settings, search hits, character souls) is
 * the bulk of the writing prompt and must scale with — and never exceed —
 * the model's context window, leaving room for the chapter output and
 * prompt scaffolding.
 *
 * Context pack budget always scales from the model window. An optional
 * `requestedTokenBudget` remains only for internal planners that already
 * computed a tighter allocation (e.g. after reserving output tokens); the
 * user-facing novel setting has been removed and is never consulted.
 *
 * Stays entirely in the token domain: the window is already tokens and the
 * consumer wants tokens, so there is no character round-trip and no language
 * factor. Language density is the token estimator's job.
 */
export function computeNovelContextTokenBudget(
  maxContextSize: number | undefined,
  requestedTokenBudget?: number,
): number {
  const windowTokens =
    typeof maxContextSize === "number" && maxContextSize > 0
      ? maxContextSize
      : DEFAULT_MAX_CTX
  const cap = Math.max(
    NOVEL_CONTEXT_TOKEN_FLOOR,
    Math.floor(windowTokens * NOVEL_CONTEXT_FRAC),
  )
  if (requestedTokenBudget && requestedTokenBudget > 0) {
    return Math.min(requestedTokenBudget, cap)
  }
  return cap
}

export interface ResolveContextPackTokenBudgetInput {
  maxContextSize?: number
  /**
   * Optional precomputed allocation (planner / composer). Not a user setting.
   * 0 / undefined = auto from window.
   */
  contextTokenBudget?: number
}

/**
 * Canonical resolver for chat / context-hub / trim-plugin ContextPack budgets.
 * Always returns a positive finite token budget (never "unbounded").
 */
export function resolveContextPackTokenBudget(
  input: ResolveContextPackTokenBudgetInput = {},
): number {
  return computeNovelContextTokenBudget(
    input.maxContextSize,
    input.contextTokenBudget,
  )
}

export const MIN_LLM_OUTPUT_TOKENS = 512

/** Share of the window reserved for analysis / planning responses (task brief, etc.). */
export const ANALYSIS_OUTPUT_FRAC = 0.04

/**
 * Floor for chapter-generation output budgets, ≈1.5 万字 at the CJK
 * 1-char-per-token estimator. Window-fraction planning may raise this, but
 * never drops below it — unless the user's maxOutputTokens cap is lower.
 */
export const CHAPTER_GENERATION_OUTPUT_FLOOR = 15_360

export class LlmContextBudgetError extends Error {
  constructor(message = "模型上下文不足：无法同时容纳系统提示、当前用户请求和最小输出空间。") {
    super(message)
    this.name = "LlmContextBudgetError"
  }
}

/**
 * Headroom kept between our token estimates and the model's real window.
 * Estimation is approximate in both directions (tokenizer differences,
 * scaffolding we don't see), so we plan against 90% of the advertised
 * window. This replaces an earlier `/ 4`, which looked like a safety factor
 * but was actually a character-to-token conversion applied to a value that
 * was already in tokens — shrinking every window to a quarter of its size.
 */
const LLM_WINDOW_SAFETY_FRAC = 0.9

export interface LlmRequestBudgetInput {
  maxContextSize?: number
  desiredOutputTokens: number
  requestedContextTokens?: number
  scaffoldReserveTokens: number
  minimumContextTokens?: number
  minimumOutputTokens?: number
  /** The model's declared maximum output, from the user's settings. Output
   *  is never planned above this even when the window could hold more. */
  maxOutputTokensCap?: number
  /** Output the active reasoning level needs before it can produce any final
   *  content (`thinkingMinMaxTokens`). Raises the plan, but stays subject to
   *  the cap and the window — unlike a floor applied to the request body,
   *  which would silently break the conservation guaranteed here. */
  thinkingFloorTokens?: number
}

export interface LlmRequestBudgetPlan {
  windowTokens: number
  outputTokens: number
  contextTokenBudget: number
  scaffoldReserveTokens: number
  inputTokenBudget: number
}

function finiteNonNegative(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) && (value as number) > 0
    ? Math.floor(value as number)
    : fallback
}

/** Token-domain conservation kernel shared by chapter and outline workflows. */
export function planLlmRequestBudget(input: LlmRequestBudgetInput): LlmRequestBudgetPlan {
  const rawWindow = Number.isFinite(input.maxContextSize) && (input.maxContextSize as number) > 0
    ? Math.floor(input.maxContextSize as number)
    : normalizeUserLlmContextSize(undefined)
  const windowTokens = Math.max(1, Math.floor(rawWindow * LLM_WINDOW_SAFETY_FRAC))
  const scaffoldReserveTokens = finiteNonNegative(input.scaffoldReserveTokens)
  const minimumOutputTokens = Math.max(
    MIN_LLM_OUTPUT_TOKENS,
    finiteNonNegative(input.minimumOutputTokens, MIN_LLM_OUTPUT_TOKENS),
  )
  const outputCap = finiteNonNegative(input.maxOutputTokensCap, Number.MAX_SAFE_INTEGER)
  const desiredOutputTokens = Math.max(
    minimumOutputTokens,
    finiteNonNegative(input.desiredOutputTokens, minimumOutputTokens),
  )
  // The thinking floor may not push output past what the model can emit.
  const thinkingFloorTokens = Math.min(finiteNonNegative(input.thinkingFloorTokens), outputCap)
  const targetOutputTokens = Math.max(desiredOutputTokens, thinkingFloorTokens)
  const minimumContextTokens = finiteNonNegative(input.minimumContextTokens)
  const available = windowTokens - scaffoldReserveTokens
  if (available < minimumOutputTokens) throw new LlmContextBudgetError()

  // Keep the requested minimum context where possible, then allocate output.
  // If both cannot fit, context is the degradable side; output never drops below 512.
  const outputCeiling = Math.max(
    minimumOutputTokens,
    Math.min(outputCap, available - minimumContextTokens),
  )
  const outputTokens = Math.min(targetOutputTokens, outputCeiling)
  const remainingForContext = Math.max(0, available - outputTokens)
  const requestedContextTokens = finiteNonNegative(input.requestedContextTokens)
  const contextTokenBudget = requestedContextTokens > 0
    ? Math.min(requestedContextTokens, remainingForContext)
    : remainingForContext
  const inputTokenBudget = windowTokens - outputTokens

  return {
    windowTokens,
    outputTokens,
    contextTokenBudget,
    scaffoldReserveTokens,
    inputTokenBudget,
  }
}

export type ChapterBudgetStage = "analysis" | "generation"

export interface PlanChapterRequestBudgetInput {
  maxContextSize?: number
  contextTokenBudget?: number
  chapterTargetChars?: number
  stage: ChapterBudgetStage
  maxOutputTokens?: number
  thinkingFloorTokens?: number
}

export function planChapterRequestBudget(
  input: PlanChapterRequestBudgetInput,
): LlmRequestBudgetPlan {
  const normalizedWindow = normalizeUserLlmContextSize(input.maxContextSize)
  const genericContextCap = computeNovelContextTokenBudget(
    normalizedWindow,
    input.contextTokenBudget,
  )
  // Analysis and generation both scale with the window. Generation also keeps
  // a 15_360-token floor so a short target-char setting cannot starve the
  // draft; the user's maxOutputTokens cap still wins when it is lower.
  const desiredOutputTokens = input.stage === "analysis"
    ? Math.floor(normalizedWindow * ANALYSIS_OUTPUT_FRAC)
    : Math.max(
      CHAPTER_GENERATION_OUTPUT_FLOOR,
      Math.floor(normalizedWindow * RESPONSE_RESERVE_FRAC),
    )
  return planLlmRequestBudget({
    maxContextSize: normalizedWindow,
    desiredOutputTokens,
    requestedContextTokens: genericContextCap,
    scaffoldReserveTokens: 8_000,
    minimumContextTokens: 2_000,
    maxOutputTokensCap: input.maxOutputTokens,
    thinkingFloorTokens: input.thinkingFloorTokens,
  })
}

export type OutlineBudgetStage = "analysis" | "generation"

export interface PlanOutlineRequestBudgetInput {
  maxContextSize?: number
  contextTokenBudget?: number
  stage: OutlineBudgetStage
  maxOutputTokens?: number
  thinkingFloorTokens?: number
}

export function planOutlineRequestBudget(
  input: PlanOutlineRequestBudgetInput,
): LlmRequestBudgetPlan {
  const normalizedWindow = normalizeUserLlmContextSize(input.maxContextSize)
  // Scales with the window instead of stepping through fixed tiers, and is
  // then bounded by the user's declared output cap inside the kernel.
  const desiredOutputTokens = Math.floor(normalizedWindow * (input.stage === "analysis"
    ? ANALYSIS_OUTPUT_FRAC
    : RESPONSE_RESERVE_FRAC))
  const genericContextCap = computeNovelContextTokenBudget(
    normalizedWindow,
    input.contextTokenBudget,
  )
  return planLlmRequestBudget({
    maxContextSize: normalizedWindow,
    desiredOutputTokens,
    requestedContextTokens: genericContextCap,
    scaffoldReserveTokens: 8_192,
    minimumContextTokens: 4_000,
    maxOutputTokensCap: input.maxOutputTokens,
    thinkingFloorTokens: input.thinkingFloorTokens,
  })
}

export interface ComputeWritingContextPackTokenBudgetInput {
  maxContextSize?: number
  contextTokenBudget?: number
  chapterTargetChars?: number
  maxOutputTokens?: number
}

/**
 * Compatibility wrapper over the shared chapter-generation budget strategy.
 */
export function computeWritingContextPackTokenBudget(
  input: ComputeWritingContextPackTokenBudgetInput,
): number {
  return planChapterRequestBudget({
    maxContextSize: input.maxContextSize,
    contextTokenBudget: input.contextTokenBudget,
    chapterTargetChars: input.chapterTargetChars,
    stage: "generation",
    maxOutputTokens: input.maxOutputTokens,
  }).contextTokenBudget
}

/** Legacy single-pass outline ingest floor; kept so small windows still behave predictably. */
export const OUTLINE_INGEST_MIN_BODY_BUDGET = 8_000
/** Upper cap aligned with wiki long-source ingest. */
export const OUTLINE_INGEST_MAX_BODY_BUDGET = 300_000

function clampBudget(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Character budget for the outline body in `ingestOutline`.
 *
 * Reserves space for fixed prompts and JSON output, then allocates the
 * remainder to the outline markdown. Scales with `maxContextSize` and the
 * active language's character density like other character-domain helpers.
 */
export function computeOutlineIngestBodyBudget(
  maxContextSize: number | undefined,
  promptOverheadChars: number,
  charsPerToken?: number,
): number {
  const { maxCtx, responseReserve } = computeContextBudget(maxContextSize, charsPerToken)
  const outputReserve = Math.max(responseReserve, Math.floor(maxCtx * 0.15))
  const instructionReserve = Math.max(promptOverheadChars, Math.floor(maxCtx * 0.08))
  const available = maxCtx - outputReserve - instructionReserve
  const upper = Math.min(
    OUTLINE_INGEST_MAX_BODY_BUDGET,
    Math.max(OUTLINE_INGEST_MIN_BODY_BUDGET, Math.floor(maxCtx * 0.6)),
  )
  const min = Math.min(
    OUTLINE_INGEST_MIN_BODY_BUDGET,
    Math.max(1_000, Math.floor(available)),
  )
  return clampBudget(Math.floor(available), min, upper)
}
