import type { FileNode } from "@/types/wiki"

export interface ProjectPathIndexEntry {
  name: string
  path: string
}

export interface ProjectPathIndex {
  byPath: ReadonlyMap<string, ProjectPathIndexEntry>
  filesByName: ReadonlyMap<string, readonly ProjectPathIndexEntry[]>
}

type ProjectPathLookup = ProjectPathIndex | FileNode[]

export function createEmptyProjectPathIndex(): ProjectPathIndex {
  return { byPath: new Map(), filesByName: new Map() }
}

export function buildProjectPathIndexFromTree(tree: FileNode[]): ProjectPathIndex {
  const byPath = new Map<string, ProjectPathIndexEntry>()
  const filesByName = new Map<string, ProjectPathIndexEntry[]>()

  function walk(nodes: FileNode[]) {
    for (const node of nodes) {
      const entry: ProjectPathIndexEntry = {
        name: node.name,
        path: node.path,
      }
      byPath.set(node.path, entry)
      if (!node.is_dir) {
        const bucket = filesByName.get(node.name)
        if (bucket) bucket.push(entry)
        else filesByName.set(node.name, [entry])
      }
      if (node.is_dir && node.children) walk(node.children)
    }
  }

  walk(tree)
  return { byPath, filesByName }
}

function toProjectPathIndex(input: ProjectPathLookup): { index: ProjectPathIndex; fallbackTree?: FileNode[] } {
  if (Array.isArray(input)) {
    return { index: buildProjectPathIndexFromTree(input), fallbackTree: input }
  }
  return { index: input }
}

/**
 * Strip Obsidian-style `[[target]]` or `[[target|alias]]` wrapping
 * from a value, returning `{ slug, label }`. Frontmatter authors
 * (humans and the LLM) sometimes write related entries as
 * wikilinks instead of bare slugs; we want to display the alias
 * (or target) without the bracket noise and look up by target.
 *
 * Non-wikilink input is returned with `slug === label === input`.
 */
export function unwrapWikilink(s: string): { slug: string; label: string } {
  const m = s.match(/^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/)
  if (!m) return { slug: s, label: s }
  const target = m[1].trim()
  const alias = m[2]?.trim()
  return { slug: target, label: alias && alias.length > 0 ? alias : target }
}

function findInTreeByNameFromTree(
  tree: FileNode[],
  targetName: string,
  pathContains: string,
): string | null {
  function walk(nodes: FileNode[]): string | null {
    for (const node of nodes) {
      if (node.is_dir) {
        if (node.children) {
          const r = walk(node.children)
          if (r) return r
        }
        continue
      }
      if (node.name === targetName && node.path.includes(pathContains)) {
        return node.path
      }
    }
    return null
  }
  return walk(tree)
}

function findInTreeByPathFromTree(tree: FileNode[], targetPath: string): string | null {
  function walk(nodes: FileNode[]): string | null {
    for (const node of nodes) {
      if (node.path === targetPath) return node.path
      if (node.is_dir && node.children) {
        const r = walk(node.children)
        if (r) return r
      }
    }
    return null
  }
  return walk(tree)
}

/**
 * Return the absolute path of the first indexed file whose basename
 * matches `targetName` and whose path contains `pathContains`.
 */
export function findInTreeByName(
  lookup: ProjectPathLookup,
  targetName: string,
  pathContains: string,
  fallbackTree?: FileNode[],
): string | null {
  const normalized = toProjectPathIndex(lookup)
  const tree = fallbackTree ?? normalized.fallbackTree
  for (const entry of normalized.index.filesByName.get(targetName) ?? []) {
    if (entry.path.includes(pathContains)) return entry.path
  }
  if (tree) {
    return findInTreeByNameFromTree(tree, targetName, pathContains)
  }
  return null
}

function findInTreeByPath(
  lookup: ProjectPathLookup,
  targetPath: string,
  fallbackTree?: FileNode[],
): string | null {
  const normalized = toProjectPathIndex(lookup)
  const found = normalized.index.byPath.get(targetPath)
  if (found) return found.path
  const tree = fallbackTree ?? normalized.fallbackTree
  if (tree) return findInTreeByPathFromTree(tree, targetPath)
  return null
}

/**
 * Resolve a `related:` reference to an absolute wiki page path.
 */
export function resolveRelatedSlug(
  lookup: ProjectPathLookup,
  ref: string,
  wikiRoot: string,
  fallbackTree?: FileNode[],
): string | null {
  if (ref.includes("/")) {
    const projectRoot = wikiRoot.replace(/\/wiki$/, "")
    const target = `${projectRoot}/${ref}`
    const found = findInTreeByPath(lookup, target, fallbackTree)
    return found && found.includes(`${wikiRoot}/`) ? found : null
  }

  const filename = ref.endsWith(".md") ? ref : `${ref}.md`
  return findInTreeByName(lookup, filename, `${wikiRoot}/`, fallbackTree)
}

/**
 * Resolve a `sources:` reference.
 */
export function resolveSourceName(
  lookup: ProjectPathLookup,
  ref: string,
  sourcesRoot: string,
  fallbackTree?: FileNode[],
): string | null {
  const projectRoot = sourcesRoot.replace(/\/raw\/sources$/, "")
  const wikiSources = `${projectRoot}/wiki/sources`

  if (ref.includes("/")) {
    const normalizedRef = ref.replace(/\\/g, "/").replace(/^\/+/, "")
    const candidates = normalizedRef.startsWith("raw/sources/") ||
      normalizedRef.startsWith("wiki/")
      ? [`${projectRoot}/${normalizedRef}`]
      : [
          `${sourcesRoot}/${normalizedRef}`,
          `${projectRoot}/${normalizedRef}`,
        ]

    for (const target of candidates) {
      const found = findInTreeByPath(lookup, target, fallbackTree)
      if (found) return found
    }
    return null
  }

  if (ref.endsWith(".md")) {
    const inWiki = findInTreeByName(lookup, ref, `${wikiSources}/`, fallbackTree)
    if (inWiki) return inWiki
  }

  return findInTreeByName(lookup, ref, `${sourcesRoot}/`, fallbackTree)
}
