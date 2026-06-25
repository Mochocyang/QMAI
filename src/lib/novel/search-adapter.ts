import { searchWiki } from "@/lib/search"
import { readFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { rerankCandidates } from "@/lib/rerank"
import { useWikiStore } from "@/stores/wiki-store"
import { loadSnapshot, listSnapshots } from "./chapter-ingest"

export interface NovelSearchParams {
  projectPath: string
  query: string
  chapterNumber?: number
  topK?: number
  authoritativeOnly?: boolean
  includeGraph?: boolean
  includeVector?: boolean
  includeKeyword?: boolean
  includeRecentChapters?: boolean
  includeCanon?: boolean
}

export interface NovelSearchResult {
  type: "keyword" | "vector" | "graph" | "recent_chapter" | "canon"
  path: string
  title: string
  snippet: string
  relevance: number
}

type RankedNovelSearchResult = NovelSearchResult & {
  sourceRank: number
}

const SOURCE_RRF_K = 60
const SEARCH_SOURCE_TIMEOUT_MS = 2500
const SOURCE_WEIGHTS: Record<NovelSearchResult["type"], number> = {
  keyword: 1,
  vector: 1,
  graph: 0.95,
  canon: 0.9,
  recent_chapter: 0.75,
}

const SOURCE_TIE_PRIORITY: Record<NovelSearchResult["type"], number> = {
  keyword: 0,
  vector: 1,
  graph: 2,
  canon: 3,
  recent_chapter: 4,
}

export function isAuthoritativeGenerationPath(path: string): boolean {
  return /\/wiki\/(entities|concepts|memory|chapters)\//.test(path)
    || /\/wiki\/canon\.md$/.test(path)
    || /\/\.novel\/snapshots\//.test(path)
}

export function isHistoricalProjectionSnippet(path: string, snippet: string): boolean {
  return /\/history\//.test(path) || /is_historical:\s*true/i.test(snippet)
}

export async function novelMixedSearch(params: NovelSearchParams): Promise<NovelSearchResult[]> {
  console.log("[novelMixedSearch] START, includeKeyword=", params.includeKeyword, "includeVector=", params.includeVector, "includeGraph=", params.includeGraph, "includeRecentChapters=", params.includeRecentChapters, "includeCanon=", params.includeCanon)
  const pp = normalizePath(params.projectPath)
  const topK = params.topK ?? 5
  const results: RankedNovelSearchResult[] = []

  const promises: Promise<void>[] = []

  if (params.includeKeyword !== false) {
    const pKeyword = runSearchBranch("keyword", searchWiki(pp, params.query)).then(items => {
      console.log("[novelMixedSearch] keyword done, got", items.length)
      results.push(...items.slice(0, topK).map((item, sourceRank) => ({
        type: "keyword" as const,
        path: item.path,
        title: item.title,
        snippet: item.snippet ?? "",
        relevance: item.score ?? 0,
        sourceRank,
      })))
    })
    promises.push(pKeyword)
  }

  if (params.includeVector) {
    const pVector = runSearchBranch("vector", runVectorSearch(pp, params.query, topK)).then(items => {
      console.log("[novelMixedSearch] vector done, got", items.length)
      results.push(...rankSourceResults(items))
    })
    promises.push(pVector)
  }

  if (params.includeGraph) {
    const pGraph = runSearchBranch("graph", runGraphSearch(pp, params.query, topK)).then(items => {
      console.log("[novelMixedSearch] graph done, got", items.length)
      results.push(...rankSourceResults(items))
    })
    promises.push(pGraph)
  }

  if (params.includeRecentChapters) {
    const pRecent = runSearchBranch("recent_chapter", runRecentChapterSearch(pp, topK)).then(items => {
      console.log("[novelMixedSearch] recent_chapter done, got", items.length)
      results.push(...rankSourceResults(items))
    })
    promises.push(pRecent)
  }

  if (params.includeCanon) {
    const pCanon = runSearchBranch("canon", runCanonSearch(pp, params.query)).then(items => {
      console.log("[novelMixedSearch] canon done, got", items.length)
      results.push(...rankSourceResults(items))
    })
    promises.push(pCanon)
  }

  console.log("[novelMixedSearch] waiting for", promises.length, "promises...")
  await Promise.all(promises)
  console.log("[novelMixedSearch] all promises resolved, total results:", results.length)

  const merged = deduplicateResults(results, topK)
  const filtered = params.authoritativeOnly
    ? merged.filter((item) => {
      if (isHistoricalProjectionSnippet(item.path, item.snippet)) return false
      if (item.type === "canon" || item.type === "recent_chapter") return true
      return isAuthoritativeGenerationPath(item.path)
    })
    : merged
  console.log("[novelMixedSearch] dedup done, merged:", merged.length, "filtered:", filtered.length)

  console.log("[novelMixedSearch] calling rerankCandidates...")
  const reranked = await rerankCandidates(
    params.query,
    filtered.map((item) => ({
      ...item,
      id: `${item.type}:${normalizeResultPath(item.path)}`,
      source: item.type,
    })),
    {
      topK,
      purpose: "用于小说剧情搜索，优先返回最能支撑当前剧情推进、设定一致性和记忆调用的结果。",
    },
  )
  console.log("[novelMixedSearch] rerank done, got", reranked.length)
  return reranked
}

async function runSearchBranch<T>(label: string, promise: Promise<T>): Promise<T> {
  try {
    return await withTimeout(promise, SEARCH_SOURCE_TIMEOUT_MS, label)
  } catch (err) {
    console.log(`[novelMixedSearch] ${label} error:`, err)
    return [] as T
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} search timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function rankSourceResults(items: NovelSearchResult[]): RankedNovelSearchResult[] {
  return items.map((item, sourceRank) => ({ ...item, sourceRank }))
}

async function runVectorSearch(
  pp: string,
  query: string,
  topK: number,
): Promise<NovelSearchResult[]> {
  const embCfg = useWikiStore.getState().embeddingConfig
  if (!embCfg.enabled || !embCfg.model) return []

  try {
    const { searchByEmbedding } = await import("@/lib/embedding")
    const vectorResults = await searchByEmbedding(pp, query, embCfg, Math.max(topK * 2, 10))
    if (vectorResults.length === 0) return []

    const items: NovelSearchResult[] = []
    for (const vr of vectorResults.slice(0, topK)) {
      try {
        const dirs = ["entities", "concepts", "sources", "synthesis", "comparison", "queries"]
        let content = ""
        let foundPath = ""
        for (const dir of dirs) {
          const tryPath = `${pp}/wiki/${dir}/${vr.id}.md`
          try {
            content = await readFile(tryPath)
            foundPath = tryPath
            break
          } catch {}
        }
        if (!foundPath) {
          const tryPath = `${pp}/wiki/${vr.id}.md`
          try {
            content = await readFile(tryPath)
            foundPath = tryPath
          } catch {}
        }
        if (foundPath && content) {
          const title = extractTitle(content, vr.id)
          items.push({
            type: "vector",
            path: foundPath,
            title,
            snippet: content.slice(0, 300).replace(/\n/g, " "),
            relevance: vr.score,
          })
        }
      } catch {}
    }
    return items
  } catch {
    return []
  }
}

async function runGraphSearch(
  pp: string,
  query: string,
  topK: number,
): Promise<NovelSearchResult[]> {
  try {
    const { buildRetrievalGraph, getRelatedNodes } = await import("@/lib/graph-relevance")
    const graph = await buildRetrievalGraph(pp)
    if (graph.nodes.size === 0) return []

    const tokens = query
      .split(/[\s,，。！？、]+/)
      .filter(t => t.length >= 2)

    const candidateNames = new Set(tokens)
    for (const [, node] of graph.nodes) {
      const nodeText = `${node.title} ${node.id}`.toLowerCase()
      for (const token of tokens) {
        if (nodeText.includes(token.toLowerCase())) {
          candidateNames.add(node.title)
          candidateNames.add(node.id)
        }
      }
    }

    const seenIds = new Set<string>()
    const scoredNodes: { title: string; path: string; snippet: string; relevance: number }[] = []

    for (const name of candidateNames) {
      const matchedNodes = Array.from(graph.nodes.values()).filter(
        n => n.title.includes(name) || n.id.includes(name),
      )
      for (const matchedNode of matchedNodes) {
        if (seenIds.has(matchedNode.id)) continue
        seenIds.add(matchedNode.id)

        const related = getRelatedNodes(matchedNode.id, graph, 5)
        for (const { node, relevance } of related) {
          if (seenIds.has(node.id)) continue
          seenIds.add(node.id)
          try {
            const content = await readFile(node.path)
            scoredNodes.push({
              title: node.title,
              path: node.path,
              snippet: content.slice(0, 300).replace(/\n/g, " "),
              relevance: Math.round(relevance * 100) / 100,
            })
          } catch {}
        }
      }
    }

    scoredNodes.sort((a, b) => b.relevance - a.relevance)
    return scoredNodes.slice(0, topK).map(n => ({
      type: "graph" as const,
      path: n.path,
      title: n.title,
      snippet: n.snippet,
      relevance: n.relevance,
    }))
  } catch {
    return []
  }
}

async function runRecentChapterSearch(
  pp: string,
  topK: number,
): Promise<NovelSearchResult[]> {
  try {
    const chapterNumbers = await listSnapshots(pp)
    if (chapterNumbers.length === 0) return []

    const recentNumbers = chapterNumbers.slice(-topK).reverse()
    const items: NovelSearchResult[] = []

    for (const num of recentNumbers) {
      const snap = await loadSnapshot(pp, num)
      if (snap) {
        const paddedNum = String(num).padStart(3, "0")
        items.push({
          type: "recent_chapter",
          path: `${pp}/.novel/snapshots/${paddedNum}.snapshot.json`,
          title: `第${num}章`,
          snippet: snap.summary || snap.endingHook || "",
          relevance: 1,
        })
      }
    }
    return items
  } catch {
    return []
  }
}

async function runCanonSearch(
  pp: string,
  query: string,
): Promise<NovelSearchResult[]> {
  const canonPath = `${pp}/wiki/canon.md`
  try {
    const content = await readFile(canonPath)
    if (!content.trim()) return []

    const queryLower = query.toLowerCase()
    const lines = content.split("\n")
    const matchedLines: string[] = []

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(queryLower)) {
        const start = Math.max(0, i - 1)
        const end = Math.min(lines.length, i + 2)
        matchedLines.push(lines.slice(start, end).join("\n"))
      }
    }

    if (matchedLines.length === 0) {
      return [{
        type: "canon",
        path: canonPath,
        title: "正史规则",
        snippet: content.slice(0, 500).replace(/\n/g, " "),
        relevance: 0.5,
      }]
    }

    return matchedLines.slice(0, 3).map((snippet, i) => ({
      type: "canon" as const,
      path: canonPath,
      title: "正史规则",
      snippet: snippet.replace(/\n/g, " ").slice(0, 300),
      relevance: 1 - i * 0.1,
    }))
  } catch {
    return []
  }
}

function deduplicateResults(results: RankedNovelSearchResult[], topK: number): NovelSearchResult[] {
  const fused = new Map<string, {
    result: NovelSearchResult
    fusionScore: number
    bestContribution: number
    bestRelevance: number
    bestRank: number
    bestTypePriority: number
  }>()

  for (const r of results) {
    const sourceRank = Math.max(0, r.sourceRank)
    const weight = SOURCE_WEIGHTS[r.type] ?? 0.8
    const contribution = weight / (SOURCE_RRF_K + sourceRank + 1)
    const key = normalizeResultPath(r.path)
    const cleanResult = toPublicResult(r)
    const existing = fused.get(key)

    if (!existing) {
      fused.set(key, {
        result: cleanResult,
        fusionScore: contribution,
        bestContribution: contribution,
        bestRelevance: r.relevance,
        bestRank: sourceRank,
        bestTypePriority: SOURCE_TIE_PRIORITY[r.type] ?? 9,
      })
      continue
    }

    existing.fusionScore += contribution
    if (shouldReplaceRepresentative(existing, r, contribution)) {
      existing.result = cleanResult
      existing.bestContribution = contribution
      existing.bestRelevance = r.relevance
      existing.bestRank = sourceRank
      existing.bestTypePriority = SOURCE_TIE_PRIORITY[r.type] ?? 9
    }
  }

  return Array.from(fused.values())
    .sort((a, b) => {
      if (b.fusionScore !== a.fusionScore) return b.fusionScore - a.fusionScore
      if (b.bestRelevance !== a.bestRelevance) return b.bestRelevance - a.bestRelevance
      if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank
      if (a.bestTypePriority !== b.bestTypePriority) return a.bestTypePriority - b.bestTypePriority
      return a.result.title.localeCompare(b.result.title)
    })
    .slice(0, topK)
    .map((item) => ({
      ...item.result,
      relevance: Math.round(item.fusionScore * 1_000_000) / 1_000_000,
    }))
}

function normalizeResultPath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase()
}

function toPublicResult(result: NovelSearchResult): NovelSearchResult {
  return {
    type: result.type,
    path: result.path,
    title: result.title,
    snippet: result.snippet,
    relevance: result.relevance,
  }
}

function shouldReplaceRepresentative(
  existing: {
    bestContribution: number
    bestRelevance: number
    bestRank: number
    bestTypePriority: number
  },
  candidate: RankedNovelSearchResult,
  contribution: number,
): boolean {
  if (contribution !== existing.bestContribution) return contribution > existing.bestContribution
  if (candidate.relevance !== existing.bestRelevance) return candidate.relevance > existing.bestRelevance
  if (candidate.sourceRank !== existing.bestRank) return candidate.sourceRank < existing.bestRank
  return (SOURCE_TIE_PRIORITY[candidate.type] ?? 9) < existing.bestTypePriority
}

function extractTitle(content: string, fallback: string): string {
  const match = content.match(/^#\s+(.+)/m)
  if (match) return match[1].trim()
  const fmMatch = content.match(/^---\ntitle:\s*(.+)/m)
  if (fmMatch) return fmMatch[1].trim()
  return fallback
}

export interface SearchPlotOptions {
  scene?: string
  topK?: number
  includeKeyword?: boolean
  includeVector?: boolean
  includeGraph?: boolean
  includeRecentChapters?: boolean
  includeCanon?: boolean
}

export async function searchPlot(
  projectPath: string,
  query: string,
  options?: SearchPlotOptions,
): Promise<NovelSearchResult[]> {
  return novelMixedSearch({
    projectPath,
    query,
    topK: options?.topK ?? 10,
    includeKeyword: options?.includeKeyword ?? true,
    includeVector: options?.includeVector ?? true,
    includeGraph: options?.includeGraph ?? true,
    includeRecentChapters: options?.includeRecentChapters ?? true,
    includeCanon: options?.includeCanon ?? false,
  })
}
