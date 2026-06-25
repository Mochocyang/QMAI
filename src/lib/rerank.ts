import { streamChat } from "@/lib/llm-client"
import { useWikiStore, type LlmConfig, type RerankConfig } from "@/stores/wiki-store"
import { isDirectRerankEndpoint, requestDirectRerank } from "@/lib/rerank-api"
import { resolveDefaultModel } from "@/lib/novel/model-resolver"

export interface RerankCandidate {
  id: string
  title: string
  snippet: string
  source?: string
  path?: string
}

interface RerankResponseItem {
  id: string
  score?: number
}

interface RerankResponse {
  order?: RerankResponseItem[]
}

export interface RerankOptions {
  topK?: number
  purpose?: string
}

function extractJsonObject(raw: string): RerankResponse {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced?.match(/\{[\s\S]*\}/)?.[0] ?? raw.match(/\{[\s\S]*\}/)?.[0]
  if (!candidate) {
    throw new Error("Rerank response did not contain JSON")
  }
  return JSON.parse(candidate) as RerankResponse
}

function resolveRerankModel(
  baseConfig: LlmConfig,
  rerankConfig: RerankConfig,
): LlmConfig | null {
  if (!rerankConfig.enabled) return null
  if (rerankConfig.useMainLlm) {
    return { ...baseConfig, reasoning: { mode: "off" } }
  }
  if (!rerankConfig.model.trim()) return null
  return {
    provider: rerankConfig.provider,
    apiKey: rerankConfig.apiKey,
    model: rerankConfig.model,
    ollamaUrl: rerankConfig.ollamaUrl,
    customEndpoint: rerankConfig.customEndpoint,
    apiMode: rerankConfig.provider === "custom" ? rerankConfig.apiMode : undefined,
    maxContextSize: Math.min(baseConfig.maxContextSize ?? 65536, 65536),
    reasoning: { mode: "off" },
  }
}

function buildPrompt(
  query: string,
  candidates: RerankCandidate[],
  purpose?: string,
): string {
  const serialized = candidates.map((candidate, index) => ({
    id: candidate.id,
    rank: index + 1,
    title: candidate.title,
    source: candidate.source ?? "",
    path: candidate.path ?? "",
    snippet: candidate.snippet.slice(0, 500),
  }))

  return [
    "你是一个检索结果重排助手。",
    "你的任务是根据查询意图，把候选结果按最相关到最不相关重新排序。",
    "不要生成新条目，不要修改 id，不要解释过程。",
    "优先考虑：与查询目标的直接相关性、对当前任务的可执行价值、事实约束和记忆一致性。",
    purpose ? `当前用途：${purpose}` : "",
    "",
    `查询：${query}`,
    "",
    "候选结果 JSON：",
    JSON.stringify(serialized, null, 2),
    "",
    "只返回 JSON，对象格式必须是：",
    '{"order":[{"id":"候选id","score":0.0}]}',
  ].filter(Boolean).join("\n")
}

export function isRerankEnabled(rerankConfig: RerankConfig): boolean {
  return rerankConfig.enabled
}

export async function rerankCandidates<T extends RerankCandidate>(
  query: string,
  candidates: T[],
  options: RerankOptions = {},
): Promise<T[]> {
  if (candidates.length <= 1) return candidates.slice(0, options.topK ?? candidates.length)

  const { llmConfig: rawLlmConfig, rerankConfig } = useWikiStore.getState()
  const llmConfig = resolveDefaultModel(rawLlmConfig)
  const modelConfig = resolveRerankModel(llmConfig, rerankConfig)
  if (!modelConfig) {
    return candidates.slice(0, options.topK ?? candidates.length)
  }

  const candidateLimit = Math.min(
    candidates.length,
    Math.max(options.topK ?? 0, rerankConfig.maxCandidates),
  )
  const candidateSlice = candidates.slice(0, candidateLimit)
  const prompt = buildPrompt(query, candidateSlice, options.purpose)

  if (isDirectRerankEndpoint(modelConfig)) {
    try {
      const directResults = await requestDirectRerank(
        modelConfig,
        query,
        candidateSlice.map((candidate) => [candidate.title, candidate.snippet, candidate.source, candidate.path].filter(Boolean).join("\n")),
        AbortSignal.timeout(45000),
      )
      const ordered: T[] = []
      const used = new Set<number>()
      for (const item of directResults) {
        if (!Number.isInteger(item.index) || item.index < 0 || item.index >= candidateSlice.length || used.has(item.index)) continue
        used.add(item.index)
        ordered.push(candidateSlice[item.index] as T)
      }
      for (let index = 0; index < candidateSlice.length; index += 1) {
        if (used.has(index)) continue
        ordered.push(candidateSlice[index] as T)
      }
      const result = [...ordered, ...candidates.slice(candidateLimit)]
      return result.slice(0, options.topK ?? result.length)
    } catch (error) {
      console.warn("[rerank] direct rerank endpoint failed, using original order:", error)
      return candidates.slice(0, options.topK ?? candidates.length)
    }
  }

  let content = ""
  let streamError: Error | null = null

  await streamChat(modelConfig, [{ role: "user", content: prompt }], {
    onToken: (token) => {
      content += token
    },
    onDone: () => {},
    onError: (error) => {
      streamError = error
    },
  }, AbortSignal.timeout(45000), {
    temperature: 0,
    max_tokens: 1200,
  })

  if (streamError) {
    console.warn("[rerank] falling back to original order:", streamError)
    return candidates.slice(0, options.topK ?? candidates.length)
  }

  let parsed: RerankResponse
  try {
    parsed = extractJsonObject(content)
  } catch (error) {
    console.warn("[rerank] could not parse response, using original order:", error)
    return candidates.slice(0, options.topK ?? candidates.length)
  }

  const byId = new Map(candidateSlice.map((candidate) => [candidate.id, candidate]))
  const ordered: T[] = []
  const used = new Set<string>()

  for (const item of parsed.order ?? []) {
    if (!item?.id || used.has(item.id)) continue
    const candidate = byId.get(item.id)
    if (!candidate) continue
    used.add(item.id)
    ordered.push(candidate)
  }

  for (const candidate of candidateSlice) {
    if (used.has(candidate.id)) continue
    ordered.push(candidate)
  }

  const result = [...ordered, ...candidates.slice(candidateLimit)]
  return result.slice(0, options.topK ?? result.length)
}
