import { readFile, writeFile, createDirectory } from "@/commands/fs"
import { buildWikiGraph, type GraphNode, type CommunityInfo } from "@/lib/wiki-graph"
import { streamChat, DEFAULT_LLM_REQUEST_TIMEOUT_MS, type StreamCallbacks } from "@/lib/llm-client"
import type { ChatMessage } from "@/lib/llm-providers"
import { resolveNovelModel } from "@/lib/novel/model-resolver"
import { embedPage, searchByEmbedding } from "@/lib/embedding"
import { useWikiStore, type NovelConfig, type LlmConfig } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"

/** 社区摘要持久化结构 */
export interface CommunitySummaryRecord {
  communityId: number
  summary: string
  nodeCount: number
  topNodes: string[]
  generatedAt: string
}

/** 判断当前章节是否应该触发社区摘要重建 */
export function shouldRebuildCommunitySummaries(
  chapterNumber: number,
  novelConfig: NovelConfig,
): boolean {
  if (!novelConfig.communitySummaryEnabled) return false
  if (chapterNumber <= 0) return false
  const interval = Math.max(1, novelConfig.communitySummaryInterval || 5)
  return chapterNumber % interval === 0
}

/** 生成所有社区的叙事摘要并持久化 + 向量化 */
export async function generateCommunitySummaries(
  projectPath: string,
  llmConfig: LlmConfig,
  novelConfig: NovelConfig,
): Promise<void> {
  const pp = normalizePath(projectPath)
  const { nodes, communities } = await buildWikiGraph(pp)
  if (communities.length === 0) return

  // 按社区 ID 分组节点
  const nodesByCommunity = new Map<number, GraphNode[]>()
  for (const node of nodes) {
    const bucket = nodesByCommunity.get(node.community) ?? []
    bucket.push(node)
    nodesByCommunity.set(node.community, bucket)
  }

  // 准备持久化目录
  const summaryDir = `${pp}/.novel/community-summaries`
  await createDirectory(summaryDir)

  // 解析摘要模型
  const summaryLlmConfig = resolveNovelModel(llmConfig, novelConfig, "summary")
  const embCfg = useWikiStore.getState().embeddingConfig

  // 逐个社区生成摘要
  for (const community of communities) {
    const members = nodesByCommunity.get(community.id) ?? []
    if (members.length === 0) continue

    try {
      const summary = await generateSingleCommunitySummary(community, members, summaryLlmConfig)
      const record: CommunitySummaryRecord = {
        communityId: community.id,
        summary,
        nodeCount: community.nodeCount,
        topNodes: community.topNodes,
        generatedAt: new Date().toISOString(),
      }

      // 持久化到 JSON
      const summaryPath = `${summaryDir}/${community.id}.json`
      await writeFile(summaryPath, JSON.stringify(record, null, 2))

      // 向量化写入 LanceDB（page_id = community:xxx）
      if (embCfg.enabled && embCfg.model) {
        try {
          const pageId = `community:${community.id}`
          const title = `社区 ${community.id} 摘要（${community.topNodes[0] ?? ""}）`
          await embedPage(pp, pageId, title, summary, embCfg)
        } catch (err) {
          console.warn(
            `[CommunitySummary] 向量化社区 ${community.id} 失败:`,
            err instanceof Error ? err.message : err,
          )
        }
      }
    } catch (err) {
      console.warn(
        `[CommunitySummary] 生成社区 ${community.id} 摘要失败:`,
        err instanceof Error ? err.message : err,
      )
    }
  }
}

/** 为单个社区生成叙事摘要（200-400 字） */
async function generateSingleCommunitySummary(
  community: CommunityInfo,
  members: GraphNode[],
  llmConfig: LlmConfig,
): Promise<string> {
  // 收集成员节点内容（前 500 字/节点，最多 10 个节点）
  const topMembers = members
    .sort((a, b) => b.linkCount - a.linkCount)
    .slice(0, 10)
  const memberContents: string[] = []
  for (const member of topMembers) {
    try {
      const content = await readFile(member.path)
      const truncated = content.slice(0, 500).replace(/\s+/g, " ").trim()
      memberContents.push(`【${member.label}】（${member.type}）: ${truncated}`)
    } catch {
      // 跳过读取失败的节点
    }
  }

  if (memberContents.length === 0) {
    return `社区 ${community.id}：包含 ${community.nodeCount} 个节点（${community.topNodes.join("、")}），但无法读取节点内容。`
  }

  const systemPrompt = `你是一位小说编辑助手，擅长分析角色阵营、关系网络和故事结构。请根据给定的图谱社区成员信息，生成一段 200-400 字的叙事摘要，描述这个社区的核心主题、阵营特征、关键关系和重要事件。

要求：
1. 用流畅的叙事语言，不要用列表
2. 突出社区的核心主题和阵营特征
3. 提及关键成员及其关系
4. 涵盖重要事件和冲突
5. 200-400 字，不要超过 400 字`

  const userPrompt = `社区 ID: ${community.id}
社区规模: ${community.nodeCount} 个节点
核心成员: ${community.topNodes.join("、")}

成员详情：
${memberContents.join("\n\n")}

请为这个社区生成叙事摘要。`

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]

  let result = ""
  let streamError: Error | null = null
  const callbacks: StreamCallbacks = {
    onToken: (token: string) => {
      result += token
    },
    onDone: () => {},
    onError: (error: Error) => {
      streamError = error
    },
  }

  await streamChat(llmConfig, messages, callbacks, AbortSignal.timeout(DEFAULT_LLM_REQUEST_TIMEOUT_MS))
  if (streamError) throw streamError

  return result.trim() || `社区 ${community.id}：包含 ${community.nodeCount} 个节点（${community.topNodes.join("、")}）。`
}

/** 检索与查询相关的社区摘要（用于注入上下文） */
export async function searchCommunitySummaries(
  projectPath: string,
  query: string,
  topK: number = 3,
): Promise<string> {
  const pp = normalizePath(projectPath)
  const embCfg = useWikiStore.getState().embeddingConfig
  if (!embCfg.enabled || !embCfg.model) return ""

  try {
    const results = await searchByEmbedding(pp, query, embCfg, topK * 3)
    // 只保留 community: 前缀的结果
    const communityResults = results.filter(r => r.id.startsWith("community:"))
    if (communityResults.length === 0) return ""

    // 取 Top-K
    const top = communityResults.slice(0, topK)
    return top.map(r => {
      const communityId = r.id.replace("community:", "")
      const snippet = r.matchedChunks?.[0]?.text?.slice(0, 400) ?? ""
      return `- 【社区摘要·社区${communityId}】: ${snippet}`
    }).join("\n")
  } catch {
    return ""
  }
}
