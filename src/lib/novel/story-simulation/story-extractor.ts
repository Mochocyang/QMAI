/**
 * 全维度内容提取器
 *
 * 从小说项目中提取角色特征、章节内容、记忆库、世界规则等，
 * 用于后续的仿真推演。所有文件读取均带容错处理，单个文件缺失
 * 不会中断整体提取流程。
 */

import { readFile, listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { parseFrontmatter } from "@/lib/frontmatter"
import { readSoulDoc } from "@/lib/novel/soul-doc"
import { loadCognitionState } from "@/lib/novel/character-cognition"
import { loadForeshadowingTracker } from "@/lib/novel/foreshadowing-tracker"
import { getTimelineEvents } from "@/lib/novel/timeline"
import {
  loadCharacterStates,
  characterStatesToContextText,
} from "@/lib/novel/character-state"
import { loadSnapshot } from "@/lib/novel/chapter-ingest"
import {
  listCharacterAuras,
  getCharacterAuraBindings,
  loadCharacterAuraSkillDocument,
} from "@/lib/novel/character-aura"
import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import type {
  ExtractionResult,
  ExtractedCharacter,
  ExtractedChapterContent,
  ExtractedMemoryData,
} from "./types"

// ── 对外接口 ──

interface ExtractionOptions {
  sourceChapters: number
  llmConfig?: LlmConfig
  onProgress?: (progress: number, label: string) => void
}

/**
 * 从小说项目中提取全维度内容。
 *
 * 提取维度包括：大纲、灵魂文档、最近 N 章正文、记忆库
 * （角色状态 / 认知 / 伏笔 / 时间线 / 正史 / 冲突）、角色
 * 完整特征（档案 + 光环 + 认知 + 技能）、世界规则与力量体系。
 */
export async function extractStoryContent(
  projectPath: string,
  options: ExtractionOptions,
): Promise<ExtractionResult> {
  const pp = normalizePath(projectPath)
  const { sourceChapters, llmConfig, onProgress } = options
  const report = (progress: number, label: string): void => {
    onProgress?.(progress, label)
  }

  // 1. 读取大纲（5%）
  report(5, "正在读取大纲...")
  const outlineContent = await readOutlines(pp)

  // 2. 读取项目灵魂文档（15%）
  report(15, "正在读取灵魂文档...")
  const soulDoc = await readSoulDoc(pp)

  // 3. 读取最近 N 章内容（25%）
  report(25, `正在读取最近 ${sourceChapters} 章内容...`)
  const chapterContents = await readRecentChapters(pp, sourceChapters)

  // 4. 读取记忆库（40%）
  report(40, "正在读取记忆库...")
  const memoryData = await readMemoryData(pp)

  // 5. 读取角色完整特征（55%）
  report(55, "正在提取角色完整特征...")
  const characters = await extractCharacters(pp, chapterContents, llmConfig)

  // 6. 从大纲中提取世界规则和力量体系（70%）
  report(70, "正在从大纲中提取世界规则与力量体系...")
  const worldRules = extractWorldRules(outlineContent)
  const powerSystem = extractPowerSystem(outlineContent)

  // 7. 汇总结果（85% → 100%）
  report(85, "正在汇总提取结果...")

  const result: ExtractionResult = {
    characters,
    chapterContents,
    memoryData,
    worldRules,
    powerSystem,
    foreshadowing: memoryData.foreshadowingTracker,
    timeline: memoryData.timeline,
    outlineContent,
    soulDoc,
  }

  report(100, "全维度内容提取完成")
  return result
}

// ── 内部实现 ──

/**
 * 从 frontmatter 值（string | string[]）中取字符串。
 */
function fmString(value: string | string[] | undefined): string {
  if (value === undefined) return ""
  return Array.isArray(value) ? (value[0] ?? "") : value
}

/**
 * 从 frontmatter 值中取数字，无法解析时返回 NaN。
 */
function fmNumber(value: string | string[] | undefined): number {
  const num = Number(fmString(value))
  return Number.isFinite(num) ? num : NaN
}

/**
 * 读取 wiki/outlines/ 目录下所有大纲文件，按文件名排序后拼接。
 */
async function readOutlines(pp: string): Promise<string> {
  const outlinesDir = `${pp}/wiki/outlines`
  let nodes
  try {
    nodes = await listDirectory(outlinesDir)
  } catch {
    return ""
  }

  const mdFiles = nodes
    .filter((n) => !n.is_dir && n.name.endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  const contents: string[] = []
  for (const node of mdFiles) {
    try {
      contents.push(await readFile(node.path))
    } catch {
      // 单个文件读取失败，跳过
    }
  }
  return contents.join("\n\n---\n\n")
}

/**
 * 读取最近 N 章内容。从 wiki/chapters/ 目录按章节号排序后取最后 N 章，
 * 每章的摘要从对应章节快照中获取。
 */
async function readRecentChapters(
  pp: string,
  count: number,
): Promise<ExtractedChapterContent[]> {
  const chaptersDir = `${pp}/wiki/chapters`
  let nodes
  try {
    nodes = await listDirectory(chaptersDir)
  } catch {
    return []
  }

  const mdFiles = nodes.filter((n) => !n.is_dir && n.name.endsWith(".md"))

  // 解析每个章节文件，获取章节号、标题和正文
  const parsed: { number: number; title: string; content: string }[] = []
  for (const node of mdFiles) {
    try {
      const raw = await readFile(node.path)
      const result = parseFrontmatter(raw)
      const fm = result.frontmatter
      const chapterNumber = fmNumber(fm?.chapter_number)
      if (!Number.isFinite(chapterNumber)) continue
      const title = fmString(fm?.title) || node.name.replace(/\.md$/, "")
      parsed.push({ number: chapterNumber, title, content: result.body })
    } catch {
      // 单个章节解析失败，跳过
    }
  }

  // 按章节号排序（numeric）
  parsed.sort((a, b) => a.number - b.number)

  // 取最后 N 章
  const recent = parsed.slice(-count)

  // 为每章补充摘要（从快照获取）
  const results: ExtractedChapterContent[] = []
  for (const ch of recent) {
    let summary = ""
    try {
      const snapshot = await loadSnapshot(pp, ch.number)
      if (snapshot) summary = snapshot.summary
    } catch {
      // 无快照，摘要留空
    }
    results.push({
      chapterNumber: ch.number,
      title: ch.title,
      summary,
      content: ch.content,
    })
  }

  return results
}

/**
 * 读取记忆库数据：角色状态、角色认知、伏笔追踪、时间线、正史、冲突。
 */
async function readMemoryData(pp: string): Promise<ExtractedMemoryData> {
  // 角色状态 → 转为文本
  const characterStates = await loadCharacterStates(pp)
    .then((store) => characterStatesToContextText(store))
    .catch(() => "")

  // 角色认知状态
  const characterCognition = await loadCognitionState(pp).catch(() => null)

  // 伏笔追踪
  const foreshadowingTracker = await loadForeshadowingTracker(pp).catch(
    () => null,
  )

  // 时间线 → 提取事件文本
  const timeline: string[] = await getTimelineEvents(pp)
    .then((entries) => entries.map((e) => e.event))
    .catch(() => [])

  // 正史设定
  const canonFacts = await readFile(
    `${pp}/wiki/memory/canon-facts.md`,
  ).catch(() => "")

  // 冲突记录
  const conflicts = await readFile(
    `${pp}/wiki/memory/conflicts.md`,
  ).catch(() => "")

  return {
    characterStates,
    characterCognition,
    foreshadowingTracker,
    timeline,
    canonFacts,
    conflicts,
  }
}

/**
 * 从章节摄入产物（.novel/chapter-ingest-output/NNN.output.json）读取角色。
 *
 * 每个摄入产物包含 wikiUpdatePatch.entries[]，其中 entryType === "character"
 * 的条目携带角色名、别名、身份、阵营、目标、弧光、当前状态、认知等字段。
 * 多个章节出现的同名角色会被合并：appearanceChapters 累加，其余字段取最新章节。
 */
async function extractCharactersFromIngestOutput(
  pp: string,
): Promise<
  Map<
    string,
    {
      name: string
      aliases: string[]
      profile: string
      cognition: { knows: string[]; doesNotKnow: string[] } | null
      appearanceChapters: number[]
    }
  >
> {
  const outputDir = `${pp}/.novel/chapter-ingest-output`
  let nodes
  try {
    nodes = await listDirectory(outputDir)
  } catch {
    return new Map()
  }
  const outputFiles = nodes.filter(
    (n) => !n.is_dir && n.name.endsWith(".output.json"),
  )

  const characterMap = new Map<
    string,
    {
      name: string
      aliases: string[]
      profile: string
      cognition: { knows: string[]; doesNotKnow: string[] } | null
      appearanceChapters: number[]
    }
  >()

  // 按文件名排序，保证后续章节覆盖前面的（取最新）
  outputFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  for (const node of outputFiles) {
    try {
      const raw = await readFile(node.path)
      const data = JSON.parse(raw)
      const entries = data?.wikiUpdatePatch?.entries ?? []
      for (const entry of entries) {
        if (entry.entryType !== "character") continue
        const f = entry.fields ?? {}
        const name = String(f.name ?? entry.title ?? "").trim()
        if (!name) continue

        const existing = characterMap.get(name)
        const appearanceChapters = existing?.appearanceChapters ?? []
        const newChapters: unknown[] = f.appearanceChapters ?? []
        for (const ch of newChapters) {
          const n = Number(ch)
          if (Number.isFinite(n) && !appearanceChapters.includes(n)) {
            appearanceChapters.push(n)
          }
        }

        // 构建角色档案：身份/阵营/目标/弧光/当前状态
        const profileParts: string[] = []
        if (f.identity) profileParts.push(`身份：${f.identity}`)
        if (f.faction) profileParts.push(`阵营：${f.faction}`)
        if (f.goals) profileParts.push(`目标：${f.goals}`)
        if (f.arcChange) profileParts.push(`角色弧光：${f.arcChange}`)
        if (f.currentState) profileParts.push(`当前状态：${f.currentState}`)
        const profile = profileParts.join("\n") || existing?.profile || ""

        // 认知
        const cog = f.cognition
        const cognition =
          cog && Array.isArray(cog.knows) && Array.isArray(cog.doesNotKnow)
            ? {
                knows: cog.knows.map(String),
                doesNotKnow: cog.doesNotKnow.map(String),
              }
            : existing?.cognition ?? null

        characterMap.set(name, {
          name,
          aliases: existing?.aliases ?? Array.isArray(f.aliases) ? f.aliases.map(String) : [],
          profile,
          cognition,
          appearanceChapters,
        })
      }
    } catch {
      // 单个摄入产物解析失败，跳过
    }
  }

  return characterMap
}

/**
 * 从章节正文用 LLM 提取角色。
 *
 * 当章节摄入产物为空时，调用 LLM 直接分析最近 N 章的正文内容，
 * 从中提取出现的角色名称和基本特征（身份、性格、目标等）。
 * 返回的格式与 extractCharactersFromIngestOutput 一致，便于后续补充逻辑复用。
 */
async function extractCharactersFromChapters(
  chapterContents: ExtractedChapterContent[],
  llmConfig: LlmConfig,
): Promise<
  Map<
    string,
    {
      name: string
      aliases: string[]
      profile: string
      cognition: { knows: string[]; doesNotKnow: string[] } | null
      appearanceChapters: number[]
    }
  >
> {
  if (chapterContents.length === 0) return new Map()

  const chaptersText = chapterContents
    .map((ch) => {
      const num = ch.chapterNumber ?? 0
      return `## 第${num}章 ${ch.title}\n\n${ch.content}`
    })
    .join("\n\n---\n\n")

  const systemPrompt = `你是资深小说角色分析专家。请从以下小说章节正文中提取出现的所有重要角色。

输出要求：
1. 只输出 JSON 数组，不要任何额外文字或解释
2. 每个角色包含以下字段：
   - name: 角色姓名（全名）
   - aliases: 别名/昵称数组
   - identity: 身份/职业
   - personality: 性格特征
   - goals: 目标/动机
   - faction: 阵营/势力
   - appearanceChapters: 出现的章节号数组

3. 只提取有明确姓名或身份的角色，忽略路人甲、群众等无名角色
4. 按角色重要性排序，主要角色在前`

  const userPrompt = `以下是小说章节内容：

${chaptersText.slice(0, 15000)}

请提取其中的重要角色信息。`

  try {
    let fullText = ""
    await streamChat(
      llmConfig,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      {
        onToken: (token: string) => {
          fullText += token
        },
        onDone: () => {},
        onError: () => {},
      },
    )

    const jsonMatch = fullText.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return new Map()

    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed)) return new Map()

    const characterMap = new Map<
      string,
      {
        name: string
        aliases: string[]
        profile: string
        cognition: { knows: string[]; doesNotKnow: string[] } | null
        appearanceChapters: number[]
      }
    >()

    for (const item of parsed) {
      const name = String(item.name ?? "").trim()
      if (!name) continue

      const profileParts: string[] = []
      if (item.identity) profileParts.push(`身份：${item.identity}`)
      if (item.personality) profileParts.push(`性格：${item.personality}`)
      if (item.goals) profileParts.push(`目标：${item.goals}`)
      if (item.faction) profileParts.push(`阵营：${item.faction}`)

      const appearanceChapters = Array.isArray(item.appearanceChapters)
        ? item.appearanceChapters.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
        : []

      characterMap.set(name, {
        name,
        aliases: Array.isArray(item.aliases) ? item.aliases.map(String) : [],
        profile: profileParts.join("\n"),
        cognition: null,
        appearanceChapters,
      })
    }

    return characterMap
  } catch {
    return new Map()
  }
}

/**
 * 提取角色完整特征。
 *
 * 主路径：从章节摄入产物（.novel/chapter-ingest-output/）读取角色名与
 * 基础特征（身份/阵营/目标/弧光/认知）。
 * 补充源：光环（.qmai/character-auras/）、角色认知状态、角色档案页。
 */
async function extractCharacters(
  pp: string,
  chapterContents: ExtractedChapterContent[],
  llmConfig?: LlmConfig,
): Promise<ExtractedCharacter[]> {
  // 1. 从章节摄入产物读取角色名和基础特征
  let ingestCharacters = await extractCharactersFromIngestOutput(pp)

  // 2. 如果摄入产物为空，尝试从章节正文用 LLM 提取角色
  if (ingestCharacters.size === 0 && llmConfig && chapterContents.length > 0) {
    const llmCharacters = await extractCharactersFromChapters(chapterContents, llmConfig)
    if (llmCharacters.size > 0) {
      ingestCharacters = llmCharacters
    }
  }

  if (ingestCharacters.size === 0) return []

  // 2. 加载光环数据和绑定关系（补充源）
  const auras = await listCharacterAuras(pp).catch(() => [])
  const bindings = await getCharacterAuraBindings(pp).catch(() => [])

  // 3. 加载角色认知状态（补充源）
  const cognitionState = await loadCognitionState(pp).catch(() => null)

  const characters: ExtractedCharacter[] = []
  for (const [name, info] of ingestCharacters) {
    // 匹配光环绑定（按角色名或别名双向匹配）
    const binding = bindings.find(
      (b) =>
        b.characterName === name ||
        (b.aliases && b.aliases.includes(name)) ||
        (info.aliases && info.aliases.includes(b.characterName)),
    )
    const aura = binding
      ? (auras.find((a) => a.id === binding.auraId) ?? null)
      : null

    // 认知：优先用摄入产物的，其次用 cognitionState
    let cognition = info.cognition
    if (!cognition && cognitionState) {
      const entry = cognitionState.characters.find((c) => c.character === name)
      if (entry) {
        cognition = { knows: entry.knows, doesNotKnow: entry.doesNotKnow }
      }
    }

    // 读取技能文档（来自光环的 skillFolder）
    let skillContent = ""
    if (aura) {
      try {
        skillContent = await loadCharacterAuraSkillDocument(aura, pp)
      } catch {
        // 技能文档读取失败，留空
      }
    }

    // 读取角色档案页（wiki/entities/{name}.md），叠加到摄入产物的 profile 上
    let profile = info.profile
    try {
      const fileProfile = await readFile(`${pp}/wiki/entities/${name}.md`)
      if (fileProfile) {
        profile = profile ? `${profile}\n\n${fileProfile}` : fileProfile
      }
    } catch {
      // 无角色档案页，留空
    }

    characters.push({
      id: name,
      name,
      profile,
      aura,
      cognition,
      // 角色级灵魂文档在当前系统中尚无独立存储，留空；
      // 项目级灵魂文档已在 ExtractionResult.soulDoc 中单独提供。
      soul: "",
      skillContent,
    })
  }

  return characters
}

/**
 * 从大纲内容中提取世界规则。
 *
 * 查找标题中包含"世界规则""世界观""法则"等关键词的章节，
 * 返回该章节标题下方、下一个同级标题之前的正文内容。
 */
function extractWorldRules(outlineContent: string): string {
  return extractSectionByKeyword(outlineContent, [
    "世界规则",
    "世界法则",
    "世界观设定",
    "世界设定",
    "设定规则",
    "法则体系",
    "世界规则设定",
  ])
}

/**
 * 从大纲内容中提取力量体系。
 *
 * 查找标题中包含"力量体系""修炼体系""能力体系"等关键词的章节。
 */
function extractPowerSystem(outlineContent: string): string {
  return extractSectionByKeyword(outlineContent, [
    "力量体系",
    "修炼体系",
    "能力体系",
    "战力体系",
    "魔法体系",
    "超凡体系",
    "力量设定",
    "修炼设定",
  ])
}

/**
 * 通用 Markdown 章节提取：按标题关键词定位章节，返回标题下方正文。
 *
 * 遍历所有标题行，找到第一个包含任一关键词的标题后，
 * 收集该标题之后、直到下一个标题行之间的所有内容。
 */
function extractSectionByKeyword(
  content: string,
  keywords: string[],
): string {
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!/^#{1,6}\s/.test(line)) continue

    const headingLower = line.toLowerCase()
    if (!keywords.some((kw) => headingLower.includes(kw.toLowerCase()))) continue

    // 收集标题下方内容，直到下一个标题行
    const sectionLines: string[] = []
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#{1,6}\s/.test(lines[j])) break
      sectionLines.push(lines[j])
    }
    const section = sectionLines.join("\n").trim()
    if (section) return section
  }
  return ""
}
