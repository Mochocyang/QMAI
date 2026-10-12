/**
 * 文风自进化的**编排**：一轮完整的「取样 → 分析 → 校验 → 试写 → 判定 → 落候选/作废」。
 *
 * 达尔文式棘轮：让模型读用户最近的章节提一份新画像，再**让新画像和当前启用的画像
 * 按同一份情节要点各写一段**，谁写出来的文字统计上更接近用户原文，就留下谁。
 * 判据是确定性指标距离（见 `style-evolution-metrics.ts`），不是模型自评分 ——
 * 自评分不可复现，会让「要不要换掉用户的文风」这个决定变成掷骰子。
 *
 * ── 四条来自用户原话 / 规格硬约束、缺一条就出事的规则 ────────────────────
 *   ① **同一打开日最多尝试一次，且 `lastAttemptedOn` 必须在跑模型之前落盘。**
 *      `hydrateDeferredProjectState` 是 `void`、没有 in-flight 锁，用户切书
 *      A→B→A 就会再进一次；若等跑完（可能 40 秒以上）才落盘，同一天会被算两次
 *      并起两个并发轮次。
 *   ② **失败绝不推进计数。** 任何 `incomplete`（样本不足、调用报错、垃圾画像、
 *      探针没产出正文）都不调用 `completeRound`，计数停在阈值之上 ⇒
 *      下一个打开日自动重试。否则一次失败就白等 3~5 天。
 *   ③ **候选的 `sourceBook` 每轮唯一。** `upsertWritingStylePreset` 按
 *      `sourceBook` 去重，命中时**原地覆盖 profile 并保留 id**；而
 *      `setEnabledWritingStyle` 不因 profile 变化而失效。若沿用固定来源，
 *      用户启用候选之后，下一轮会**静默改掉他正在用的画像**。
 *   ④ **清理上一轮候选前必须确认它没被启用。** `removeWritingStylePresets`
 *      删掉当前启用项时会把 `enabledStyleId` 置 null ⇒ 一次「清理」把用户的
 *      文风整个关掉。
 *
 * ── 让「谁更好」的结论可信的四条 ────────────────────────────────────
 *   · **取样看最近的章节**：只取最近 {@link RECENT_CHAPTERS} 章。以前分析素材截的是
 *     全书开头，书越写越长，新章节永远进不了分析。
 *   · **没写新东西就不分析**：距上一轮完整分析新增不足 {@link MIN_NEW_CHAPTERS} 章时
 *     跳过，计数保留，同一批文本不反复烧模型。
 *   · **试写内容受控**：先把检验片段提炼成不含原文措辞的情节要点，基线与候选按同一份
 *     要点写，再与对应原文片段比。两边写的是同一件事，差异只来自文风。
 *   · **配对判定**：两组都要更近、平均改善超过 ε 才保留（见 `resolvePairedVerdict`）。
 *     单段试写的波动远大于 ε，只比一组时结论接近随机。
 *
 * ── 关于 `workbenchStyle`：本功能明确**不产出**它 ──────────────────────
 * `writing-style-store.ts:356-373` 的结构化分支与旧分支是 if/else：一旦
 * `profile.workbenchStyle` 存在，`constitution` 与 `integratedDna` **都不再注入**。
 * 而 `compileStyleFingerprint` 是**消费者**（入参是 `WorkbenchItem`），要让它拼出
 * 有用文本得额外交付整套拆书工作台结构化产物。硬塞一个空 `rules` 的
 * `workbenchStyle` 会让注入内容缩成几行标题 —— 界面正常、内容悄悄变空。
 * 所以这里走旧画像路径，代价（无前缀、可能被预算整段裁掉）已在规格里认下。
 */
import type { BookStyleProfile } from "./book-analysis/types"
import { formatStyleMetricsForPrompt, computeStyleMetrics } from "./book-analysis/style-metrics"
import {
  distance,
  EPSILON,
  flattenMetrics,
  resolvePairedVerdict,
  type StyleMetricVector,
  type StyleProbePair,
} from "./style-evolution-metrics"
import {
  advanceOpenDay,
  completeRound,
  remainingOpenDays,
} from "./style-evolution-schedule"
import {
  loadStyleEvolutionState,
  saveStyleEvolutionState,
  type StyleEvolutionRound,
  type StyleEvolutionState,
} from "./style-evolution-store"
import { normalizePath } from "@/lib/path-utils"
import {
  loadWritingStyleStore,
  removeWritingStylePresetBySourceBook,
  upsertWritingStylePreset,
} from "./writing-style-store"

/** 至少要有这么多章才值得分析（2 章进 fit、1 章当 holdout）。 */
export const MIN_CHAPTERS = 3

/** 全部取样章节的总字数下限。几行字算不出文风，硬算只会给出噪声。 */
export const MIN_TOTAL_CHARS = 1200

/** 探针正文的字数下限。低于它说明模型没真写（或只吐了个句号）。 */
export const MIN_PROBE_CHARS = 40

/** 取样窗口：只看最近这么多章。 */
export const RECENT_CHAPTERS = 8

/** 距上一轮完整分析，至少要有这么多章是新写或改过的。 */
export const MIN_NEW_CHAPTERS = 2

/** 送进分析提示词的 fit 正文上限，防止超长项目把 prompt 顶爆。 */
const MAX_FIT_CHARS = 12000
/** 单章进分析提示词的上限：保证几章都能进来，而不是被第一章吃光预算。 */
const MAX_FIT_CHARS_PER_CHAPTER = 3000

/** 检验片段：组数与每段目标字数。 */
export const PROBE_PAIRS = 2
const PROBE_PASSAGE_CHARS = 600

/** 候选预设的来源前缀。**每轮都要带轮次号** —— 见文件头③。 */
const SYNTHETIC_SOURCE_BOOK_PREFIX = "我的文风 · 自动进化"

/** 探针与分析的提示词里都刻意出现的标记，便于测试区分几类调用。 */
const PROBE_MARKER = "只输出正文"
export const OUTLINE_MARKER = "情节要点提炼"

/** 一章取样素材。`key` 用于新素材闸门（文件名 + 字数：新写或改过的章节都会换 key）。 */
export interface StyleEvolutionChapter {
  key: string
  body: string
  /**
   * 这一章里 AI 原样写下、用户没改过的字占比（0~1）。
   * `null`/缺省 = 无从得知（老章节、带外修改），按作者文本对待。
   */
  aiRatio?: number | null
}

/**
 * AI 字占比超过这个值的章节不进取样：用户改动不足 15%，量出来的是模型的文风，
 * 拿它去「进化」只会让画像越来越像模型自己（自我强化）。
 */
export const AI_DOMINANT_RATIO = 0.85

export const AI_SAMPLE_FALLBACK_NOTE = "可用的作者章节不足，样本可能主要是 AI 文本"

export interface StyleEvolutionDeps {
  /** 调模型拿**原始文本**。关思考重试等策略由调用方在适配器里负责。 */
  callModel: (prompt: string) => Promise<string>
  /**
   * 用户自己章节的正文（已剥 frontmatter），按章节顺序。
   * 只给字符串时按「序号 + 字数」生成 key。
   */
  collectChapterBodies: () => Promise<Array<string | StyleEvolutionChapter>>
  /** 打开日（本地 `YYYY-MM-DD`）。默认取当前本地日期。 */
  now?: string
  rng?: () => number
}

export type StyleEvolutionRoundStatus =
  /** 开关没开 —— 一次模型调用都没有。 */
  | "skipped-disabled"
  /** 今天不该分析（没到阈值，或今天已经尝试过）。 */
  | "skipped-not-due"
  /** 到了该分析的日子，但自上一轮以来没有足够的新章节。计数保留。 */
  | "skipped-no-new-material"
  /** 一轮完整跑完，有结论。 */
  | "completed"
  /** 没跑成。计数不动，下一个打开日重试。 */
  | "incomplete"

export interface StyleEvolutionRoundResult {
  status: StyleEvolutionRoundStatus
  /** 仅 `completed` 时有值。 */
  outcome?: "bootstrap" | "kept" | "reverted"
  /** 给面板/提示条直接显示的中文原因。 */
  reason: string
  state: StyleEvolutionState
  distanceCandidate?: number
  distanceBase?: number
  /** 本轮写出的候选预设（bootstrap / kept 时有值），便于界面跳转。 */
  stylePresetId?: string
  stylePresetName?: string
  /** 取样层面的提醒（例如只能退回到 AI 为主的章节），写进日志供排错。 */
  sampleNote?: string
}

function localDayKey(now: number): string {
  const date = new Date(now)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

/**
 * 按章节序号**稳定**切分（不是随机）：每 3 章取第 3 章当 holdout。
 *
 * 稳定是为了可复现 —— 同一批章节每次都要给出同一个目标 T，
 * 否则「这一轮比上一轮更好」就掺进了切分随机性。
 */
export function splitFitAndHoldout(bodies: string[]): { fit: string[]; holdout: string[] } {
  const fit: string[] = []
  const holdout: string[] = []
  bodies.forEach((body, index) => {
    if (index % 3 === 2) holdout.push(body)
    else fit.push(body)
  })
  return { fit, holdout }
}

function normalizeChapters(raw: ReadonlyArray<string | StyleEvolutionChapter>): StyleEvolutionChapter[] {
  return raw
    .map((item, index): StyleEvolutionChapter => {
      if (typeof item === "string") {
        const body = String(item ?? "").trim()
        return { key: `#${index}:${body.length}`, body }
      }
      return {
        key: String(item?.key ?? `#${index}`),
        body: String(item?.body ?? "").trim(),
        aiRatio: typeof item?.aiRatio === "number" && Number.isFinite(item.aiRatio) ? item.aiRatio : null,
      }
    })
    .filter((chapter) => chapter.body.length > 0)
}

/** 统一成带 key 的章节，并只留最近 {@link RECENT_CHAPTERS} 章。 */
export function selectRecentChapters(
  raw: ReadonlyArray<string | StyleEvolutionChapter>,
): StyleEvolutionChapter[] {
  return normalizeChapters(raw).slice(-RECENT_CHAPTERS)
}

/**
 * 去掉 AI 为主的章节后再取最近几章。去掉之后不够 {@link MIN_CHAPTERS} 章就退回全部章节，
 * 并带上提醒：完全不跑会让「主要靠 AI 写」的用户永远用不上这个功能。
 */
export function selectAuthoredRecentChapters(
  raw: ReadonlyArray<string | StyleEvolutionChapter>,
): { chapters: StyleEvolutionChapter[]; note?: string } {
  const all = normalizeChapters(raw)
  const authored = all.filter((chapter) => chapter.aiRatio == null || chapter.aiRatio <= AI_DOMINANT_RATIO)
  if (authored.length >= MIN_CHAPTERS || authored.length === all.length) {
    return { chapters: authored.slice(-RECENT_CHAPTERS) }
  }
  return { chapters: all.slice(-RECENT_CHAPTERS), note: AI_SAMPLE_FALLBACK_NOTE }
}

/** 把画像渲染成一段给模型看的文本。 */
export function renderProfileForPrompt(profile: BookStyleProfile): string {
  const parts: string[] = []
  const dna = profile.integratedDna?.trim()
  if (dna) parts.push(dna)
  const constitution = profile.constitution?.trim()
  if (constitution) parts.push(`风格硬约束：\n${constitution}`)
  const samples = (profile.samples ?? []).filter((s) => typeof s === "string" && s.trim())
  if (samples.length) parts.push(`代表片段：\n${samples.slice(0, 3).join("\n---\n")}`)
  return parts.join("\n\n")
}

/**
 * fit 正文按章均分预算、每章取开头一段，章与章之间用分隔线隔开。
 * 不再整体 `slice(0, N)`：那样只有最早的一两章能进来。
 */
export function buildFitText(fitBodies: readonly string[]): string {
  if (fitBodies.length === 0) return ""
  const perChapter = Math.min(MAX_FIT_CHARS_PER_CHAPTER, Math.floor(MAX_FIT_CHARS / fitBodies.length))
  return fitBodies.map((body) => body.slice(0, perChapter)).join("\n\n---\n\n")
}

/** 分析提示词：用户自己的章节 + 目标统计 + （可选）基线画像。 */
export function buildAnalysisPrompt(input: {
  fitBodies: string[]
  targetMetricsText: string
  baselineProfileText: string | null
}): string {
  return [
    "你是一位中文小说文风分析员。下面是一位作者最近写的章节，以及从这些章节里统计出来的语言与节奏指标。",
    "",
    "## 作者最近的章节",
    buildFitText(input.fitBodies),
    "",
    "## 从作者章节里算出的指标（目标：新画像写出来的文字应当更接近这些数字）",
    input.targetMetricsText,
    ...(input.baselineProfileText
      ? ["", "## 当前正在用的画像（作为对比基线，可被推翻）", input.baselineProfileText]
      : []),
    "",
    "## 你的任务",
    "提炼这位作者的写作画像，让它比现有画像更贴近上面的指标。",
    "",
    "只输出一个 JSON 对象，不要任何解释文字、不要 Markdown 代码块围栏。字段：",
    "- schemaVersion: 固定 2",
    "- generatedAt: 当前毫秒时间戳（数字）",
    "- integratedDna: 字符串，Markdown，含「## 语言特征」与「## 风格硬约束」两节，必须非空",
    "- constitution: 字符串，8~12 条可执行的风格硬约束，每条一行",
    "- samples: 字符串数组，3~6 段作者原文里的代表片段（**必须来自上面章节，不要自己编**）",
    "",
    "红线：不要迁移任何专有名词、人物设定或情节；不要照抄整句；只描述写法。",
  ].join("\n")
}

/**
 * 从检验章节里切出 {@link PROBE_PAIRS} 个原文片段（按段落对齐、各约 600 字）。
 * 检验章节够多时每章取一段（取中段，避开章首章尾的套路写法）；只有一章时在这一章里切两段。
 */
export function pickProbePassages(holdout: readonly string[]): string[] {
  const paragraphsOf = (body: string) =>
    body.replace(/\r\n/g, "\n").split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const takeFrom = (paragraphs: string[], start: number): string => {
    const picked: string[] = []
    let length = 0
    for (let i = Math.max(0, start); i < paragraphs.length && length < PROBE_PASSAGE_CHARS; i += 1) {
      picked.push(paragraphs[i])
      length += paragraphs[i].length
    }
    return picked.join("\n\n")
  }

  const sources = holdout.filter((body) => body.trim())
  if (sources.length === 0) return []
  if (sources.length >= PROBE_PAIRS) {
    return sources.slice(-PROBE_PAIRS).map((body) => {
      const paragraphs = paragraphsOf(body)
      return takeFrom(paragraphs, Math.floor(paragraphs.length / 3))
    })
  }
  const paragraphs = paragraphsOf(sources[0])
  const half = Math.floor(paragraphs.length / 2)
  const passages = [takeFrom(paragraphs.slice(0, half), 0), takeFrom(paragraphs.slice(half), 0)]
  return passages.filter((passage) => passage.trim())
}

/** 情节要点提示词：只要发生了什么，不要原文措辞。 */
export function buildOutlinePrompt(passages: readonly string[]): string {
  return [
    `【${OUTLINE_MARKER}】下面是几段中文小说原文。请为每一段写一份情节要点，供别人按要点重写这段情节。`,
    "",
    ...passages.flatMap((passage, index) => [`## 片段 ${index + 1}`, passage, ""]),
    "## 要求",
    "- 每份要点 4~8 条，只写发生了什么、谁说了什么意思、场景在哪里。",
    "- 不要照抄原文的句子、比喻、口头禅，不要描述写法。",
    "- 只输出一个 JSON 对象，不要解释、不要代码块围栏。",
    `- 格式：{"outlines":["片段1的要点","片段2的要点"]}，数量与片段数一致（${passages.length} 份）。`,
  ].join("\n")
}

function parseOutlines(raw: string, expected: number): string[] | null {
  let parsed: unknown
  try {
    parsed = extractJsonObject(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.outlines)) return null
  const outlines = parsed.outlines.map((item) => {
    if (typeof item === "string") return item.trim()
    if (Array.isArray(item)) return item.filter((line) => typeof line === "string").join("\n").trim()
    return ""
  })
  if (outlines.length < expected || outlines.slice(0, expected).some((item) => !item)) return null
  return outlines.slice(0, expected)
}

/**
 * 试写提示词：让某个画像按给定情节要点写一段，用来量它的指标。
 *
 * 刻意要求 **3~5 个自然段**：距离里含段落级指标
 * （`oneSentenceParagraphRatio` / `dialogueParagraphRatio` / `avgParagraphChars`），
 * 只写一段时前两个只能取 0 或 1，距离会被「模型这次分了几段」这一个随机事件主导。
 */
export function buildProbePrompt(input: {
  role: "baseline" | "candidate"
  profileText: string
  outline: string
  targetChars: number
}): string {
  const label = input.role === "baseline" ? "基线画像" : "候选画像"
  const target = Math.max(200, Math.round(input.targetChars / 50) * 50)
  return [
    `下面是一份【${label}】和一份情节要点。请按画像的写法，把这段情节写成中文小说正文。`,
    "",
    `## ${label}`,
    input.profileText,
    "",
    "## 情节要点",
    input.outline,
    "",
    "## 要求",
    `- ${PROBE_MARKER}，不要解释、不要标题、不要代码块。`,
    `- 写 3~5 个自然段，合计约 ${target} 字。`,
    "- 只写要点里的情节，不要添加新的人物或事件。",
  ].join("\n")
}

/** 从模型输出里抠出 JSON 对象。容忍代码块围栏与前后废话。 */
function extractJsonObject(raw: string): unknown {
  const text = String(raw ?? "").trim()
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  return JSON.parse(body.slice(start, end + 1))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export type CandidateProfileResult =
  | { ok: true; profile: BookStyleProfile }
  | { ok: false; reason: string }

/**
 * 校验模型给的画像。
 *
 * 必须有这一层：`migrateStyleProfile` 是**宽容**的（缺字段补空、非字符串给空串），
 * `upsertWritingStylePreset` 又原样落盘 —— 垃圾画像不会被拒绝，会被照单写进
 * 文风库、而且用户还能启用它。所以这里自己判。
 */
export function normalizeCandidateProfile(raw: string, now: number): CandidateProfileResult {
  let parsed: unknown
  try {
    parsed = extractJsonObject(raw)
  } catch {
    return { ok: false, reason: "画像不是合法 JSON" }
  }
  if (!isRecord(parsed)) return { ok: false, reason: "画像不是 JSON 对象" }

  const generatedAt = parsed.generatedAt
  if (generatedAt !== undefined && (typeof generatedAt !== "number" || !Number.isFinite(generatedAt))) {
    return { ok: false, reason: "generatedAt 不是有限数" }
  }

  const integratedDna = typeof parsed.integratedDna === "string" ? parsed.integratedDna.trim() : ""
  if (!integratedDna) return { ok: false, reason: "integratedDna 为空，画像没有可用内容" }

  const constitution = typeof parsed.constitution === "string" ? parsed.constitution : ""
  const samples = Array.isArray(parsed.samples)
    ? parsed.samples.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : []

  return {
    ok: true,
    profile: {
      schemaVersion: 2,
      generatedAt: typeof generatedAt === "number" ? generatedAt : now,
      sampledChapterIds: [],
      integratedDna,
      constitution,
      samples,
      // ⚠️ 刻意不设 workbenchStyle —— 见文件头说明。
    },
  }
}

function measureText(text: string): StyleMetricVector {
  return flattenMetrics(computeStyleMetrics([text]).derived)
}

function lastCompletedRoundWithPreset(state: StyleEvolutionState): StyleEvolutionRound | undefined {
  for (let i = state.rounds.length - 1; i >= 0; i -= 1) {
    if (state.rounds[i].stylePresetId) return state.rounds[i]
  }
  return undefined
}

function nextRoundNumber(state: StyleEvolutionState): number {
  return state.rounds.reduce((max, r) => Math.max(max, r.round), 0) + 1
}

/** 本次取样里，上一轮完整分析时没见过的章节数。 */
export function countNewChapters(previousKeys: readonly string[], currentKeys: readonly string[]): number {
  const seen = new Set(previousKeys)
  return currentKeys.filter((key) => !seen.has(key)).length
}

/**
 * 跑一轮。永远不抛错：所有失败都收敛成 `incomplete` + 中文原因。
 */
export async function runStyleEvolutionRound(
  projectPath: string,
  deps: StyleEvolutionDeps,
): Promise<StyleEvolutionRoundResult> {
  const sampling: { note?: string } = {}
  const result = await runRound(projectPath, deps, sampling)
  return sampling.note ? { ...result, sampleNote: sampling.note } : result
}

async function runRound(
  projectPath: string,
  deps: StyleEvolutionDeps,
  sampling: { note?: string },
): Promise<StyleEvolutionRoundResult> {
  const today = deps.now ?? localDayKey(Date.now())
  const rng = deps.rng ?? Math.random

  let state = await loadStyleEvolutionState(projectPath)
  if (!state.enabled) {
    return { status: "skipped-disabled", reason: "文风自进化未开启", state }
  }

  // ── 打开日节律 ────────────────────────────────────────────────
  const advance = advanceOpenDay(state, today)
  state = advance.state
  if (!advance.shouldAnalyze) {
    // 计数 +1 也要落盘，否则这次打开就白记了。
    await saveStyleEvolutionState(projectPath, state)
    return {
      status: "skipped-not-due",
      reason: `还需 ${remainingOpenDays(state)} 次打开`,
      state,
    }
  }

  /*
   * ★ 先落盘再跑模型（文件头①）。
   * 此刻 state 已经带上 lastAttemptedOn = today，重入的那一次会被拦住。
   */
  await saveStyleEvolutionState(projectPath, state)

  const incomplete = async (reason: string): Promise<StyleEvolutionRoundResult> => {
    // 不调用 completeRound、也不写轮次记录：计数停在阈值之上，下个打开日重试。
    return { status: "incomplete", reason, state }
  }

  try {
    // ── 取样：只看最近的章节 ────────────────────────────────────
    const selection = selectAuthoredRecentChapters(await deps.collectChapterBodies())
    sampling.note = selection.note
    const chapters = selection.chapters
    const bodies = chapters.map((chapter) => chapter.body)
    const chapterKeys = chapters.map((chapter) => chapter.key)

    if (bodies.length < MIN_CHAPTERS) {
      return await incomplete(`样本不足：只有 ${bodies.length} 章，至少需要 ${MIN_CHAPTERS} 章`)
    }
    const { fit, holdout } = splitFitAndHoldout(bodies)
    if (fit.length === 0 || holdout.length === 0) {
      return await incomplete("样本不足：无法同时分出对照与检验章节")
    }
    const totalChars = bodies.reduce((sum, body) => sum + body.length, 0)
    if (totalChars < MIN_TOTAL_CHARS) {
      return await incomplete(`样本不足：共 ${totalChars} 字，至少需要 ${MIN_TOTAL_CHARS} 字`)
    }

    // ── 新素材闸门：同一批文本不反复分析 ─────────────────────────
    if (state.lastSampledChapterKeys.length > 0) {
      const fresh = countNewChapters(state.lastSampledChapterKeys, chapterKeys)
      if (fresh < MIN_NEW_CHAPTERS) {
        return {
          status: "skipped-no-new-material",
          reason: `自上次分析以来只有 ${fresh} 章新内容，至少需要 ${MIN_NEW_CHAPTERS} 章`,
          state,
        }
      }
    }

    // ── 目标：用户自己章节的指标 ────────────────────────────────
    const targetMetrics = computeStyleMetrics(holdout)
    const targetMetricsText = formatStyleMetricsForPrompt(targetMetrics)

    // ── 基线：当前启用的文风 → 上一轮候选 → 都没有就是首轮 ──────
    const presetStore = await loadWritingStyleStore(projectPath)
    const enabledPreset = presetStore.enabledStyleId
      ? presetStore.styles.find((s) => s.id === presetStore.enabledStyleId)
      : undefined
    const previousRound = lastCompletedRoundWithPreset(state)
    const previousPreset = previousRound?.stylePresetId
      ? presetStore.styles.find((s) => s.id === previousRound.stylePresetId)
      : undefined
    const baselinePreset = [enabledPreset, previousPreset].find(
      (preset) => preset && renderProfileForPrompt(preset.profile).trim(),
    )
    const baselineProfileText = baselinePreset ? renderProfileForPrompt(baselinePreset.profile) : null

    // ── 分析：产出候选画像 ──────────────────────────────────────
    const analysisRaw = await deps.callModel(
      buildAnalysisPrompt({ fitBodies: fit, targetMetricsText, baselineProfileText }),
    )
    const normalized = normalizeCandidateProfile(analysisRaw, Date.now())
    if (!normalized.ok) {
      return await incomplete(`候选画像未通过校验：${normalized.reason}`)
    }
    const candidateProfile = normalized.profile

    const round = nextRoundNumber(state)
    const sourceBook = `${SYNTHETIC_SOURCE_BOOK_PREFIX} · 第 ${round} 轮`
    const name = `自动进化 · 第 ${round} 轮`

    const writeCandidate = async (): Promise<string> => {
      const preset = await upsertWritingStylePreset(projectPath, {
        name,
        sourceBook,
        profile: candidateProfile,
      })
      return preset.id
    }

    /** 写完后清理上一轮候选 —— 但**绝不删用户正在用的那条**（文件头④）。 */
    const cleanupPrevious = async (previousSourceBook: string | null): Promise<void> => {
      if (!previousSourceBook || previousSourceBook === sourceBook) return
      const current = await loadWritingStyleStore(projectPath)
      const previous = current.styles.find((s) => s.sourceBook === previousSourceBook)
      if (!previous) return
      if (current.enabledStyleId === previous.id) return // 用户启用了它 ⇒ 保住
      await removeWritingStylePresetBySourceBook(projectPath, previousSourceBook)
    }

    const previousSourceBook = previousRound?.sourceBook ?? null

    // ── 首轮：没有基线可比 ⇒ 建立基线，跳过试写 ──────────────────
    if (!baselineProfileText) {
      const presetId = await writeCandidate()
      await cleanupPrevious(previousSourceBook)

      const record: StyleEvolutionRound = {
        at: today,
        round,
        outcome: "bootstrap",
        reason: "首次分析，已建立基线；尚未经过试写验证",
        stylePresetId: presetId,
        sourceBook,
      }
      state = completeRound(state, today, rng)
      state = {
        ...state,
        probe: null,
        lastSampledChapterKeys: chapterKeys,
        rounds: [...state.rounds, record],
      }
      await saveStyleEvolutionState(projectPath, state)

      return {
        status: "completed",
        outcome: "bootstrap",
        reason: record.reason!,
        state,
        stylePresetId: presetId,
        stylePresetName: name,
      }
    }

    // ── 受控试写：先提炼情节要点，再让两份画像按同一要点各写一段 ──
    const passages = pickProbePassages(holdout)
    if (passages.length < PROBE_PAIRS) {
      return await incomplete("检验章节太短，切不出足够的检验片段")
    }
    const outlines = parseOutlines(await deps.callModel(buildOutlinePrompt(passages)), passages.length)
    if (!outlines) {
      return await incomplete("情节要点提炼失败，无法做受控试写")
    }

    const candidateProfileText = renderProfileForPrompt(candidateProfile)
    const pairs: StyleProbePair[] = []
    for (let i = 0; i < passages.length; i += 1) {
      const passageMetrics = measureText(passages[i])
      const baseText = (
        await deps.callModel(buildProbePrompt({
          role: "baseline",
          profileText: baselineProfileText,
          outline: outlines[i],
          targetChars: passages[i].length,
        }))
      ).trim()
      if (baseText.length < MIN_PROBE_CHARS) {
        return await incomplete("基线试写没有产出正文，无法建立对比")
      }
      const candidateText = (
        await deps.callModel(buildProbePrompt({
          role: "candidate",
          profileText: candidateProfileText,
          outline: outlines[i],
          targetChars: passages[i].length,
        }))
      ).trim()
      if (candidateText.length < MIN_PROBE_CHARS) {
        return await incomplete("候选试写没有产出正文，无法判定")
      }
      pairs.push({
        distanceBase: distance(measureText(baseText), passageMetrics),
        distanceCandidate: distance(measureText(candidateText), passageMetrics),
      })
    }

    const verdict = resolvePairedVerdict(pairs, EPSILON)
    const distanceCandidate = Number.isFinite(verdict.meanCandidate) ? verdict.meanCandidate : undefined
    const distanceBase = Number.isFinite(verdict.meanBase) ? verdict.meanBase : undefined

    if (verdict.verdict === "kept") {
      const presetId = await writeCandidate()
      await cleanupPrevious(previousSourceBook)

      const record: StyleEvolutionRound = {
        at: today,
        round,
        outcome: "kept",
        reason: verdict.reason,
        distanceCandidate,
        distanceBase,
        stylePresetId: presetId,
        sourceBook,
      }
      state = completeRound(state, today, rng)
      state = {
        ...state,
        probe: null,
        lastSampledChapterKeys: chapterKeys,
        rounds: [...state.rounds, record],
      }
      await saveStyleEvolutionState(projectPath, state)

      return {
        status: "completed",
        outcome: "kept",
        reason: "候选更接近你的写法，已生成待你确认",
        state,
        distanceCandidate,
        distanceBase,
        stylePresetId: presetId,
        stylePresetName: name,
      }
    }

    const record: StyleEvolutionRound = {
      at: today,
      round,
      outcome: "reverted",
      reason:
        verdict.reason === "undecidable"
          ? "距离无法判定，按不采纳处理"
          : "候选没有在每组试写里都更接近你的写法，已作废",
      distanceCandidate,
      distanceBase,
    }
    state = completeRound(state, today, rng)
    state = {
      ...state,
      probe: null,
      lastSampledChapterKeys: chapterKeys,
      rounds: [...state.rounds, record],
    }
    await saveStyleEvolutionState(projectPath, state)

    return {
      status: "completed",
      outcome: "reverted",
      reason: record.reason!,
      state,
      distanceCandidate,
      distanceBase,
    }
  } catch (error) {
    // 任何未预期的异常都收敛成 incomplete：计数不动，下个打开日重试。
    const message = error instanceof Error ? error.message : String(error)
    return await incomplete(`分析过程出错：${message}`)
  }
}

/** 给界面用：把项目路径规范化后拼出状态文件路径（便于展示/排错）。 */
export function styleEvolutionStatePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/style-evolution.json`
}
