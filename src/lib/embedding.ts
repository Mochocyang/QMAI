/**
 * Embedding pipeline — standard RAG flow.
 *
 *   1. chunkMarkdown(content)        (src/lib/text-chunker.ts)
 *   2. embed chunks in batches (about 64 texts, 32 requests in flight
 *      across pages). The 32 cap is one process-wide slot, so a page
 *      update and a rebuild cannot multiply it.
 *      A batch the server calls too long, or too large, is split in
 *      half. A single text that is still too long is halved.
 *      429 and 503 wait 0.5s, 1s, then 2s and retry, up to 3 times.
 *   3. Single-page updates: vector_upsert_chunks replaces that page.
 *      Full reindex: append when the buffer hits 4096 rows or ~64MB
 *      of vector JSON, then swap the staging table and compact once.
 *
 * Search:
 *   1. fetchEmbedding(query)
 *   2. vector_search_chunks(query_emb, topK × 3)
 *   3. group by page_id, max-pool primary score + weighted tail sum
 *   4. return top-K pages, outer API-compatible with the old per-page
 *      `{id, score}[]` shape; matched chunks available on the
 *      optional `matchedChunks` field for future UI surfacing.
 *
 * HTTP goes through the Tauri plugin (`src/lib/tauri-fetch.ts`) so
 * CORS-unfriendly endpoints work the same as the LLM path.
 */

import { createDirectory, readFile, listDirectory, writeFileAtomic } from "@/commands/fs"
import { invoke } from "@tauri-apps/api/core"
import type { EmbeddingConfig } from "@/stores/wiki-store"
import type { FileNode } from "@/types/wiki"
import { mapWithConcurrency } from "@/lib/async-pool"
import {
  EMBED_BATCH_CONCURRENCY,
  EMBED_BATCH_SIZE,
  EMBED_QUEUE_DEPTH,
  collectEmbeddingBatch,
  embeddingConfigFingerprint,
  estimateEmbeddingJsonBytes,
  hashEmbeddingPage,
  looksLikeOversizeError,
  parseDashScopeEmbeddingBatch,
  parseGoogleEmbeddingBatch,
  parseOpenAiEmbeddingBatch,
  planEmbeddingReindex,
  shouldFlushEmbeddingWrite,
  type EmbeddingIndexManifest,
} from "@/lib/embedding-batch"
import {
  embeddingHttpBegan,
  embeddingHttpEnded,
  embeddingIndexLog,
  endpointHost,
  noteEmbeddingLogError,
  setEmbeddingLogBuffer,
  setEmbeddingLogPhase,
  setEmbeddingLogProgress,
  startEmbeddingIndexLog,
  stopEmbeddingIndexLog,
} from "@/lib/embedding-log"
import { normalizePath } from "@/lib/path-utils"
import { getHttpFetch, isFetchNetworkError } from "@/lib/tauri-fetch"
import { chunkMarkdown, type Chunk } from "@/lib/text-chunker"

const STRUCTURAL_PAGE_IDS = new Set(["index", "log", "overview", "purpose", "schema"])

/**
 * Serialize LanceDB v2 mutations. Concurrent delete+add on the same
 * table races (especially first-create), so every upsert/delete
 * chains through this promise queue regardless of caller.
 */
let vectorWriteChain: Promise<void> = Promise.resolve()

function withVectorWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = vectorWriteChain.then(fn, fn)
  vectorWriteChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/**
 * One process-wide cap on embedding HTTP calls. Held only around the
 * request itself: a rebuild worker that also took a slot would fill
 * all 32 and then deadlock waiting for its own POST.
 */
let embeddingSlotsInUse = 0
const embeddingSlotWaiters: Array<() => void> = []

function acquireEmbeddingSlot(): Promise<void> {
  if (embeddingSlotsInUse < EMBED_BATCH_CONCURRENCY) {
    embeddingSlotsInUse++
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    embeddingSlotWaiters.push(() => {
      embeddingSlotsInUse++
      resolve()
    })
  })
}

function releaseEmbeddingSlot() {
  embeddingSlotsInUse--
  const next = embeddingSlotWaiters.shift()
  if (next) next()
}

async function withEmbeddingSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireEmbeddingSlot()
  try {
    return await fn()
  } finally {
    releaseEmbeddingSlot()
  }
}

const EMBED_RATE_LIMIT_DELAYS_MS = [500, 1000, 2000]

function embeddingDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Error surfacing ──────────────────────────────────────────────────────

/**
 * Most recent embedding failure description, so Settings → Embedding
 * can show the user WHY vector search fell back to BM25 instead of
 * silently dropping to keyword match. Cleared on any successful
 * embed.
 */
let lastEmbeddingError: string | null = null

export function getLastEmbeddingError(): string | null {
  return lastEmbeddingError
}

// ── fetchEmbedding with auto-halve retry ────────────────────────────────

/**
 * Heuristic: does this error response look like an "input too long /
 * exceeds model context / payload too large" rejection? True for all
 * the phrasings we've seen from OpenAI, LM Studio, llama.cpp,
 * Ollama, and Azure. Safer to over-match than under-match — a false
 * positive just means a retry at half size, which will still succeed
 * on a real auth/model-id error (it won't) or just log the same error.
 */
type EmbeddingProvider = "google" | "dashscope" | "openai"

function embeddingProvider(cfg: EmbeddingConfig): EmbeddingProvider {
  if (isGoogleEmbeddingConfig(cfg)) return "google"
  if (isDashScopeEmbeddingConfig(cfg)) return "dashscope"
  return "openai"
}

function embeddingHeaders(cfg: EmbeddingConfig): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (!cfg.apiKey) return headers
  if (isGoogleEmbeddingConfig(cfg)) headers["x-goog-api-key"] = cfg.apiKey
  else headers.Authorization = `Bearer ${cfg.apiKey}`
  return headers
}

function embeddingRequest(cfg: EmbeddingConfig, texts: string[]): { endpoint: string; body: unknown } {
  if (isGoogleEmbeddingConfig(cfg) && texts.length === 1) {
    return {
      endpoint: googleEmbeddingEndpoint(cfg),
      body: googleEmbeddingBody(cfg.model, texts[0], cfg.outputDimensionality),
    }
  }
  if (isGoogleEmbeddingConfig(cfg)) {
    const single = googleEmbeddingEndpoint(cfg)
    return {
      endpoint: single.replace(/:embedContent/i, ":batchEmbedContents"),
      body: {
        requests: texts.map((text) => googleEmbeddingBody(cfg.model, text, cfg.outputDimensionality)),
      },
    }
  }
  if (isDashScopeEmbeddingConfig(cfg)) {
    return {
      endpoint: cfg.endpoint,
      body: {
        model: cfg.model.trim(),
        input: { texts },
      },
    }
  }
  return {
    endpoint: cfg.endpoint,
    body: {
      model: cfg.model,
      input: texts.length === 1 ? texts[0] : texts,
    },
  }
}

function parseProviderBatch(
  provider: EmbeddingProvider,
  data: unknown,
  count: number,
): (number[] | null)[] | null {
  if (provider === "google") {
    if (count === 1) {
      const single = (data as { embedding?: { values?: unknown } } | null)?.embedding?.values
      if (isNonEmptyNumberArray(single)) return [single]
    }
    return parseGoogleEmbeddingBatch(data, count)
  }
  if (provider === "dashscope") return parseDashScopeEmbeddingBatch(data, count)
  return parseOpenAiEmbeddingBatch(data, count)
}

function rememberEmbeddingFailure(message: string) {
  lastEmbeddingError = message
  console.warn(`[Embedding] ${message}`)
}

type EmbeddingPostResult =
  | { ok: true; vectors: (number[] | null)[] }
  | { ok: false; status: number; statusText: string; body: string }

async function postEmbeddingTextsOnce(
  cfg: EmbeddingConfig,
  texts: string[],
): Promise<EmbeddingPostResult> {
  const provider = embeddingProvider(cfg)
  const { endpoint, body } = embeddingRequest(cfg, texts)
  try {
    const httpFetch = await getHttpFetch()
    const resp = await httpFetch(endpoint, {
      method: "POST",
      headers: embeddingHeaders(cfg),
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      let bodyText = ""
      try {
        bodyText = await resp.text()
      } catch {
        // empty error bodies are common
      }
      return { ok: false, status: resp.status, statusText: resp.statusText, body: bodyText }
    }
    const data = await resp.json()
    const vectors = parseProviderBatch(provider, data, texts.length)
    if (!vectors) {
      const expectedShape = provider === "google"
        ? "embeddings[].values"
        : provider === "dashscope"
        ? "output.embeddings[].embedding"
        : "data[].embedding"
      rememberEmbeddingFailure(
        `Embedding response missing ${expectedShape} (got ${JSON.stringify(data).slice(0, 200)})`,
      )
      return { ok: true, vectors: texts.map(() => null) }
    }
    if (vectors.some((vector) => vector)) lastEmbeddingError = null
    return { ok: true, vectors }
  } catch (err) {
    const message = isFetchNetworkError(err)
      ? `Network error reaching ${endpoint}. Check endpoint URL, API key, and connectivity.`
      : err instanceof Error ? err.message : String(err)
    rememberEmbeddingFailure(message)
    noteEmbeddingLogError(message)
    embeddingIndexLog("http-fail", { status: 0, texts: texts.length, body: message.slice(0, 200) })
    return { ok: false, status: 0, statusText: "", body: message }
  }
}

async function postEmbeddingTextsOnceTracked(
  cfg: EmbeddingConfig,
  texts: string[],
): Promise<EmbeddingPostResult> {
  const id = embeddingHttpBegan()
  try {
    return await postEmbeddingTextsOnce(cfg, texts)
  } finally {
    embeddingHttpEnded(id)
  }
}

async function postEmbeddingTexts(
  cfg: EmbeddingConfig,
  texts: string[],
): Promise<EmbeddingPostResult> {
  let result = await withEmbeddingSlot(() => postEmbeddingTextsOnceTracked(cfg, texts))
  for (let attempt = 0; attempt < EMBED_RATE_LIMIT_DELAYS_MS.length; attempt++) {
    if (result.ok || (result.status !== 429 && result.status !== 503)) return result
    const waitMs = EMBED_RATE_LIMIT_DELAYS_MS[attempt]
    noteEmbeddingLogError(`HTTP ${result.status}`)
    embeddingIndexLog("retry", { status: result.status, waitMs, texts: texts.length })
    await embeddingDelay(waitMs)
    result = await withEmbeddingSlot(() => postEmbeddingTextsOnceTracked(cfg, texts))
  }
  return result
}

/**
 * Embed many texts. Requests stay at EMBED_BATCH_SIZE. In-flight HTTP
 * calls share one process-wide cap of EMBED_BATCH_CONCURRENCY, taken
 * inside postEmbeddingTexts. An oversize batch is split in half; only
 * a single remaining text is truncated.
 */
export async function fetchEmbeddings(
  texts: string[],
  cfg: EmbeddingConfig,
): Promise<(number[] | null)[]> {
  if (texts.length === 0) return []
  if (!cfg.endpoint) return texts.map(() => null)

  const groups: string[][] = []
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    groups.push(texts.slice(i, i + EMBED_BATCH_SIZE))
  }
  const nested = await mapWithConcurrency(groups, EMBED_BATCH_CONCURRENCY, (group) =>
    collectEmbeddingBatch(group, async (batch) => {
      if (batch.length === 1) {
        const vector = await fetchEmbedding(batch[0], cfg)
        return { ok: true, vectors: [vector] }
      }
      const posted = await postEmbeddingTexts(cfg, batch)
      if (!posted.ok && looksLikeOversizeError(posted.status, posted.body)) {
        embeddingIndexLog("oversize", {
          status: posted.status,
          texts: batch.length,
          body: posted.body.slice(0, 160),
        })
      } else if (!posted.ok && posted.status !== 0) {
        const message = `API ${posted.status} ${posted.statusText}${posted.body ? ` — ${posted.body.slice(0, 200)}` : ""} at ${cfg.endpoint}`
        rememberEmbeddingFailure(message)
        noteEmbeddingLogError(message)
        embeddingIndexLog("http-fail", {
          status: posted.status,
          texts: batch.length,
          body: posted.body.slice(0, 200),
        })
      }
      return posted
    }),
  )
  return nested.flat()
}

/**
 * POST one embedding request; on an oversize rejection, halve the text
 * and retry up to `maxRetries` times. Returns null on definitive
 * failure (auth, network, dim mismatch, retries exhausted) with a
 * human-readable reason left in `lastEmbeddingError`.
 *
 * The returned vector represents the (possibly truncated) text that
 * actually got through. Chunker config should be tuned to minimise
 * truncation — this is a safety net, not the main line of defence.
 */
export async function fetchEmbedding(
  text: string,
  cfg: EmbeddingConfig,
  maxRetries = 3,
): Promise<number[] | null> {
  if (!cfg.endpoint) return null

  const endpoint = isGoogleEmbeddingConfig(cfg) ? googleEmbeddingEndpoint(cfg) : cfg.endpoint
  let current = text
  let attempts = 0
  while (attempts <= maxRetries) {
    attempts++
    const posted = await postEmbeddingTexts(cfg, [current])
    if (posted.ok) {
      const embedding = posted.vectors[0]
      if (embedding) return embedding
      return null
    }

    if (looksLikeOversizeError(posted.status, posted.body)) {
      embeddingIndexLog("oversize", {
        status: posted.status,
        texts: 1,
        chars: current.length,
        body: posted.body.slice(0, 160),
      })
      if (current.length > 64 && attempts <= maxRetries) {
        const prev = current.length
        current = current.slice(0, Math.floor(current.length / 2))
        console.warn(
          `[Embedding] auto-halving after HTTP ${posted.status} at ${prev} chars → retrying at ${current.length} chars (attempt ${attempts}/${maxRetries + 1})`,
        )
        continue
      }
      rememberEmbeddingFailure(
        `Endpoint rejected input even at ${current.length} chars — server context smaller than expected. Lower Settings → Embedding → Max Chunk Chars (${posted.body.slice(0, 160)}).`,
      )
      return null
    }

    if (posted.status === 0) return null
    const message = `API ${posted.status} ${posted.statusText}${posted.body ? ` — ${posted.body.slice(0, 200)}` : ""} at ${endpoint}`
    rememberEmbeddingFailure(message)
    noteEmbeddingLogError(message)
    embeddingIndexLog("http-fail", {
      status: posted.status,
      texts: 1,
      body: posted.body.slice(0, 200),
    })
    return null
  }

  rememberEmbeddingFailure(
    `Embedding endpoint rejected every size down to ${current.length} chars — the server's context is smaller than ${current.length * 2}. Lower Settings → Embedding → Max Chunk Chars.`,
  )
  return null
}

function isNonEmptyNumberArray(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => typeof item === "number" && Number.isFinite(item))
}

function isGoogleEmbeddingConfig(cfg: EmbeddingConfig): boolean {
  const endpoint = cfg.endpoint.toLowerCase()
  return endpoint.includes("generativelanguage.googleapis.com")
    || /:embedcontent(\?|$)/i.test(endpoint)
}

function isDashScopeEmbeddingConfig(cfg: EmbeddingConfig): boolean {
  const endpoint = cfg.endpoint.toLowerCase()
  return endpoint.includes("dashscope.aliyuncs.com") && endpoint.includes("/embeddings/")
}

function googleEmbeddingEndpoint(cfg: EmbeddingConfig): string {
  const raw = stripGoogleApiKeyQuery(cfg.endpoint.trim()).replace(/\/+$/, "")
  if (/:batchEmbedContents(\?|$)/i.test(raw)) {
    return raw.replace(/:batchEmbedContents/i, ":embedContent")
  }
  if (/:embedContent(\?|$)/i.test(raw)) return raw

  const modelPath = googleModelPath(cfg.model)
  if (/\/models\/[^/?]+$/i.test(raw)) {
    return `${raw}:embedContent`
  }
  return `${raw}/models/${encodeURIComponent(modelPath.replace(/^models\//, ""))}:embedContent`
}

function stripGoogleApiKeyQuery(endpoint: string): string {
  if (!endpoint.includes("?")) return endpoint
  try {
    const url = new URL(endpoint)
    url.searchParams.delete("key")
    return url.toString()
  } catch {
    return endpoint.replace(/([?&])key=[^&]*&?/i, (_, prefix: string) => prefix === "?" ? "?" : "&")
      .replace(/[?&]$/, "")
      .replace("?&", "?")
  }
}

function googleModelPath(model: string): string {
  const trimmed = model.trim()
  if (trimmed.startsWith("models/")) return trimmed
  return `models/${trimmed}`
}

function googleEmbeddingBody(
  model: string,
  text: string,
  outputDimensionality?: number,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: googleModelPath(model),
    content: {
      parts: [{ text }],
    },
  }
  if (typeof outputDimensionality === "number" && Number.isFinite(outputDimensionality) && outputDimensionality > 0) {
    body.output_dimensionality = Math.floor(outputDimensionality)
  }
  return body
}

// ── LanceDB v2 operations (via Rust Tauri commands) ──────────────────────

interface ChunkUpsertInput {
  chunkIndex: number
  chunkText: string
  headingPath: string
  embedding: number[]
}

async function vectorUpsertChunks(
  projectPath: string,
  pageId: string,
  chunks: ChunkUpsertInput[],
): Promise<void> {
  const pp = normalizePath(projectPath)
  await withVectorWriteLock(() =>
    invoke("vector_upsert_chunks", {
      projectPath: pp,
      pageId,
      chunks: chunks.map((c) => ({
        chunk_index: c.chunkIndex,
        chunk_text: c.chunkText,
        heading_path: c.headingPath,
        embedding: c.embedding.map((v) => Math.fround(v)),
      })),
    }),
  )
}

interface ChunkSearchResult {
  chunk_id: string
  page_id: string
  chunk_index: number
  chunk_text: string
  heading_path: string
  score: number
}

async function vectorSearchChunks(
  projectPath: string,
  queryEmbedding: number[],
  topK: number,
): Promise<ChunkSearchResult[]> {
  const pp = normalizePath(projectPath)
  return await invoke("vector_search_chunks", {
    projectPath: pp,
    queryEmbedding: queryEmbedding.map((v) => Math.fround(v)),
    topK,
  })
}

async function vectorDeletePage(projectPath: string, pageId: string): Promise<void> {
  const pp = normalizePath(projectPath)
  await withVectorWriteLock(() =>
    invoke("vector_delete_page", {
      projectPath: pp,
      pageId,
    }),
  )
}

interface RebuildChunkInput extends ChunkUpsertInput {
  pageId: string
}

function packEmbeddingRows(chunks: RebuildChunkInput[]) {
  return chunks.map((c) => ({
    page_id: c.pageId,
    chunk_index: c.chunkIndex,
    chunk_text: c.chunkText,
    heading_path: c.headingPath,
    embedding: c.embedding.map((v) => Math.fround(v)),
  }))
}

async function vectorRebuildBegin(projectPath: string): Promise<void> {
  await withVectorWriteLock(() =>
    invoke("vector_rebuild_begin", { projectPath: normalizePath(projectPath) }),
  )
}

async function vectorRebuildAppend(projectPath: string, chunks: RebuildChunkInput[]): Promise<void> {
  if (chunks.length === 0) return
  await withVectorWriteLock(() =>
    invoke("vector_rebuild_append", {
      projectPath: normalizePath(projectPath),
      chunks: packEmbeddingRows(chunks),
    }),
  )
}

async function vectorRebuildCommit(projectPath: string): Promise<void> {
  await withVectorWriteLock(() =>
    invoke("vector_rebuild_commit", { projectPath: normalizePath(projectPath) }),
  )
}

async function vectorRebuildAbort(projectPath: string): Promise<void> {
  await withVectorWriteLock(() =>
    invoke("vector_rebuild_abort", { projectPath: normalizePath(projectPath) }),
  )
}

async function vectorCountChunks(projectPath: string): Promise<number> {
  const pp = normalizePath(projectPath)
  return await invoke("vector_count_chunks", {
    projectPath: pp,
  })
}

export async function legacyVectorRowCount(projectPath: string): Promise<number> {
  try {
    const pp = normalizePath(projectPath)
    return await invoke("vector_legacy_row_count", {
      projectPath: pp,
    })
  } catch {
    return 0
  }
}

export async function dropLegacyVectorTable(projectPath: string): Promise<void> {
  const pp = normalizePath(projectPath)
  await invoke("vector_drop_legacy", {
    projectPath: pp,
  })
}

// ── Chunk enrichment ─────────────────────────────────────────────────────

/**
 * Build the text we actually embed for a chunk: page title + heading
 * breadcrumb + chunk content. The breadcrumb is the most important
 * context for a short chunk — a 300-char excerpt about "Mixture of
 * Experts" is far more findable when the embedded text explicitly
 * names its containing sections.
 */
function enrichChunkForEmbedding(
  pageTitle: string,
  chunk: Chunk,
): string {
  const parts: string[] = []
  if (pageTitle.trim().length > 0) parts.push(pageTitle.trim())
  if (chunk.headingPath.trim().length > 0) parts.push(chunk.headingPath.trim())
  parts.push(chunk.text.trim())
  return parts.join("\n\n")
}

// ── Public API: embedPage / embedAllPages / searchByEmbedding ────────────

function chunkOptions(cfg: EmbeddingConfig) {
  return {
    targetChars: cfg.maxChunkChars ?? 1000,
    overlapChars: cfg.overlapChunkChars ?? 200,
  }
}

function pageTitleFromMarkdown(content: string, fallback: string): string {
  const titleMatch = content.match(/^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m)
  return titleMatch ? titleMatch[1].trim() : fallback
}

interface WikiPageRef {
  id: string
  path: string
  title: string
  hash: string
}

function manifestPath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/embedding-index.json`
}

async function readEmbeddingManifest(projectPath: string): Promise<EmbeddingIndexManifest | null> {
  try {
    const raw = await readFile(manifestPath(projectPath))
    const parsed = JSON.parse(raw) as Partial<EmbeddingIndexManifest>
    if (!parsed || typeof parsed.configHash !== "string" || !parsed.pages || typeof parsed.pages !== "object") {
      return null
    }
    const pages: Record<string, string> = {}
    for (const [id, hash] of Object.entries(parsed.pages)) {
      if (typeof hash === "string") pages[id] = hash
    }
    return { configHash: parsed.configHash, pages }
  } catch {
    return null
  }
}

async function writeEmbeddingManifest(projectPath: string, manifest: EmbeddingIndexManifest): Promise<void> {
  const path = manifestPath(projectPath)
  await createDirectory(`${normalizePath(projectPath)}/.qmai`)
  await writeFileAtomic(path, JSON.stringify(manifest))
}

async function listWikiPages(projectPath: string): Promise<WikiPageRef[]> {
  const tree = await listDirectory(`${normalizePath(projectPath)}/wiki`)
  const files: { id: string; path: string }[] = []
  const walk = (nodes: FileNode[]) => {
    for (const node of nodes) {
      if (node.is_dir && node.children) walk(node.children)
      else if (!node.is_dir && node.name.endsWith(".md")) {
        const id = node.name.replace(/\.md$/, "")
        if (!STRUCTURAL_PAGE_IDS.has(id)) files.push({ id, path: node.path })
      }
    }
  }
  walk(tree)

  const pages: WikiPageRef[] = []
  for (const file of files) {
    const content = await readFile(file.path)
    const title = pageTitleFromMarkdown(content, file.id)
    pages.push({
      id: file.id,
      path: file.path,
      title,
      hash: hashEmbeddingPage(title, content),
    })
  }
  return pages
}

/**
 * Embed a wiki page: chunk → batched embed → replace the page's
 * vectors in LanceDB in one batch. Every transient failure leaves the
 * existing v2 rows intact (empty upsert is a no-op Rust-side).
 *
 * Returns false when any chunk failed to embed, so a later reindex
 * will try the page again. Called by ingest.ts after writing a page.
 */
export async function embedPage(
  projectPath: string,
  pageId: string,
  title: string,
  content: string,
  cfg: EmbeddingConfig,
): Promise<boolean> {
  if (!cfg.enabled || !cfg.model) return false

  const t0 = performance.now()
  const chunks = chunkMarkdown(content, chunkOptions(cfg))
  if (chunks.length === 0) return true

  const vectors = await fetchEmbeddings(chunks.map((chunk) => enrichChunkForEmbedding(title, chunk)), cfg)
  const rows: ChunkUpsertInput[] = []
  let failedChunks = 0
  chunks.forEach((chunk, index) => {
    const vec = vectors[index]
    if (vec) {
      rows.push({
        chunkIndex: chunk.index,
        chunkText: chunk.text,
        headingPath: chunk.headingPath,
        embedding: vec,
      })
    } else {
      failedChunks++
    }
  })

  if (rows.length === 0) {
    console.log(
      `[Embedding] Indexed nothing for "${pageId}" — all ${chunks.length} chunks failed. See getLastEmbeddingError().`,
    )
    return false
  }

  await vectorUpsertChunks(projectPath, pageId, rows)
  const elapsed = Math.round(performance.now() - t0)
  console.log(
    `[Embedding] Indexed "${pageId}": ${rows.length}/${chunks.length} chunks (${failedChunks} skipped) in ${elapsed}ms`,
  )
  return failedChunks === 0
}

async function embedPagesIncremental(
  projectPath: string,
  pages: WikiPageRef[],
  dirtyIds: Set<string>,
  removedIds: string[],
  cfg: EmbeddingConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<Record<string, string>> {
  for (const id of removedIds) {
    await vectorDeletePage(projectPath, id)
  }
  const hashes: Record<string, string> = {}
  const dirtyPages: WikiPageRef[] = []
  for (const page of pages) {
    if (dirtyIds.has(page.id)) dirtyPages.push(page)
    else hashes[page.id] = page.hash
  }
  let done = pages.length - dirtyPages.length
  onProgress?.(done, pages.length)
  await mapWithConcurrency(dirtyPages, EMBED_BATCH_CONCURRENCY, async (page) => {
    try {
      const content = await readFile(page.path)
      const ok = await embedPage(projectPath, page.id, page.title, content, cfg)
      if (ok) hashes[page.id] = page.hash
      else embeddingIndexLog("page-incomplete", { pageId: page.id })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      noteEmbeddingLogError(message)
      embeddingIndexLog("page-fail", { pageId: page.id, error: message.slice(0, 200) })
    }
    done++
    setEmbeddingLogProgress(done, pages.length)
    onProgress?.(done, pages.length)
  })
  return hashes
}

interface RebuildBatch {
  pageId: string
  chunks: Chunk[]
  texts: string[]
}

function createRebuildQueue(limit: number) {
  const items: RebuildBatch[] = []
  const takers: Array<(value: RebuildBatch | undefined) => void> = []
  const space: Array<() => void> = []
  let closed = false

  return {
    get closed() {
      return closed
    },
    async push(item: RebuildBatch) {
      if (closed) return
      while (items.length >= limit && takers.length === 0 && !closed) {
        await new Promise<void>((resolve) => space.push(resolve))
      }
      if (closed) return
      const taker = takers.shift()
      if (taker) taker(item)
      else items.push(item)
    },
    close() {
      closed = true
      for (const taker of takers.splice(0)) taker(undefined)
      for (const resolve of space.splice(0)) resolve()
    },
    async pop(): Promise<RebuildBatch | undefined> {
      const next = items.shift()
      space.shift()?.()
      if (next) return next
      if (closed) return undefined
      return new Promise((resolve) => takers.push(resolve))
    },
  }
}

async function embedPagesRebuild(
  projectPath: string,
  pages: WikiPageRef[],
  cfg: EmbeddingConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<Record<string, string>> {
  await vectorRebuildBegin(projectPath)
  const hashes: Record<string, string> = {}
  const buffer: RebuildChunkInput[] = []
  const pageStates = new Map<string, { hash: string; left: number; failed: boolean }>()
  const queue = createRebuildQueue(EMBED_QUEUE_DEPTH)
  let done = 0
  let writeError: unknown = null
  let writeChain = Promise.resolve()
  let bufferBytes = 0

  const notePageFinished = (pageId: string) => {
    const state = pageStates.get(pageId)
    if (!state) return
    state.left -= 1
    if (state.left > 0) return
    pageStates.delete(pageId)
    if (!state.failed) hashes[pageId] = state.hash
    else embeddingIndexLog("page-incomplete", { pageId })
    done += 1
    setEmbeddingLogProgress(done, pages.length)
    onProgress?.(done, pages.length)
  }

  const enqueueRows = (rows: RebuildChunkInput[]) => {
    if (writeError || rows.length === 0) return
    for (const row of rows) {
      buffer.push(row)
      bufferBytes += estimateEmbeddingJsonBytes(row.embedding.length)
    }
    setEmbeddingLogBuffer(buffer.length, bufferBytes)
    if (!shouldFlushEmbeddingWrite(buffer.length, bufferBytes)) return
    const batch = buffer.splice(0, buffer.length)
    const flushedBytes = bufferBytes
    bufferBytes = 0
    setEmbeddingLogBuffer(0, 0)
    embeddingIndexLog("flush", { rows: batch.length, bytes: flushedBytes })
    writeChain = writeChain.then(() => vectorRebuildAppend(projectPath, batch)).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      writeError = error
      noteEmbeddingLogError(message)
      embeddingIndexLog("flush-fail", { error: message.slice(0, 200) })
      queue.close()
    })
  }

  const producer = (async () => {
    try {
      for (const page of pages) {
        if (queue.closed) return
        let chunks: Chunk[] = []
        try {
          const content = await readFile(page.path)
          chunks = chunkMarkdown(content, chunkOptions(cfg))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          noteEmbeddingLogError(message)
          embeddingIndexLog("page-read-fail", { pageId: page.id, error: message.slice(0, 200) })
          done += 1
          setEmbeddingLogProgress(done, pages.length)
          onProgress?.(done, pages.length)
          continue
        }
        if (chunks.length === 0) {
          hashes[page.id] = page.hash
          done += 1
          onProgress?.(done, pages.length)
          continue
        }
        const batchCount = Math.ceil(chunks.length / EMBED_BATCH_SIZE)
        pageStates.set(page.id, { hash: page.hash, left: batchCount, failed: false })
        for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
          const slice = chunks.slice(i, i + EMBED_BATCH_SIZE)
          await queue.push({
            pageId: page.id,
            chunks: slice,
            texts: slice.map((chunk) => enrichChunkForEmbedding(page.title, chunk)),
          })
          if (queue.closed) return
        }
      }
    } finally {
      queue.close()
    }
  })()

  const workers = Array.from({ length: EMBED_BATCH_CONCURRENCY }, async () => {
    while (!writeError) {
      const job = await queue.pop()
      if (!job) return
      const state = pageStates.get(job.pageId)
      try {
        const vectors = await fetchEmbeddings(job.texts, cfg)
        const rows: RebuildChunkInput[] = []
        job.chunks.forEach((chunk, index) => {
          const vec = vectors[index]
          if (!vec) {
            if (state) state.failed = true
            return
          }
          rows.push({
            pageId: job.pageId,
            chunkIndex: chunk.index,
            chunkText: chunk.text,
            headingPath: chunk.headingPath,
            embedding: vec,
          })
        })
        enqueueRows(rows)
      } catch (error) {
        if (state) state.failed = true
        const message = error instanceof Error ? error.message : String(error)
        noteEmbeddingLogError(message)
        embeddingIndexLog("page-fail", { pageId: job.pageId, error: message.slice(0, 200) })
      }
      notePageFinished(job.pageId)
    }
  })

  try {
    await Promise.all([producer, ...workers])
    await writeChain
    if (writeError) throw writeError
    if (buffer.length > 0) {
      const batch = buffer.splice(0, buffer.length)
      embeddingIndexLog("flush", { rows: batch.length, bytes: bufferBytes })
      bufferBytes = 0
      setEmbeddingLogBuffer(0, 0)
      await vectorRebuildAppend(projectPath, batch)
    }
    embeddingIndexLog("commit")
    await vectorRebuildCommit(projectPath)
    return hashes
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    noteEmbeddingLogError(message)
    embeddingIndexLog("lance-abort", { error: message.slice(0, 200) })
    try {
      await vectorRebuildAbort(projectPath)
    } catch {
      // the original failure is the one to surface
    }
    throw error
  }
}

/**
 * Reindex wiki content pages. Unchanged pages (same model, dimensions,
 * chunk settings, and content hash) are skipped. A handful of edits
 * replace those pages in place. A first index, a config change, or a
 * large set of dirty pages is written into a staging table and swapped
 * in, so memory does not grow with the number of pages already stored.
 *
 * Skips structural pages (index / log / overview / purpose / schema).
 */
export async function embedAllPages(
  projectPath: string,
  cfg: EmbeddingConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  if (!cfg.enabled || !cfg.model) return 0

  const pp = normalizePath(projectPath)
  const startedAt = Date.now()
  startEmbeddingIndexLog(pp, {
    model: cfg.model,
    host: endpointHost(cfg.endpoint),
    batchSize: EMBED_BATCH_SIZE,
    concurrency: EMBED_BATCH_CONCURRENCY,
    dims: cfg.outputDimensionality ?? null,
  })
  const progress = (done: number, total: number) => {
    setEmbeddingLogProgress(done, total)
    onProgress?.(done, total)
  }
  try {
    let pages: WikiPageRef[]
    try {
      pages = await listWikiPages(pp)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      noteEmbeddingLogError(message)
      embeddingIndexLog("list-fail", { error: message.slice(0, 200) })
      return 0
    }
    if (pages.length === 0) {
      embeddingIndexLog("empty")
      progress(0, 0)
      return 0
    }

    const configHash = embeddingConfigFingerprint(cfg)
    const manifest = await readEmbeddingManifest(pp)
    const pageHashes: Record<string, string> = {}
    for (const page of pages) pageHashes[page.id] = page.hash
    const plan = planEmbeddingReindex(pageHashes, manifest, configHash)
    setEmbeddingLogPhase(plan.mode)
    setEmbeddingLogProgress(0, pages.length)
    embeddingIndexLog("plan", {
      mode: plan.mode,
      pages: pages.length,
      dirty: plan.dirtyIds.length,
      removed: plan.removedIds.length,
    })

    const nextPages = plan.mode === "rebuild"
      ? await embedPagesRebuild(pp, pages, cfg, progress)
      : await embedPagesIncremental(
        pp,
        pages,
        new Set(plan.dirtyIds),
        plan.removedIds,
        cfg,
        progress,
      )

    try {
      await writeEmbeddingManifest(pp, { configHash, pages: nextPages })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Embedding] Failed to write index manifest: ${message}`)
      noteEmbeddingLogError(message)
      embeddingIndexLog("manifest-fail", { error: message.slice(0, 200) })
    }
    embeddingIndexLog("done", {
      pages: pages.length,
      indexedPages: Object.keys(nextPages).length,
      elapsedMs: Date.now() - startedAt,
    })
    return pages.length
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    noteEmbeddingLogError(message)
    embeddingIndexLog("abort", { error: message.slice(0, 200) })
    throw error
  } finally {
    stopEmbeddingIndexLog()
  }
}

/**
 * Vector search over the v2 chunk store, shaped to stay API-compatible
 * with the pre-0.3.11 per-page interface. Under the hood:
 *   1. Embed the query.
 *   2. Over-fetch top-K × 3 chunks.
 *   3. Group by page_id; score each page as max(chunk_scores) plus
 *      0.3 × sum of the other chunks' scores (bounded — capped at
 *      1.0 - max_score), so a page with two good chunks outranks a
 *      page with one equally-good chunk and a weaker one.
 *   4. Sort pages by score, return top-K.
 *
 * The optional `matchedChunks` field gives callers the raw chunk
 * context when they want to surface "matched in this section" in
 * the UI. Existing callers can ignore it.
 */
export interface PageSearchResult {
  id: string
  score: number
  matchedChunks?: Array<{ text: string; headingPath: string; score: number }>
}

export async function searchByEmbedding(
  projectPath: string,
  query: string,
  cfg: EmbeddingConfig,
  topK: number = 10,
): Promise<PageSearchResult[]> {
  if (!cfg.enabled || !cfg.model) return []

  const queryEmb = await fetchEmbedding(query, cfg)
  if (!queryEmb) return []

  const t0 = performance.now()
  let rawChunks: ChunkSearchResult[] = []
  try {
    rawChunks = await vectorSearchChunks(projectPath, queryEmb, Math.max(topK * 3, 30))
  } catch (err) {
    console.log(`[Embedding] LanceDB chunk search failed: ${err instanceof Error ? err.message : err}`)
    return []
  }
  if (rawChunks.length === 0) return []

  // Group by page; keep every matched chunk's score so we can compute
  // a blended per-page score.
  const byPage = new Map<string, ChunkSearchResult[]>()
  for (const c of rawChunks) {
    const bucket = byPage.get(c.page_id)
    if (bucket) bucket.push(c)
    else byPage.set(c.page_id, [c])
  }

  const ranked: PageSearchResult[] = []
  for (const [pageId, chunks] of byPage.entries()) {
    chunks.sort((a, b) => b.score - a.score)
    const top = chunks[0].score
    const tail = chunks.slice(1).reduce((sum, c) => sum + c.score, 0)
    // Cap the tail contribution so many-weak-chunks can't drown a
    // single-strong-chunk page. 0.3 weight is empirical; adjust later
    // with real data.
    const blended = top + Math.min(tail * 0.3, Math.max(0, 1 - top))
    ranked.push({
      id: pageId,
      score: blended,
      matchedChunks: chunks.slice(0, 3).map((c) => ({
        text: c.chunk_text,
        headingPath: c.heading_path,
        score: c.score,
      })),
    })
  }
  ranked.sort((a, b) => b.score - a.score)

  const elapsed = Math.round(performance.now() - t0)
  console.log(
    `[Embedding] LanceDB chunk search: ${rawChunks.length} chunks → ${ranked.length} pages in ${elapsed}ms`,
  )

  return ranked.slice(0, topK)
}

/**
 * Remove a page's embeddings from the v2 index. Called from the
 * source-delete flow so orphaned chunks don't pollute future searches.
 */
export async function removePageEmbedding(
  projectPath: string,
  pageId: string,
): Promise<void> {
  try {
    await vectorDeletePage(projectPath, pageId)
  } catch {
    // non-critical
  }
}

/**
 * Total chunks in the v2 index. Surfaces "N chunks indexed" status
 * in Settings.
 */
export async function getEmbeddingCount(projectPath: string): Promise<number> {
  try {
    return await vectorCountChunks(projectPath)
  } catch {
    return 0
  }
}
