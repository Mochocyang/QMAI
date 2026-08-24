import type { ChatMessage } from "@/lib/llm-client"
import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import type {
  CharacterAnalysis,
  DraftChapter,
  SimulationReport,
  StoryBranch,
  StoryDraft,
  StoryFramework,
  StoryNode,
} from "@/lib/novel/story-simulation/types"

// ── 对外接口 ──

interface DraftGenerationOptions {
  framework: StoryFramework
  report: SimulationReport
  selectedBranch: StoryBranch
  llmConfig: LlmConfig
  onProgress?: (label: string) => void
  onChapterGenerated?: (chapter: DraftChapter) => void
  signal?: AbortSignal
}

// ── 内部辅助：将 streamChat 的流式回调收拢为一个完整字符串 ──

async function collectStream(
  config: LlmConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  let result = ""
  let streamError: Error | null = null

  await streamChat(
    config,
    messages,
    {
      onToken: (token) => {
        result += token
      },
      onDone: () => {},
      onError: (err) => {
        streamError = err
      },
    },
    signal,
  )

  if (streamError) throw streamError
  return result
}

// ── 内部辅助：统计正文字数（按非空白字符近似，中文每字计 1） ──

function countWords(text: string): number {
  return text.replace(/\s/g, "").length
}

// ── 内部辅助：构建单章提示词 ──

function buildChapterPrompt(
  node: StoryNode,
  branch: StoryBranch,
  relatedAnalyses: CharacterAnalysis[],
  chapterIndex: number,
  totalChapters: number,
  targetWords: number,
): string {
  const lines: string[] = []
  lines.push(`当前是第 ${chapterIndex + 1} / ${totalChapters} 章，对应故事框架中的「${node.title}」节点。`)
  lines.push("")
  lines.push("【当前节点信息】")
  lines.push(`阶段：${node.phase}`)
  lines.push(`节点标题：${node.title}`)
  lines.push(`核心冲突：${node.coreConflict}`)
  lines.push(`涉及角色：${node.involvedCharacters.join("、") || "（未指定）"}`)
  lines.push(`本章目标：${node.goal}`)
  lines.push(`预期结果：${node.expectedOutcome}`)
  if (node.causeFromPrev) {
    lines.push(`承接上文的因果：${node.causeFromPrev}`)
  }
  lines.push("")
  lines.push("【选择的推演走向分支】")
  lines.push(`分支标题：${branch.title}`)
  lines.push(`分支概要：${branch.summary}`)
  lines.push(`关键事件：${branch.keyEvents.length > 0 ? branch.keyEvents.join("；") : "（无）"}`)
  lines.push("")
  lines.push("【相关角色的行为分析】")
  if (relatedAnalyses.length === 0) {
    lines.push("（无相关角色的行为分析数据）")
  } else {
    for (const analysis of relatedAnalyses) {
      lines.push(`角色：${analysis.name}`)
      // 优先取与当前节点相关的行为；若没有则展示该角色的全部行为，保留上下文。
      const nodeBehaviors = analysis.behaviors.filter((b) => b.node === node.title)
      const behaviors = nodeBehaviors.length > 0 ? nodeBehaviors : analysis.behaviors
      for (const b of behaviors) {
        lines.push(`  - 行为：${b.action}（动机：${b.motivation}）`)
      }
      if (analysis.stateChanges.length > 0) {
        lines.push(`  状态变化：${analysis.stateChanges.join("；")}`)
      }
    }
  }
  lines.push("")
  lines.push("【写作要求】")
  lines.push("1. 请根据以上框架节点、走向分支和角色行为分析，撰写本章正文。")
  lines.push(`2. 本章目标字数约 ${targetWords} 字。`)
  lines.push("3. 只输出正文内容，不要输出章节标题，也不要输出任何说明、标注或元信息。")
  lines.push("4. 保持叙事连贯，自然承接上一章。")
  return lines.join("\n")
}

// ── 主流程：按框架节点逐章生成故事草稿 ──

export async function generateStoryDraft(options: DraftGenerationOptions): Promise<StoryDraft> {
  const { framework, report, selectedBranch, llmConfig, onProgress, onChapterGenerated, signal } = options

  const nodes = framework.nodes
  const nodeCount = nodes.length
  const perChapterTarget =
    nodeCount > 0 ? Math.max(1, Math.round(framework.targetWords / nodeCount)) : framework.targetWords

  const chapters: DraftChapter[] = []
  let totalWords = 0

  const systemPrompt =
    "你是一位专业的小说作者。请根据提供的故事框架与角色行为分析，撰写高质量的章节正文。" +
    "要求叙事连贯、人物性格一致、冲突推进合理。只输出正文，不要输出章节标题或任何说明性文字。"

  for (let i = 0; i < nodeCount; i += 1) {
    const node = nodes[i]
    onProgress?.(`正在生成第 ${i + 1}/${nodeCount} 章：${node.title}`)

    // 从推演报告中筛选当前节点涉及的角色行为分析
    const involvedNames = new Set(node.involvedCharacters)
    const relatedAnalyses = report.characterAnalyses.filter(
      (analysis) => involvedNames.has(analysis.name) || involvedNames.has(analysis.characterId),
    )

    const userPrompt = buildChapterPrompt(
      node,
      selectedBranch,
      relatedAnalyses,
      i,
      nodeCount,
      perChapterTarget,
    )

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]

    const content = await collectStream(llmConfig, messages, signal)
    const trimmed = content.trim()

    const chapter: DraftChapter = {
      title: node.title,
      content: trimmed,
      correspondingNode: node.index,
      rawContent: trimmed,
    }

    chapters.push(chapter)
    totalWords += countWords(trimmed)
    onChapterGenerated?.(chapter)
  }

  const draft: StoryDraft = {
    branchId: selectedBranch.title,
    frameworkId: framework.id,
    chapters,
    totalWords,
    createdAt: new Date().toISOString(),
  }

  return draft
}
