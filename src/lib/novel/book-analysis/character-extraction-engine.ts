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
import { CHAPTER_BODY_EXCERPT_MAX_CHARS } from "@/lib/novel/chapter-excerpts"
import { parseLlmJsonObject } from "./llm-json"

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
  /** 已在上一步识别并由用户勾选的角色；提供后只分析这些角色，不再重新识别全书角色。 */
  targetCharacters?: RecognizedCharacter[]
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
  /** 是否把中间结果写入正式角色目录；分析区块并发执行时必须关闭。 */
  persistResults?: boolean
}

export interface CharacterExtractionResult {
  success: boolean
  characters: ExtractedCharacter[]
  /** 部分章节/角色失败时的告警，不阻断整体成功 */
  warnings?: string[]
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
${chapterContent.substring(0, CHAPTER_BODY_EXCERPT_MAX_CHARS)} ${chapterContent.length > CHAPTER_BODY_EXCERPT_MAX_CHARS ? "...(内容过长已截断)" : ""}

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
  let streamError: Error | null = null

  try {
    await streamChat(llmConfig, messages, {
      onToken: (text) => { response += text },
      onDone: () => {},
      onError: (err) => { streamError = err },
    }, signal)

    if (streamError) throw streamError

    const data = parseLlmJsonObject(response)
    if (!data || !Array.isArray(data.characters)) throw new Error("模型返回内容缺少 characters 数组")
    return data.characters.flatMap((item): Array<{ name: string; aliases: string[]; importance: number }> => {
      if (!item || typeof item !== "object") return []
      const candidate = item as Record<string, unknown>
      const name = typeof candidate.name === "string" ? candidate.name.trim() : ""
      if (!name) return []
      const rawImportance = Number(candidate.importance)
      return [{
        name,
        aliases: Array.isArray(candidate.aliases)
          ? candidate.aliases.filter((alias): alias is string => typeof alias === "string")
          : [],
        importance: Number.isFinite(rawImportance)
          ? Math.max(1, Math.min(10, rawImportance))
          : 5,
      }]
    })
  } catch (error) {
    if (signal?.aborted) throw new Error("用户取消分析")
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`角色识别失败（${chapterTitle}），跳过该章：`, message)
    throw new Error(`角色识别失败（${chapterTitle}）：${message}`)
  }
}

async function identifyCharactersInChapterSafe(
  chapterContent: string,
  chapterTitle: string,
  chapterOrder: number,
  llmConfig: LlmConfig,
  signal: AbortSignal | undefined,
  warnings: string[],
): Promise<Array<{ name: string; aliases: string[]; importance: number }>> {
  try {
    return await identifyCharactersInChapter(chapterContent, chapterTitle, chapterOrder, llmConfig, signal)
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.message === "用户取消分析")) throw error
    const message = error instanceof Error ? error.message : String(error)
    warnings.push(message)
    return []
  }
}

/**
 * 深度分析单个角色
 */
async function analyzeCharacterDetails(
  characterName: string,
  relevantChapters: Array<{ id: string; title: string; content: string; order: number }>,
  llmConfig: LlmConfig,
  signal?: AbortSignal
): Promise<ExtractedCharacter | null> {
  // 收集角色相关的文本片段
  const corpus = relevantChapters
    .map(ch => `【${ch.id} · 第${ch.order}章 · ${ch.title}】\n${ch.content}`)
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
  "motivation": "底层动机与核心欲望",
  "goals": ["当前目标与长期目标"],
  "fears": ["恐惧、禁区与不能接受的结果"],
  "growthArc": "本批章节内的关系变化、认知变化和成长弧",
  "behaviorPatterns": "面对压力、利益、冲突和亲密关系时的稳定行为模式",
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
  ],
  "representativeQuotes": [
    {
      "chapterId": "必须使用上文【】中的章节ID",
      "text": "80-300字的短原文片段，不得改写"
    }
  ]
}

只返回JSON，不要其他说明。`

  const messages: ChatMessage[] = [
    { role: "user", content: prompt }
  ]

  let response = ""
  let streamError: Error | null = null

  try {
    await streamChat(llmConfig, messages, {
      onToken: (text) => { response += text },
      onDone: () => {},
      onError: (err) => { streamError = err },
    }, signal)

    if (streamError) throw streamError

    const data = parseLlmJsonObject(response)
    if (!data) throw new Error("模型返回内容不是有效 JSON")

    const character: ExtractedCharacter = {
      // feature/fix-six-dim-extract：用稳定 hash id 替代 Math.random，避免 id 跨调用漂移
      id: stableCharacterId(typeof data.name === "string" ? data.name : characterName, ""),
      name: typeof data.name === "string" && data.name ? data.name : characterName,
      aliases: Array.isArray(data.aliases)
        ? data.aliases.filter((item): item is string => typeof item === "string")
        : [],
      importance: 5, // 默认值，稍后会更新
      category: (typeof data.category === "string" ? data.category : "minor") as ExtractedCharacter["category"],
      firstAppearance: relevantChapters[0]?.order || 1,
      lastAppearance: relevantChapters[relevantChapters.length - 1]?.order || 1,
      appearanceCount: relevantChapters.length,
      description: typeof data.description === "string" ? data.description : "",
      personality: typeof data.personality === "string" ? data.personality : "",
      motivation: typeof data.motivation === "string" ? data.motivation : "",
      goals: Array.isArray(data.goals) ? data.goals.filter((item): item is string => typeof item === "string") : [],
      fears: Array.isArray(data.fears) ? data.fears.filter((item): item is string => typeof item === "string") : [],
      growthArc: typeof data.growthArc === "string" ? data.growthArc : "",
      behaviorPatterns: typeof data.behaviorPatterns === "string" ? data.behaviorPatterns : "",
      speechStyle: typeof data.speechStyle === "string" ? data.speechStyle : "",
      relationships: Array.isArray(data.relationships) ? data.relationships as ExtractedCharacter["relationships"] : [],
      keyEvents: Array.isArray(data.keyEvents) ? data.keyEvents as ExtractedCharacter["keyEvents"] : [],
      representativeQuotes: Array.isArray(data.representativeQuotes)
        ? data.representativeQuotes.filter((item: unknown): item is { chapterId: string; text: string } => {
            if (!item || typeof item !== "object") return false
            const candidate = item as Record<string, unknown>
            return typeof candidate.chapterId === "string" && typeof candidate.text === "string"
          })
        : [],
      corpus: corpus.substring(0, 10000), // 保留部分语料
    }

    return character
  } catch (error) {
    if (signal?.aborted) throw new Error("用户取消分析")
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`角色详情提取失败（${characterName}），跳过该角色：`, message)
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
  const warnings: string[] = []

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

      // 解析 frontmatter（兼容 \r\n 和 \n 换行）
      const normalizedContent = content.replace(/\r\n/g, "\n")
      const frontmatterMatch = normalizedContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
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

  // 第二阶段：未指定目标角色时，兼容旧入口并逐章识别所有角色。
  const characterMentions = new Map<string, {
    count: number
    importance: number
    chapters: number[]
  }>()

  if (input.targetCharacters === undefined) {
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

      const identified = await identifyCharactersInChapterSafe(
        chapter.content,
        chapter.title,
        chapter.order,
        llmConfig,
        signal,
        warnings,
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
  }

  // 第三阶段：深度分析重要角色（importance >= 5）
  const importantCharacters: Array<[string, { count: number; importance: number; chapters: number[] }]> =
    input.targetCharacters !== undefined
      ? input.targetCharacters.map((character) => {
          const appearedChapterOrders = character.chapterIndices
            .map((index) => chapters[index]?.order)
            .filter((order): order is number => order !== undefined)
          return [character.name, {
            count: character.appearances,
            importance: Math.max(1, Math.min(10, Math.ceil(character.importanceScore / 10))),
            chapters: appearedChapterOrders.length > 0
              ? appearedChapterOrders
              : chapters.map((chapter) => chapter.order),
          }]
        })
      : Array.from(characterMentions.entries())
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

    // 获取该角色相关的章节；跨 chunk 索引未命中时回退到当前区块全部章节
    const matchedChapters = chapters.filter(ch => data.chapters.includes(ch.order))
    const relevantChapters = matchedChapters.length > 0 ? matchedChapters : chapters

    const character = await analyzeCharacterDetails(
      characterName,
      relevantChapters,
      llmConfig,
      signal,
    )

    if (character) {
      character.importance = data.importance
      character.appearanceCount = data.count
      characters.push(character)
    } else {
      warnings.push(`角色详情提取失败（${characterName}）：已跳过`)
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
        const message = e instanceof Error ? e.message : String(e)
        console.warn(`[6d] failed for ${character.name}:`, message)
        warnings.push(`6 维度分析失败（${character.name}）：${message}`)
      }
      // 保存更新后的角色（feature/fix-six-dim-extract：writeFile 失败不应中断整个 6 维流程）
      try {
        if (input.persistResults === false) continue
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

  if (warnings.length > 0) {
    console.warn(`[角色提取] 部分失败但仍返回成功结果：${warnings.join("；")}`)
  }

  return {
    success: true,
    characters,
    warnings: warnings.length > 0 ? warnings : undefined,
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
 *
 * 关键修复（fix/character-reextract-and-loading-state）：
 *   - simple 模式不再依赖外部注入 `_llmCall`，改为内部直接用 `streamChat` 调用 LLM，
 *     避免 `_llmCall` 缺失时走 `defaultLlmCall` 抛错被吞掉、导致"再次提取"看起来无效果。
 *   - 内部构造的 `realLlmCall` 会记录单次 LLM 错误并通过返回值透传给上层，
 *     上层据此判断"提取失败"并 toast 提示。
 */
export async function extractSingleCharacter(
  input: SingleCharacterReextractInput,
): Promise<SingleCharacterReextractResult> {
  const { bookPath, character, mode, depth = "standard", llmConfig, bookTitle, bookAuthor, signal } = input
  const corpus = character.corpus || ""

  // 内部统一 LLM call 包装（fix/character-reextract-and-loading-state）：
  // simple / six-dimension 都直接使用同一实现，six-dimension 已自带 streamChat，
  // 这里我们额外提供 simple 模式用的 LLM 闭包
  const realLlmCall = async (prompt: string): Promise<string> => {
    let response = ""
    await streamChat(
      llmConfig,
      [{ role: "user", content: prompt }],
      {
        onToken: (text) => { response += text },
        onDone: () => {},
        onError: (err) => { console.error("[single-reextract] LLM error:", err) },
      },
      signal,
    )
    return response.trim()
  }

  if (mode === "simple") {
    // 实际导出名是 extractSingleProfile（feature/network-error-resume 阶段新增），
    // 签名要求 RecognizedCharacter + chapterSamples + 可选 _llmCall。
    // 关键修复（fix/character-reextract-and-loading-state）：传入 _llmCall 走真实 LLM，
    // 避免 defaultLlmCall 抛错被吞。
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
    const { profile, error: profileError } = await extractSingleProfile({
      character: minimalRecognized,
      chapterSamples: corpus,
      llmConfig,
      signal,
      _llmCall: realLlmCall,
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
    if (profileError) {
      // 透传错误信息，让 viewer 能 toast 提示
      throw new Error(`简单提取失败：${profileError}`)
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
