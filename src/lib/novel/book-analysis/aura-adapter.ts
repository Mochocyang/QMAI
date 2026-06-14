import type { CharacterAura, GeneratedCharacterAuraSkillInput } from "@/lib/novel/character-aura"
import { createCustomCharacterAuraFromGeneratedSkill } from "@/lib/novel/character-aura"
import type { BookAnalysisMetadata, CharacterSkill, ExtractedCharacter } from "./types"

export interface ImportedBookAnalysisAura {
  skillId: string
  characterId: string
  characterName: string
  auraId: string
  auraName: string
}

function linesOrFallback(lines: string[], fallback: string): string {
  const normalized = lines.map((line) => line.trim()).filter(Boolean)
  return normalized.length > 0 ? normalized.join("\n") : fallback
}

function relationshipMarkdown(character: ExtractedCharacter): string {
  return linesOrFallback(
    character.relationships.map((rel) => `- ${rel.target}：${rel.relation}${rel.description ? `，${rel.description}` : ""}`),
    "- 暂未提取到稳定关系。",
  )
}

function keyEventsMarkdown(character: ExtractedCharacter): string {
  return linesOrFallback(
    character.keyEvents.map((event) => `- ${event.chapterId}：${event.description}`),
    "- 暂未提取到关键事件。",
  )
}

export function buildGeneratedAuraInputFromBookCharacter(
  character: ExtractedCharacter,
  skill: CharacterSkill,
  metadata: BookAnalysisMetadata,
): GeneratedCharacterAuraSkillInput {
  const chapterRange = skill.chapterRange.length >= 2
    ? `第 ${skill.chapterRange[0]} 章 - 第 ${skill.chapterRange[skill.chapterRange.length - 1]} 章`
    : `第 ${character.firstAppearance} 章 - 第 ${character.lastAppearance} 章`
  const sourceNote = `来自拆书作品《${metadata.title}》的角色分析。该灵魂只作为小说创作参考，不覆盖当前作品的人物小传、阵营、记忆和剧情因果。`
  const relationships = relationshipMarkdown(character)
  const keyEvents = keyEventsMarkdown(character)

  return {
    name: character.name,
    category: "拆书角色",
    sourceBook: metadata.title,
    sourceNote,
    corpus: [
      `来源作品：《${metadata.title}》`,
      `章节范围：${chapterRange}`,
      "",
      "## 角色描述",
      character.description || "暂未提取到角色描述。",
      "",
      "## 原始语料摘要",
      character.corpus || "暂未保存角色语料。",
    ].join("\n"),
    styleDescription: linesOrFallback(
      [character.description, character.personality],
      "暂未提取到稳定角色气质。",
    ),
    behaviorRules: [
      "写作时先读取当前小说人物小传和章节目标，再参考该拆书角色的行为倾向。",
      "只能借用气质、表达倾向、判断方式和关系处理方式，不直接搬运原作剧情。",
      "",
      "## 关系网络",
      relationships,
    ].join("\n"),
    boundaries: "绑定后只增强角色气质，不得覆盖当前小说已有设定、阵营、记忆、剧情任务和世界观规则。",
    notes: `来源章节：${chapterRange}\n重要性：${character.importance}/10\n出现次数：${character.appearanceCount} 次`,
    expressionDna: character.speechStyle || "暂未提取到明确说话方式，写作时保持当前人物小传优先。",
    mentalModel: linesOrFallback(
      [character.personality, character.description],
      "根据当前人物小传和章节目标判断，不额外补写未分析出的心理机制。",
    ),
    decisionHeuristics: [
      "从已提取关键事件中借用决策顺序，不能借用原作事件本身。",
      "",
      keyEvents,
    ].join("\n"),
    valueAntiPatterns: "避免把拆书角色写成万能模板；避免照搬原作台词、剧情桥段、身份背景和关系结论。",
    honestyBoundaries: "只使用拆书分析中已经提取出的性格、语言和行为信息；未分析到的信息必须服从当前小说设定。",
    skillContent: skill.skillContent,
    generationPrompt: `拆书作品《${metadata.title}》角色「${character.name}」生成。`,
    researchFiles: {
      "01-writings.md": [
        `# ${character.name} - 公开资料`,
        "",
        "## 核心结论",
        `- 来源作品：《${metadata.title}》。`,
        `- 章节范围：${chapterRange}。`,
        `- 角色定位：${character.category}，重要性 ${character.importance}/10。`,
        "",
        "## 角色描述",
        character.description || "暂未提取到角色描述。",
        "",
        "## 证据线索",
        character.corpus || "暂未保存角色语料。",
      ].join("\n"),
      "02-conversations.md": [
        `# ${character.name} - 对话方式`,
        "",
        "## 说话节奏",
        character.speechStyle || "暂未提取到明确说话方式。",
        "",
        "## 示例约束",
        "- 写作时借用表达节奏，不照搬原作台词。",
      ].join("\n"),
      "03-expression-dna.md": [
        `# ${character.name} - 表达特征`,
        "",
        "## 表达 DNA",
        character.speechStyle || "暂未提取到表达特征。",
        "",
        "## 性格显影",
        character.personality || "暂未提取到性格特征。",
      ].join("\n"),
      "04-external-views.md": [
        `# ${character.name} - 外部评价`,
        "",
        "## 关系网络",
        relationships,
      ].join("\n"),
      "05-decisions.md": [
        `# ${character.name} - 决策记录`,
        "",
        "## 关键事件",
        keyEvents,
        "",
        "## 决策启发式",
        "写作时参考角色在关键事件中的取舍方式，但不得复制事件本身。",
      ].join("\n"),
      "06-timeline.md": [
        `# ${character.name} - 时间线`,
        "",
        "## 起点",
        `首次出现：第 ${character.firstAppearance} 章。`,
        "",
        "## 当前分析终点",
        `最后出现：第 ${character.lastAppearance} 章。`,
        "",
        "## 可延展线索",
        keyEvents,
      ].join("\n"),
    },
  }
}

export async function importBookAnalysisSkillsAsAuras(
  projectPath: string,
  metadata: BookAnalysisMetadata,
  characters: ExtractedCharacter[],
  skills: CharacterSkill[],
  selectedSkillIds: string[],
): Promise<ImportedBookAnalysisAura[]> {
  const characterById = new Map(characters.map((character) => [character.id, character]))
  const selected = skills.filter((skill) => selectedSkillIds.includes(skill.id))
  const imported: ImportedBookAnalysisAura[] = []

  for (const skill of selected) {
    const character = characterById.get(skill.characterId)
    if (!character) continue
    const aura: CharacterAura = await createCustomCharacterAuraFromGeneratedSkill(
      projectPath,
      buildGeneratedAuraInputFromBookCharacter(character, skill, metadata),
    )
    imported.push({
      skillId: skill.id,
      characterId: character.id,
      characterName: character.name,
      auraId: aura.id,
      auraName: aura.name,
    })
  }

  return imported
}
