/**
 * I/O wrapper that connects the pure dedup algorithm in dedup.ts
 * to the project's filesystem + LLM. The UI layer calls these
 * functions; everything below is about read/write/spawn-llm so
 * the algorithm core stays testable without mocks of all that.
 */
import { listDirectory, readFile, writeFile, deleteFile } from "@/commands/fs"
import { streamChat } from "@/lib/llm-client"
import { normalizePath } from "@/lib/path-utils"
import type { LlmConfig } from "@/stores/wiki-store"
import type { FileNode } from "@/types/wiki"
import {
  detectDuplicateGroups,
  extractEntitySummary,
  mergeDuplicateGroup,
  rewriteIndexMd,
  type DedupLlmCall,
  type DuplicateGroup,
  type EntitySummary,
  type MergeResult,
} from "./dedup"
import { loadNotDuplicates } from "./dedup-storage"

const WIKI_READ_CONCURRENCY = 12
const WIKI_WRITE_CONCURRENCY = 12

export type DedupMergeStage = "loading" | "merging" | "writing"

export type DedupScanStage = "loading" | "detecting"

/** Append-only process log line for UI / console. */
export type DedupLogFn = (message: string) => void

export interface ExecuteMergeOptions {
  signal?: AbortSignal
  onProgress?: (stage: DedupMergeStage) => void
  onLog?: DedupLogFn
}

export interface RunDuplicateDetectionOptions {
  signal?: AbortSignal
  summaries?: EntitySummary[]
  onProgress?: (stage: DedupScanStage) => void
  onLog?: DedupLogFn
}

function describeLlm(llmConfig: LlmConfig): string {
  const provider = llmConfig.provider?.trim() || "unknown"
  const model = llmConfig.model?.trim() || "unknown"
  return `${provider}/${model}`
}

export interface DuplicateDetectionResult {
  groups: DuplicateGroup[]
  scannedPageCount: number
}

/**
 * Run `fn` over `items` with a bounded worker pool. Items where `fn`
 * returns null/undefined are omitted from the result.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R | null | undefined>,
): Promise<R[]> {
  if (items.length === 0) return []

  const limit = Math.max(1, concurrency)
  const results: R[] = []
  let index = 0

  async function worker(): Promise<void> {
    while (true) {
      const i = index++
      if (i >= items.length) return
      const result = await fn(items[i])
      if (result !== null && result !== undefined) {
        results.push(result)
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  )
  return results
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return

  const limit = Math.max(1, concurrency)
  let index = 0

  async function worker(): Promise<void> {
    while (true) {
      const i = index++
      if (i >= items.length) return
      await fn(items[i])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  )
}

/**
 * Wrap streamChat into the (system, user, signal) → string shape
 * the dedup module expects. Same pattern page-merge uses — keeps
 * the algorithm modules free of any LlmConfig knowledge.
 */
export function buildDedupLlmCall(llmConfig: LlmConfig): DedupLlmCall {
  return async (systemPrompt, userMessage, signal) => {
    let result = ""
    let streamError: Error | null = null
    await new Promise<void>((resolve) => {
      streamChat(
        llmConfig,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        {
          onToken: (t) => {
            result += t
          },
          onDone: () => resolve(),
          onError: (err) => {
            streamError = err
            resolve()
          },
        },
        signal,
        { temperature: 0.1 },
      ).catch((err) => {
        streamError = err instanceof Error ? err : new Error(String(err))
        resolve()
      })
    })
    if (streamError) throw streamError
    return result
  }
}

/** Walk a FileNode tree, yielding every .md file under a given prefix. */
function* walkMd(nodes: FileNode[], prefix: string): Generator<FileNode> {
  for (const node of nodes) {
    if (node.is_dir) {
      if (node.children) yield* walkMd(node.children, prefix)
      continue
    }
    if (node.name.endsWith(".md") && node.path.includes(`${prefix}/`)) {
      yield node
    }
  }
}

/** Convert an absolute filesystem path to a wiki-relative one
 *  (`<project>/wiki/entities/foo.md` → `wiki/entities/foo.md`). */
function toWikiRelative(projectPath: string, absPath: string): string {
  const pp = normalizePath(projectPath)
  const norm = normalizePath(absPath)
  if (norm.startsWith(`${pp}/`)) return norm.slice(pp.length + 1)
  return norm
}

/**
 * Walk wiki/entities/ and wiki/concepts/, build summaries.
 * Pages that fail to parse (no frontmatter, etc.) are skipped
 * silently — they can't participate in dedup anyway.
 */
export async function loadAllEntitySummaries(
  projectPath: string,
): Promise<EntitySummary[]> {
  const pp = normalizePath(projectPath)
  const tree = await listDirectory(pp)
  const nodes: FileNode[] = []
  for (const prefix of ["wiki/entities", "wiki/concepts"]) {
    nodes.push(...walkMd(tree, prefix))
  }

  return mapWithConcurrency(nodes, WIKI_READ_CONCURRENCY, async (node) => {
    try {
      const content = await readFile(node.path)
      const rel = toWikiRelative(pp, node.path)
      return extractEntitySummary(rel, content)
    } catch {
      return null
    }
  })
}

/** Read every .md under wiki/ as { path, content }. The path is
 *  the wiki-relative form callers downstream use. */
export async function loadAllWikiPages(
  projectPath: string,
): Promise<{ path: string; content: string }[]> {
  const pp = normalizePath(projectPath)
  const tree = await listDirectory(pp)
  const nodes = [...walkMd(tree, "wiki")]

  return mapWithConcurrency(nodes, WIKI_READ_CONCURRENCY, async (node) => {
    try {
      const content = await readFile(node.path)
      return { path: toWikiRelative(pp, node.path), content }
    } catch {
      return null
    }
  })
}

/**
 * Stage 1 + 2 from the user's perspective: scan the project for
 * duplicate-candidate groups. Reads notDuplicates whitelist from
 * disk so previously-confirmed false-positives don't reappear.
 */
export async function runDuplicateDetection(
  projectPath: string,
  llmConfig: LlmConfig,
  options: RunDuplicateDetectionOptions = {},
): Promise<DuplicateDetectionResult> {
  const log = options.onLog
  log?.(`开始扫描，模型：${describeLlm(llmConfig)}`)
  options.onProgress?.("loading")
  log?.("正在读取实体 / 概念页面…")
  const summaries =
    options.summaries ?? (await loadAllEntitySummaries(projectPath))
  log?.(`已读取 ${summaries.length} 个实体 / 概念页面`)

  if (summaries.length < 2) {
    log?.("页面不足 2 个，跳过模型检测")
    return { groups: [], scannedPageCount: summaries.length }
  }

  options.onProgress?.("detecting")
  const notDup = await loadNotDuplicates(projectPath)
  if (notDup.length > 0) {
    log?.(`已加载 ${notDup.length} 组「非重复」白名单`)
  }
  log?.("正在调用模型分析重复候选…")
  const llm = buildDedupLlmCall(llmConfig)
  const groups = await detectDuplicateGroups(summaries, llm, {
    signal: options.signal,
    notDuplicates: notDup,
  })
  log?.(`模型分析完成，得到 ${groups.length} 组重复候选`)
  return { groups, scannedPageCount: summaries.length }
}

/**
 * Stage 3 + persistence: execute one user-confirmed merge.
 *
 * Steps:
 *   1. Load each group page's full content + every other wiki page
 *   2. Run mergeDuplicateGroup (LLM body merge + frontmatter
 *      union + cross-reference rewrites)
 *   3. Snapshot every touched file to .qmai/page-history/
 *      dedup-<timestamp>/
 *   4. Write canonical content
 *   5. Apply cross-reference rewrites
 *   6. Delete merged-away files
 *   7. Apply index.md rewrite (separate pass — index isn't in
 *      otherWikiPages because removing references is a different
 *      operation than slug-rewriting them)
 */
export async function executeMerge(
  projectPath: string,
  group: DuplicateGroup,
  canonicalSlug: string,
  llmConfig: LlmConfig,
  options: ExecuteMergeOptions = {},
): Promise<MergeResult> {
  const pp = normalizePath(projectPath)
  const { signal, onProgress, onLog: log } = options

  log?.(
    `开始合并 ${group.slugs.join(", ")} → ${canonicalSlug}，模型：${describeLlm(llmConfig)}`,
  )

  // 1. Resolve each group slug to its actual on-disk path + content
  onProgress?.("loading")
  log?.("正在读取 wiki 页面…")
  const allPages = await loadAllWikiPages(pp)
  log?.(`已读取 ${allPages.length} 个 wiki 页面`)
  const pathBySlug = new Map<string, string>()
  for (const p of allPages) {
    const base = p.path.split("/").pop() ?? ""
    if (base.endsWith(".md")) {
      pathBySlug.set(base.slice(0, -3), p.path)
    }
  }
  const groupPages: { slug: string; path: string; content: string }[] = []
  for (const slug of group.slugs) {
    const relPath = pathBySlug.get(slug)
    if (!relPath) {
      throw new Error(
        `Slug "${slug}" not found on disk — was the page deleted between detection and merge?`,
      )
    }
    const page = allPages.find((p) => p.path === relPath)
    if (!page) {
      throw new Error(`Internal: page lookup miss for ${relPath}`)
    }
    groupPages.push({ slug, path: relPath, content: page.content })
  }

  const groupPaths = new Set(groupPages.map((p) => p.path))
  const otherPages = allPages.filter((p) => !groupPaths.has(p.path))

  const llm = buildDedupLlmCall(llmConfig)
  onProgress?.("merging")
  log?.("正在调用模型合并正文…")
  const result = await mergeDuplicateGroup(
    {
      group: groupPages,
      canonicalSlug,
      otherWikiPages: otherPages,
    },
    llm,
    { signal },
  )
  log?.("模型正文合并完成")

  onProgress?.("writing")
  log?.("正在写入备份与文件…")

  // 2. Snapshot backup before any writes. If a write fails partway
  //    through, the user has the pre-merge state intact in
  //    .qmai/page-history/.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const backupDir = `${pp}/.qmai/page-history/dedup-${stamp}`
  await runWithConcurrency(result.backup, WIKI_WRITE_CONCURRENCY, async (b) => {
    const sanitized = b.path.replace(/[/\\]/g, "_")
    await writeFile(`${backupDir}/${sanitized}`, b.content)
  })
  log?.(`已备份 ${result.backup.length} 个文件 → ${backupDir}`)

  // 3. Write canonical
  await writeFile(`${pp}/${result.canonicalPath}`, result.canonicalContent)
  log?.(`已写入主条目 ${result.canonicalPath}`)

  // 4. Apply rewrites
  await runWithConcurrency(result.rewrites, WIKI_WRITE_CONCURRENCY, async (r) => {
    await writeFile(`${pp}/${r.path}`, r.newContent)
  })
  if (result.rewrites.length > 0) {
    log?.(`已改写 ${result.rewrites.length} 个交叉引用页面`)
  }

  // 5. Delete merged-away pages
  await runWithConcurrency(result.pagesToDelete, WIKI_WRITE_CONCURRENCY, async (dead) => {
    try {
      await deleteFile(`${pp}/${dead}`)
    } catch (err) {
      // Surface as a warning — backup is still safe.
      console.warn(`[dedup] failed to delete ${dead}: ${err}`)
      log?.(`删除失败（已有备份）：${dead}`)
    }
  })
  if (result.pagesToDelete.length > 0) {
    log?.(`已删除 ${result.pagesToDelete.length} 个合并掉的页面`)
  }

  // 6. Rewrite index.md to drop merged-away entries.
  const indexPath = `${pp}/wiki/index.md`
  const indexEntry = allPages.find((p) => p.path === "wiki/index.md")
  if (indexEntry) {
    const removed = new Set(
      group.slugs.filter((s) => s !== canonicalSlug),
    )
    const rewritten = rewriteIndexMd(indexEntry.content, removed)
    if (rewritten !== indexEntry.content) {
      await writeFile(indexPath, rewritten)
      log?.("已更新 wiki/index.md")
    }
  }

  log?.("合并完成")
  return result
}
