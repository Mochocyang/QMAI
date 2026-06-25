import { readFile, listDirectory } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { buildRetrievalGraph, calculateRelevance } from "./graph-relevance"
import { normalizePath } from "@/lib/path-utils"
import { NOVEL_NODE_TYPE_LABELS, NOVEL_RELATION_LABELS } from "@/lib/novel/graph-adapter"
import Graph from "graphology"
import louvain from "graphology-communities-louvain"

export interface GraphNode {
  id: string
  label: string
  type: string
  path: string
  linkCount: number // inbound + outbound
  community: number // community id from Louvain detection
  sources?: string[]
}

export interface GraphEdge {
  source: string
  target: string
  weight: number // relevance score between source and target
  relation?: string
  confidence?: number
  sources?: string[]
}

export interface CommunityInfo {
  id: number
  nodeCount: number
  cohesion: number // intra-community edge density
  topNodes: string[] // top nodes by linkCount (labels)
}

/** Run Louvain community detection and compute cohesion per community */
function detectCommunities(
  nodes: { id: string; label: string; linkCount: number }[],
  edges: GraphEdge[],
): { assignments: Map<string, number>; communities: CommunityInfo[] } {
  if (nodes.length === 0) {
    return { assignments: new Map(), communities: [] }
  }

  const g = new Graph({ type: "undirected" })
  for (const node of nodes) {
    g.addNode(node.id)
  }
  for (const edge of edges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      const key = `${edge.source}->${edge.target}`
      if (!g.hasEdge(key) && !g.hasEdge(`${edge.target}->${edge.source}`)) {
        g.addEdgeWithKey(key, edge.source, edge.target, { weight: edge.weight })
      }
    }
  }

  // Run Louvain — returns { nodeId: communityId }
  const communityMap: Record<string, number> = louvain(g, { resolution: 1 })
  const assignments = new Map(Object.entries(communityMap).map(([k, v]) => [k, v as number]))

  // Group nodes by community
  const groups = new Map<number, string[]>()
  for (const [nodeId, commId] of assignments) {
    const list = groups.get(commId) ?? []
    list.push(nodeId)
    groups.set(commId, list)
  }

  // Build edge lookup for cohesion calculation
  const edgeSet = new Set<string>()
  for (const edge of edges) {
    edgeSet.add(`${edge.source}:::${edge.target}`)
    edgeSet.add(`${edge.target}:::${edge.source}`)
  }

  // Build label + linkCount lookup
  const nodeInfo = new Map(nodes.map((n) => [n.id, { label: n.label, linkCount: n.linkCount }]))

  // Compute per-community info
  const communities: CommunityInfo[] = []
  for (const [commId, memberIds] of groups) {
    const n = memberIds.length
    // Cohesion = actual intra-community edges / possible edges
    let intraEdges = 0
    for (let i = 0; i < memberIds.length; i++) {
      for (let j = i + 1; j < memberIds.length; j++) {
        if (edgeSet.has(`${memberIds[i]}:::${memberIds[j]}`)) {
          intraEdges++
        }
      }
    }
    const possibleEdges = n > 1 ? (n * (n - 1)) / 2 : 1
    const cohesion = intraEdges / possibleEdges

    // Top nodes by linkCount
    const sorted = [...memberIds].sort(
      (a, b) => (nodeInfo.get(b)?.linkCount ?? 0) - (nodeInfo.get(a)?.linkCount ?? 0),
    )
    const topNodes = sorted.slice(0, 5).map((id) => nodeInfo.get(id)?.label ?? id)

    communities.push({ id: commId, nodeCount: n, cohesion, topNodes })
  }

  // Sort by nodeCount descending
  communities.sort((a, b) => b.nodeCount - a.nodeCount)

  // Re-number community IDs sequentially (0, 1, 2, ...)
  const idRemap = new Map<number, number>()
  communities.forEach((c, idx) => {
    idRemap.set(c.id, idx)
    c.id = idx
  })
  for (const [nodeId, oldId] of assignments) {
    assignments.set(nodeId, idRemap.get(oldId) ?? 0)
  }

  return { assignments, communities }
}

const WIKILINK_REGEX = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g

function flattenMdFiles(nodes: FileNode[]): FileNode[] {
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

function extractTitle(content: string, fileName: string): string {
  const frontmatterTitleMatch = content.match(/^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m)
  if (frontmatterTitleMatch) return frontmatterTitleMatch[1].trim()

  const headingMatch = content.match(/^#\s+(.+)$/m)
  if (headingMatch) return headingMatch[1].trim()

  return fileName.replace(/\.md$/, "").replace(/-/g, " ")
}

function extractType(content: string, filePath: string): string {
  const frontmatterTypeMatch = content.match(/^---\n[\s\S]*?^type:\s*["']?(.+?)["']?\s*$/m)
  if (frontmatterTypeMatch) return frontmatterTypeMatch[1].trim().toLowerCase()
  const frontmatter = extractFrontmatter(content)
  if (frontmatter) {
    if (/^chapter_number:\s*\d+\s*$/m.test(frontmatter)) return "chapter"
    if (/^outline_type:\s*["']?.+?["']?\s*$/m.test(frontmatter)) return "outline"
  }
  const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase()
  if (normalizedPath.includes("/wiki/chapters/")) return "chapter"
  if (normalizedPath.includes("/wiki/outlines/")) return "outline"
  return "other"
}

const NOVEL_ENTITY_TYPES = new Set<string>(Object.keys(NOVEL_NODE_TYPE_LABELS))

function extractTags(content: string): string[] {
  const inlineMatch = content.match(/^---\n[\s\S]*?^tags:\s*\[([^\]]*)\]/m)
  if (inlineMatch) {
    return inlineMatch[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
  }
  const blockMatch = content.match(/^---\n[\s\S]*?^tags:\s*\n((?:\s+-\s+.+\n?)*)/m)
  if (blockMatch) {
    return blockMatch[1].split("\n").map((line) => {
      const m = line.match(/^\s+-\s+["']?(.+?)["']?\s*$/)
      return m ? m[1] : ""
    }).filter(Boolean)
  }
  return []
}

function resolveNodeType(content: string, filePath: string): string {
  const type = extractType(content, filePath)
  if (type === "entity") {
    const tags = extractTags(content)
    const novelTag = tags.find((t) => NOVEL_ENTITY_TYPES.has(t))
    if (novelTag) return novelTag
  }
  return type
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

function relationNameToType(name: string): string | undefined {
  const normalized = name.trim()
  for (const [type, label] of Object.entries(NOVEL_RELATION_LABELS)) {
    if (normalized === type || normalized === label) return type
  }
  return undefined
}

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

function extractFrontmatter(content: string): string | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  return frontmatterMatch?.[1] ?? null
}

function extractFrontmatterLinks(content: string, ...fields: string[]): string[] {
  const links: string[] = []
  const frontmatter = extractFrontmatter(content)
  if (!frontmatter) return links

  for (const field of fields) {
    const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

    const inlineMatch = frontmatter.match(new RegExp(`^${escapedField}:\\s*\\[([^\\]]*)\\]\\s*$`, "m"))
    if (inlineMatch) {
      links.push(...inlineMatch[1].split(",").map((part) => part.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean))
    }

    const blockMatch = frontmatter.match(new RegExp(`^${escapedField}:\\s*\\n((?:\\s*-\\s*.+\\n?)*)`, "m"))
    if (blockMatch?.[1]) {
      links.push(...blockMatch[1].split("\n").map((line) => {
        const match = line.match(/^\s*-\s*(.+)$/)
        return match ? match[1].trim().replace(/^['"]|['"]$/g, "") : ""
      }).filter(Boolean))
    }
  }

  return mergeLinks(links)
}

function extractSnapshotId(content: string): string | null {
  const frontmatter = extractFrontmatter(content)
  if (!frontmatter) return null

  const match = frontmatter.match(/^(?:snapshot|snapshot_id|snapshotId):\s*["']?(.+?)["']?\s*$/m)
  if (match?.[1]?.trim()) return match[1].trim()

  const snapshotSource = extractFrontmatterLinks(content, "sources")
    .find((source) => /\.snapshot\.json$/i.test(source))
  return snapshotSource ?? null
}

function mergeLinks(...groups: string[][]): string[] {
  return Array.from(new Set(groups.flat().map((link) => link.trim()).filter(Boolean)))
}

function fileNameToId(fileName: string): string {
  return fileName.replace(/\.md$/, "")
}

export async function buildWikiGraph(
  projectPath: string,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; communities: CommunityInfo[] }> {
  const wikiRoot = `${normalizePath(projectPath)}/wiki`

  let tree: FileNode[]
  try {
    tree = await listDirectory(wikiRoot)
  } catch {
    return { nodes: [], edges: [], communities: [] }
  }

  const mdFiles = flattenMdFiles(tree)
  if (mdFiles.length === 0) {
    return { nodes: [], edges: [], communities: [] }
  }

  // Build a map of id -> node data
  const nodeMap = new Map<
    string,
    {
      id: string
      label: string
      type: string
      path: string
      links: string[]
      relationLinks: Array<{ target: string; relation: string }>
      aliases: string[]
      sources: string[]
      snapshotId: string | null
    }
  >()

  for (const file of mdFiles) {
    const id = fileNameToId(file.name)
    let content = ""
    try {
      content = await readFile(file.path)
    } catch {
      // Skip unreadable files
      continue
    }

    const sources = extractFrontmatterLinks(content, "sources")

    nodeMap.set(id, {
      id,
      label: extractTitle(content, file.name),
      type: resolveNodeType(content, file.path),
      path: file.path,
      links: mergeLinks(extractWikilinks(content), extractFrontmatterLinks(content, "related")),
      relationLinks: extractRelationLinks(content),
      aliases: extractFrontmatterLinks(content, "aliases"),
      sources,
      snapshotId: extractSnapshotId(content),
    })
  }

  // Filter out query nodes (research results, saved chat answers) — they are
  // intermediate artifacts, not knowledge structure. The entities/concepts
  // extracted from them via auto-ingest are what belong in the graph.
  const HIDDEN_TYPES = new Set(["query"])
  for (const [id, node] of nodeMap) {
    if (HIDDEN_TYPES.has(node.type)) {
      nodeMap.delete(id)
    }
  }

  // Count link references
  const linkCounts = new Map<string, number>()
  for (const [id] of nodeMap) {
    linkCounts.set(id, 0)
  }

  const rawEdges: GraphEdge[] = []

  for (const [sourceId, nodeData] of nodeMap) {
    const relationLinksByTarget = new Map<string, string[]>()
    for (const link of nodeData.relationLinks) {
      relationLinksByTarget.set(link.target, [...(relationLinksByTarget.get(link.target) ?? []), link.relation])
    }

    for (const link of nodeData.relationLinks) {
      const targetId = resolveTarget(link.target, nodeMap)
      if (targetId === null) continue
      if (targetId === sourceId) continue

      rawEdges.push({
        source: sourceId,
        target: targetId,
        weight: 1,
        relation: link.relation,
        sources: nodeData.sources,
      })

      linkCounts.set(sourceId, (linkCounts.get(sourceId) ?? 0) + 1)
      linkCounts.set(targetId, (linkCounts.get(targetId) ?? 0) + 1)
    }

    for (const targetRaw of nodeData.links) {
      if (relationLinksByTarget.has(targetRaw)) continue
      const targetId = resolveTarget(targetRaw, nodeMap)
      if (targetId === null) continue
      if (targetId === sourceId) continue

      rawEdges.push({
        source: sourceId,
        target: targetId,
        weight: 1,
        sources: nodeData.sources,
      })

      linkCounts.set(sourceId, (linkCounts.get(sourceId) ?? 0) + 1)
      linkCounts.set(targetId, (linkCounts.get(targetId) ?? 0) + 1)
    }
  }

  for (const [sourceId, nodeData] of nodeMap) {
    if (!NOVEL_ENTITY_TYPES.has(nodeData.type)) continue
    if (!nodeData.snapshotId) continue
    if ((linkCounts.get(sourceId) ?? 0) > 0) continue

    const chapterIds = Array.from(nodeMap.values())
      .filter((node) => node.id !== sourceId && node.type === "chapter" && node.snapshotId === nodeData.snapshotId)
      .map((node) => node.id)

    for (const targetId of chapterIds) {
      rawEdges.push({ source: sourceId, target: targetId, weight: 0.5, relation: "APPEARS_IN", confidence: 0.5, sources: nodeData.sources })
      linkCounts.set(sourceId, (linkCounts.get(sourceId) ?? 0) + 1)
      linkCounts.set(targetId, (linkCounts.get(targetId) ?? 0) + 1)
    }
  }

  // Deduplicate edges
  const seenEdges = new Set<string>()
  const dedupedEdges: GraphEdge[] = []
  for (const edge of rawEdges) {
    const key = `${edge.source}:::${edge.target}:::${edge.relation ?? ""}`
    if (!seenEdges.has(key)) {
      seenEdges.add(key)
      dedupedEdges.push(edge)
    }
  }

  // Calculate relevance weights using the retrieval graph
  let retrievalGraph: Awaited<ReturnType<typeof buildRetrievalGraph>> | null = null
  try {
    const { useWikiStore } = await import("@/stores/wiki-store")
    const dv = useWikiStore.getState().dataVersion
    retrievalGraph = await buildRetrievalGraph(normalizePath(projectPath), dv)
  } catch {
    // ignore — weights will default to 1
  }

  const edges: GraphEdge[] = dedupedEdges.map((e) => {
    let weight = 1
    if (retrievalGraph) {
      const nodeA = retrievalGraph.nodes.get(e.source)
      const nodeB = retrievalGraph.nodes.get(e.target)
      if (nodeA && nodeB) {
        weight = calculateRelevance(nodeA, nodeB, retrievalGraph)
      }
    }
    return { source: e.source, target: e.target, weight, relation: e.relation, confidence: e.confidence, sources: e.sources }
  })

  // Build preliminary nodes for community detection
  const prelimNodes = Array.from(nodeMap.values()).map((n) => ({
    id: n.id,
    label: n.label,
    linkCount: linkCounts.get(n.id) ?? 0,
  }))

  const { assignments, communities } = detectCommunities(prelimNodes, edges)

  const nodes: GraphNode[] = Array.from(nodeMap.values()).map((n) => ({
    id: n.id,
    label: n.label,
    type: n.type,
    path: n.path,
    linkCount: linkCounts.get(n.id) ?? 0,
    community: assignments.get(n.id) ?? 0,
    sources: n.sources,
  }))

  return { nodes, edges, communities }
}

function resolveTarget(
  raw: string,
  nodeMap: Map<string, { id: string; aliases?: string[]; label?: string }>,
): string | null {
  // Direct match
  if (nodeMap.has(raw)) return raw

  // Normalize: lowercase, replace spaces with hyphens and vice versa
  const normalized = raw.toLowerCase().replace(/\s+/g, "-")
  for (const [id, node] of nodeMap) {
    if (id.toLowerCase() === normalized) return id
    if (id.toLowerCase() === raw.toLowerCase()) return id
    if (id.toLowerCase().replace(/\s+/g, "-") === normalized) return id
    if (node.label?.toLowerCase() === raw.toLowerCase()) return id
    if (node.aliases?.some((alias) => alias.toLowerCase() === raw.toLowerCase() || alias.toLowerCase().replace(/\s+/g, "-") === normalized)) return id
  }

  return null
}
