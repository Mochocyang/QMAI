import type { CharacterAura } from "@/lib/novel/character-aura"
import type {
  AgentMemory,
  AgentRelation,
  ExtractionResult,
  ExtractedCharacter,
  NovelAgent,
  RumorEvent,
  StoryFramework,
  StoryNode,
  TimelineEvent,
} from "@/lib/novel/story-simulation/types"

/**
 * 从故事框架中推断某个角色当前的目标。
 *
 * 策略：找到第一个涉及该角色的节点，返回该节点的 goal；
 * 如果没有涉及该角色的节点，使用框架前提作为兜底目标。
 */
function inferGoalFromFramework(
  framework: StoryFramework,
  characterName: string,
): string {
  const node = framework.nodes.find((n) =>
    n.involvedCharacters.includes(characterName),
  )
  if (node) {
    return node.goal
  }
  return framework.premise || "待定"
}

/**
 * 从角色 soul 和 aura 中提取性格关键词。
 * 简单策略：取 soul 文本的前若干关键词 + aura 中相关字段的关键短语。
 */
function extractPersonalityKeywords(
  soul: string,
  aura: CharacterAura | null,
): string[] {
  const keywords: string[] = []

  // 从 soul 中提取简短关键词（按标点分割，取短句）
  if (soul) {
    const parts = soul
      .split(/[。；，、\n,;.]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 12)
    for (const part of parts.slice(0, 5)) {
      if (!keywords.includes(part)) {
        keywords.push(part)
      }
    }
  }

  // 从 aura 关键字段提取
  if (aura) {
    const fields = [aura.styleDescription, aura.behaviorRules, aura.mentalModel]
    for (const field of fields) {
      if (!field) continue
      const parts = field
        .split(/[。；，、\n,;.]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 10)
      for (const part of parts.slice(0, 2)) {
        if (!keywords.includes(part)) {
          keywords.push(part)
        }
      }
    }
  }

  return keywords.slice(0, 8)
}

/**
 * 从 aura 的表达 DNA 和风格描述中提取说话风格。
 */
function extractSpeakingStyle(aura: CharacterAura | null, soul: string): string {
  const parts: string[] = []
  if (aura?.expressionDna) {
    parts.push(aura.expressionDna.trim())
  }
  if (aura?.styleDescription) {
    parts.push(aura.styleDescription.trim())
  }
  if (parts.length === 0 && soul) {
    // 兜底：取 soul 的前 100 字作为风格参考
    parts.push(soul.slice(0, 100))
  }
  return parts.join("；").slice(0, 300)
}

/**
 * 初始化 Agent 记忆。
 */
function initMemory(
  allCharacterIds: string[],
  initialSentiments?: Map<string, number>,
): AgentMemory {
  const sentiments = new Map<string, number>()
  for (const id of allCharacterIds) {
    sentiments.set(id, initialSentiments?.get(id) ?? 0)
  }
  return {
    observedEvents: [],
    knownSecrets: new Set<string>(),
    sentiments,
    recentDecisions: [],
  }
}

/**
 * 根据提取结果与故事框架构建仿真用 Agent 列表。
 *
 * - 从框架节点中收集所有涉及的角色名
 * - 如果框架未指定角色，则使用全部提取到的角色
 * - 为每个角色构建 NovelAgent，初始化目标、情绪、已知事实、关系、记忆、性格、说话风格、认知范围
 */
export function buildAgents(
  extraction: ExtractionResult,
  framework: StoryFramework,
): NovelAgent[] {
  // 收集框架中涉及的角色名（去重，保持顺序）
  const frameworkCharacters: string[] = []
  for (const node of framework.nodes) {
    for (const name of node.involvedCharacters) {
      if (!frameworkCharacters.includes(name)) {
        frameworkCharacters.push(name)
      }
    }
  }

  // 根据框架指定角色筛选，若框架未指定则使用全部提取角色
  const selectedCharacters: ExtractedCharacter[] =
    frameworkCharacters.length > 0
      ? extraction.characters.filter((c) =>
          frameworkCharacters.includes(c.name),
        )
      : extraction.characters

  // 构建所有选中角色的 id 列表，用于初始化关系
  const allCharacterIds = selectedCharacters.map((c) => c.id)

  const agents: NovelAgent[] = selectedCharacters.map((character) => {
    // 已知事实从认知的 knows 初始化（保留兼容）
    const knownFacts = new Set<string>(
      character.cognition?.knows ?? [],
    )

    // 初始化与其他角色的关系（保留兼容）
    const relationships = new Map<string, AgentRelation>()
    for (const otherId of allCharacterIds) {
      if (otherId === character.id) continue
      relationships.set(otherId, {
        targetId: otherId,
        relationType: "neutral",
        sentiment: 0,
      })
    }

    // 知识范围从 cognition.knows 构建
    const knowledgeScope: string[] = [...(character.cognition?.knows ?? [])]

    // 性格关键词
    const personality = extractPersonalityKeywords(character.soul, character.aura)

    // 说话风格
    const speakingStyle = extractSpeakingStyle(character.aura, character.soul)

    // 记忆初始化
    const memory = initMemory(allCharacterIds)

    return {
      characterId: character.id,
      name: character.name,
      profile: character.profile,
      aura: character.aura,
      cognition: character.cognition,
      soul: character.soul,
      currentGoal: inferGoalFromFramework(framework, character.name),
      emotionalState: "neutral",
      knownFacts,
      relationships,
      powerLevel: "",
      memory,
      knowledgeScope,
      personality,
      speakingStyle,
    }
  })

  return agents
}

/**
 * 从 SimulationState 中筛选某个 Agent 可见的时间线事件（最近 N 条）。
 */
export function getVisibleEvents(
  agentId: string,
  timelineEvents: TimelineEvent[],
  limit = 10,
): TimelineEvent[] {
  return timelineEvents
    .filter((e) => e.observableBy.includes(agentId))
    .slice(-limit)
}

/**
 * 格式化时间线事件为简短描述（供上下文拼接使用）。
 */
export function formatTimelineEvent(event: TimelineEvent): string {
  const targetDesc = event.targetName ? ` → ${event.targetName}` : ""
  const visibilityTag =
    event.observableBy.length > 2
      ? "[公开]"
      : event.observableBy.length === 2
        ? "[私聊]"
        : "[内心]"
  return `第${event.round + 1}轮 ${visibilityTag} ${event.actorName}${targetDesc} [${event.actionType}]：${event.content}`
}

function formatRumorEvent(rumor: RumorEvent): string {
  const distortionPercent = Math.round(rumor.distortion * 100)
  return `第${rumor.round + 1}轮 [传闻（可信度低，可能失真）] ${rumor.content}（失真度约${distortionPercent}%）`
}

/**
 * 构建 Agent 决策时的上下文文本。
 *
 * 包含当前场景、Agent 身份（含性格与说话风格）、认知边界、记忆/情感、人际关系、可见时间线事件与世界规则。
 */
export function buildAgentContext(
  agent: NovelAgent,
  node: StoryNode,
  recentEvents: string[],
  worldRules: string,
  visibleTimelineEvents?: TimelineEvent[],
  visibleRumors?: RumorEvent[],
): string {
  const sections: string[] = []

  // ── 当前场景 ──
  sections.push("【当前场景】")
  sections.push(`节点 ${node.index}（${node.phase}）：${node.title}`)
  sections.push(`核心冲突：${node.coreConflict}`)
  sections.push(`本节点目标：${node.goal}`)
  if (node.causeFromPrev) {
    sections.push(`承前原因：${node.causeFromPrev}`)
  }
  if (node.expectedOutcome) {
    sections.push(`预期结果：${node.expectedOutcome}`)
  }
  if (node.involvedCharacters.length > 0) {
    sections.push(`涉及角色：${node.involvedCharacters.join("、")}`)
  }

  // ── Agent 身份 ──
  sections.push("")
  sections.push("【Agent 身份】")
  sections.push(`姓名：${agent.name}`)
  if (agent.profile) {
    sections.push(`档案：${agent.profile}`)
  }
  if (agent.soul) {
    sections.push(`灵魂：${agent.soul}`)
  }
  if (agent.personality.length > 0) {
    sections.push(`性格关键词：${agent.personality.join("、")}`)
  }
  if (agent.speakingStyle) {
    sections.push(`说话风格：${agent.speakingStyle}`)
  }

  // 光环各字段（以实际源码为准，不存在的字段跳过）
  if (agent.aura) {
    const aura = agent.aura as CharacterAura
    sections.push("")
    sections.push("【角色光环】")
    appendAuraField(sections, "风格描述", aura.styleDescription)
    appendAuraField(sections, "行为规则", aura.behaviorRules)
    appendAuraField(sections, "边界", aura.boundaries)
    appendAuraField(sections, "表达 DNA", aura.expressionDna)
    appendAuraField(sections, "心智模型", aura.mentalModel)
    appendAuraField(sections, "决策启发式", aura.decisionHeuristics)
    appendAuraField(sections, "价值反模式", aura.valueAntiPatterns)
    appendAuraField(sections, "诚实边界", aura.honestyBoundaries)
    appendAuraField(sections, "备注", aura.notes)
  }

  // ── 认知边界 ──
  sections.push("")
  sections.push("【认知边界】")
  if (agent.knowledgeScope.length > 0) {
    sections.push(`你知道的信息：${agent.knowledgeScope.join("；")}`)
  }
  if (agent.cognition?.doesNotKnow && agent.cognition.doesNotKnow.length > 0) {
    sections.push(`你不知道的信息：${agent.cognition.doesNotKnow.join("；")}`)
  }
  sections.push("【重要提醒】你只能基于你知道的信息行动，你不知道的事情绝对不能使用，绝不能表现出全知视角。")

  // ── 当前状态 ──
  sections.push("")
  sections.push("【当前状态】")
  sections.push(`当前目标：${agent.currentGoal}`)
  sections.push(`情绪状态：${agent.emotionalState}`)

  // ── 人际关系与情感（从 memory.sentiments 读取） ──
  if (agent.memory.sentiments.size > 0) {
    sections.push("")
    sections.push("【你对其他角色的情感】")
    for (const [otherId, value] of agent.memory.sentiments.entries()) {
      if (otherId === agent.characterId) continue
      // 尝试找到角色名
      sections.push(`对角色[${otherId}]：好感度 ${value}`)
    }
  }

  // ── 近期事件（旧接口字符串列表，保留兼容） ──
  if (recentEvents.length > 0) {
    sections.push("")
    sections.push("【近期事件】")
    for (const event of recentEvents) {
      sections.push(`- ${event}`)
    }
  }

  // ── 你能观察到的时间线事件（新引擎） ──
  if (visibleTimelineEvents && visibleTimelineEvents.length > 0) {
    sections.push("")
    sections.push("【你观察到的最近事件】")
    for (const ev of visibleTimelineEvents) {
      sections.push(`- ${formatTimelineEvent(ev)}`)
    }
  }

  // ── 你听到的传闻 ──
  if (visibleRumors && visibleRumors.length > 0) {
    sections.push("")
    sections.push("【你听到的传闻】")
    sections.push("注意：传闻（可信度低，可能失真），仅供参考，不要当作事实。")
    for (const rumor of visibleRumors) {
      sections.push(`- ${formatRumorEvent(rumor)}`)
    }
  }

  // ── 世界规则 ──
  if (worldRules) {
    sections.push("")
    sections.push("【世界规则】")
    sections.push(worldRules)
  }

  return sections.join("\n")
}

/**
 * 将光环字段追加到 sections，仅当字段存在且非空时输出。
 */
function appendAuraField(
  sections: string[],
  label: string,
  value: string | undefined,
): void {
  if (value !== undefined && value !== "") {
    sections.push(`${label}：${value}`)
  }
}
