import { readFile, listDirectory } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { normalizePath } from "@/lib/path-utils"
import { NOVEL_RELATION_LABELS } from "@/lib/novel/graph-adapter"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 带关系类型的出边，用于关系类型匹配信号。 */
export interface RelationEdge {
  readonly target: string
  readonly relation: string
}

export interface RetrievalNode {
  readonly id: string
  readonly title: string
  readonly type: string
  readonly path: string
  readonly sources: readonly string[]
  readonly outLinks: ReadonlySet<string>
  readonly inLinks: ReadonlySet<string>
  /** 带关系类型的出边（从 wiki 实体页的 `- [[target]] — 关系标签` 提取）。 */
  readonly relationEdges: readonly RelationEdge[]
}

export interface RetrievalGraph {
  readonly nodes: ReadonlyMap<string, RetrievalNode>
  readonly dataVersion: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WIKILINK_REGEX = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g

const WEIGHTS = {
  directLink: 3.0,
  sourceOverlap: 4.0,
  commonNeighbor: 1.5,
  typeAffinity: 1.0,
  relationTypeMatch: 1.5,
} as const

const TYPE_AFFINITY: Record<string, Record<string, number>> = {
  entity: { concept: 1.2, entity: 0.8, source: 1.0, synthesis: 1.0, query: 0.8 },
  concept: { entity: 1.2, concept: 0.8, source: 1.0, synthesis: 1.2, query: 1.0 },
  source: { entity: 1.0, concept: 1.0, source: 0.5, query: 0.8, synthesis: 1.0 },
  query: { concept: 1.0, entity: 0.8, synthesis: 1.0, source: 0.8, query: 0.5 },
  synthesis: { concept: 1.2, entity: 1.0, source: 1.0, query: 1.0, synthesis: 0.8 },
}

/**
 * 关系类型对关联度的贡献权重。
 *
 * 设计原则：
 * - 强关系（敌对/合作/属于）：人物间核心关系，高权重
 * - 伏笔关系（推进/回收/新增）：剧情线索，较高权重
 * - 心理关系（怀疑/隐瞒）：戏剧冲突来源，较高权重
 * - 因果关系（导致/揭示/影响）：剧情推动，中权重
 * - 弱关系（出场于/发生于/位于）：太常见，低权重（避免噪声）
 * - 认知关系（知道/不知道）：单向认知，中低权重
 */
const RELATION_TYPE_AFFINITY: Record<string, number> = {
  ENEMY_OF: 1.5,
  ALLY_OF: 1.5,
  BELONGS_TO: 1.3,
  HAS_ITEM: 1.0,
  KNOWS: 0.8,
  DOES_NOT_KNOW: 0.5,
  SUSPECTS: 1.2,
  HIDES_FROM: 1.2,
  CAUSES: 1.0,
  REVEALS: 1.0,
  AFFECTS: 0.8,
  APPEARS_IN: 0.5,
  HAPPENS_IN: 0.5,
  LOCATED_AT: 0.6,
  ADVANCES_FORESHADOWING: 1.2,
  RESOLVES_FORESHADOWING: 1.2,
  CREATES_FORESHADOWING: 1.2,
}

// ---------------------------------------------------------------------------
// Module-level cache
// ---------------------------------------------------------------------------

const graphCache = new Map<string, Promise<RetrievalGraph>>()

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

function flattenMdFiles(nodes: readonly FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMdFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

function fileNameToId(fileName: string): string {
  return fileName.replace(/\.md$/, "")
}

function extractFrontmatter(content: string): { title: string; type: string; sources: string[]; isHistorical: boolean } {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  const fm = fmMatch ? fmMatch[1] : ""

  const titleMatch = fm.match(/^title:\s*["']?(.+?)["']?\s*$/m)
  const typeMatch = fm.match(/^type:\s*["']?(.+?)["']?\s*$/m)
  const historicalMatch = fm.match(/^is_historical:\s*(true|false)\s*$/mi)

  // Parse sources array from YAML frontmatter
  const sources: string[] = []
  const sourcesBlockMatch = fm.match(/^sources:\s*\n((?:\s+-\s+.+\n?)*)/m)
  if (sourcesBlockMatch) {
    const lines = sourcesBlockMatch[1].split("\n")
    for (const line of lines) {
      const itemMatch = line.match(/^\s+-\s+["']?(.+?)["']?\s*$/)
      if (itemMatch) {
        sources.push(itemMatch[1])
      }
    }
  } else {
    // Single-line: sources: ["a.pdf", "b.pdf"] or sources: [a.pdf]
    const inlineMatch = fm.match(/^sources:\s*\[([^\]]*)\]/m)
    if (inlineMatch) {
      const items = inlineMatch[1].split(",")
      for (const item of items) {
        const trimmed = item.trim().replace(/^["']|["']$/g, "")
        if (trimmed) sources.push(trimmed)
      }
    }
  }

  let title = titleMatch ? titleMatch[1].trim() : ""
  if (!title) {
    const headingMatch = content.match(/^#\s+(.+)$/m)
    title = headingMatch ? headingMatch[1].trim() : ""
  }

  return {
    title,
    type: typeMatch ? typeMatch[1].trim().toLowerCase() : "other",
    sources,
    isHistorical: historicalMatch?.[1]?.toLowerCase() === "true",
  }
}

function extractWikilinks(content: string): string[] {
  const links: string[] = []
  const regex = new RegExp(WIKILINK_REGEX.source, "g")
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1].trim())
  }
  return links
}

/** 把关系标签（中文或英文类型名）转为关系类型枚举。 */
function relationNameToType(name: string): string | undefined {
  const normalized = name.trim()
  for (const [type, label] of Object.entries(NOVEL_RELATION_LABELS)) {
    if (normalized === type || normalized === label) return type
  }
  return undefined
}

/**
 * 从 wiki 实体页内容提取带关系类型的链接。
 *
 * 匹配格式（与 wiki-graph.ts 的 extractRelationLinks 保持一致）：
 *   - [[target]] — 关系标签
 *   - [[target]] - 关系标签
 *   - [[target]] : 关系标签
 *   - [[target]]：关系标签
 *
 * 只保留能识别为 NOVEL_RELATION_LABELS 的关系，避免噪声。
 */
function extractRelationLinks(content: string): Array<{ target: string; relation: string }> {
  const links: Array<{ target: string; relation: string }> = []
  const regex = /^\s*-\s*\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]\s*(?:—|-|:|：)\s*([^\n]+?)\s*$/gm
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    const relation = relationNameToType(match[2])
    if (relation) links.push({ target: match[1].trim(), relation })
  }
  return links
}

function resolveTarget(
  raw: string,
  nodeIds: ReadonlySet<string>,
): string | null {
  if (nodeIds.has(raw)) return raw

  const normalized = raw.toLowerCase().replace(/\s+/g, "-")
  for (const id of nodeIds) {
    const idLower = id.toLowerCase()
    if (idLower === normalized) return id
    if (idLower === raw.toLowerCase()) return id
    if (idLower.replace(/\s+/g, "-") === normalized) return id
  }
  return null
}

function getNeighbors(node: RetrievalNode): ReadonlySet<string> {
  const neighbors = new Set<string>()
  for (const id of node.outLinks) neighbors.add(id)
  for (const id of node.inLinks) neighbors.add(id)
  return neighbors
}

function getNodeDegree(node: RetrievalNode): number {
  return node.outLinks.size + node.inLinks.size
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

export async function buildRetrievalGraph(
  projectPath: string,
  dataVersion: number = 0,
): Promise<RetrievalGraph> {
  const normalizedProjectPath = normalizePath(projectPath)
  const cacheKey = `${normalizedProjectPath}:${dataVersion}`
  const cached = graphCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const graphPromise = buildRetrievalGraphForProject(normalizedProjectPath, dataVersion).catch((error) => {
    graphCache.delete(cacheKey)
    throw error
  })
  graphCache.set(cacheKey, graphPromise)
  return graphPromise
}

async function buildRetrievalGraphForProject(
  projectPath: string,
  dataVersion: number,
): Promise<RetrievalGraph> {
  const wikiRoot = `${projectPath}/wiki`
  let tree: FileNode[]
  try {
    tree = await listDirectory(wikiRoot)
  } catch {
    return { nodes: new Map(), dataVersion }
  }

  const mdFiles = flattenMdFiles(tree)

  // First pass: read all files and build raw node data
  const rawNodes: Array<{
    id: string
    title: string
    type: string
    path: string
    sources: string[]
    rawLinks: string[]
    rawRelationLinks: Array<{ target: string; relation: string }>
    fileName: string
  }> = []

  for (const file of mdFiles) {
    const id = fileNameToId(file.name)
    let content = ""
    try {
      content = await readFile(file.path)
    } catch {
      continue
    }

    const fm = extractFrontmatter(content)
    if (fm.isHistorical) {
      continue
    }
    rawNodes.push({
      id,
      title: fm.title || file.name.replace(/\.md$/, "").replace(/-/g, " "),
      type: fm.type,
      path: file.path,
      sources: fm.sources,
      rawLinks: extractWikilinks(content),
      rawRelationLinks: extractRelationLinks(content),
      fileName: file.name,
    })
  }

  const nodeIds = new Set(rawNodes.map((n) => n.id))

  // Second pass: resolve links and build graph nodes
  const outLinksMap = new Map<string, Set<string>>()
  const inLinksMap = new Map<string, Set<string>>()
  const relationEdgesMap = new Map<string, RelationEdge[]>()

  for (const id of nodeIds) {
    outLinksMap.set(id, new Set())
    inLinksMap.set(id, new Set())
    relationEdgesMap.set(id, [])
  }

  for (const raw of rawNodes) {
    for (const linkTarget of raw.rawLinks) {
      const resolvedId = resolveTarget(linkTarget, nodeIds)
      if (resolvedId === null || resolvedId === raw.id) continue
      outLinksMap.get(raw.id)!.add(resolvedId)
      inLinksMap.get(resolvedId)!.add(raw.id)
    }
    // 解析关系链接，只保留能解析到目标节点的边
    for (const rel of raw.rawRelationLinks) {
      const resolvedId = resolveTarget(rel.target, nodeIds)
      if (resolvedId === null || resolvedId === raw.id) continue
      relationEdgesMap.get(raw.id)!.push({ target: resolvedId, relation: rel.relation })
    }
  }

  // Build immutable nodes map
  const nodes = new Map<string, RetrievalNode>()
  for (const raw of rawNodes) {
    nodes.set(raw.id, {
      id: raw.id,
      title: raw.title,
      type: raw.type,
      path: raw.path,
      sources: Object.freeze([...raw.sources]),
      outLinks: Object.freeze(outLinksMap.get(raw.id) ?? new Set<string>()),
      inLinks: Object.freeze(inLinksMap.get(raw.id) ?? new Set<string>()),
      relationEdges: Object.freeze(relationEdgesMap.get(raw.id) ?? []),
    })
  }

  const graph: RetrievalGraph = { nodes, dataVersion }
  return graph
}

export function calculateRelevance(
  nodeA: RetrievalNode,
  nodeB: RetrievalNode,
  graph: RetrievalGraph,
): number {
  if (nodeA.id === nodeB.id) return 0

  // Signal 1: Direct links (weight 3.0)
  const forwardLinks = nodeA.outLinks.has(nodeB.id) ? 1 : 0
  const backwardLinks = nodeB.outLinks.has(nodeA.id) ? 1 : 0
  const directLinkScore = (forwardLinks + backwardLinks) * WEIGHTS.directLink

  // Signal 2: Source overlap (weight 4.0)
  const sourcesA = new Set(nodeA.sources)
  let sharedSourceCount = 0
  for (const src of nodeB.sources) {
    if (sourcesA.has(src)) sharedSourceCount += 1
  }
  const sourceOverlapScore = sharedSourceCount * WEIGHTS.sourceOverlap

  // Signal 3: Common neighbors - Adamic-Adar (weight 1.5)
  const neighborsA = getNeighbors(nodeA)
  const neighborsB = getNeighbors(nodeB)
  let adamicAdar = 0
  for (const neighborId of neighborsA) {
    if (neighborsB.has(neighborId)) {
      const neighbor = graph.nodes.get(neighborId)
      if (neighbor) {
        const degree = getNodeDegree(neighbor)
        adamicAdar += 1 / Math.log(Math.max(degree, 2))
      }
    }
  }
  const commonNeighborScore = adamicAdar * WEIGHTS.commonNeighbor

  // Signal 4: Type affinity (weight 1.0)
  const affinityMap = TYPE_AFFINITY[nodeA.type]
  const typeAffinityScore = (affinityMap?.[nodeB.type] ?? 0.5) * WEIGHTS.typeAffinity

  // Signal 5: Relation type match (weight 1.5)
  // 遍历 A→B 和 B→A 的带关系类型边，按关系类型权重累加。
  // 强关系（敌对/合作/属于）贡献高，弱关系（出场于/位于）贡献低。
  let relationTypeWeight = 0
  for (const edge of nodeA.relationEdges) {
    if (edge.target === nodeB.id) {
      relationTypeWeight += RELATION_TYPE_AFFINITY[edge.relation] ?? 0.5
    }
  }
  for (const edge of nodeB.relationEdges) {
    if (edge.target === nodeA.id) {
      relationTypeWeight += RELATION_TYPE_AFFINITY[edge.relation] ?? 0.5
    }
  }
  const relationTypeMatchScore = relationTypeWeight * WEIGHTS.relationTypeMatch

  return directLinkScore + sourceOverlapScore + commonNeighborScore + typeAffinityScore + relationTypeMatchScore
}

export function getRelatedNodes(
  nodeId: string,
  graph: RetrievalGraph,
  limit: number = 5,
): ReadonlyArray<{ node: RetrievalNode; relevance: number }> {
  const sourceNode = graph.nodes.get(nodeId)
  if (!sourceNode) return []

  const scored: Array<{ node: RetrievalNode; relevance: number }> = []
  for (const [id, node] of graph.nodes) {
    if (id === nodeId) continue
    const relevance = calculateRelevance(sourceNode, node, graph)
    if (relevance > 0) {
      scored.push({ node, relevance })
    }
  }

  scored.sort((a, b) => b.relevance - a.relevance)
  return scored.slice(0, limit)
}

export function clearGraphCache(): void {
  graphCache.clear()
}
