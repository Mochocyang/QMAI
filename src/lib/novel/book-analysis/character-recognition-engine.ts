import type { RecognizedCharacter, CharacterCategory } from "./types"

// ============================================================
// 启发式识别（按章节统计名字频次）
// ============================================================
export interface HeuristicInput {
  chapters: { index: number; content: string }[]
  minChapters: number  // 至少在多少章出现才算"高频"
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
  const { chapters, minChapters } = input
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
      id: `heuristic-${name}`,  // 临时 id，LLM 评分阶段会基于 sourceBook 重新生成
      name,
      aliases: [],
      appearances: chapterSet.size,
      chapterIndices,
      importanceScore: chapterSet.size * 10,  // 临时分数，LLM 评分覆盖
      category: classifyByScore(chapterSet.size * 10),
      sourceBook: "",
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
}

export interface LlmScoringOutput {
  scored: RecognizedCharacter[]  // 含 importanceScore 0-100
}

export async function llmScoreCharacters(
  input: LlmScoringInput
): Promise<LlmScoringOutput> {
  // 占位：实际实现见 Task 4
  return { scored: input.candidates }
}
