import {
  createDirectory,
  fileExists,
  readFile,
  writeFileAtomic,
} from "@/commands/fs"
import { joinPath, normalizePath } from "@/lib/path-utils"
import type {
  AnalysisEvidenceCollection,
  AnalysisEvidenceSnippet,
  AnalysisSkill,
} from "./analysis-pipeline-types"

export interface AnalysisEvidenceStoreIo {
  createDirectory(path: string): Promise<void>
  fileExists(path: string): Promise<boolean>
  readFile(path: string): Promise<string>
  writeFileAtomic(path: string, contents: string): Promise<void>
}

const defaultIo: AnalysisEvidenceStoreIo = {
  createDirectory,
  fileExists,
  readFile,
  writeFileAtomic,
}

function normalized(path: string): string {
  return normalizePath(path).replace(/\/+$/, "")
}

function evidencePath(bookPath: string): string {
  return normalized(joinPath(bookPath, "analysis", "evidence.json"))
}

function analysisDir(bookPath: string): string {
  return normalized(joinPath(bookPath, "analysis"))
}

function bookIdFromPath(bookPath: string): string {
  return normalized(bookPath).split("/").pop() || "unknown-book"
}

function emptyCollection(bookPath: string): AnalysisEvidenceCollection {
  return {
    version: 1,
    bookId: bookIdFromPath(bookPath),
    snippets: [],
    updatedAt: 0,
  }
}

function isEvidenceCollection(value: unknown): value is AnalysisEvidenceCollection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Partial<AnalysisEvidenceCollection>
  return candidate.version === 1
    && typeof candidate.bookId === "string"
    && Array.isArray(candidate.snippets)
}

function normalizedEvidenceText(text: string): string {
  return text.trim().replace(/\s+/g, " ")
}

function evidenceKey(item: AnalysisEvidenceSnippet): string {
  return [item.skill, item.chapterId, normalizedEvidenceText(item.text)].join("::")
}

async function saveEvidence(
  bookPath: string,
  collection: AnalysisEvidenceCollection,
  io: AnalysisEvidenceStoreIo,
): Promise<AnalysisEvidenceCollection> {
  await io.createDirectory(analysisDir(bookPath))
  await io.writeFileAtomic(evidencePath(bookPath), JSON.stringify(collection, null, 2))
  return collection
}

export async function loadEvidence(
  bookPath: string,
  io: AnalysisEvidenceStoreIo = defaultIo,
): Promise<AnalysisEvidenceCollection> {
  const path = evidencePath(bookPath)
  if (!(await io.fileExists(path))) return emptyCollection(bookPath)
  try {
    const parsed = JSON.parse(await io.readFile(path)) as unknown
    return isEvidenceCollection(parsed) ? parsed : emptyCollection(bookPath)
  } catch {
    return emptyCollection(bookPath)
  }
}

function mergeEvidenceItems(
  current: AnalysisEvidenceSnippet[],
  incoming: AnalysisEvidenceSnippet[],
): AnalysisEvidenceSnippet[] {
  const merged = [...current]
  const indexes = new Map(merged.map((item, index) => [evidenceKey(item), index]))
  for (const item of incoming) {
    const normalizedItem = { ...item, text: normalizedEvidenceText(item.text) }
    const key = evidenceKey(normalizedItem)
    const existingIndex = indexes.get(key)
    if (existingIndex === undefined) {
      indexes.set(key, merged.length)
      merged.push(normalizedItem)
      continue
    }
    const existing = merged[existingIndex]
    merged[existingIndex] = {
      ...normalizedItem,
      id: existing.id,
      createdAt: existing.createdAt,
      enabled: existing.enabled,
      userPinned: existing.userPinned || normalizedItem.userPinned,
    }
  }
  return merged
}

export async function mergeEvidence(
  bookPath: string,
  incoming: AnalysisEvidenceSnippet[],
  io: AnalysisEvidenceStoreIo = defaultIo,
): Promise<AnalysisEvidenceCollection> {
  const current = await loadEvidence(bookPath, io)
  const updatedAt = Date.now()
  return saveEvidence(bookPath, {
    ...current,
    snippets: mergeEvidenceItems(current.snippets, incoming),
    updatedAt,
  }, io)
}

export async function replaceAutomaticEvidence(
  bookPath: string,
  skill: AnalysisSkill,
  incoming: AnalysisEvidenceSnippet[],
  io: AnalysisEvidenceStoreIo = defaultIo,
): Promise<AnalysisEvidenceCollection> {
  const current = await loadEvidence(bookPath, io)
  const retained = current.snippets.filter((item) => item.skill !== skill || item.userPinned)
  return saveEvidence(bookPath, {
    ...current,
    snippets: mergeEvidenceItems(retained, incoming.filter((item) => item.skill === skill)),
    updatedAt: Date.now(),
  }, io)
}

async function updateEvidenceItem(
  bookPath: string,
  evidenceId: string,
  update: (item: AnalysisEvidenceSnippet) => AnalysisEvidenceSnippet | null,
  io: AnalysisEvidenceStoreIo,
): Promise<AnalysisEvidenceCollection> {
  const current = await loadEvidence(bookPath, io)
  let found = false
  const snippets: AnalysisEvidenceSnippet[] = []
  for (const item of current.snippets) {
    if (item.id !== evidenceId) {
      snippets.push(item)
      continue
    }
    found = true
    const next = update(item)
    if (next) snippets.push(next)
  }
  if (!found) throw new Error("未找到证据片段")
  return saveEvidence(bookPath, { ...current, snippets, updatedAt: Date.now() }, io)
}

export function setEvidenceEnabled(
  bookPath: string,
  evidenceId: string,
  enabled: boolean,
  io: AnalysisEvidenceStoreIo = defaultIo,
): Promise<AnalysisEvidenceCollection> {
  return updateEvidenceItem(bookPath, evidenceId, (item) => ({
    ...item,
    enabled,
    updatedAt: Date.now(),
  }), io)
}
