/**
 * 拆书分析 Workflow - 并行处理章节提取角色
 */

export const meta = {
  name: 'book-analysis-parallel',
  description: '并行分析多个章节提取角色信息',
  phases: [
    { title: '分析章节', detail: '并行提取每章角色信息' },
    { title: '合并去重', detail: '合并所有角色并去重' },
    { title: '生成Skills', detail: '为每个角色生成Skill文档' },
  ],
}

// 参数：
// - chapters: Array<{id, title, content, order}>
// - bookMetadata: {title, author, ...}
// - llmConfig: LLM配置

const chapters = args.chapters || []
const bookMetadata = args.bookMetadata || {}
const outputDir = args.outputDir || ''

if (!chapters.length) {
  return { error: '没有要分析的章节' }
}

log(`开始并行分析 ${chapters.length} 个章节...`)

// 第一阶段：并行分析每个章节
phase('分析章节')

const chapterSchema = {
  type: 'object',
  properties: {
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          aliases: { type: 'array', items: { type: 'string' } },
          category: { type: 'string', enum: ['protagonist', 'antagonist', 'supporting', 'minor'] },
          description: { type: 'string' },
          personality: { type: 'string' },
          speechStyle: { type: 'string' },
          relationships: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                target: { type: 'string' },
                relation: { type: 'string' },
                description: { type: 'string' },
              },
            },
          },
          importance: { type: 'number', minimum: 1, maximum: 10 },
        },
        required: ['name', 'category', 'importance'],
      },
    },
  },
  required: ['characters'],
}

// 使用 pipeline 并行处理所有章节（无阻塞）
const chapterResults = await pipeline(
  chapters,
  (chapter) => agent(
    `分析以下章节中的所有角色：

**章节标题**：${chapter.title}
**章节序号**：第${chapter.order}章

**章节内容**：
${chapter.content}

---

请提取所有出现的角色，包括：
1. 角色名称（主要名称和所有别名）
2. 角色类别（主角protagonist/反派antagonist/配角supporting/龙套minor）
3. 角色描述（外貌、身份、背景）
4. 性格特征
5. 说话方式
6. 与其他角色的关系
7. 重要性评分（1-10分）

注意：
- 即使是只出现一次的龙套角色也要记录
- 同一角色的不同称呼要记录在aliases中
- 重要性根据角色在情节中的作用评分`,
    {
      label: `分析:${chapter.title}`,
      phase: '分析章节',
      schema: chapterSchema,
    }
  ),
  // 将chapter信息附加到结果中
  (result, chapter) => result ? { ...result, chapterId: chapter.id, chapterOrder: chapter.order } : null
)

const validResults = chapterResults.filter(Boolean)
log(`成功分析 ${validResults.length}/${chapters.length} 个章节`)

if (validResults.length === 0) {
  return { error: '没有成功分析任何章节' }
}

// 第二阶段：合并和去重
phase('合并去重')

const allCharacters = validResults.flatMap(r => r.characters.map(char => ({
  ...char,
  firstAppearance: r.chapterOrder,
  lastAppearance: r.chapterOrder,
  appearanceCount: 1,
  chapters: [r.chapterId],
})))

log(`收集到 ${allCharacters.length} 个角色实例，开始合并...`)

const mergeSchema = {
  type: 'object',
  properties: {
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          aliases: { type: 'array', items: { type: 'string' } },
          category: { type: 'string' },
          description: { type: 'string' },
          personality: { type: 'string' },
          speechStyle: { type: 'string' },
          relationships: { type: 'array' },
          importance: { type: 'number' },
          firstAppearance: { type: 'number' },
          lastAppearance: { type: 'number' },
          appearanceCount: { type: 'number' },
        },
        required: ['id', 'name', 'category', 'importance'],
      },
    },
  },
  required: ['characters'],
}

const mergedResult = await agent(
  `请合并以下角色列表，识别同一角色的不同出现：

${JSON.stringify(allCharacters, null, 2)}

任务：
1. 识别哪些角色是同一人（考虑名字相似、别名、关系网等）
2. 合并同一角色的信息：
   - 综合所有描述
   - 合并所有别名
   - 统计出现次数
   - 记录首次和最后出现章节
   - 整合性格和说话方式
   - 合并关系网络
3. 为每个角色生成唯一ID（使用 name 的拼音或英文简写）
4. 按重要性排序

注意：
- 宁可多列不同角色，也不要错误合并
- 重要性应综合考虑所有出现`,
  {
    label: '合并角色',
    phase: '合并去重',
    schema: mergeSchema,
  }
)

const mergedCharacters = mergedResult?.characters || []
log(`合并后共 ${mergedCharacters.length} 个不同角色`)

// 第三阶段：生成 Skills
phase('生成Skills')

const skillSchema = {
  type: 'object',
  properties: {
    skillContent: { type: 'string' },
  },
  required: ['skillContent'],
}

const skills = await pipeline(
  mergedCharacters,
  (character) => agent(
    `为小说《${bookMetadata.title}》中的角色"${character.name}"生成一个完整的 Skill 文档。

**角色信息**：
${JSON.stringify(character, null, 2)}

**Skill 格式要求**：

\`\`\`markdown
---
角色名: ${character.name}
来源: ${bookMetadata.title}
作者: ${bookMetadata.author || '未知'}
---

# ${character.name}

## 基本信息

- **别名**: [列出所有别名]
- **类别**: [主角/反派/配角/龙套]
- **重要性**: [X/10]

## 角色描述

[详细的角色描述，包括外貌、身份、背景]

## 性格特征

[详细的性格分析]

## 说话方式

[说话风格和语言特点]

## 关系网络

[与其他角色的关系]

## 出现信息

- 首次出现：第 X 章
- 最后出现：第 Y 章
- 出现次数：Z 次

## 使用建议

在创作时，如果需要这种类型的角色，可以参考"${character.name}"的性格特征和说话方式。
\`\`\`

请按照以上格式生成完整的 Skill 文档。`,
    {
      label: `生成:${character.name}`,
      phase: '生成Skills',
      schema: skillSchema,
    }
  ),
  (result, character) => result ? {
    id: character.id,
    characterName: character.name,
    sourceBook: bookMetadata.title,
    skillContent: result.skillContent,
    filePath: `${outputDir}/skills/${character.id}.md`,
  } : null
)

const validSkills = skills.filter(Boolean)
log(`成功生成 ${validSkills.length}/${mergedCharacters.length} 个 Skills`)

return {
  characters: mergedCharacters,
  skills: validSkills,
  summary: {
    totalChapters: chapters.length,
    successfulChapters: validResults.length,
    totalCharacters: mergedCharacters.length,
    totalSkills: validSkills.length,
  },
}
