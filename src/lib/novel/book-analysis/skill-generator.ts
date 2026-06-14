/**
 * 角色 Skill 生成器
 * 为提取的角色生成可复用的 Skill 文件
 *
 * 6 维度模式（feature/book-analysis-6d-skill）：
 *   - 如果 character.sixDimensionResearch 存在，则优先把 6 个维度研究内容作为正文骨架
 *   - 前面只补一个轻量 frontmatter + 总览段，LLM 只做润色 / 补全
 *   - 旧模式（无 6 维度）保持不变
 */

import type { LlmConfig } from "@/stores/wiki-store"
import type {
  ExtractedCharacter,
  CharacterSkill,
  BookAnalysisMetadata,
  PersonalityProfile,
} from "./types"
import { writeFile } from "@/commands/fs"
import { joinPath } from "@/lib/path-utils"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import { ALL_DIMENSIONS, DIMENSION_LABELS } from "./six-dimension-prompts"

/**
 * 是否有 6 维度研究内容
 */
export function isSixDimensionSkill(character: ExtractedCharacter): boolean {
  return !!character.sixDimensionResearch && !!character.sixDimensionMeta
}

/**
 * 6 维度骨架 → markdown 文本（跳过 LLM）
 */
function buildSixDimensionSkeleton(
  character: ExtractedCharacter,
  bookMetadata: BookAnalysisMetadata
): string {
  const research = character.sixDimensionResearch!
  const meta = character.sixDimensionMeta!
  const aliasNames = character.aliasMap
    ? [character.aliasMap.canonical, ...character.aliasMap.aliases]
    : [character.name, ...character.aliases]
  const aliasText = Array.from(new Set(aliasNames)).filter(Boolean).join("、")

  const lines: string[] = []
  lines.push(`---`)
  lines.push(`name: ${character.name}`)
  lines.push(`description: ${character.description.substring(0, 100)}`)
  lines.push(`sourceBook: ${bookMetadata.title}`)
  lines.push(`category: character-skill`)
  lines.push(`schema: 6d`)
  lines.push(`analysisDepth: ${meta.depth}`)
  lines.push(`webSearchUsed: ${meta.webSearchUsed}`)
  lines.push(`sourceNote: ${meta.sourceNote}`)
  lines.push(`generatedAt: ${meta.generatedAt}`)
  lines.push(`---`)
  lines.push(``)
  lines.push(`# ${character.name}`)
  lines.push(``)
  lines.push(`> 6 维度分析 · 深度：${meta.depth} · ${meta.sourceNote}`)
  lines.push(``)
  lines.push(`## 角色别名 / 称谓`)
  lines.push(``)
  lines.push(aliasText)
  lines.push(``)
  lines.push(`## 角色总览`)
  lines.push(``)
  lines.push(`- **分类**：${character.category}`)
  lines.push(`- **首次出现**：第 ${character.firstAppearance} 章`)
  lines.push(`- **最后一次出现**：第 ${character.lastAppearance} 章`)
  lines.push(`- **出现次数**：${character.appearanceCount} 次`)
  lines.push(`- **来源作品**：《${bookMetadata.title}》（作者：${bookMetadata.author || "未知"}）`)
  lines.push(``)

  for (const key of ALL_DIMENSIONS) {
    lines.push(`## ${DIMENSION_LABELS[key]}`)
    lines.push(``)
    lines.push(research[key] || `（空）`)
    lines.push(``)
  }

  return lines.join("\n")
}

/**
 * 生成角色 Skill（6 维度模式 / 旧模式自动判断）
 */
export async function generateCharacterSkill(
  character: ExtractedCharacter,
  bookMetadata: BookAnalysisMetadata,
  llmConfig: LlmConfig,
  signal?: AbortSignal
): Promise<string> {
  // 6 维度模式：直接组装，跳过 LLM（研究阶段已调用过 6 次 LLM）
  if (isSixDimensionSkill(character)) {
    return buildSixDimensionSkeleton(character, bookMetadata)
  }

  const prompt = `请为小说角色生成一个完整的 Skill 技能文档。

角色信息：
- 姓名：${character.name}
- 别名：${character.aliases.join("、")}
- 分类：${character.category}
- 描述：${character.description}
- 性格：${character.personality}
- 说话方式：${character.speechStyle}
- 关系：${character.relationships.map(r => `${r.target}（${r.relation}）`).join("、")}

来源作品：${bookMetadata.title}
作者：${bookMetadata.author || "未知"}

请生成一个 Markdown 格式的 Skill 文档，包含以下部分：

1. Frontmatter（YAML格式）：
   - name: 角色名
   - description: 一句话简介
   - sourceBook: 来源书籍
   - category: 角色分类

2. 角色基本信息
3. 性格特征（详细展开）
4. 说话方式（包含示例）
5. 行为模式
6. 关系网络
7. 使用建议（如何在写作中使用这个角色）

请直接输出完整的 Markdown 内容，不要额外说明。`

  const messages: ChatMessage[] = [
    { role: "user", content: prompt }
  ]

  let skillContent = ""

  try {
    await streamChat(llmConfig, messages, {
      onToken: (text) => { skillContent += text },
      onDone: () => {},
      onError: (err) => { console.error(err) },
    }, signal)

    // 如果生成的内容没有 frontmatter，添加一个
    if (!skillContent.startsWith("---")) {
      const frontmatter = `---
name: ${character.name}
description: ${character.description.substring(0, 100)}
sourceBook: ${bookMetadata.title}
category: character-skill
---

`
      skillContent = frontmatter + skillContent
    }

    return skillContent
  } catch (error) {
    console.error(`Failed to generate skill for ${character.name}:`, error)

    // 返回一个基础的 Skill 模板
    return `---
name: ${character.name}
description: ${character.description}
sourceBook: ${bookMetadata.title}
category: character-skill
---

# ${character.name}

## 角色基本信息

- **姓名**：${character.name}
- **别名**：${character.aliases.join("、") || "无"}
- **分类**：${character.category}
- **首次出现**：第${character.firstAppearance}章

## 角色描述

${character.description}

## 性格特征

${character.personality}

## 说话方式

${character.speechStyle}

## 关系网络

${character.relationships.map(r => `- **${r.target}**：${r.relation}${r.description ? ` - ${r.description}` : ""}`).join("\n")}

## 使用建议

这个角色来自《${bookMetadata.title}》，可以作为灵魂库中的参考角色使用。在写作中可以借鉴其性格特征和说话方式。
`
  }
}

/**
 * 批量生成 Skills 并保存
 */
export async function generateSkillsForCharacters(
  characters: ExtractedCharacter[],
  bookMetadata: BookAnalysisMetadata,
  bookPath: string,
  llmConfig: LlmConfig,
  onProgress?: (progress: {
    stage: string
    stageLabel: string
    completed: number
    total: number
    percentage: number
    currentItem?: string
  }) => void,
  signal?: AbortSignal
): Promise<CharacterSkill[]> {
  const skills: CharacterSkill[] = []

  for (let i = 0; i < characters.length; i++) {
    if (signal?.aborted) {
      throw new Error("用户取消生成")
    }

    const character = characters[i]

    onProgress?.({
      stage: "generating_skills",
      stageLabel: "生成角色Skill",
      completed: i,
      total: characters.length,
      percentage: 90 + Math.floor((i / characters.length) * 10),
      currentItem: character.name,
    })

    const skillContent = await generateCharacterSkill(
      character,
      bookMetadata,
      llmConfig,
      signal
    )

    // 生成安全的文件名
    const safeFileName = character.name.replace(/[^一-龥a-zA-Z0-9]/g, "_")
    const skillFileName = `${safeFileName}-skill.md`
    const skillPath = joinPath(bookPath, "skills", skillFileName)

    await writeFile(skillPath, skillContent)

    const skill: CharacterSkill = {
      id: `skill-${character.id}`,
      characterId: character.id,
      characterName: character.name,
      skillContent,
      sourceBook: bookMetadata.title,
      chapterRange: [`${character.firstAppearance}`, `${character.lastAppearance}`],
      createdAt: Date.now(),
      filePath: skillPath,
      depth: character.sixDimensionMeta?.depth,
      sixDimensionMeta: character.sixDimensionMeta,
    }

    skills.push(skill)
  }

  onProgress?.({
    stage: "generating_skills",
    stageLabel: "Skill生成完成",
    completed: characters.length,
    total: characters.length,
    percentage: 100,
  })

  return skills
}

/**
 * 生成简单提取模式的 Skill markdown（feature/character-recognition-and-simple-mode）
 * 4 字段 + 代表性台词格式
 */
export function generateSimpleSkillMarkdown(input: {
  characterName: string
  profile: PersonalityProfile
  sourceBook?: string
}): string {
  const { characterName, profile, sourceBook } = input
  return `# 角色 Skill - ${characterName}

> 来源：${sourceBook ?? "未知"}
> 提取方式：简单提取（4 字段 + 代表性台词）

## 性格
${profile.personality}

## 动机
${profile.motivation}

## 说话风格
${profile.speechStyle}

## 行为模式
${profile.behaviorPatterns}

## 代表性台词
${profile.quotes.map((q) => `- 「${q}」`).join("\n")}

---
*本 Skill 由 QM AI 拆书功能生成*
`
}
