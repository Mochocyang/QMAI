import { readFile, writeFile, createDirectory, listDirectory } from "@/commands/fs"
import { buildWikiGraph, type GraphNode, type CommunityInfo } from "@/lib/wiki-graph"
import { streamChat, DEFAULT_LLM_REQUEST_TIMEOUT_MS, type StreamCallbacks } from "@/lib/llm-client"
import type { ChatMessage } from "@/lib/llm-providers"
import { resolveNovelModel } from "@/lib/novel/model-resolver"
import { embedPage, searchByEmbedding } from "@/lib/embedding"
import { useWikiStore, type NovelConfig, type LlmConfig } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"
import { fingerprintText } from "@/lib/novel/book-analysis/content-fingerprint"
import {
  buildNovelVectorSnippet,
  selectRelevantNovelVectorResults,
} from "./vector-relevance"

/** 小于该规模的社区不调 LLM（孤立节点 / 噪声簇）。 */
export const MIN_COMMUNITY_SUMMARY_NODE_COUNT = 5

/** 社区摘要持久化结构 */
interface CommunitySummaryRecord {
  communityId: number
  memberFingerprint: string
  memberIds: string[]
  summary: string
  nodeCount: number
  topNodes: string[]
  generatedAt: string
}

const inFlight = new Map<string, Promise<void>>()

export function __resetCommunitySummaryLocksForTesting(): void {
  inFlight.clear()
}

/** 成员 ID 排序后的稳定指纹。Louvain 重编号不应改变结果。 */
export function communityMemberFingerprint(memberIds: readonly string[]): string {
  return fingerprintText(
    [...memberIds]
      .map((id) => id.trim())
      .filter(Boolean)
      .sort()
      .join("\0"),
  )
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException("The operation was aborted.", "AbortError")
}

function combineAbortSignals(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(DEFAULT_LLM_REQUEST_TIMEOUT_MS)
  if (!signal) return timeout
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout])
  return signal
}

function parseStoredRecord(raw: unknown): CommunitySummaryRecord | null {
  if (!raw || typeof raw !== "object") return null
  const rec = raw as Record<string, unknown>
  if (typeof rec.memberFingerprint !== "string" || !rec.memberFingerprint.trim()) return null
  if (typeof rec.summary !== "string" || !rec.summary.trim()) return null
  const memberIds = Array.isArray(rec.memberIds)
    ? rec.memberIds.filter((id): id is string => typeof id === "string")
    : []
  return {
    communityId: typeof rec.communityId === "number" ? rec.communityId : -1,
    memberFingerprint: rec.memberFingerprint,
    memberIds,
    summary: rec.summary,
    nodeCount: typeof rec.nodeCount === "number" ? rec.nodeCount : memberIds.length,
    topNodes: Array.isArray(rec.topNodes)
      ? rec.topNodes.filter((name): name is string => typeof name === "string")
      : [],
    generatedAt: typeof rec.generatedAt === "string" ? rec.generatedAt : "",
  }
}

async function loadExistingByFingerprint(
  summaryDir: string,
): Promise<Map<string, CommunitySummaryRecord>> {
  const map = new Map<string, CommunitySummaryRecord>()
  let files
  try {
    files = await listDirectory(summaryDir, { includeHidden: false, maxDepth: 1 })
  } catch {
    return map
  }
  for (const file of files) {
    if (file.is_dir || !file.name.endsWith(".json")) continue
    try {
      const record = parseStoredRecord(JSON.parse(await readFile(file.path)))
      if (record) map.set(record.memberFingerprint, record)
    } catch {
      // 跳过坏文件
    }
  }
  return map
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

async function generateCommunitySummariesUnlocked(
  projectPath: string,
  llmConfig: LlmConfig,
  novelConfig: NovelConfig,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal)
  const pp = normalizePath(projectPath)
  const { nodes, communities } = await buildWikiGraph(pp)
  if (communities.length === 0) return

  const nodesByCommunity = new Map<number, GraphNode[]>()
  for (const node of nodes) {
    const bucket = nodesByCommunity.get(node.community) ?? []
    bucket.push(node)
    nodesByCommunity.set(node.community, bucket)
  }

  const summaryDir = `${pp}/.novel/community-summaries`
  await createDirectory(summaryDir)
  const existing = await loadExistingByFingerprint(summaryDir)

  const summaryLlmConfig = resolveNovelModel(llmConfig, novelConfig, "summary")
  const embCfg = useWikiStore.getState().embeddingConfig

  for (const community of communities) {
    throwIfAborted(signal)
    const members = nodesByCommunity.get(community.id) ?? []
    if (members.length < MIN_COMMUNITY_SUMMARY_NODE_COUNT) continue
    if (community.nodeCount < MIN_COMMUNITY_SUMMARY_NODE_COUNT) continue

    const memberIds = members.map((member) => member.id)
    const fingerprint = communityMemberFingerprint(memberIds)
    if (existing.get(fingerprint)?.summary.trim()) continue

    try {
      const summary = await generateSingleCommunitySummary(
        community,
        members,
        summaryLlmConfig,
        signal,
      )
      const record: CommunitySummaryRecord = {
        communityId: community.id,
        memberFingerprint: fingerprint,
        memberIds,
        summary,
        nodeCount: members.length,
        topNodes: community.topNodes,
        generatedAt: new Date().toISOString(),
      }

      await writeFile(`${summaryDir}/${fingerprint}.json`, JSON.stringify(record, null, 2))
      existing.set(fingerprint, record)

      if (embCfg.enabled && embCfg.model) {
        try {
          const title = `社区摘要（${community.topNodes[0] ?? fingerprint.slice(0, 8)}）`
          await embedPage(pp, `community:${fingerprint}`, title, summary, embCfg)
        } catch (err) {
          console.warn(
            `[CommunitySummary] 向量化社区 ${fingerprint} 失败:`,
            err instanceof Error ? err.message : err,
          )
        }
      }
    } catch (err) {
      if (signal?.aborted) throw err
      console.warn(
        `[CommunitySummary] 生成社区 ${fingerprint} 摘要失败:`,
        err instanceof Error ? err.message : err,
      )
    }
  }
}

/** 生成规模达标且成员集变化过的社区叙事摘要并持久化 + 向量化 */
export async function generateCommunitySummaries(
  projectPath: string,
  llmConfig: LlmConfig,
  novelConfig: NovelConfig,
  signal?: AbortSignal,
): Promise<void> {
  const key = normalizePath(projectPath)
  const pending = inFlight.get(key)
  if (pending) return pending

  const run = generateCommunitySummariesUnlocked(projectPath, llmConfig, novelConfig, signal)
    .finally(() => {
      if (inFlight.get(key) === run) inFlight.delete(key)
    })
  inFlight.set(key, run)
  return run
}

/** 为单个社区生成叙事摘要（200-400 字） */
async function generateSingleCommunitySummary(
  community: CommunityInfo,
  members: GraphNode[],
  llmConfig: LlmConfig,
  signal?: AbortSignal,
): Promise<string> {
  const topMembers = members
    .sort((a, b) => b.linkCount - a.linkCount)
    .slice(0, 10)
  const memberContents: string[] = []
  for (const member of topMembers) {
    throwIfAborted(signal)
    try {
      const content = await readFile(member.path)
      const truncated = content.slice(0, 500).replace(/\s+/g, " ").trim()
      memberContents.push(`【${member.label}】（${member.type}）: ${truncated}`)
    } catch {
      // 跳过读取失败的节点
    }
  }

  if (memberContents.length === 0) {
    return `社区：包含 ${community.nodeCount} 个节点（${community.topNodes.join("、")}），但无法读取节点内容。`
  }

  const systemPrompt = `你是一位小说编辑助手，擅长分析角色阵营、关系网络和故事结构。请根据给定的图谱社区成员信息，生成一段 200-400 字的叙事摘要，描述这个社区的核心主题、阵营特征、关键关系和重要事件。

要求：
1. 用流畅的叙事语言，不要用列表
2. 突出社区的核心主题和阵营特征
3. 提及关键成员及其关系
4. 涵盖重要事件和冲突
5. 200-400 字，不要超过 400 字`

  const userPrompt = `社区规模: ${community.nodeCount} 个节点
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

  await streamChat(llmConfig, messages, callbacks, combineAbortSignals(signal))
  if (streamError) throw streamError

  return result.trim() || `社区：包含 ${community.nodeCount} 个节点（${community.topNodes.join("、")}）。`
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
    const communityResults = selectRelevantNovelVectorResults(
      results.filter(r => r.id.startsWith("community:")),
      topK,
    )
    if (communityResults.length === 0) return ""

    return communityResults.map(r => {
      const heading = r.matchedChunks?.[0]?.headingPath
      const snippet = buildNovelVectorSnippet(r, 400)
      return `- 【社区摘要${heading ? `·${heading}` : ""}】: ${snippet}`
    }).join("\n")
  } catch {
    return ""
  }
}
