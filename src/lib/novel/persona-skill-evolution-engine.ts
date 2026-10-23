/**
 * 人物 Skill 的**达尔文式自进化引擎**。
 *
 * 人物档案平时只随章节「完善」——那是一条只能向前的流水线，档案写歪了
 * 就会沿着歪的方向继续合并。这一层给它补上一个独立的进化循环：
 *
 *   诊断 → 变异（生成候选档案）→ 配对评审 → 棘轮（更好才落盘）
 *
 * ── 从「达尔文.skill 2.0」（C:\QMAI_C\darwin-skill-master）移植的规则 ──
 *   1. **棘轮只认配对多数决，不认绝对分。** 绝对分数跨评委噪音极大
 *      （同一份文字换个评委能差 8 分），用它做 keep/revert 会把真实增益
 *      当成退化丢掉。这里 N=3 个评委**各自独立调用**（无共享上下文），
 *      每个评委在同一次调用里同时看到新旧两份档案，输出 better/worse/tie
 *      + margin；`better 票数 >= worse 票数` 才保留 —— 平局不算退步
 *      （乐观棘轮，达尔文原规则）。
 *   2. **先诊断后改。** 生成候选前必须先指出当前档案的具体问题，
 *      不允许「直接给一份更好的」——没有诊断的改进无法评审。
 *   3. **实测进入评审（dim8 的替身）。** 生成候选时同时产出
 *      「同一个情节锚点下，按旧档案 / 按新档案各演绎一段该人物的言行」，
 *      评委看到的不是两份干巴巴的设定对照，而是两份档案各自指导出来的
 *      实际写法 —— 这在零额外模型调用的前提下把「实测表现」拉进评审。
 *   4. **成本护栏。** 每轮最多 2 个人物；节律沿用文风自进化的打开日阈值
 *      （3~5 个打开日 + 同日最多一次）；候选体积超限直接判废。
 *
 * ── 与文风自进化的分工 ────────────────────────────────────────
 * 文风进化比的是 17 维**可量化指标**的距离（有客观尺）；人物档案的
 * 「更像这个人物」没有可靠的量化尺，所以走纯评审。模型自评不可信
 * （SkillLens：裸 LLM-as-judge 准确率 46.4%），因此评审必须拿
 * **出场原文**当事实锚点，评的是「贴合人物 + 忠于证据」，不是文采。
 *
 * 引擎只收注入的 IO（同 style-evolution-engine 的约定）：文件、模型、
 * 时间、随机数全部从外面来，这里没有一次真实的读盘或网络调用，可测。
 */
import {
  renderPersonaSkillDocument,
  type PersonaPriorEvidence,
} from "./persona-skill-learning"
import { readPersonaDocumentFields } from "./persona-skill-profile"
import type {
  PersonaSkillEvolutionRound,
  PersonaSkillEvolutionState,
} from "./persona-skill-evolution-store"
import { advanceOpenDay, completeRound } from "./style-evolution-schedule"
import type { PersonaSkillIndex, PersonaSkillMeta } from "./persona-skill-types"

/** 每轮最多进化几个人物。评委每人 3 次、生成 1 次，2 人 = 每轮最多 10 次调用。 */
export const MAX_CHARACTERS_PER_ROUND = 2

/** 评委人数。必须是奇数（多数决不允许平票）。 */
export const EVOLUTION_JUDGES = 3

/**
 * 候选体积上限：超过「原文 3 倍 + 800 字」判废。
 * 合并式改进理应大体保持体量；暴涨意味着模型在注水或整份重写。
 */
function candidateSizeLimit(original: string): number {
  return original.length * 3 + 800
}

/** 人物档案的 5 个规范字段。与 persona-skill-learning 的存储口径一致。 */
const FIELD_NAMES = ["怎么说话", "怎么想", "怎么判断", "什么不做", "知道局限"] as const

export interface PersonaEvolutionCandidate {
  /** 生成阶段诊断出的当前档案问题（先诊断后改，评审会核对改进是否对着问题去）。 */
  problems: string[]
  /** 改进后的完整 5 字段（不是增量：合并口径与章节学习一致，避免丢字段）。 */
  fields: Record<string, string>
  /** 每个字段的一句改进理由。 */
  reasons: Record<string, string>
  /** 配对实测素材：同一情节锚点下，旧档案 / 新档案各自的演绎。 */
  sample: { anchor: string; base: string; candidate: string }
}

export interface PersonaPairJudgement {
  verdict: "base" | "candidate" | "tie"
  margin: "clear" | "slight"
  reason: string
}

export interface PersonaEvolutionTarget {
  meta: PersonaSkillMeta
  document: string
  evidence: PersonaPriorEvidence[]
  candidate: PersonaEvolutionCandidate
  /** 渲染后的候选 SKILL.md 全文（含 frontmatter）。 */
  candidateDocument: string
}

export interface PersonaSkillEvolutionIO {
  /** 读开关与节律状态（注入后引擎不碰任何真实文件，可裸测）。 */
  loadState: () => Promise<PersonaSkillEvolutionState>
  saveState: (state: PersonaSkillEvolutionState) => Promise<void>
  loadIndex: () => Promise<PersonaSkillIndex>
  loadDocument: (id: string) => Promise<string>
  loadEvidence: (
    characterName: string,
    aliases: readonly string[],
    chapters: readonly number[],
  ) => Promise<PersonaPriorEvidence[]>
  generateCandidate: (input: {
    characterName: string
    aliases: readonly string[]
    document: string
    evidence: PersonaPriorEvidence[]
  }) => Promise<PersonaEvolutionCandidate | null>
  judgePair: (input: {
    characterName: string
    document: string
    candidate: PersonaEvolutionCandidate
    evidence: PersonaPriorEvidence[]
  }) => Promise<PersonaPairJudgement | null>
  /**
   * 把候选落盘：快照旧版 → 写新档案 → 索引 skillRevision+1，全程同一把锁。
   *
   * 必须回传**落盘后**索引里的 `updatedAt`：引擎要把它记进 processedAt。
   * 不回传（或让引擎先记旧值）会让「这一版处理过了」永远追不上磁盘上的
   * 新版 —— 于是同一个人每个节律周期都被重写一次，说话方式越改越远。
   */
  applyCandidate: (id: string, candidateDocument: string) => Promise<{ updatedAt: string }>
}

export type PersonaSkillEvolutionStatus =
  | "skipped-disabled"
  | "skipped-not-due"
  | "skipped-no-new-material"
  | "completed"
  | "incomplete"

export interface PersonaSkillEvolutionRoundResult {
  status: PersonaSkillEvolutionStatus
  reason?: string
  state: PersonaSkillEvolutionState
  outcome?: PersonaSkillEvolutionRound["outcome"]
  votes?: string[]
  characterNames?: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** 从模型输出里解析候选。5 个字段缺一不可；problems/sample 允许退化但结构要对。 */
export function parsePersonaEvolutionCandidate(raw: string): PersonaEvolutionCandidate | null {
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  const fields: Record<string, string> = {}
  const rawFields = isRecord(parsed.fields) ? parsed.fields : {}
  for (const name of FIELD_NAMES) {
    const value = rawFields[name]
    if (typeof value !== "string" || value.trim().length < 2) return null
    fields[name] = value.trim()
  }

  const problems = Array.isArray(parsed.problems)
    ? parsed.problems.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []

  const reasons: Record<string, string> = {}
  if (isRecord(parsed.reasons)) {
    for (const name of FIELD_NAMES) {
      const value = parsed.reasons[name]
      if (typeof value === "string" && value.trim()) reasons[name] = value.trim()
    }
  }

  const sample = isRecord(parsed.sample) ? parsed.sample : {}
  const anchor = typeof sample.anchor === "string" ? sample.anchor.trim() : ""
  const base = typeof sample.base === "string" ? sample.base.trim() : ""
  const candidate = typeof sample.candidate === "string" ? sample.candidate.trim() : ""
  if (!anchor || !base || !candidate) return null

  return { problems, fields, reasons, sample: { anchor, base, candidate } }
}

/** 从模型输出里解析一票。verdict/margin 非法时返回 null（弃权票）。 */
export function parsePersonaPairJudgement(raw: string): PersonaPairJudgement | null {
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const verdict = parsed.verdict
  const margin = parsed.margin
  if (verdict !== "base" && verdict !== "candidate" && verdict !== "tie") return null
  const settledMargin = margin === "clear" || margin === "slight" ? margin : "slight"
  const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : ""
  return { verdict, margin: settledMargin, reason }
}

/** 生成阶段的用户提示词。先诊断后改；演绎样例供配对评审使用。 */
export function buildPersonaEvolutionCandidatePrompt(input: {
  characterName: string
  aliases: readonly string[]
  document: string
  evidence: PersonaPriorEvidence[]
}): string {
  const evidenceText =
    input.evidence.length > 0
      ? input.evidence
          .map((item) => `【第 ${item.chapterNumber} 章出场原文】\n${item.text}`)
          .join("\n\n")
      : "（暂无出场原文可用）"

  return [
    `你在审校一份中文小说人物的「人物 Skill」档案。它会被注入写作提示词，指导 AI 把「${input.characterName}」写对。`,
    `别名：${input.aliases.length > 0 ? input.aliases.join("、") : "无"}`,
    "",
    "【当前档案（整份，含档案页；本轮只改下面列出的 5 个演技字段）】",
    input.document,
    "",
    "【该人物最近的出场原文（唯一事实来源）】",
    evidenceText,
    "",
    "【你的任务】第一步先诊断，第二步再改进：",
    "1. 从下列评审准则出发，指出当前档案的 2~3 个**具体**问题（引用档案里的原句或原词），按影响从大到小排：",
    "   - 可演性：字段给的是能直接照着写的指令（句式、口头禅、决策规则、禁忌），还是「沉默寡言、内心复杂」这类空标签；",
    "   - 忠实于证据：档案内容与出场原文一致，没有编造原文里没发生的设定；",
    "   - 护栏：有「这个人物不会做什么 / 要避免什么」的边界；",
    "   - 区分度：把名字换成一个同类角色，这段话是否照样成立（成立=模板话，扣分）；",
    "   - 简洁：没有「注意」「总之」式的凑字废话。",
    "2. 输出改进后的**完整五字段**（不是增量）：仍成立的内容原样保留，只修诊断出的问题；",
    "   不得引入出场原文之外的新设定，不得整份推翻重写。",
    "   这里的「五字段」只有：怎么说话 / 怎么想 / 怎么判断 / 什么不做 / 知道局限。",
    "   档案页字段（性别 / 年龄 / 势力组织 / 外貌 / 性格 / 背景 / 动机 / 能力 / 关系网 / 成长轨迹 / 备注）",
    "   不在本轮范围内：不要输出，也不要把它们当成要改的内容。",
    "3. 每个字段给一句改进理由（对应上面哪条准则、修的哪个问题）。",
    "4. 做一次配对演绎：从出场原文里挑一个情节锚点，分别按【当前档案】与【改进档案】",
    "   写出这个人物在该情节下的言行（各 3~5 句，含一小段对话或动作），用于后续评审。",
    "",
    '只输出一个 JSON 对象（无代码围栏、无解释），结构：',
    '{"problems":["..."],"fields":{"怎么说话":"...","怎么想":"...","怎么判断":"...","什么不做":"...","知道局限":"..."},',
    ' "reasons":{"怎么说话":"...","怎么想":"...","怎么判断":"...","什么不做":"...","知道局限":"..."},',
    ' "sample":{"anchor":"...","base":"...","candidate":"..."}}',
  ].join("\n")
}

/** 配对评审的提示词。同一评委一次调用内看两版 —— 尺子偏差在比较中抵销。 */
export function buildPersonaPairJudgePrompt(input: {
  characterName: string
  document: string
  candidate: PersonaEvolutionCandidate
  evidence: PersonaPriorEvidence[]
}): string {
  const candidateSections = FIELD_NAMES.map((name) => `## ${name}\n${input.candidate.fields[name] ?? ""}`).join("\n\n")
  /**
   * A 版也只截 5 个演技字段。
   *
   * 档案里现在还有性别 / 势力组织 / 外貌 / 关系网等 11 个字段，而候选只产这 5 个。
   * 若把整份文档当 A 版去比，评委是在拿「16 段的旧档案」比「5 段的新档案」——
   * 要么因为「A 版更完整」而系统性否决好候选，要么被这些与准则无关的段落干扰。
   * 评审要的是同类项相比：这一场怎么演他。
   */
  const baseFields = readPersonaDocumentFields(input.document)
  const baseSections = FIELD_NAMES.map((name) => `## ${name}\n${baseFields[name] ?? ""}`).join("\n\n")
  const evidenceText =
    input.evidence.length > 0
      ? input.evidence.map((item) => `【第 ${item.chapterNumber} 章】${item.text}`).join("\n\n")
      : "（无）"

  return [
    `你是中文小说人物档案的评审。判断下面两份「${input.characterName}」的人物 Skill 档案，**哪一份更能让写作者把这个人物写对**。`,
    "",
    "【评审准则（按此比较，不打绝对分）】",
    "1. 可演性：给的是能照着写的指令，不是性格标签；",
    "2. 忠实于证据：与出场原文一致，不编造未发生的设定；",
    "3. 护栏：写明了这个人物不会做什么、要避免什么；",
    "4. 区分度：换个同类角色名字就不成立的，才是好档案；",
    "5. 简洁：没有凑字废话。",
    "",
    "【出场原文（事实锚点）】",
    evidenceText,
    "",
    "【A 版（现行档案中的五个演技字段）】",
    baseSections,
    "",
    "【B 版（候选档案）】",
    candidateSections,
    "",
    "【两版在同一情节锚点下的演绎对照】",
    `锚点：${input.candidate.sample.anchor}`,
    `按 A 版写：${input.candidate.sample.base}`,
    `按 B 版写：${input.candidate.sample.candidate}`,
    "",
    "要求：先各自默读一遍再比较；演绎对照与档案文本都要看；与出场原文冲突的内容是硬伤。",
    '只输出一个 JSON 对象（无代码围栏）：{"verdict":"base|candidate|tie","margin":"clear|slight","reason":"一句话，引用至少一处具体文字作为依据"}',
  ].join("\n")
}

function localToday(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, "0")
  const day = `${now.getDate()}`.padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * 可参与进化的人物：有档案、没被用户手改（用户的字比模型的好，不许覆盖），
 * 且**这一版还没被进化处理过**（`updatedAt` 与 processedAt 记录不一致）。
 *
 * 排序：绿勾 → 主要档 → **最近学习优先**（lastLearnedChapter 大的在前）→ 出场次数。
 * 「最近学习优先」是给「消失很久后回归」的角色让路：他刚带着新章节素材回来，
 * 这一轮的新证据对他最值钱；老资历的主角下轮还有机会，回归者错过就要再等
 * 一个 3~5 天的节律周期。
 */
function pickEvolutionTargets(
  index: PersonaSkillIndex,
  processedAt: Record<string, string>,
): PersonaSkillMeta[] {
  return index.skills
    .filter((meta) => meta.status === "active" && !meta.editedByUser)
    .filter((meta) => (processedAt[meta.id] ?? "") !== meta.updatedAt)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (a.tier !== b.tier) return a.tier === "major" ? -1 : 1
      if (a.lastLearnedChapter !== b.lastLearnedChapter) return b.lastLearnedChapter - a.lastLearnedChapter
      if (a.appearanceCount !== b.appearanceCount) return b.appearanceCount - a.appearanceCount
      return a.characterName.localeCompare(b.characterName, "zh-Hans-CN")
    })
    .slice(0, MAX_CHARACTERS_PER_ROUND)
}

/** 待处理人数：一个人物的学习版（updatedAt）还没被任何进化轮处理过，就算待处理。 */
function countPendingTargets(index: PersonaSkillIndex, processedAt: Record<string, string>): number {
  return index.skills.filter(
    (meta) =>
      meta.status === "active" &&
      !meta.editedByUser &&
      (processedAt[meta.id] ?? "") !== meta.updatedAt,
  ).length
}

/**
 * 跑一轮人物 Skill 进化。**永不抛错**：一切失败收敛为 `incomplete`，
 * 节律计数留在阈值之上，下一个打开日自动重试（同文风）。
 */
export async function runPersonaSkillEvolutionRound(
  io: PersonaSkillEvolutionIO,
  opts: { now?: string; rng?: () => number } = {},
): Promise<PersonaSkillEvolutionRoundResult> {
  const rng = opts.rng ?? Math.random
  const today = opts.now ?? localToday()

  let state: PersonaSkillEvolutionState = await io.loadState()
  if (!state.enabled) {
    return { status: "skipped-disabled", state }
  }

  const advanced = advanceOpenDay(state, today)
  state = advanced.state
  // 先落盘再干活：lastAttemptedOn 必须在模型调用之前写下去，否则同日重入拦不住。
  await io.saveState(state)
  if (!advanced.shouldAnalyze) {
    return { status: "skipped-not-due", state }
  }

  try {
    const index = await io.loadIndex()

    // 新素材闸门：所有「学习版还没被进化处理过」的人都消化完了才歇。
    // 逐人判断而不是比一个全局时间戳：一轮章节学习常同时更新 4 个人，而进化
    // 每轮只处理 2 个 —— 全局基线会让同一批里排后面的人永远轮不到。
    if (state.processedAt && countPendingTargets(index, state.processedAt) === 0) {
      return { status: "skipped-no-new-material", reason: "没有未处理过新学习的人物档案", state }
    }

    const targets = pickEvolutionTargets(index, state.processedAt)
    if (targets.length === 0) {
      return {
        status: "incomplete",
        reason: "没有可进化的人物档案（需要先通过章节学习建档，且未被手动编辑）",
        state,
      }
    }

    const votes: string[] = []
    const evolvedNames: string[] = []
    let keptCount = 0
    // 本轮处理过的人（含被否决/跳过的）都记下他们的 updatedAt：
    // 否决也是一种结论，下一轮不该拿同一份候选再审一遍。
    const processed: Record<string, string> = { ...state.processedAt }

    for (const meta of targets) {
      const document = await io.loadDocument(meta.id)
      if (!document.trim()) {
        processed[meta.id] = meta.updatedAt
        continue
      }

      const evidence = await io.loadEvidence(meta.characterName, meta.aliases, [
        meta.lastChapter,
        meta.firstChapter,
      ])

      const candidate = await io.generateCandidate({
        characterName: meta.characterName,
        aliases: meta.aliases,
        document,
        evidence,
      })
      if (!candidate) {
        votes.push(`${meta.characterName} 跳过（候选生成失败）`)
        processed[meta.id] = meta.updatedAt
        continue
      }

      // 候选只覆盖 5 个「演技」字段（提示词就这么要求的），档案字段
      // （性别 / 势力组织 / 外貌 / 关系网…）必须从旧档案原样带过来。
      // 不带的话，一次自进化就把整份档案的档案页清空 —— 而界面上看起来
      // 像「AI 把他忘了」，用户没有任何线索。
      const previousFields = readPersonaDocumentFields(document)
      const candidateDocument = renderPersonaSkillDocument({
        characterName: meta.characterName,
        aliases: [...meta.aliases],
        roleType: meta.roleType,
        tier: meta.tier,
        pinned: meta.pinned,
        appearanceCount: meta.appearanceCount,
        firstChapter: meta.firstChapter,
        lastChapter: meta.lastChapter,
        chapterNumber: meta.lastChapter,
        fields: { ...previousFields, ...candidate.fields },
        existing: "",
        editedByUser: false,
      })

      if (candidateDocument.length > candidateSizeLimit(document)) {
        votes.push(`${meta.characterName} 跳过（候选体积超限：${candidateDocument.length} > ${candidateSizeLimit(document)}）`)
        processed[meta.id] = meta.updatedAt
        continue
      }

      const judgements: PersonaPairJudgement[] = []
      for (let i = 0; i < EVOLUTION_JUDGES; i += 1) {
        const judgement = await io.judgePair({
          characterName: meta.characterName,
          document,
          candidate,
          evidence,
        })
        if (judgement) judgements.push(judgement)
      }
      // 弃权票过多（有效评委不足 2 个）时不动档案：拿不出可信的多数决。
      if (judgements.length < 2) {
        votes.push(`${meta.characterName} 跳过（有效评委不足）`)
        processed[meta.id] = meta.updatedAt
        continue
      }

      const candidateVotes = judgements.filter((item) => item.verdict === "candidate").length
      const baseVotes = judgements.filter((item) => item.verdict === "base").length
      const tally = `${meta.characterName} ${candidateVotes}-${baseVotes}（弃权 ${judgements.length - candidateVotes - baseVotes}）`

      // 乐观棘轮（达尔文原规则）：better >= worse 就保留，平局不算退步。
      // 记录 processedAt 时用**落盘后**的 updatedAt —— 用 meta.updatedAt（旧值）
      // 会让新素材闸门永远认为「这一版还没处理过」，同一份档案被反复重写。
      if (candidateVotes >= baseVotes && candidateVotes > 0) {
        const applied = await io.applyCandidate(meta.id, candidateDocument)
        processed[meta.id] = applied.updatedAt || meta.updatedAt
        const topReason = judgements.find((item) => item.verdict === "candidate")?.reason ?? ""
        votes.push(`${tally} kept：${topReason}`)
        evolvedNames.push(meta.characterName)
        keptCount += 1
      } else {
        processed[meta.id] = meta.updatedAt
        const topReason = judgements.find((item) => item.verdict === "base")?.reason ?? ""
        votes.push(`${tally} reverted：${topReason}`)
      }
    }

    const outcome: PersonaSkillEvolutionRound["outcome"] = keptCount > 0 ? "kept" : "reverted"
    const round: PersonaSkillEvolutionRound = {
      at: today,
      round: state.rounds.length + 1,
      outcome,
      reason:
        keptCount > 0
          ? ` ${keptCount} 份档案通过配对评审升级`
          : "所有候选都被配对评审否决（这正是棘轮：改不动就保持原样）",
      votes,
    }
    if (evolvedNames.length > 0) round.characterNames = evolvedNames

    state = {
      ...state,
      rounds: [...state.rounds, round],
      // 逐人记录「这一版处理过了」：被否决的人也算，下一轮拿同一份候选再审
      // 一遍只是烧钱。只保留 index 里仍存在的人物，demote/删除的不留残迹。
      processedAt: Object.fromEntries(
        index.skills
          .filter((meta) => processed[meta.id] !== undefined)
          .map((meta) => [meta.id, processed[meta.id]]),
      ),
    }
    state = completeRound(state, today, rng)
    await io.saveState(state)

    return {
      status: "completed",
      state,
      outcome,
      votes,
      characterNames: evolvedNames,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // incomplete 不推进节律：重新读盘，保住 lastAttemptedOn 之后的最新状态。
    const fresh = await io.loadState().catch(() => state)
    return { status: "incomplete", reason: `人物 Skill 进化失败：${message}`, state: fresh }
  }
}
