import { createHash } from "crypto"
import type { RecognizedCharacter, CharacterCategory } from "./types"

/**
 * 生成稳定 id：基于 name + sourceBook 哈希
 * 同一本书 + 同一角色名 → 同一 id（多次识别结果可复用 / 匹配）
 */
export function stableCharacterId(name: string, sourceBook: string): string {
  const seed = `${name}|${sourceBook}`
  return createHash("sha256").update(seed).digest("hex").slice(0, 12)
}

// ============================================================
// 启发式识别（按章节统计名字频次）
// ============================================================
export interface HeuristicInput {
  chapters: { index: number; content: string }[]
  minChapters: number  // 至少在多少章出现才算"高频"
  sourceBook?: string  // 用于生成稳定 id
}

// 简单中文人名匹配：2-4 个汉字，首字符大写或非汉字
// 注：当前实现是占位，准确度不高；后续可接入 NLP 库
function extractCandidateNames(text: string): string[] {
  const names: string[] = []
  // 匹配"某某道"、"某某说"等中文说话模式 - 取前 2-3 字
  const pattern = /([\u4e00-\u9fa5]{2,3})(?:道|说|笑|问|答|想|道：|说：)/g
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    names.push(m[1])
  }
  // 按标点切分，匹配每段开头的 2-3 字中文（人名通常 2-3 字）
  const segments = text.split(/[。！？\n，,]/).map((s) => s.trim()).filter((s) => s.length >= 2)
  for (const seg of segments) {
    if (seg.length >= 3) {
      names.push(seg.slice(0, 3))
    } else {
      names.push(seg)
    }
  }
  return names
}

export function heuristicRecognizeCharacters(input: HeuristicInput): RecognizedCharacter[] {
  const { chapters, minChapters, sourceBook = "" } = input
  if (chapters.length === 0) return []

  // 统计每个名字的章节集合
  const nameChapters = new Map<string, Set<number>>()
  for (const ch of chapters) {
    const names = new Set(extractCandidateNames(ch.content))
    for (const n of names) {
      if (!nameChapters.has(n)) nameChapters.set(n, new Set())
      nameChapters.get(n)!.add(ch.index)
    }
  }

  // 过滤 + 排序（按章节数降序）
  const results: RecognizedCharacter[] = []
  for (const [name, chapterSet] of nameChapters) {
    if (chapterSet.size < minChapters) continue
    const chapterIndices = Array.from(chapterSet).sort((a, b) => a - b)
    results.push({
      id: stableCharacterId(name, sourceBook),  // 基于 name + sourceBook 的稳定 id
      name,
      aliases: [],
      appearances: chapterSet.size,
      chapterIndices,
      importanceScore: chapterSet.size * 10,  // 临时分数，LLM 评分覆盖
      category: classifyByScore(chapterSet.size * 10),
      sourceBook,
    })
  }

  return results.sort((a, b) => b.appearances - a.appearances)
}

function classifyByScore(score: number): CharacterCategory {
  if (score >= 70) return "主角"
  if (score >= 40) return "配角"
  return "次要"
}

// ============================================================
// LLM 评分（覆盖启发式分数）
// ============================================================
export interface LlmScoringInput {
  candidates: RecognizedCharacter[]
  chapters: { index: number; content: string }[]
  llmConfig: { endpoint: string; apiKey?: string; model: string }
  signal?: AbortSignal
  // 测试注入点（生产环境不传）
  _llmCall?: (prompt: string) => Promise<string>
}

export interface LlmScoringOutput {
  scored: RecognizedCharacter[]
}

const SCORING_PROMPT = `你是一个小说角色分析助手。下面是候选角色列表（来自启发式统计），请根据角色在章节中的剧情参与度给每个角色打"重要度"分（0-100），并判断其类别（主角/配角/次要）。

# 候选角色（中频：启发式后还需要 LLM 评分的"潜在隐藏 BOSS"或次重要角色）
{{midCandidates}}

# 章节内容（节选）
{{chapterSamples}}

# 输出格式（JSON 数组）
[
  { "name": "角色名", "importanceScore": 0-100, "category": "主角|配角|次要", "aliases": ["别名1"] }
]
只返回 JSON，不要其他文字。`

/**
 * LLM 评分时只送"中频"角色：启发式全名单独立保留（高频频次角色已有充分信号），
 * LLM 仅补足"中频"角色（潜在隐藏 BOSS），限制数量避免 prompt 过载。
 *
 * 启发式频次 / 出场 ≤ maxAppearances（默认 2）才算中频；
 * 同时截断到 maxCandidates（默认 30）防 prompt 爆炸。
 */
export function filterMidFrequencyCandidates(
  candidates: RecognizedCharacter[],
  options: { maxAppearances?: number; maxCandidates?: number } = {}
): RecognizedCharacter[] {
  const { maxAppearances = 2, maxCandidates = 30 } = options
  return candidates
    .filter((c) => c.appearances <= maxAppearances)
    .slice(0, maxCandidates)
}

export async function llmScoreCharacters(
  input: LlmScoringInput
): Promise<LlmScoringOutput> {
  const { candidates, chapters, signal, _llmCall } = input
  // llmConfig 保留在接口中（生产代码传入），此处占位以避免 lint 警告
  void input.llmConfig

  // 启发式全名单独立保留（高频角色已有充分信号，无需再送 LLM）
  // 只对"中频"角色（潜在隐藏 BOSS）调用 LLM 评分
  const midFrequencyCandidates = filterMidFrequencyCandidates(candidates)

  // 没有中频角色可评分 → 直接返回（避免空 prompt）
  if (midFrequencyCandidates.length === 0) {
    return { scored: candidates }
  }

  // 构建 prompt（仅含中频角色）
  const candidateList = midFrequencyCandidates
    .map((c) => `- ${c.name}（${c.appearances} 章）`)
    .join("\n")
  const chapterSamples = chapters
    .slice(0, 5)  // 仅前 5 章
    .map((c) => `【第 ${c.index + 1} 章】\n${c.content.slice(0, 500)}`)
    .join("\n\n")
  const prompt = SCORING_PROMPT
    .replace("{{midCandidates}}", candidateList)
    .replace("{{chapterSamples}}", chapterSamples)

  try {
    const llmFn = _llmCall ?? defaultLlmCall
    const raw = await llmFn(prompt)
    if (signal?.aborted) throw new Error("aborted")
    const parsed = JSON.parse(raw) as Array<{
      name: string
      importanceScore: number
      category: CharacterCategory
      aliases?: string[]
    }>

    // 合并：仅中频角色用 LLM 结果覆盖分数；高频角色保留启发式分数
    const scored: RecognizedCharacter[] = candidates.map((c) => {
      const isMidFreq = c.appearances <= 2
      if (!isMidFreq) return c
      const llmResult = parsed.find((p) => p.name === c.name)
      if (llmResult) {
        return {
          ...c,
          importanceScore: llmResult.importanceScore,
          category: llmResult.category,
          aliases: llmResult.aliases ?? c.aliases,
        }
      }
      return c
    })

    return { scored }
  } catch {
    // LLM 失败 → 保留启发式分数
    return { scored: candidates }
  }
}

async function defaultLlmCall(_prompt: string): Promise<string> {
  // 占位：实际项目里应调真实 LLM endpoint
  // 暂时 throw 让回退逻辑生效
  throw new Error("defaultLlmCall not implemented in this context")
}
