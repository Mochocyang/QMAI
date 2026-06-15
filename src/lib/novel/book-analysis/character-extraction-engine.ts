/**
 * 角色提取引擎
 * 从选定的章节中提取所有角色信息
 *
 * 6 维度扩展（feature/book-analysis-6d-skill）：
 *   - 在原有"识别 + 深度分析"之后，如果 depth !== "fast"，会调用 6 维度引擎
 *   - depth: "fast" 走纯模板，depth: "standard" 走 6 LLM，depth: "deep" 走 6 LLM + web 搜索
 */

import type { LlmConfig } from "@/stores/wiki-store"
import type {
  AnalysisDepth,
  ExtractedCharacter,
  RecognizedCharacter,
  SixDimensionKey,
  SixDimensionProgressItem,
} from "./types"
import { readFile, writeFile } from "@/commands/fs"
import { joinPath } from "@/lib/path-utils"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import { analyzeSixDimensions, DEPTH_DESCRIPTIONS } from "./six-dimension-engine"
import { stableCharacterId } from "./character-recognition-engine"

export interface CharacterExtractionInput {
  bookPath: string
  selectedChapterIds: string[]
  llmConfig: LlmConfig
  /** 6 维度分析深度（默认 "fast" 保持旧行为） */
  depth?: AnalysisDepth
  /** 作品名（用于 6 维度 web 搜索） */
  bookTitle?: string
  /** 作者 */
  bookAuthor?: string
  onProgress?: (progress: {
    stage: string
    stageLabel: string
    completed: number
    total: number
    percentage: number
    currentItem?: string
    /** 6 维度分析时（feature/book-analysis-6d-skill）：当前角色名 */
    currentCharacter?: string
    /** 6 维度分析时：当前维度 key */
    currentDimension?: SixDimensionKey
    /** 6 维度分析时：6 个维度的完整状态清单 */
    dimensions?: SixDimensionProgressItem[]
  }) => void
  signal?: AbortSignal
}

export interface CharacterExtractionResult {
  success: boolean
  characters: ExtractedCharacter[]
}

/**
 * 从章节内容中提取角色信息（第一阶段：识别所有角色）
 */
async function identifyCharactersInChapter(
  chapterContent: string,
  chapterTitle: string,
  _chapterOrder: number,
  llmConfig: LlmConfig,
  signal?: AbortSignal
): Promise<Array<{ name: string; aliases: string[]; importance: number }>> {
  const prompt = `请分析以下小说章节，识别出现的所有角色。

章节：${chapterTitle}

内容：
${chapterContent.substring(0, 8000)} ${chapterContent.length > 8000 ? "...(内容过长已截断)" : ""}

请以JSON格式返回角色列表，格式如下：
{
  "characters": [
    {
      "name": "角色名",
      "aliases": ["别名1", "别名2"],
      "importance": 1-10的数字，主角10，配角5，龙套1
    }
  ]
}

只返回JSON，不要其他说明。`

  const messages: ChatMessage[] = [
    { role: "user", content: prompt }
  ]

  let response = ""

  try {
    await streamChat(llmConfig, messages, {
      onToken: (text) => { response += text },
      onDone: () => {},
      onError: (err) => { console.error(err) },
    }, signal)

    // 解析 JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0])
      return data.characters || []
    }

    return []
  } catch (error) {
    console.error(`Failed to identify characters in chapter ${chapterTitle}:`, error)
    return []
  }
}

/**
 * 深度分析单个角色
 */
async function analyzeCharacterDetails(
  characterName: string,
  relevantChapters: Array<{ title: string; content: string; order: number }>,
  llmConfig: LlmConfig,
  signal?: AbortSignal
): Promise<ExtractedCharacter | null> {
  // 收集角色相关的文本片段
  const corpus = relevantChapters
    .map(ch => ch.content)
    .join("\n\n")
    .substring(0, 20000) // 限制长度

  const prompt = `请深度分析小说角色"${characterName}"的详细信息。

相关章节内容：
${corpus}

请以JSON格式返回分析结果：
{
  "name": "${characterName}",
  "aliases": ["别名数组"],
  "category": "protagonist/antagonist/supporting/minor",
  "description": "角色外貌、身份、背景描述",
  "personality": "性格特征，包括优点、缺点、特质",
  "speechStyle": "说话方式和语言特点",
  "relationships": [
    {
      "target": "关联角色名",
      "relation": "关系类型",
      "description": "关系描述"
    }
  ],
  "keyEvents": [
    {
      "chapterId": "章节ID",
      "description": "关键事件描述"
    }
  ]
}

只返回JSON，不要其他说明。`

  const messages: ChatMessage[] = [
    { role: "user", content: prompt }
  ]

  let response = ""

  try {
    await streamChat(llmConfig, messages, {
      onToken: (text) => { response += text },
      onDone: () => {},
      onError: (err) => { console.error(err) },
    }, signal)

    // 解析 JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0])

      const character: ExtractedCharacter = {
        // feature/fix-six-dim-extract：用稳定 hash id 替代 Math.random，避免 id 跨调用漂移
        id: stableCharacterId(data.name || characterName, ""),
        name: data.name || characterName,
        aliases: data.aliases || [],
        importance: 5, // 默认值，稍后会更新
        category: data.category || "minor",
        firstAppearance: relevantChapters[0]?.order || 1,
        lastAppearance: relevantChapters[relevantChapters.length - 1]?.order || 1,
        appearanceCount: relevantChapters.length,
        description: data.description || "",
        personality: data.personality || "",
        speechStyle: data.speechStyle || "",
        relationships: data.relationships || [],
        keyEvents: data.keyEvents || [],
        corpus: corpus.substring(0, 10000), // 保留部分语料
      }

      return character
    }

    return null
  } catch (error) {
    console.error(`Failed to analyze character ${characterName}:`, error)
    return null
  }
}

/**
 * 主函数：提取角色信息
 */
export async function extractCharactersFromChapters(
  input: CharacterExtractionInput
): Promise<CharacterExtractionResult> {
  const { bookPath, selectedChapterIds, llmConfig, onProgress, signal } = input

  onProgress?.({
    stage: "extracting_characters",
    stageLabel: "正在识别角色",
    completed: 0,
    total: 100,
    percentage: 30,
  })

  // 第一阶段：读取选中的章节
  const chapters: Array<{ id: string; title: string; order: number; content: string }> = []

  for (const chapterId of selectedChapterIds) {
    if (signal?.aborted) {
      throw new Error("用户取消分析")
    }

    try {
      const chapterPath = joinPath(bookPath, "chapters", `${chapterId}.md`)
      const content = await readFile(chapterPath)

      // 解析 frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1]
        const bodyContent = frontmatterMatch[2]

        const titleMatch = frontmatter.match(/title:\s*(.+)/)
        const orderMatch = frontmatter.match(/order:\s*(\d+)/)

        if (titleMatch && orderMatch) {
          chapters.push({
            id: chapterId,
            title: titleMatch[1].trim(),
            order: parseInt(orderMatch[1], 10),
            content: bodyContent,
          })
        }
      }
    } catch (error) {
      console.error(`Failed to read chapter ${chapterId}:`, error)
    }
  }

  if (chapters.length === 0) {
    throw new Error("未能读取到任何章节内容")
  }

  // 第二阶段：识别所有角色（逐章分析）
  const characterMentions = new Map<string, {
    count: number
    importance: number
    chapters: number[]
  }>()

  for (let i = 0; i < chapters.length; i++) {
    if (signal?.aborted) {
      throw new Error("用户取消分析")
    }

    const chapter = chapters[i]

    onProgress?.({
      stage: "extracting_characters",
      stageLabel: "识别角色中",
      completed: i,
      total: chapters.length * 2,
      percentage: 30 + Math.floor((i / chapters.length) * 20),
      currentItem: chapter.title,
    })

    const identified = await identifyCharactersInChapter(
      chapter.content,
      chapter.title,
      chapter.order,
      llmConfig,
      signal
    )

    // 汇总角色出现次数
    for (const char of identified) {
      const existing = characterMentions.get(char.name)
      if (existing) {
        existing.count++
        existing.importance = Math.max(existing.importance, char.importance)
        existing.chapters.push(chapter.order)
      } else {
        characterMentions.set(char.name, {
          count: 1,
          importance: char.importance,
          chapters: [chapter.order],
        })
      }
    }
  }

  // 第三阶段：深度分析重要角色（importance >= 5）
  const importantCharacters = Array.from(characterMentions.entries())
    .filter(([_, data]) => data.importance >= 5)
    .sort((a, b) => b[1].importance - a[1].importance)
    .slice(0, 20) // 最多分析前20个重要角色

  const characters: ExtractedCharacter[] = []

  for (let i = 0; i < importantCharacters.length; i++) {
    if (signal?.aborted) {
      throw new Error("用户取消分析")
    }

    const [characterName, data] = importantCharacters[i]

    onProgress?.({
      stage: "extracting_characters",
      stageLabel: "深度分析角色",
      completed: chapters.length + i,
      total: chapters.length + importantCharacters.length,
      percentage: 50 + Math.floor((i / importantCharacters.length) * 40),
      currentItem: characterName,
    })

    // 获取该角色相关的章节
    const relevantChapters = chapters.filter(ch => data.chapters.includes(ch.order))

    const character = await analyzeCharacterDetails(
      characterName,
      relevantChapters,
      llmConfig,
      signal
    )

    if (character) {
      character.importance = data.importance
      character.appearanceCount = data.count
      characters.push(character)
    }
  }

  // 第四阶段：6 维度深度分析（feature/book-analysis-6d-skill）
  const depth: AnalysisDepth = input.depth ?? "fast"
  if (depth !== "fast" && characters.length > 0) {
    const bookTitle = input.bookTitle || "未知作品"
    const bookAuthor = input.bookAuthor
    const sixDimTotal = characters.length
    for (let i = 0; i < characters.length; i++) {
      if (signal?.aborted) {
        throw new Error("用户取消分析")
      }
      const character = characters[i]
      // 进入角色时报告"6 维度分析"阶段 + 正在做哪个角色
      onProgress?.({
        stage: "analyzing_six_dimension",
        stageLabel: `6 维度分析 (${DEPTH_DESCRIPTIONS[depth].label}) · ${character.name}`,
        completed: i,
        total: sixDimTotal,
        percentage: 50 + Math.floor((i / sixDimTotal) * 40),
        currentItem: character.name,
        currentCharacter: character.name,
      })
      try {
        const result = await analyzeSixDimensions({
          character,
          corpus: character.corpus || "",
          llmConfig,
          depth,
          bookTitle,
          bookAuthor,
          // 把 6 维度内部进度透传到外层
          onProgress: (p) => {
            // 角色维度的内层进度，统一映射到外层"analyzing_six_dimension"阶段
            onProgress?.({
              stage: "analyzing_six_dimension",
              stageLabel: `6 维度 · ${character.name} · ${p.label}`,
              completed: i,
              total: sixDimTotal,
              // 角色内进度 0~40% 平摊到每个角色
              percentage: 50 + Math.floor(((i + (p.percentage / 100)) / sixDimTotal) * 40),
              currentItem: p.currentItem,
              currentCharacter: character.name,
              currentDimension: p.currentDimension,
              dimensions: p.dimensions,
            })
          },
          signal,
        })
        characters[i] = result.character
      } catch (e) {
        console.error(`[6d] failed for ${character.name}:`, e)
      }
      // 保存更新后的角色（feature/fix-six-dim-extract：writeFile 失败不应中断整个 6 维流程）
      try {
        await writeFile(
          joinPath(bookPath, "characters", `${character.id}.json`),
          JSON.stringify(characters[i], null, 2)
        )
      } catch (writeErr) {
        console.warn(`[6d] 保存角色档案失败（不影响 6 维返回）：${character.name}：`, writeErr)
      }
    }
  }

  onProgress?.({
    stage: "extracting_characters",
    stageLabel: "角色提取完成",
    completed: chapters.length + importantCharacters.length,
    total: chapters.length + importantCharacters.length,
    percentage: 90,
  })

  return {
    success: true,
    characters,
  }
}

// === 单角色重新提取（feature/book-analysis-reuse）===
export interface SingleCharacterReextractInput {
  bookPath: string
  bookId: string
  /** 被重提的目标角色（带 id + name + corpus） */
  character: ExtractedCharacter
  /** simple 走 simple-extraction；six-dimension 走 6 维 */
  mode: "simple" | "six-dimension"
  depth?: AnalysisDepth
  llmConfig: LlmConfig
  bookTitle?: string
  bookAuthor?: string
  signal?: AbortSignal
}

export interface SingleCharacterReextractResult {
  character: ExtractedCharacter
}

/**
 * 单角色重新提取（feature/book-analysis-reuse）
 * 复用同一 bookPath / 同一 LLM 配置，仅重跑指定角色
 */
export async function extractSingleCharacter(
  input: SingleCharacterReextractInput,
): Promise<SingleCharacterReextractResult> {
  const { bookPath, character, mode, depth = "standard", llmConfig, bookTitle, bookAuthor, signal } = input
  const corpus = character.corpus || ""

  if (mode === "simple") {
    // 实际导出名是 extractSingleProfile（feature/network-error-resume 阶段新增），
    // 签名要求 RecognizedCharacter + chapterSamples；本函数仅取 name，其余字段
    // 用最小 RecognizedCharacter 占位以满足类型
    const { extractSingleProfile } = await import("./simple-extraction-engine")
    const minimalRecognized: RecognizedCharacter = {
      id: character.id,
      name: character.name,
      aliases: character.aliases ?? [],
      appearances: character.appearanceCount ?? 0,
      chapterIndices: [],
      importanceScore: (character.importance ?? 0) * 10,
      category: "次要",
      sourceBook: bookPath,
    }
    const { profile } = await extractSingleProfile({
      character: minimalRecognized,
      chapterSamples: corpus,
      llmConfig,
      signal,
    })
    const updated: ExtractedCharacter = {
      ...character,
      personalityProfile: profile,
      simpleExtractionMeta: { generatedAt: Date.now(), schemaVersion: 1 },
      // 清掉 6 维旧数据，避免两条结果混着
      sixDimensionResearch: undefined,
      sixDimensionMeta: undefined,
    }
    try {
      await writeFile(
        joinPath(bookPath, "characters", `${character.id}.json`),
        JSON.stringify(updated, null, 2),
      )
    } catch (err) {
      console.warn(`[single-reextract] 保存失败：${character.name}`, err)
    }
    return { character: updated }
  }

  // six-dimension
  const { analyzeSixDimensions } = await import("./six-dimension-engine")
  const result = await analyzeSixDimensions({
    character,
    corpus,
    llmConfig,
    depth,
    bookTitle: bookTitle || "未知作品",
    bookAuthor,
    signal,
  })
  try {
    await writeFile(
      joinPath(bookPath, "characters", `${character.id}.json`),
      JSON.stringify(result.character, null, 2),
    )
  } catch (err) {
    console.warn(`[single-reextract] 保存失败：${character.name}`, err)
  }
  return { character: result.character }
}
