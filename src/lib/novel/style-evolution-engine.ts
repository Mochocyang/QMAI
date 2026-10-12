/**
 * 文风自进化的**编排**：一轮完整的「取样 → 分析 → 校验 → 试写 → 判定 → 落候选/作废」。
 *
 * 达尔文式棘轮：让模型读用户自己的章节提一份新画像，再**让新画像和老画像各写一段**，
 * 谁写出来的文字统计上更接近用户真实写法，就留下谁。判据是确定性指标距离
 * （见 `style-evolution-metrics.ts`），不是模型自评分 —— 自评分不可复现，
 * 会让「要不要换掉用户的文风」这个决定变成掷骰子。
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
  resolveVerdict,
  type StyleMetricVector,
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

/** 送进分析提示词的 fit 正文上限，防止超长项目把 prompt 顶爆。 */
const MAX_FIT_CHARS = 12000

/** 候选预设的来源前缀。**每轮都要带轮次号** —— 见文件头③。 */
const SYNTHETIC_SOURCE_BOOK_PREFIX = "我的文风 · 自动进化"

/** 探针与分析的提示词里都刻意出现的标记，便于测试区分两类调用。 */
const PROBE_MARKER = "只输出正文"

export interface StyleEvolutionDeps {
  /** 调模型拿**原始文本**。关思考重试等策略由调用方在适配器里负责。 */
  callModel: (prompt: string) => Promise<string>
  /** 用户自己章节的正文（已剥 frontmatter）。 */
  collectChapterBodies: () => Promise<string[]>
  /** 打开日（本地 `YYYY-MM-DD`）。默认取当前本地日期。 */
  now?: string
  rng?: () => number
}

export type StyleEvolutionRoundStatus =
  /** 开关没开 —— 一次模型调用都没有。 */
  | "skipped-disabled"
  /** 今天不该分析（没到阈值，或今天已经尝试过）。 */
  | "skipped-not-due"
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

/** 分析提示词：用户自己的章节 + 目标统计 + （可选）基线画像。 */
export function buildAnalysisPrompt(input: {
  fitBodies: string[]
  targetMetricsText: string
  baselineProfileText: string | null
}): string {
  const fitText = input.fitBodies.join("\n\n---\n\n").slice(0, MAX_FIT_CHARS)
  return [
    "你是一位中文小说文风分析员。下面是一位作者自己写的章节，以及从这些章节里统计出来的语言与节奏指标。",
    "",
    "## 作者自己的章节",
    fitText,
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
 * 试写提示词：让某个画像写一小段，用来量它的指标。
 *
 * 刻意要求 **3~5 个自然段**：距离里含段落级指标
 * （`oneSentenceParagraphRatio` / `dialogueParagraphRatio` / `avgParagraphChars`），
 * 只写一段时前两个只能取 0 或 1，距离会被「模型这次分了几段」这一个随机事件主导。
 */
export function buildProbePrompt(input: {
  role: "baseline" | "candidate"
  profileText: string
}): string {
  const label = input.role === "baseline" ? "基线画像" : "候选画像"
  return [
    `下面是一份【${label}】。请按它的写法写一小段中文小说正文。`,
    "",
    `## ${label}`,
    input.profileText,
    "",
    "## 要求",
    `- ${PROBE_MARKER}，不要解释、不要标题、不要代码块。`,
    "- 写 3~5 个自然段，合计 300~400 字。",
    "- 必须有对白，也必须有叙述。",
    "- 写一个全新的日常场景，不要复用画像里出现过的任何人物、地名或情节。",
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

/**
 * 跑一轮。永远不抛错：所有失败都收敛成 `incomplete` + 中文原因。
 */
export async function runStyleEvolutionRound(
  projectPath: string,
  deps: StyleEvolutionDeps,
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
    // ── 取样 ────────────────────────────────────────────────────
    const bodies = (await deps.collectChapterBodies())
      .map((body) => String(body ?? "").trim())
      .filter((body) => body.length > 0)

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

    // ── 目标：用户自己章节的指标 ────────────────────────────────
    const targetMetrics = computeStyleMetrics(holdout)
    const targetVector = flattenMetrics(targetMetrics.derived)
    const targetMetricsText = formatStyleMetricsForPrompt(targetMetrics)

    // ── 基线：上一轮候选 → 当前启用 → 都没有就是首轮 ────────────
    let baselineMetrics: StyleMetricVector | null = null
    let baselineProfileText: string | null = null

    const presetStore = await loadWritingStyleStore(projectPath)
    const enabledId = presetStore.enabledStyleId

    if (state.probe) {
      const cached = presetStore.styles.find((s) => s.id === state.probe?.stylePresetId)
      if (cached) {
        baselineMetrics = state.probe.metrics
        baselineProfileText = renderProfileForPrompt(cached.profile)
      }
    }

    if (!baselineMetrics) {
      const previous = lastCompletedRoundWithPreset(state)
      const candidateId = previous?.stylePresetId ?? enabledId
      const preset = candidateId ? presetStore.styles.find((s) => s.id === candidateId) : undefined
      if (preset) {
        const profileText = renderProfileForPrompt(preset.profile)
        if (profileText.trim()) {
          const probeText = (await deps.callModel(buildProbePrompt({ role: "baseline", profileText }))).trim()
          if (probeText.length < MIN_PROBE_CHARS) {
            return await incomplete("基线试写没有产出正文，无法建立对比")
          }
          baselineMetrics = measureText(probeText)
          baselineProfileText = profileText
          // 缓存**指标**（不缓存距离）：下一轮不必再量一次同一份基线。
          state = {
            ...state,
            probe: {
              stylePresetId: preset.id,
              sourceBook: preset.sourceBook,
              at: today,
              metrics: baselineMetrics,
            },
          }
          await saveStyleEvolutionState(projectPath, state)
        }
      }
    }

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

    const previousSourceBook = lastCompletedRoundWithPreset(state)?.sourceBook ?? null

    // ── 首轮：没有基线可比 ⇒ 建立基线，跳过试写 ──────────────────
    if (!baselineMetrics) {
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
      state = { ...state, rounds: [...state.rounds, record] }
      await saveStyleEvolutionState(projectPath, state)

      return {
        status: "completed",
        outcome: "bootstrap",
        reason: record.reason!,
        state,
      }
    }

    // ── 试写与判定 ──────────────────────────────────────────────
    const candidateProfileText = renderProfileForPrompt(candidateProfile)
    const candidateProbeText = (
      await deps.callModel(buildProbePrompt({ role: "candidate", profileText: candidateProfileText }))
    ).trim()
    if (candidateProbeText.length < MIN_PROBE_CHARS) {
      return await incomplete("候选试写没有产出正文，无法判定")
    }

    const candidateMetrics = measureText(candidateProbeText)
    const distanceCandidate = distance(candidateMetrics, targetVector)
    const distanceBase = distance(baselineMetrics, targetVector)
    const verdict = resolveVerdict(distanceCandidate, distanceBase, EPSILON)

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
        // 新候选成为下一轮的基线；缓存的是**它的指标**。
        probe: { stylePresetId: presetId, sourceBook, at: today, metrics: candidateMetrics },
        rounds: [...state.rounds, record],
      }
      await saveStyleEvolutionState(projectPath, state)

      return { status: "completed", outcome: "kept", reason: "候选更接近你的写法，已生成待你确认", state, distanceCandidate, distanceBase }
    }

    const record: StyleEvolutionRound = {
      at: today,
      round,
      outcome: "reverted",
      reason:
        verdict.reason === "undecidable"
          ? "距离无法判定，按不采纳处理"
          : "候选没有更接近你的写法，已作废",
      distanceCandidate,
      distanceBase,
    }
    state = completeRound(state, today, rng)
    state = { ...state, rounds: [...state.rounds, record] }
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
