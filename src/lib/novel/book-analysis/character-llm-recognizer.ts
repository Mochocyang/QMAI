/**
 * LLM 角色识别（feature/llm-character-recognizer）
 *
 * 替代启发式正则：直接让 LLM 从章节内容中识别所有重要角色。
 * 优点：不受正则模式限制，能识别罕见人名、过滤代词/副词/对话内容。
 * 缺点：依赖真实 LLM endpoint（失败时回退到 heuristicRecognizeCharacters）。
 */

import { streamChat } from "@/lib/llm-client"
import type { ChatMessage } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import { stableCharacterId } from "./character-recognition-engine"
import type { RecognizedCharacter, CharacterCategory } from "./types"

// ============================================================
// 入口类型
// ============================================================
export interface LlmRecognizeInput {
  chapters: { index: number; content: string }[]
  llmConfig: LlmConfig
  /** 失败兜底时会用此源书名生成稳定 id */
  sourceBook?: string
  signal?: AbortSignal
  /** 测试注入点：跳过真实 HTTP 调用，直接返回字符串。生产环境不传 */
  _llmCall?: (prompt: string) => Promise<string>
}

// ============================================================
// Prompt 模板
// ============================================================
const RECOGNITION_PROMPT = `你是一个中文小说角色分析助手。下面是若干章节的小说节选（每章 800 字以内）。

# 任务
识别文中**所有重要角色**（主角 + 配角），只输出有具体姓名的人物。**严格忽略**：
- 代词（"他/她/我/我们/他们/你"）
- 副词 / 方位词（"这时/那时/这里/那里/突然/于是"）
- 称呼（"皇上/陛下/大人/公子/小姐/姑娘"，没有具体姓名的）
- 描述性短语（"那位老者/街上的路人/某个男子"）
- 对话内容本身（引号里的句子）

# 输出格式
严格返回 JSON 数组，每个角色：
- "name": 角色**全名**（**不要简称**，统一为最完整名。例：输出 "许七安" 而非 "许七"）
- "importanceScore": 0-100 重要度（剧情参与度、戏份多少）
- "category": "主角" / "配角" / "次要"
- "chapterIndices": 出现的章节索引（0-based 数组）
- "aliases": 别名 / 简称列表（数组，可空）

# 章节内容
{{chapters}}

# 输出
**只返回 JSON 数组**，不要任何其他文字、解释或代码块标记。`

/**
 * 调 LLM 识别角色（主入口）
 * 失败（网络/超时/解析错）时抛 Error，调用方需自行回退到启发式
 */
export async function llmRecognizeCharacters(
  input: LlmRecognizeInput
): Promise<RecognizedCharacter[]> {
  const { chapters, llmConfig, sourceBook = "", signal, _llmCall } = input

  if (chapters.length === 0) return []

  // 1. 构造 prompt（每章限 800 字避免 prompt 爆炸）
  const chapterText = chapters
    .map((c) => `【第 ${c.index + 1} 章】\n${c.content.slice(0, 800)}`)
    .join("\n\n")
  const prompt = RECOGNITION_PROMPT.replace("{{chapters}}", chapterText)

  // 2. 调 LLM（生产：streamChat 累积 token；测试：注入 _llmCall 直接返回字符串）
  let raw: string
  if (_llmCall) {
    raw = await _llmCall(prompt)
  } else {
    raw = await callLlmForRecognition(llmConfig, prompt, signal)
  }

  // 3. 解析 JSON
  const parsed = parseRecognitionResponse(raw)

  // 4. 转换为 RecognizedCharacter 格式 + 应用识别规则
  const results: RecognizedCharacter[] = []
  for (const p of parsed) {
    if (!p.name || typeof p.name !== "string") continue
    const trimmed = p.name.trim()
    if (!trimmed) continue
    const chapterIndices = Array.isArray(p.chapterIndices)
      ? p.chapterIndices.filter((i) => Number.isInteger(i) && i >= 0 && i < chapters.length)
      : []
    if (chapterIndices.length === 0) continue
    results.push({
      id: stableCharacterId(trimmed, sourceBook),
      name: trimmed,
      aliases: Array.isArray(p.aliases) ? p.aliases.filter((a) => typeof a === "string") : [],
      appearances: chapterIndices.length,
      chapterIndices: chapterIndices.sort((a, b) => a - b),
      importanceScore: clampScore(p.importanceScore),
      category: normalizeCategory(p.category, p.importanceScore),
      sourceBook,
    })
  }

  // 5. 按重要度降序
  return results.sort((a, b) => b.importanceScore - a.importanceScore)
}

// ============================================================
// 内部 helper
// ============================================================
async function callLlmForRecognition(
  llmConfig: LlmConfig,
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  const messages: ChatMessage[] = [{ role: "user", content: prompt }]
  let response = ""
  await streamChat(
    llmConfig,
    messages,
    {
      onToken: (text) => {
        response += text
      },
      onDone: () => {},
      onError: (err) => {
        console.error("[llm-character-recognizer] LLM error:", err)
      },
    },
    signal
  )
  return response.trim()
}

/**
 * 解析 LLM 返回的 JSON 响应
 * 兼容：纯 JSON 数组 / JSON 数组被包在 markdown ```json ... ``` 中 / 前后有解释文字
 */
function parseRecognitionResponse(raw: string): Array<{
  name: string
  importanceScore: number
  category: CharacterCategory
  chapterIndices: number[]
  aliases?: string[]
}> {
  if (!raw) return []
  // 尝试提取 JSON 数组
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()
  // 找到第一个 [ 和最后一个 ]
  const start = cleaned.indexOf("[")
  const end = cleaned.lastIndexOf("]")
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM 响应中未找到 JSON 数组")
  }
  const jsonStr = cleaned.slice(start, end + 1)
  try {
    const parsed = JSON.parse(jsonStr)
    if (!Array.isArray(parsed)) throw new Error("LLM 响应不是 JSON 数组")
    return parsed
  } catch (e) {
    throw new Error(`LLM 响应 JSON 解析失败：${(e as Error).message}`)
  }
}

function clampScore(score: unknown): number {
  if (typeof score !== "number" || !Number.isFinite(score)) return 50
  return Math.max(0, Math.min(100, Math.round(score)))
}

function normalizeCategory(
  category: unknown,
  score: number
): CharacterCategory {
  if (category === "主角" || category === "配角" || category === "次要") {
    return category
  }
  // 类别无效时按分数兜底
  if (score >= 70) return "主角"
  if (score >= 30) return "配角"
  return "次要"
}
