/**
 * Pure helpers for batched embedding requests and reindex planning.
 * No I/O: HTTP and Lance live in embedding.ts / vectorstore.rs.
 */

export const EMBED_BATCH_SIZE = 64
/** In-flight embedding HTTP calls. Each call is one batch, not one page. */
export const EMBED_BATCH_CONCURRENCY = 32
/** Rebuild queue depth: two waves of batches so reads overlap HTTP. */
export const EMBED_QUEUE_DEPTH = EMBED_BATCH_CONCURRENCY * 2
/** Flush the staging buffer at this many rows, or at the byte cap below. */
export const EMBED_WRITE_ROW_LIMIT = 4096
/** Rough JSON size of buffered vectors, about 8 characters per float. */
export const EMBED_WRITE_BYTE_LIMIT = 64 * 1024 * 1024
/** Dirty pages above this go through a staging-table rebuild. */
export const EMBED_REBUILD_DIRTY_LIMIT = 64

export interface EmbeddingIndexManifest {
  configHash: string
  pages: Record<string, string>
}

export interface EmbeddingReindexPlan {
  mode: "incremental" | "rebuild"
  dirtyIds: string[]
  removedIds: string[]
}

export type EmbeddingBatchAttempt =
  | { ok: true; vectors: (number[] | null)[] }
  | { ok: false; status: number; statusText?: string; body: string }

export function looksLikeOversizeError(httpStatus: number, body: string): boolean {
  if (httpStatus === 413) return true
  const lower = body.toLowerCase()
  return (
    lower.includes("too long") ||
    lower.includes("maximum context") ||
    lower.includes("max_tokens") ||
    lower.includes("max tokens") ||
    lower.includes("context length") ||
    lower.includes("token limit") ||
    lower.includes("exceeds") ||
    lower.includes("input length") ||
    lower.includes("batch size") ||
    lower.includes("max batch")
  )
}

/** JSON size of one embedding, about 8 characters per float. */
export function estimateEmbeddingJsonBytes(dimensions: number): number {
  return dimensions * 8
}

export function shouldFlushEmbeddingWrite(rowCount: number, estimatedBytes: number): boolean {
  return rowCount >= EMBED_WRITE_ROW_LIMIT || estimatedBytes >= EMBED_WRITE_BYTE_LIMIT
}

export function hashEmbeddingText(text: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i))
    hash = BigInt.asUintN(64, hash * prime)
  }
  return hash.toString(16).padStart(16, "0")
}

export function hashEmbeddingPage(title: string, content: string): string {
  return hashEmbeddingText(`${title}\n${content}`)
}

export function embeddingConfigFingerprint(config: {
  model: string
  outputDimensionality?: number
  maxChunkChars?: number
  overlapChunkChars?: number
}): string {
  return hashEmbeddingText(
    [
      config.model.trim(),
      String(config.outputDimensionality ?? ""),
      String(config.maxChunkChars ?? ""),
      String(config.overlapChunkChars ?? ""),
    ].join("\0"),
  )
}

/**
 * Decide whether a reindex can patch a few pages or must rebuild.
 * Matching hashes produce an incremental plan with empty dirty/removed lists.
 */
export function planEmbeddingReindex(
  pageHashes: Record<string, string>,
  manifest: EmbeddingIndexManifest | null,
  configHash: string,
): EmbeddingReindexPlan {
  const allIds = Object.keys(pageHashes)
  if (!manifest || manifest.configHash !== configHash) {
    return { mode: "rebuild", dirtyIds: allIds, removedIds: [] }
  }
  const dirtyIds = allIds.filter((id) => manifest.pages[id] !== pageHashes[id])
  const removedIds = Object.keys(manifest.pages).filter((id) => !(id in pageHashes))
  if (dirtyIds.length > EMBED_REBUILD_DIRTY_LIMIT) {
    return { mode: "rebuild", dirtyIds: allIds, removedIds: [] }
  }
  return { mode: "incremental", dirtyIds, removedIds }
}

function isFiniteVector(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => typeof item === "number" && Number.isFinite(item))
}

function alignVectors(
  count: number,
  items: unknown[],
  read: (item: unknown, position: number) => { index?: number; embedding: number[] | null },
): (number[] | null)[] {
  const out: (number[] | null)[] = Array.from({ length: count }, () => null)
  items.forEach((item, position) => {
    const parsed = read(item, position)
    const at = typeof parsed.index === "number" ? parsed.index : position
    if (at >= 0 && at < count && parsed.embedding) out[at] = parsed.embedding
  })
  return out
}

function readIndex(item: unknown, keys: string[]): number | undefined {
  if (!item || typeof item !== "object") return undefined
  const record = item as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "number" && Number.isInteger(value)) return value
  }
  return undefined
}

export function parseOpenAiEmbeddingBatch(data: unknown, count: number): (number[] | null)[] | null {
  if (!data || typeof data !== "object") return null
  const items = (data as { data?: unknown }).data
  if (!Array.isArray(items)) return null
  return alignVectors(count, items, (item) => {
    const record = item && typeof item === "object" ? item as { embedding?: unknown } : {}
    return {
      index: readIndex(item, ["index"]),
      embedding: isFiniteVector(record.embedding) ? record.embedding : null,
    }
  })
}

export function parseDashScopeEmbeddingBatch(data: unknown, count: number): (number[] | null)[] | null {
  if (!data || typeof data !== "object") return null
  const items = (data as { output?: { embeddings?: unknown } }).output?.embeddings
  if (!Array.isArray(items)) return null
  return alignVectors(count, items, (item) => {
    const record = item && typeof item === "object" ? item as { embedding?: unknown } : {}
    return {
      index: readIndex(item, ["text_index", "index"]),
      embedding: isFiniteVector(record.embedding) ? record.embedding : null,
    }
  })
}

export function parseGoogleEmbeddingBatch(data: unknown, count: number): (number[] | null)[] | null {
  if (!data || typeof data !== "object") return null
  const items = (data as { embeddings?: unknown }).embeddings
  if (!Array.isArray(items)) return null
  return alignVectors(count, items, (item, position) => {
    const record = item && typeof item === "object" ? item as { values?: unknown } : {}
    return {
      index: readIndex(item, ["index"]) ?? position,
      embedding: isFiniteVector(record.values) ? record.values : null,
    }
  })
}

/**
 * Run one embedding request, splitting the batch in half when the server
 * rejects it as too large. Text is not truncated here; a single oversized
 * item is left to the caller.
 */
export async function collectEmbeddingBatch(
  texts: string[],
  request: (texts: string[]) => Promise<EmbeddingBatchAttempt>,
): Promise<(number[] | null)[]> {
  if (texts.length === 0) return []
  const result = await request(texts)
  if (result.ok) {
    if (result.vectors.length === texts.length) return result.vectors
    return texts.map((_, index) => result.vectors[index] ?? null)
  }
  if (looksLikeOversizeError(result.status, result.body) && texts.length > 1) {
    const mid = Math.ceil(texts.length / 2)
    const left = await collectEmbeddingBatch(texts.slice(0, mid), request)
    const right = await collectEmbeddingBatch(texts.slice(mid), request)
    return left.concat(right)
  }
  return texts.map(() => null)
}
