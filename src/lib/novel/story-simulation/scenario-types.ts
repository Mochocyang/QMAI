/**
 * 「舞台情景」数据模型
 *
 * 舞台情景是一种辅助写对话的功能：当作者写到某一章、不确定剧情里的人物
 * 该如何对话时，可以搭起一个「舞台」——由一名主持人开场与串场，挑选数名
 * 已有角色同台，围绕一条情景规则（主持人要求）轮流发言、有来有回，生成可供
 * 直接借鉴的对白。
 *
 * 与既有「剧情推演室」的定位差异：
 * - 剧情推演室：面向剧情走向的多智能体推演（各做各的行为，间接互动）。
 * - 舞台情景：面向「对白生成」的同场多方轮流发言（直接一来一回）。
 *
 * 本文件只定义类型与常量，不含任何副作用。
 */

// ── 对话形式 ──

/**
 * 舞台对话的形式。决定引擎注入到提示词中的发言倾向。
 * - debate：辩论，参与者分持不同立场交锋。
 * - dialogue：一般对话，如男女之间、长辈与晚辈之间的往来交流。
 * - free：自由讨论，参与者围绕话题自然交谈。
 */
export type ScenarioFormat = "debate" | "dialogue" | "free"

export const SCENARIO_FORMAT_INFO: Record<
  ScenarioFormat,
  { name: string; shortDesc: string; behaviorHint: string; icon: string }
> = {
  debate: {
    name: "辩论",
    shortDesc: "分持立场的正反交锋，有来有回、互相诘问",
    behaviorHint:
      "这是一场辩论。你要鲜明地持有自己的立场，针对上一位发言者的观点进行回应、质疑或反驳，力求以理服人；同时要遵守主持人设定的规则。避免与对方的发言重复，要有交锋感。",
    icon: "⚔️",
  },
  dialogue: {
    name: "对话",
    shortDesc: "日常往来交谈，如情感、叙旧、试探等",
    behaviorHint:
      "这是一场对话。你要像真实人物一样自然地一来一回交流，回应上一位发言者的话语，注意语气、情绪与潜台词的流转，不必刻意争论，但要表现出你的性格与态度。",
    icon: "💬",
  },
  free: {
    name: "自由讨论",
    shortDesc: "围绕话题自然交谈，观点互相补充或碰撞",
    behaviorHint:
      "这是一场自由讨论。围绕主持人给出的话题，结合上一位发言者的内容表达你的看法，既可以补充、认同，也可以提出不同意见，保持自然的交谈感。",
    icon: "🗣️",
  },
}

// ── 角色数量约束 ──
//
// 「角色数量」= 上台的总人数，**包含**由角色担任的那名主持人。
// 主持人由用户本人担任时，上台的就是清一色的发言角色。
//
// 之所以写成「含主持人」而不是「不含」：面板上的选中数就是上台人数，
// 与用户说的「3 个、4 个、5 个角色」是同一个口径；若按「不含」实现，
// 「选 3 人 + 指定其中一人主持」会只剩 2 名发言角色，还得再点一次补人。

export const SCENARIO_CHARACTER_MIN = 3
export const SCENARIO_CHARACTER_MAX = 10
export const SCENARIO_CHARACTER_DEFAULT = 3

/** 一键按钮的预设人数；区间之外的数量走自定义输入。 */
export const SCENARIO_CHARACTER_PRESETS = [3, 4, 5] as const

export const SCENARIO_ROUND_PRESETS = [10, 20, 30, 50] as const
export const SCENARIO_ROUND_DEFAULT = 20
export const SCENARIO_ROUND_MIN = 1
export const SCENARIO_ROUND_MAX = 100

/** 提取来源章节数的可选值。 */
export const SCENARIO_SOURCE_CHAPTER_PRESETS = [5, 10, 20, 30, 50] as const

/** 角色担任主持人时的串场间隔（每 N 轮）。0 表示不串场。 */
export const SCENARIO_MODERATOR_INTERVAL_OPTIONS = [3, 5, 10, 0] as const
export const SCENARIO_MODERATOR_INTERVAL_DEFAULT = 5

/** 预估发言条数超过该阈值时，界面提示用户二次确认（成本护栏）。 */
export const SCENARIO_COST_WARN_THRESHOLD = 40

/** 主持人默认由「用户」担任时的占位 id / 名称。 */
export const SCENARIO_MODERATOR_USER_ID = "__user__"
export const SCENARIO_MODERATOR_USER_NAME = "主持人（你）"

// ── 情景规则 ──

export interface ScenarioRules {
  /**
   * 主持人的核心要求，即用户希望在舞台上发生什么。
   * 例：「生成一场关于《中庸》这本书的辩论」。
   */
  directive: string
  /** 情景设定/背景的自由文本（如「在房间内，成婚当夜」）。 */
  scene?: string
  /** 地点（可选，与 scene 互补）。 */
  location?: string
  /** 时间（可选）。 */
  time?: string
  /**
   * 参考点（可选）。用户可指定对话需参考的资料/书籍/设定，
   * 例如「《中庸》」。引擎会要求所有角色以之为依据展开内容。
   */
  reference?: string
}

// ── 参与者 ──

export interface ScenarioParticipant {
  /** 角色 id（当前系统内即角色名）。 */
  id: string
  /** 角色名。 */
  name: string
  /** 是否担任主持人。 */
  isModerator: boolean
  /** 绑定的灵魂（光环）id；未绑定时为 null。 */
  auraId?: string | null
  /** 绑定的灵魂名称（展示用）。 */
  auraName?: string | null
  /** 角色档案。 */
  profile?: string
  /** 性格关键词。 */
  personality?: string[]
  /** 说话风格。 */
  speakingStyle?: string
  /** 认知范围（知道的信息），用于保持角色视角。 */
  knowledgeScope?: string[]
  /** 明确不知道的信息（禁止提及）。 */
  doesNotKnow?: string[]
}

// ── 发言 ──

export type ScenarioSpeakerKind = "moderator" | "character" | "user" | "system"

export interface ScenarioMessage {
  id: string
  kind: ScenarioSpeakerKind
  /** 发言者 id（角色 id / 主持人 id / "user"）。 */
  speakerId: string
  /** 发言者展示名。 */
  speakerName: string
  /** 第几轮（从 1 开始）；主持人的开场白记为第 0 轮。 */
  round: number
  /** 发言正文。 */
  content: string
  /** 生成该发言时的模型思考（可选）。 */
  reasoning?: string
  timestamp: string
}

/**
 * 舞台情景「正在流式生成的那一条发言」的状态。
 * 供房间视图实时展示，与 store / 引擎回调共用同一类型。
 */
export interface ScenarioStreamingState {
  kind: ScenarioSpeakerKind
  /**
   * 发言者 id（新增，可选）。
   *
   * 引擎的 onMessageStart 本来就带 speakerId，只是此前没往这里存，
   * 导致流式气泡拿不到「是哪个角色」，没法给它上头像与专属配色。
   *
   * 之所以可选而不是必填：这是给既有类型加字段，做成必填会让所有构造点
   * （含测试与任何第三方调用方）一起改红。唯一的构造点
   * story-simulation-view.tsx 已经真的写入了它。
   * 消费方（房间视图）在它缺席或为空时用 speakerName 兜底取配色。
   * 注意这个状态不入库：store 与 scenario-store 都不序列化它。
   */
  speakerId?: string
  speakerName: string
  content: string
}

// ── 会议设置 / 会话 ──

export interface ScenarioSetup {
  id: string
  title: string
  /** 情景规则。 */
  rules: ScenarioRules
  /** 对话形式。 */
  format: ScenarioFormat
  /** 计划生成轮数。 */
  rounds: number
  /** 主持人 + 参与角色（共 SCENARIO_CHARACTER_MIN~MAX 人）。 */
  participants: ScenarioParticipant[]
  /** 角色担任主持人时的串场间隔（每 N 轮）；0=不串场。 */
  moderatorEveryRounds?: number
  /** 提取来源章节数。 */
  sourceChapters: number
  createdAt: string
}

export interface ScenarioSession {
  id: string
  title: string
  setup: ScenarioSetup
  messages: ScenarioMessage[]
  status: "running" | "completed" | "cancelled"
  createdAt: string
  updatedAt: string
}

// ── 候选角色（供下拉选择） ──

export interface ScenarioCandidate {
  id: string
  name: string
  profile: string
  /** 绑定的灵魂（光环）id。 */
  auraId: string | null
  /** 绑定的灵魂名称。 */
  auraName: string | null
  /** 说话风格（来自灵魂，便于选择时预览）。 */
  speakingStyle: string
  /** 性格关键词。 */
  personality: string[]
  knowledgeScope: string[]
  doesNotKnow: string[]
}

// ── 工具函数 ──

/** 归一化轮数到合法区间。 */
export function clampScenarioRounds(rounds: number): number {
  if (!Number.isFinite(rounds)) return SCENARIO_ROUND_DEFAULT
  const int = Math.round(rounds)
  return Math.max(SCENARIO_ROUND_MIN, Math.min(SCENARIO_ROUND_MAX, int))
}

/**
 * 归一化上台人数到合法区间（自定义输入用）。
 *
 * 非有限值的处理刻意与紧邻的 clampScenarioRounds 不同：那里一律回退默认，
 * 这里把 +Infinity 视为「超出上限」夹到上限。因为输入来自用户在数字框里
 * 键入的内容，`Number("1e999")` 会得到 Infinity，而用户的本意显然是「要很多」，
 * 夹到上限比悄悄退回默认更贴近他的意图。NaN（空框或乱输）才回退默认。
 */
export function clampScenarioCharacterCount(count: number): number {
  if (!Number.isFinite(count)) {
    return count === Number.POSITIVE_INFINITY
      ? SCENARIO_CHARACTER_MAX
      : SCENARIO_CHARACTER_DEFAULT
  }
  const int = Math.round(count)
  return Math.max(SCENARIO_CHARACTER_MIN, Math.min(SCENARIO_CHARACTER_MAX, int))
}

/**
 * 已有对话里真正进行到第几轮（无发言时为 0）。
 *
 * 不能直接取最后一条消息的 round：主持人的开场与收束都记在第 0 轮，角色主持
 * 的情景跑完后最后一条正是那段收束，会把进度读成 0。取最大值即可，第 0 轮
 * 自然被忽略。
 */
export function lastSpokenRound(messages: ScenarioMessage[]): number {
  let last = 0
  for (const message of messages) {
    if (message.round > last) last = message.round
  }
  return last
}

/**
 * 按计划轮数算出还剩几轮没跑（用于「继续生成」）。
 *
 * 下限钳到 0：中止后重新分析或改过计划轮数时，已发生的轮次可能已经超过当前
 * 计划值，不能返回负数让调用方去反推。
 */
export function remainingScenarioRounds(
  setup: ScenarioSetup,
  messages: ScenarioMessage[],
): number {
  const planned = clampScenarioRounds(setup.rounds)
  return Math.max(0, planned - lastSpokenRound(messages))
}

/** 拆分主持人（如有）与普通角色。 */
export function splitParticipants(participants: ScenarioParticipant[]): {
  moderator: ScenarioParticipant | null
  characters: ScenarioParticipant[]
} {
  const moderator = participants.find((p) => p.isModerator) ?? null
  const characters = participants.filter((p) => !p.isModerator)
  return { moderator, characters }
}

/** 主持人是否由某个角色担任（false = 由用户本人担任）。 */
export function hasRoleModerator(
  participants: ScenarioParticipant[],
): boolean {
  return participants.some(
    (p) => p.isModerator && p.id !== SCENARIO_MODERATOR_USER_ID,
  )
}

/**
 * 预估一次舞台情景会产生的发言条数（用于成本护栏与提示）。
 *
 * 口径与 `scenario-engine.runScenario` 的首轮（startRound=1、含开场）一致：
 * 开场 1 条 + 每轮每位角色 1 条 + 主持人串场（跳过首轮，由开场覆盖）+
 * 收束 1 条（仅角色担任主持人时）。
 */
export function estimateScenarioMessages(
  participants: ScenarioParticipant[],
  rounds: number,
  moderatorEveryRounds: number = SCENARIO_MODERATOR_INTERVAL_DEFAULT,
): number {
  const characters = participants.filter((p) => !p.isModerator).length
  const roleModerator = hasRoleModerator(participants)
  const safeRounds = Math.max(1, Math.round(rounds) || 0)

  let interjections = 0
  if (roleModerator && moderatorEveryRounds > 0) {
    for (let r = 1; r <= safeRounds; r++) {
      if ((r - 1) % moderatorEveryRounds !== 0) continue
      if (r === 1) continue // 首轮串场由开场覆盖
      interjections += 1
    }
  }

  return 1 + safeRounds * characters + interjections + (roleModerator ? 1 : 0)
}
