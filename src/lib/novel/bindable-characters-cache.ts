import { listDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { sha256Text } from "@/lib/context-hub/fingerprint"
import { joinPath, normalizePath } from "@/lib/path-utils"
import type { FileNode } from "@/types/wiki"

export const BINDABLE_CHARACTERS_CACHE_FILE = "bindable-characters.json"

export type BindableCharactersCache = {
  fingerprint: string
  names: string[]
  llmRefinedFingerprint?: string
  updatedAt: number
}

/**
 * 缓存落在 <projectPath>/.qmai/ 下，与 character-aura.json 同目录。
 * 项目目录已存在，无需在此创建。
 */
export function bindableCharactersCachePath(projectPath: string): string {
  return joinPath(normalizePath(projectPath), ".qmai", BINDABLE_CHARACTERS_CACHE_FILE)
}

/**
 * 名称清洗：仅保留字符串，去空白、去空项、去重，并保持调用方给定的顺序（绝不排序）。
 */
function sanitizeNames(values: readonly unknown[]): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== "string") continue
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    names.push(trimmed)
  }
  return names
}

/**
 * wiki/entities 与 wiki/outlines 下所有 .md 的清单指纹：
 * 每个文件一行「路径 NUL 大小 NUL 修改时间」，按路径升序拼接后取 SHA-256。
 * 目录缺失或单个文件缺少元数据都不会抛，缺失的大小/修改时间按 0 处理。
 */
export async function computeBindableFingerprint(projectPath: string): Promise<string> {
  const root = normalizePath(projectPath)
  const entries: { path: string; line: string }[] = []

  for (const relativeDir of ["wiki/entities", "wiki/outlines"]) {
    let tree: FileNode[] = []
    try {
      tree = await listDirectory(`${root}/${relativeDir}`)
    } catch {
      // 项目可能还没有这些目录，按空清单处理。
      tree = []
    }
    collectMarkdownInventory(tree, entries)
  }

  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  return sha256Text(entries.map((entry) => entry.line).join("\n"))
}

function collectMarkdownInventory(nodes: readonly FileNode[], entries: { path: string; line: string }[]): void {
  for (const node of nodes) {
    if (node.is_dir) {
      if (Array.isArray(node.children)) collectMarkdownInventory(node.children, entries)
      continue
    }
    if (!node.name.toLowerCase().endsWith(".md")) continue
    const path = normalizePath(node.path)
    entries.push({ path, line: `${path}\u0000${node.size ?? 0}\u0000${node.mtimeMs ?? 0}` })
  }
}

/**
 * 读取缓存。文件缺失、JSON 损坏、字段类型不符时一律返回 null，从不抛错。
 */
export async function readBindableCharactersCache(projectPath: string): Promise<BindableCharactersCache | null> {
  try {
    const parsed = JSON.parse(await readFile(bindableCharactersCachePath(projectPath))) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null

    const record = parsed as Record<string, unknown>
    const fingerprint = typeof record.fingerprint === "string" ? record.fingerprint.trim() : ""
    if (!fingerprint) return null
    if (!Array.isArray(record.names) || record.names.some((name) => typeof name !== "string")) return null

    const cache: BindableCharactersCache = {
      fingerprint,
      names: sanitizeNames(record.names),
      updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
    }
    if (typeof record.llmRefinedFingerprint === "string" && record.llmRefinedFingerprint) {
      cache.llmRefinedFingerprint = record.llmRefinedFingerprint
    }
    return cache
  } catch {
    return null
  }
}

/** 以易读 JSON 原子落盘。名单写入前再去重一次，保持调用方的顺序。 */
export async function writeBindableCharactersCache(
  projectPath: string,
  entry: BindableCharactersCache,
): Promise<void> {
  // 读-改-写：同一指纹下「已精修」的结果永远优于「仅本地」的写入。
  // 否则「load 判未命中 → 本地解析 → 写回」与「精修跑完 → 写回」交叉时，
  // 后者的名单和 llmRefinedFingerprint 会被前者整份覆盖，下次打开又得问模型。
  if (!entry.llmRefinedFingerprint) {
    const existing = await readBindableCharactersCache(projectPath)
    if (existing?.llmRefinedFingerprint === entry.fingerprint) return
  }
  const payload: BindableCharactersCache = {
    fingerprint: entry.fingerprint,
    names: sanitizeNames(entry.names),
    updatedAt: entry.updatedAt,
  }
  if (entry.llmRefinedFingerprint) payload.llmRefinedFingerprint = entry.llmRefinedFingerprint
  await writeFileAtomic(bindableCharactersCachePath(projectPath), JSON.stringify(payload, null, 2))
}

/**
 * 指纹未变则直接命中缓存；否则调用 compute 重算并落盘。
 * 一次调用只扫描一次清单。compute 抛错时不写缓存，错误向上抛。
 */
export async function loadBindableCharactersWithCache(
  projectPath: string,
  compute: () => Promise<string[]>,
  options?: { force?: boolean },
): Promise<{ names: string[]; cacheHit: boolean; fingerprint: string }> {
  const fingerprint = await computeBindableFingerprint(projectPath)

  if (!options?.force) {
    const cached = await readBindableCharactersCache(projectPath)
    if (cached && cached.fingerprint === fingerprint) {
      return { names: cached.names, cacheHit: true, fingerprint }
    }
  }

  const names = sanitizeNames(await compute())
  // compute() 期间可能有精修落盘：同指纹的已精修结果比刚算出的本地名单更全，
  // 直接采用它并视为命中（写回也会被下面的守卫拒掉）。
  const landed = await readBindableCharactersCache(projectPath)
  if (landed && landed.fingerprint === fingerprint && landed.llmRefinedFingerprint === fingerprint) {
    return { names: landed.names, cacheHit: true, fingerprint }
  }
  await writeBindableCharactersCache(projectPath, { fingerprint, names, updatedAt: Date.now() })
  return { names, cacheHit: false, fingerprint }
}
