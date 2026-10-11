import { describe, expect, it } from "vitest"
import type { CharacterAura, CharacterAuraBinding } from "@/lib/novel/character-aura"
import type { ExtractionResult, ExtractedCharacter } from "./types"
import {
  assembleParticipants,
  buildScenarioCandidates,
  candidateToParticipant,
} from "./scenario-participant-selector"
import type { ScenarioCandidate } from "./scenario-types"

function makeAura(id: string, name: string): CharacterAura {
  return {
    id,
    builtIn: false,
    name,
    sourceNote: "",
    corpus: "",
    styleDescription: "言辞犀利，善用反问",
    behaviorRules: "遇事先质疑对方的逻辑漏洞",
    boundaries: "不做人身攻击",
    notes: "",
    expressionDna: "短句 + 反问",
  }
}

function makeCharacter(
  overrides: Partial<ExtractedCharacter> = {},
): ExtractedCharacter {
  return {
    id: "张三",
    name: "张三",
    profile: "江湖游侠，性烈如火",
    aura: null,
    cognition: { knows: ["曾败于李四"], doesNotKnow: ["李四的身世"] },
    soul: "",
    skillContent: "",
    ...overrides,
  }
}

function makeExtraction(characters: ExtractedCharacter[]): ExtractionResult {
  return {
    characters,
    chapterContents: [],
    memoryData: {
      characterStates: "",
      characterCognition: null,
      foreshadowingTracker: null,
      timeline: [],
      canonFacts: "",
      conflicts: "",
    },
    worldRules: "",
    powerSystem: "",
    foreshadowing: null,
    timeline: [],
    outlineContent: "",
    soulDoc: "",
  }
}

describe("buildScenarioCandidates", () => {
  it("保持提取顺序并映射角色基础信息", () => {
    const extraction = makeExtraction([
      makeCharacter({ id: "张三", name: "张三" }),
      makeCharacter({ id: "李四", name: "李四", profile: "书生，温润如玉" }),
    ])
    const candidates = buildScenarioCandidates(extraction)
    expect(candidates.map((c) => c.name)).toEqual(["张三", "李四"])
    expect(candidates[1].profile).toBe("书生，温润如玉")
    expect(candidates[0].doesNotKnow).toEqual(["李四的身世"])
  })

  it("读取角色已绑定的灵魂（光环）信息", () => {
    const aura = makeAura("aura-1", "诸葛亮")
    const extraction = makeExtraction([
      makeCharacter({ aura, name: "诸葛亮" }),
    ])
    const [candidate] = buildScenarioCandidates(extraction)
    expect(candidate.auraId).toBe("aura-1")
    expect(candidate.auraName).toBe("诸葛亮")
    expect(candidate.speakingStyle).toContain("反问")
  })

  it("角色未携带光环时用外部绑定兜底匹配", () => {
    const aura = makeAura("aura-2", "苏格拉底")
    const bindings: CharacterAuraBinding[] = [
      { characterName: "主角", auraId: "aura-2", aliases: ["阿明"] },
    ]
    const extraction = makeExtraction([
      makeCharacter({ id: "主角", name: "主角", profile: "爱思考的年轻人" }),
    ])
    const [candidate] = buildScenarioCandidates(extraction, {
      bindings,
      auras: [aura],
    })
    expect(candidate.auraId).toBe("aura-2")
    expect(candidate.auraName).toBe("苏格拉底")
  })

  it("无绑定关系时灵魂字段为空且不抛错", () => {
    const extraction = makeExtraction([makeCharacter()])
    const [candidate] = buildScenarioCandidates(extraction, {
      bindings: [],
      auras: [],
    })
    expect(candidate.auraId).toBeNull()
    expect(candidate.auraName).toBeNull()
  })
})

describe("candidateToParticipant", () => {
  it("标记主持人身份并透传灵魂与风格字段", () => {
    const candidate: ScenarioCandidate = {
      id: "李四",
      name: "李四",
      profile: "书生",
      auraId: "aura-1",
      auraName: "诸葛亮",
      speakingStyle: "沉稳",
      personality: ["谨慎"],
      knowledgeScope: ["朝局"],
      doesNotKnow: ["敌军部署"],
    }
    const participant = candidateToParticipant(candidate, true)
    expect(participant.isModerator).toBe(true)
    expect(participant.auraName).toBe("诸葛亮")
    expect(participant.personality).toEqual(["谨慎"])
  })
})

describe("assembleParticipants", () => {
  const candidates: ScenarioCandidate[] = [
    {
      id: "A",
      name: "A",
      profile: "",
      auraId: null,
      auraName: null,
      speakingStyle: "",
      personality: [],
      knowledgeScope: [],
      doesNotKnow: [],
    },
    {
      id: "B",
      name: "B",
      profile: "",
      auraId: null,
      auraName: null,
      speakingStyle: "",
      personality: [],
      knowledgeScope: [],
      doesNotKnow: [],
    },
    {
      id: "C",
      name: "C",
      profile: "",
      auraId: null,
      auraName: null,
      speakingStyle: "",
      personality: [],
      knowledgeScope: [],
      doesNotKnow: [],
    },
  ]

  it("命中选中角色时将其设为主持人", () => {
    const { participants, moderatorId } = assembleParticipants(
      candidates,
      ["A", "B", "C"],
      "B",
    )
    expect(moderatorId).toBe("B")
    expect(participants.find((p) => p.isModerator)?.id).toBe("B")
  })

  it("主持人未命中时默认第一位选中的角色", () => {
    const { moderatorId } = assembleParticipants(candidates, ["B", "C"], "Z")
    expect(moderatorId).toBe("B")
  })

  it("moderatorId 为 null 时不指派主持人（由用户担任）", () => {
    const { participants, moderatorId } = assembleParticipants(
      candidates,
      ["A", "B", "C"],
      null,
    )
    expect(moderatorId).toBeNull()
    expect(participants.every((p) => !p.isModerator)).toBe(true)
    expect(participants).toHaveLength(3)
  })

  it("去重并保序", () => {
    const { participants } = assembleParticipants(
      candidates,
      ["A", "A", "B", "B", "C"],
      "A",
    )
    expect(participants.map((p) => p.id)).toEqual(["A", "B", "C"])
  })

  it("空选择返回空参与者", () => {
    const { participants, moderatorId } = assembleParticipants(candidates, [], null)
    expect(participants).toEqual([])
    expect(moderatorId).toBeNull()
  })
})
