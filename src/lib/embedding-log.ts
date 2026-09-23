import { invoke } from "@tauri-apps/api/core"
import { normalizePath } from "@/lib/path-utils"

export const EMBEDDING_INDEX_LOG_REL = ".qmai/embedding-index.log"
const MAX_LOG_LINES = 2000
const HEARTBEAT_MS = 5000

export function embeddingIndexLogPath(projectPath: string): string {
  return `${normalizePath(projectPath)}/${EMBEDDING_INDEX_LOG_REL}`
}

/** Hostname only. Query strings can carry API keys. */
export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch {
    return ""
  }
}

export function formatEmbeddingLogLine(entry: Record<string, unknown>): string {
  return `${JSON.stringify(entry)}\n`
}

export function trimLogLines(lines: string[], max = MAX_LOG_LINES): string[] {
  if (lines.length <= max) return lines
  return lines.slice(lines.length - max)
}

interface EmbeddingLogSnapshot {
  phase: string
  done: number
  total: number
  bufferRows: number
  bufferBytes: number
  lastError: string | null
}

let active = false
let projectPath = ""
let lines: string[] = []
let writeChain: Promise<void> = Promise.resolve()
let timer: ReturnType<typeof setInterval> | null = null
let httpSeq = 0
const inflight = new Map<number, number>()
let snapshot: EmbeddingLogSnapshot = {
  phase: "idle",
  done: 0,
  total: 0,
  bufferRows: 0,
  bufferBytes: 0,
  lastError: null,
}

function oldestMs(now = Date.now()): number {
  let oldest = 0
  for (const started of inflight.values()) {
    const age = now - started
    if (age > oldest) oldest = age
  }
  return oldest
}

function enqueueWrite() {
  const path = embeddingIndexLogPath(projectPath)
  const contents = lines.join("")
  writeChain = writeChain.then(async () => {
    try {
      await invoke("write_file_atomic", { path, contents })
    } catch (error) {
      console.warn("[Embedding] failed to write index log", error)
    }
  })
}

export function embeddingHttpBegan(): number {
  const id = ++httpSeq
  inflight.set(id, Date.now())
  return id
}

export function embeddingHttpEnded(id: number) {
  inflight.delete(id)
}

export function setEmbeddingLogProgress(done: number, total: number) {
  snapshot.done = done
  snapshot.total = total
}

export function setEmbeddingLogBuffer(rows: number, bytes: number) {
  snapshot.bufferRows = rows
  snapshot.bufferBytes = bytes
}

export function setEmbeddingLogPhase(phase: string) {
  snapshot.phase = phase
}

export function noteEmbeddingLogError(message: string) {
  snapshot.lastError = message.slice(0, 200)
}

export function embeddingIndexLog(event: string, fields: Record<string, unknown> = {}) {
  if (!active) return
  const line = formatEmbeddingLogLine({
    at: new Date().toISOString(),
    event,
    phase: snapshot.phase,
    done: snapshot.done,
    total: snapshot.total,
    inFlight: inflight.size,
    oldestMs: oldestMs(),
    bufferRows: snapshot.bufferRows,
    bufferBytes: snapshot.bufferBytes,
    ...fields,
  })
  lines = trimLogLines([...lines, line])
  enqueueWrite()
}

export function startEmbeddingIndexLog(path: string, fields: Record<string, unknown>) {
  stopEmbeddingIndexLog()
  active = true
  projectPath = path
  lines = []
  inflight.clear()
  snapshot = {
    phase: "listing",
    done: 0,
    total: 0,
    bufferRows: 0,
    bufferBytes: 0,
    lastError: null,
  }
  embeddingIndexLog("start", fields)
  timer = setInterval(() => {
    embeddingIndexLog("beat", { lastError: snapshot.lastError })
  }, HEARTBEAT_MS)
}

export function stopEmbeddingIndexLog() {
  if (timer) clearInterval(timer)
  timer = null
  active = false
  inflight.clear()
}
