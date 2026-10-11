/**
 * 「舞台情景」角色候选选择器
 *
 * 职责：从全维度提取结果（ExtractionResult）中整理出可上台的角色候选清单，
 * 并读取每个角色在「灵魂」功能中绑定的光环（aura）信息，供用户在
 * 「角色选择」下拉框中挑选 3~5 人上台。
 *
 * 设计说明：
 * - 角色来源为既有 story-extractor 的提取产物（章节摄入 + 灵魂绑定匹配）；
 * - 灵魂（光环）绑定已由 story-extractor 按角色名/别名双向匹配，本模块只做
 *   归一化与展示字段的补齐，不重复实现匹配逻辑；
 * - 若调用方另行提供 bindings（例如直接来自 getCharacterAuraBindings），
 *   会作为兜底对未匹配到光环的角色进行补充匹配。
 */

import type { CharacterAura } from "@/lib/novel/character-aura"
import type { CharacterAuraBinding } from "@/lib/novel/character-aura"
import type { ExtractionResult } from "./types"
import type {
  ScenarioCandidate,
  ScenarioParticipant,
} from "./scenario-types"
import {
  extractPersonalityKeywords,
  extractSpeakingStyle,
} from "./agent-profile-builder"

export interface BuildScenarioCandidatesOptions {
  /**
   * 额外的灵魂绑定关系（兜底）。当提取产物中的角色未携带光环时，
   * 会尝试按角色名/别名在此列表中匹配。
   */
  bindings?: CharacterAuraBinding[]
  /** 可用的光环全集（兜底匹配时用于按 auraId 反查）。 */
  auras?: CharacterAura[]
}

/**
 * 判断角色名是否命中某条绑定（按角色名或别名双向匹配）。
 */
function matchesBinding(
  candidateName: string,
  candidateAliases: string[],
  binding: CharacterAuraBinding,
): boolean {
  if (binding.characterName === candidateName) return true
  if (candidateAliases.includes(binding.characterName)) return true
  if (binding.aliases && binding.aliases.includes(candidateName)) return true
  return false
}

/**
 * 从提取结果构建候选角色清单（保持提取顺序）。
 */
export function buildScenarioCandidates(
  extraction: ExtractionResult,
  options: BuildScenarioCandidatesOptions = {},
): ScenarioCandidate[] {
  const { bindings = [], auras = [] } = options

  return extraction.characters.map((character) => {
    let aura: CharacterAura | null = character.aura ?? null

    // 兜底：提取产物未携带光环时，尝试用外部绑定关系补匹配
    if (!aura && bindings.length > 0) {
      const aliases: string[] = []
      const binding = bindings.find((b) =>
        matchesBinding(character.name, aliases, b),
      )
      if (binding) {
        aura = auras.find((a) => a.id === binding.auraId) ?? null
      }
    }

    // soul 在提取产物中通常为空，此处以档案兜底，保证性格/风格提取仍有输入
    const soulText = character.soul || character.profile || ""

    return {
      id: character.id,
      name: character.name,
      profile: character.profile,
      auraId: aura?.id ?? null,
      auraName: aura?.name ?? null,
      speakingStyle: extractSpeakingStyle(aura, soulText),
      personality: extractPersonalityKeywords(soulText, aura),
      knowledgeScope: character.cognition?.knows ?? [],
      doesNotKnow: character.cognition?.doesNotKnow ?? [],
    }
  })
}

/**
 * 将候选角色转换为舞台参与者。
 * @param candidate 候选角色
 * @param isModerator 是否担任主持人
 */
export function candidateToParticipant(
  candidate: ScenarioCandidate,
  isModerator = false,
): ScenarioParticipant {
  return {
    id: candidate.id,
    name: candidate.name,
    isModerator,
    auraId: candidate.auraId,
    auraName: candidate.auraName,
    profile: candidate.profile,
    personality: candidate.personality,
    speakingStyle: candidate.speakingStyle,
    knowledgeScope: candidate.knowledgeScope,
    doesNotKnow: candidate.doesNotKnow,
  }
}

/**
 * 根据选中的角色 id 列表与主持人 id 组装参与者数组。
 *
 * 规则：
 * - moderatorId 命中选中角色 → 该角色标记为 isModerator；
 * - moderatorId 非空但未命中 → 回退为第一位选中的角色；
 * - moderatorId 为 null/空 → **不指派任何角色为主持人**（表示由用户担任主持人，
 *   由调用方自行补充主持人占位参与者）；
 * - 保序，去重。
 *
 * @returns { participants, moderatorId } —— moderatorId 为最终确定的主持人角色 id（无则 null）
 */
export function assembleParticipants(
  candidates: ScenarioCandidate[],
  selectedIds: string[],
  moderatorId: string | null,
): { participants: ScenarioParticipant[]; moderatorId: string | null } {
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const selected: ScenarioCandidate[] = []
  for (const id of selectedIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const c = byId.get(id)
    if (c) selected.push(c)
  }

  if (selected.length === 0) {
    return { participants: [], moderatorId: null }
  }

  // 仅在显式指定了主持人时指派；null/空 表示由用户担任主持人。
  let finalModeratorId: string | null = moderatorId || null
  if (finalModeratorId && !seen.has(finalModeratorId)) {
    finalModeratorId = selected[0].id
  }

  const participants = selected.map((c) =>
    candidateToParticipant(c, finalModeratorId !== null && c.id === finalModeratorId),
  )

  return { participants, moderatorId: finalModeratorId }
}
