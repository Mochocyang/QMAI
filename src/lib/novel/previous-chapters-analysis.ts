import type { LlmConfig } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import { searchWiki } from "@/lib/search"
import { computeContextBudget, planChapterRequestBudget } from "@/lib/context-budget"
import {
  getEffectiveMaxOutputTokens,
  thinkingMinMaxTokens,
} from "@/lib/llm-providers"

/** 前情正文占分析模型窗口的比例；其余留给分析指令与模型输出。 */
const PREVIOUS_BODY_WINDOW_FRAC = 0.5
/** 单章正文最低保留字符数，避免窗口很小时被裁到无信息量。 */
const PREVIOUS_PER_CHAPTER_FLOOR = 800

/** 章节正文超预算时保留首尾、省略中段，避免尾部（结尾/最新状态）被整段丢弃。 */
function clampChapterBody(body: string, maxChars: number): string {
  const normalized = body.trim()
  if (normalized.length <= maxChars) return normalized
  const marker = "\n\n[中间内容已省略，保留首尾]\n\n"
  const available = Math.max(200, maxChars - marker.length)
  const head = Math.ceil(available * 0.6)
  const tail = available - head
  return `${normalized.slice(0, head).trimEnd()}${marker}${tail > 0 ? normalized.slice(-tail).trimStart() : ""}`
}

/**
 * 读取前 N 章正文（去 frontmatter），不做 LLM 分析。读取失败的章节跳过。
 */
export async function readPreviousChapterBodies(
  projectPath: string,
  currentChapterNumber: number,
  analysisCount: number = 3,
  signal?: AbortSignal,
): Promise<Array<{ number: number; content: string }>> {
  if (currentChapterNumber <= 1) return []

  const previousChapters: Array<{ number: number; content: string }> = []
  for (let i = Math.max(1, currentChapterNumber - analysisCount); i < currentChapterNumber; i++) {
    if (signal?.aborted) throw new Error("已停止生成")
    try {
      const results = await searchWiki(projectPath, `chapter_number:${i}`)
      if (results.length > 0) {
        const content = await readFile(results[0].path)
        const bodyStart = content.indexOf("---", 4)
        const body = bodyStart >= 0 ? content.slice(bodyStart + 3).trim() : content
        if (body) previousChapters.push({ number: i, content: body })
      }
    } catch {
      // 忽略读取失败的章节
    }
  }
  return previousChapters
}

/**
 * 读取并分析前几章的完整内容
 */
export async function analyzePreviousChapters(
  projectPath: string,
  currentChapterNumber: number,
  llmConfig: LlmConfig,
  analysisCount: number = 3,
  signal?: AbortSignal,
): Promise<string> {
  const previousChapters = await readPreviousChapterBodies(
    projectPath,
    currentChapterNumber,
    analysisCount,
    signal,
  )

  if (previousChapters.length === 0) return ""

  // 按分析模型自身的上下文窗口分配前情正文预算，均分到各章后保留首尾。
  // 不再无界拼接全文、依赖 llm-client 末级截断。
  const { maxCtx } = computeContextBudget(llmConfig.maxContextSize)
  const bodyBudget = Math.floor(maxCtx * PREVIOUS_BODY_WINDOW_FRAC)
  const perChapterBudget = Math.max(
    PREVIOUS_PER_CHAPTER_FLOOR,
    Math.floor(bodyBudget / previousChapters.length),
  )
  const budgetedChapters = previousChapters.map((ch) => ({
    number: ch.number,
    content: clampChapterBody(ch.content, perChapterBudget),
  }))

  // 构建分析prompt
  const analysisPrompt = buildPreviousChaptersAnalysisPrompt(budgetedChapters, currentChapterNumber)

  // 调用LLM分析：显式挂 analysis 比例预算，避免只靠内核默认 generation 比例。
  const { streamChat } = await import("@/lib/llm-client")
  const analysisBudget = planChapterRequestBudget({
    maxContextSize: llmConfig.maxContextSize,
    stage: "analysis",
    maxOutputTokens: getEffectiveMaxOutputTokens(llmConfig),
    thinkingFloorTokens: thinkingMinMaxTokens(llmConfig.reasoning ?? { mode: "auto" }),
  })
  let analysis = ""

  await streamChat(
    llmConfig,
    [{ role: "user", content: analysisPrompt }],
    {
      onToken: (token) => { analysis += token },
      onDone: () => {},
      onError: () => {},
    },
    signal,
    { max_tokens: analysisBudget.outputTokens },
  )

  if (signal?.aborted) throw new Error("已停止生成")
  return analysis.trim()
}

function buildPreviousChaptersAnalysisPrompt(
  chapters: Array<{ number: number; content: string }>,
  currentChapterNumber: number,
): string {
  const chaptersText = chapters.map(ch =>
    `## 第${ch.number}章完整正文\n\n${ch.content}`
  ).join("\n\n---\n\n")

  return `你是小说前情分析专家。请仔细阅读并分析以下章节的完整正文，为第${currentChapterNumber}章的写作提供准确的前情上下文。

**分析要求**：
1. **逐章摘要**：用2-3句话总结每一章的核心剧情和关键事件
2. **关键节点提取**：列出重要的剧情转折、冲突、决策和伏笔
3. **最近一章详细分析**（第${currentChapterNumber - 1}章）：
   - 章节结尾：最后发生了什么？人物在做什么？场景在哪里？
   - 人物状态：每个出场人物的当前状态、情绪、处境
   - 剧情推进：本章推进了什么主线/支线？
   - 未解伏笔：有哪些伏笔被提及但未回收？
4. **连贯性要点**：第${currentChapterNumber}章开头必须衔接什么？

**注意**：
- 必须基于实际正文内容，不要脑补
- 保留细节（人物对话、动作、场景描述）
- 关注逻辑链条：因果关系、时间顺序、空间位置

---

${chaptersText}

---

请按照上述4点要求输出分析结果。`
}
