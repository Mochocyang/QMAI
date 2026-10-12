/**
 * 「舞台情景」对话引擎
 *
 * 在一名主持人（可为用户本人）+ 3~5 名角色构成的舞台上，按轮次让角色轮流
 * 发言，围绕情景规则（主持人要求）展开有来有回的对话。支持：
 * - 指定参考点（如《中庸》），要求所有角色据此组织内容；
 * - 指定对话形式（辩论 / 对话 / 自由讨论）；
 * - 指定轮数；
 * - 用户中途插话后继续生成；
 * - 中止（AbortSignal）。
 *
 * 术语：一轮（round）= 台上每位角色各发言一次。故 N 轮约产生 N × 角色数 条发言。
 */

import type { ChatMessage } from "@/lib/llm-client"
import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import type {
  ScenarioFormat,
  ScenarioMessage,
  ScenarioParticipant,
  ScenarioSession,
  ScenarioSetup,
} from "./scenario-types"
import {
  SCENARIO_FORMAT_INFO,
  SCENARIO_MODERATOR_INTERVAL_DEFAULT,
  SCENARIO_MODERATOR_USER_ID,
  SCENARIO_MODERATOR_USER_NAME,
  clampScenarioRounds,
  lastSpokenRound,
} from "./scenario-types"
import {
  buildModeratorClosingPrompt,
  buildModeratorInterjectionPrompt,
  buildModeratorOpeningPrompt,
  buildModeratorSystemPrompt,
  buildSceneContext,
  formatTranscript,
  getCharacters,
  getModerator,
  isUserModerator,
} from "./scenario-moderator"

// ── 会话构建 ──

export interface CreateScenarioSetupInput {
  title: string
  rules: ScenarioSetup["rules"]
  format: ScenarioFormat
  rounds: number
  participants: ScenarioParticipant[]
  moderatorEveryRounds?: number
  sourceChapters?: number
  id?: string
}

/** 生成唯一 id。 */
function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

/** 由设置构建一个 ScenarioSetup。 */
export function createScenarioSetup(
  input: CreateScenarioSetupInput,
): ScenarioSetup {
  return {
    id: input.id ?? genId("scenario"),
    title: input.title || "未命名情景",
    rules: input.rules,
    format: input.format,
    rounds: clampScenarioRounds(input.rounds),
    participants: input.participants,
    moderatorEveryRounds:
      input.moderatorEveryRounds ?? SCENARIO_MODERATOR_INTERVAL_DEFAULT,
    sourceChapters: input.sourceChapters ?? 0,
    createdAt: new Date().toISOString(),
  }
}

function makeMessage(
  partial: Omit<ScenarioMessage, "id" | "timestamp">,
): ScenarioMessage {
  return {
    id: genId("msg"),
    timestamp: new Date().toISOString(),
    ...partial,
  }
}

// ── 角色提示词 ──

/** 构建角色的系统提示词（身份 + 铁律）。 */
export function buildCharacterSystemPrompt(
  setup: ScenarioSetup,
  character: ScenarioParticipant,
): string {
  const lines: string[] = []
  lines.push(
    `你正在以小说角色「${character.name}」的身份，参与一场名为《${setup.title}》的舞台情景模拟。`,
  )
  lines.push("")
  lines.push("【核心规则 - 必须严格遵守】")
  lines.push(`1. 你就是「${character.name}」本人，不是 AI 助手，不要跳出角色。`)
  lines.push(
    "2. 你只说「你这一轮」该说的话，是一段自然的台词/发言；不要写旁白、动作描写或括号提示。",
  )
  lines.push("3. 必须针对上一位发言者（或主持人的提问）作出回应，做到有来有回。")
  lines.push(
    "4. 严格基于你的认知范围：你只知道你亲身经历、亲眼看到、亲耳听到的事情；不知道的事绝不能编造，绝不能表现出全知视角。",
  )
  lines.push("5. 保持你的性格与说话风格，让不同角色的发言在语气与立场上明显不同。")
  lines.push("6. 只输出台词纯文本，不要输出 JSON，不要使用 markdown 格式。")
  const personality = character.personality ?? []
  if (personality.length > 0) {
    lines.push("")
    lines.push(`你的性格：${personality.join("、")}`)
  }
  if (character.speakingStyle) {
    lines.push(`你的说话风格：${character.speakingStyle}`)
  }
  return lines.join("\n")
}

/** 构建角色本轮发言的用户指令。 */
export function buildCharacterTurnPrompt(
  setup: ScenarioSetup,
  character: ScenarioParticipant,
  transcript: string,
  round: number,
  worldRules?: string,
): string {
  const sections: string[] = []

  sections.push("【你的身份】")
  sections.push(`姓名：${character.name}`)
  if (character.profile) sections.push(`档案：${character.profile}`)
  if (character.auraName) sections.push(`灵魂（可参照的气质）：${character.auraName}`)
  const personality = character.personality ?? []
  if (personality.length > 0) {
    sections.push(`性格：${personality.join("、")}`)
  }
  if (character.speakingStyle) sections.push(`说话风格：${character.speakingStyle}`)

  if (character.knowledgeScope && character.knowledgeScope.length > 0) {
    sections.push("")
    sections.push("【你知道的信息】")
    sections.push(character.knowledgeScope.slice(-20).join("\n"))
  }
  if (character.doesNotKnow && character.doesNotKnow.length > 0) {
    sections.push("")
    sections.push("【你绝对不知道的事情（禁止提及）】")
    sections.push(character.doesNotKnow.join("\n"))
  }

  sections.push("")
  sections.push(
    buildSceneContext(setup, {
      formatHint: SCENARIO_FORMAT_INFO[setup.format].behaviorHint,
      worldRules,
    }),
  )

  sections.push("")
  sections.push("【已有对话】")
  sections.push(transcript)

  sections.push("")
  sections.push(
    `现在是第 ${round} 轮。请以「${character.name}」的身份说出你这一轮的发言（只输出台词本身）。`,
  )

  return sections.join("\n")
}

// ── 底层调用 ──

interface StreamResult {
  text: string
  reasoning: string
}

async function streamOnce(
  llmConfig: LlmConfig,
  messages: ChatMessage[],
  signal: AbortSignal | undefined,
  onToken: ((token: string) => void) | undefined,
): Promise<StreamResult> {
  let text = ""
  let reasoning = ""
  let streamError: Error | null = null

  await streamChat(
    llmConfig,
    messages,
    {
      onToken: (token) => {
        text += token
        onToken?.(token)
      },
      onReasoningToken: (token) => {
        reasoning += token
      },
      onDone: () => {},
      onError: (err) => {
        streamError = err
      },
    },
    signal,
  )

  if (streamError) throw streamError
  return { text: text.trim(), reasoning: reasoning.trim() }
}

// ── 引擎选项 ──

export interface RunScenarioOptions {
  setup: ScenarioSetup
  llmConfig: LlmConfig
  signal?: AbortSignal
  /** 世界规则 / 背景设定（可选）。 */
  worldRules?: string
  /** 初始消息（续跑时传入）。 */
  initialMessages?: ScenarioMessage[]
  /** 起始轮次（默认 1）。 */
  startRound?: number
  /** 生成轮数（默认取 setup.rounds）。 */
  rounds?: number
  /** 是否生成主持人开场（默认：消息为空且主持人非用户时生成）。 */
  withOpening?: boolean
  /** 是否生成主持人收束（默认 true）。 */
  withClosing?: boolean
  /** 主持人每隔多少轮串场一次（0=不串场；用户主持时忽略；默认取 setup.moderatorEveryRounds，缺省 5）。 */
  moderatorEveryRounds?: number
  /**
   * 串场节奏的起算轮次（默认 `startRound`）。
   *
   * 判据是「绝对轮次」而非「本段第几轮」：情景的轮次编号自 1 起且跨中止/插话
   * 一直延续，所以续跑时必须把起算点传成 1，否则每一段都会在自己的第一轮
   * 命中 `% === 0` —— 用户每次插话都会冒出一句串场，而原本配的「每 N 轮」
   * 完全失效。默认值保持 `startRound`，整跑行为与从前逐字一致。
   */
  moderatorOriginRound?: number
  /**
   * 这一轮已经由别处让主持人说过话（典型是插话回应），跳过节奏串场。
   *
   * 「回应插话」本身就是这一轮的串场，不跳过就会在同一轮连出两句主持人台词。
   */
  suppressModeratorInterjectionRound?: number
  /** 每条发言开始生成时回调。 */
  onMessageStart?: (info: {
    kind: ScenarioMessage["kind"]
    speakerId: string
    speakerName: string
    round: number
  }) => void
  /** 流式 token 回调（当前正在生成的发言）。 */
  onToken?: (token: string) => void
  /** 某条发言完成时回调。 */
  onMessage?: (message: ScenarioMessage) => void
  /** 进度回调：done=已完成发言数，total=预估总数。 */
  onProgress?: (done: number, total: number) => void
}

export interface ScenarioRunResult {
  messages: ScenarioMessage[]
  cancelled: boolean
}

/**
 * 运行舞台情景：开场 → 若干轮角色轮流发言（含主持人串场）→ 收束。
 */
export async function runScenario(
  options: RunScenarioOptions,
): Promise<ScenarioRunResult> {
  const {
    setup,
    llmConfig,
    signal,
    worldRules,
    initialMessages = [],
    startRound = 1,
    withClosing = true,
  } = options
  const moderatorEveryRounds =
    options.moderatorEveryRounds ??
    setup.moderatorEveryRounds ??
    SCENARIO_MODERATOR_INTERVAL_DEFAULT
  const moderatorOriginRound = options.moderatorOriginRound ?? startRound

  const characters = getCharacters(setup.participants)
  const moderator = getModerator(setup.participants)
  const userModerator = isUserModerator(setup)

  const roundsCount = Math.max(
    1,
    clampScenarioRounds(options.rounds ?? setup.rounds),
  )
  const withOpening = options.withOpening ?? initialMessages.length === 0

  const messages: ScenarioMessage[] = [...initialMessages]
  let cancelled = false

  // 预估总发言数（用于进度）：与实际循环保持一致，避免总数虚高
  let interjections = 0
  if (!userModerator && moderator && moderatorEveryRounds > 0) {
    for (let r = startRound; r < startRound + roundsCount; r++) {
      if (r === options.suppressModeratorInterjectionRound) continue
      if ((r - moderatorOriginRound) % moderatorEveryRounds !== 0) continue
      if (r === startRound && withOpening) continue
      interjections += 1
    }
  }
  const total =
    (withOpening ? 1 : 0) +
    roundsCount * characters.length +
    interjections +
    (withClosing && !userModerator && moderator ? 1 : 0)
  let done = 0
  const bump = () => {
    done += 1
    options.onProgress?.(done, total)
  }

  const emit = (message: ScenarioMessage) => {
    messages.push(message)
    options.onMessage?.(message)
  }

  const generateModeratorSpeech = async (
    speaker: ScenarioParticipant,
    round: number,
    userPrompt: string,
  ): Promise<void> => {
    options.onMessageStart?.({
      kind: "moderator",
      speakerId: speaker.id,
      speakerName: speaker.name,
      round,
    })
    const result = await streamOnce(
      llmConfig,
      [
        { role: "system", content: buildModeratorSystemPrompt(setup) },
        { role: "user", content: userPrompt },
      ],
      signal,
      options.onToken,
    )
    emit(
      makeMessage({
        kind: "moderator",
        speakerId: speaker.id,
        speakerName: speaker.name,
        round,
        content: result.text,
        reasoning: result.reasoning || undefined,
      }),
    )
    bump()
  }

  // 1. 开场
  if (withOpening) {
    if (userModerator) {
      const opening = setup.rules.directive || "（作者发起了一场舞台情景）"
      options.onMessageStart?.({
        kind: "moderator",
        speakerId: SCENARIO_MODERATOR_USER_ID,
        speakerName: SCENARIO_MODERATOR_USER_NAME,
        round: 0,
      })
      emit(
        makeMessage({
          kind: "moderator",
          speakerId: SCENARIO_MODERATOR_USER_ID,
          speakerName: SCENARIO_MODERATOR_USER_NAME,
          round: 0,
          content: opening,
        }),
      )
      bump()
    } else if (moderator) {
      await generateModeratorSpeech(
        moderator,
        0,
        buildModeratorOpeningPrompt(setup, worldRules),
      )
    }
  }

  // 2. 逐轮发言
  for (let r = startRound; r < startRound + roundsCount; r++) {
    if (signal?.aborted) {
      cancelled = true
      break
    }

    // 主持人串场（非用户主持，且达到间隔）
    if (
      !userModerator &&
      moderator &&
      moderatorEveryRounds > 0 &&
      r !== options.suppressModeratorInterjectionRound &&
      (r - moderatorOriginRound) % moderatorEveryRounds === 0 &&
      // 首轮串场已由开场覆盖，避免重复
      !(r === startRound && withOpening)
    ) {
      await generateModeratorSpeech(
        moderator,
        r,
        buildModeratorInterjectionPrompt(
          setup,
          formatTranscript(messages),
          r,
          worldRules,
        ),
      )
    }

    // 轮转起始发言者，避免总是同一角色先开口
    const offset = (r - startRound) % Math.max(1, characters.length)
    const ordered = [
      ...characters.slice(offset),
      ...characters.slice(0, offset),
    ]

    for (const character of ordered) {
      if (signal?.aborted) {
        cancelled = true
        break
      }
      options.onMessageStart?.({
        kind: "character",
        speakerId: character.id,
        speakerName: character.name,
        round: r,
      })
      const result = await streamOnce(
        llmConfig,
        [
          {
            role: "system",
            content: buildCharacterSystemPrompt(setup, character),
          },
          {
            role: "user",
            content: buildCharacterTurnPrompt(
              setup,
              character,
              formatTranscript(messages),
              r,
              worldRules,
            ),
          },
        ],
        signal,
        options.onToken,
      )
      emit(
        makeMessage({
          kind: "character",
          speakerId: character.id,
          speakerName: character.name,
          round: r,
          content: result.text,
          reasoning: result.reasoning || undefined,
        }),
      )
      bump()
    }
  }

  // 3. 收束
  if (
    withClosing &&
    !cancelled &&
    !userModerator &&
    moderator &&
    !signal?.aborted
  ) {
    await generateModeratorSpeech(
      moderator,
      0,
      buildModeratorClosingPrompt(
        setup,
        formatTranscript(messages, 60),
        worldRules,
      ),
    )
  }

  return { messages, cancelled }
}

// ── 用户插话后继续 ──

export interface ContinueScenarioOptions {
  session: ScenarioSession
  llmConfig: LlmConfig
  /** 用户（主持人）输入的内容。 */
  userInput: string
  signal?: AbortSignal
  worldRules?: string
  /** 插话后追加多少轮角色发言（默认 1）。 */
  rounds?: number
  /** 是否让主持人（角色担任时）先回应一句（默认 false）。 */
  moderatorResponds?: boolean
  onMessageStart?: RunScenarioOptions["onMessageStart"]
  onToken?: RunScenarioOptions["onToken"]
  onMessage?: RunScenarioOptions["onMessage"]
  onProgress?: RunScenarioOptions["onProgress"]
}

/**
 * 用户在舞台上插话后，继续生成后续对话。
 * 会先把用户输入记录为一条 user 消息，再追加若干轮角色发言（并由主持人串场/回应）。
 */
export async function continueScenario(
  options: ContinueScenarioOptions,
): Promise<ScenarioRunResult> {
  const {
    session,
    llmConfig,
    userInput,
    signal,
    worldRules,
    rounds = 1,
    moderatorResponds = false,
  } = options

  const setup = session.setup
  const moderator = getModerator(setup.participants)
  const userModerator = isUserModerator(setup)

  const messages: ScenarioMessage[] = [...session.messages]

  // 记录用户插话
  const lastRound = lastSpokenRound(messages)
  const userMsg = makeMessage({
    kind: "user",
    speakerId: "user",
    speakerName: "作者",
    round: lastRound + 1,
    content: userInput,
  })
  messages.push(userMsg)
  options.onMessage?.(userMsg)

  // 由角色担任主持人时，可让其先回应一句
  const moderatorRepliesToUser =
    moderatorResponds && moderator !== null && !userModerator
  if (moderatorRepliesToUser && moderator) {
    options.onMessageStart?.({
      kind: "moderator",
      speakerId: moderator.id,
      speakerName: moderator.name,
      round: userMsg.round,
    })
    const result = await streamOnce(
      llmConfig,
      [
        { role: "system", content: buildModeratorSystemPrompt(setup) },
        {
          role: "user",
          content: buildModeratorInterjectionPrompt(
            setup,
            formatTranscript(messages),
            userMsg.round,
            worldRules,
          ),
        },
      ],
      signal,
      options.onToken,
    )
    const msg = makeMessage({
      kind: "moderator",
      speakerId: moderator.id,
      speakerName: moderator.name,
      round: userMsg.round,
      content: result.text,
      reasoning: result.reasoning || undefined,
    })
    messages.push(msg)
    options.onMessage?.(msg)
  }

  const startRound = userMsg.round
  const result = await runScenario({
    setup,
    llmConfig,
    signal,
    worldRules,
    initialMessages: messages,
    startRound,
    rounds,
    withOpening: false,
    withClosing: false,
    // 插话不该把「每 N 轮串场」这条设置关掉：情景的轮次编号自 1 起一直延续，
    // 所以续跑沿用设置里的间隔，并把起算点钉在 1，让节奏跨段接着走。
    moderatorEveryRounds:
      setup.moderatorEveryRounds ?? SCENARIO_MODERATOR_INTERVAL_DEFAULT,
    moderatorOriginRound: 1,
    // 主持人才刚回应过这条插话，同一轮别再串一次
    suppressModeratorInterjectionRound: moderatorRepliesToUser
      ? userMsg.round
      : undefined,
    onMessageStart: options.onMessageStart,
    onToken: options.onToken,
    onMessage: options.onMessage,
    onProgress: options.onProgress,
  })

  return { messages: result.messages, cancelled: result.cancelled }
}

// ── 会话对象构建 ──

/** 由设置与消息构建一个完整的 ScenarioSession。 */
export function buildScenarioSession(
  setup: ScenarioSetup,
  messages: ScenarioMessage[],
  status: ScenarioSession["status"] = "completed",
): ScenarioSession {
  const now = new Date().toISOString()
  return {
    id: setup.id,
    title: setup.title,
    setup,
    messages,
    status,
    createdAt: setup.createdAt,
    updatedAt: now,
  }
}
