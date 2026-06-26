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
import { loadSnapshot, listSnapshots } from "@/lib/novel/chapter-ingest"
import {
  listCharacterAuras,
  getCharacterAuraBindings,
  loadCharacterAuraSkillDocument,
} from "@/lib/novel/character-aura"
import type {
  ExtractionResult,
  ExtractedCharacter,
  ExtractedChapterContent,
  ExtractedMemoryData,
} from "./types"

// ── 对外接口 ──

export interface ExtractionOptions {
  sourceChapters: number
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
  const { sourceChapters, onProgress } = options
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
  const characters = await extractCharacters(pp)

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
 * 提取角色完整特征。
 *
 * 从章节快照中获取角色名列表，然后匹配光环（aura）、
 * 认知（cognition）和技能（skill）数据，并读取角色档案页。
 */
async function extractCharacters(pp: string): Promise<ExtractedCharacter[]> {
  // 从章节快照中收集角色名
  const snapshotNumbers = (await listSnapshots(pp).catch(() => [])).filter(
    (n) => n > 0,
  )

  const characterNames = new Set<string>()
  for (const num of snapshotNumbers) {
    try {
      const snapshot = await loadSnapshot(pp, num)
      if (snapshot) {
        for (const name of snapshot.characters) {
          const trimmed = name.trim()
          if (trimmed) characterNames.add(trimmed)
        }
      }
    } catch {
      // 单个快照加载失败，跳过
    }
  }

  if (characterNames.size === 0) return []

  // 加载光环数据和绑定关系
  const auras = await listCharacterAuras(pp).catch(() => [])
  const bindings = await getCharacterAuraBindings(pp).catch(() => [])

  // 加载角色认知状态
  const cognitionState = await loadCognitionState(pp).catch(() => null)

  const characters: ExtractedCharacter[] = []
  for (const name of characterNames) {
    // 匹配光环绑定（按角色名或别名）
    const binding = bindings.find(
      (b) => b.characterName === name || (b.aliases && b.aliases.includes(name)),
    )
    const aura = binding
      ? (auras.find((a) => a.id === binding.auraId) ?? null)
      : null

    // 匹配认知数据
    const cognitionEntry =
      cognitionState?.characters.find((c) => c.character === name) ?? null
    const cognition = cognitionEntry
      ? { knows: cognitionEntry.knows, doesNotKnow: cognitionEntry.doesNotKnow }
      : null

    // 读取技能文档（来自光环的 skillFolder）
    let skillContent = ""
    if (aura) {
      try {
        skillContent = await loadCharacterAuraSkillDocument(aura, pp)
      } catch {
        // 技能文档读取失败，留空
      }
    }

    // 读取角色档案页（wiki/entities/{name}.md）
    let profile = ""
    try {
      profile = await readFile(`${pp}/wiki/entities/${name}.md`)
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
