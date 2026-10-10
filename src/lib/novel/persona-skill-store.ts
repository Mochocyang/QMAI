import { createDirectory, listDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import {
  PERSONA_SKILL_DOCUMENT_FILE,
  PERSONA_SKILL_INDEX_FILE,
  PERSONA_SKILL_RESEARCH_DIR,
  PERSONA_SKILL_SIGHTINGS_FILE,
  PERSONA_SKILLS_DIR,
  type PersonaSkillIndex,
  type PersonaSkillMeta,
  type PersonaSkillSighting,
  type PersonaSkillSightings,
} from "./persona-skill-types"

const UNSAFE_ID_CHARS = /[\\/:*?"<>|\s]/g

/** 同步短哈希（FNV-1a）：只在名字含路径非法字符时用来消歧，不承担安全职责。 */
function shortHash(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

/** 人物名 → 目录名。合法名原样用（便于人肉打开文件夹排查）。 */
export function personaSkillIdFor(characterName: string): string {
  const trimmed = characterName.trim()
  const safe = trimmed.replace(UNSAFE_ID_CHARS, "")
  if (safe.length > 0 && safe === trimmed) return safe
  return `${safe || "persona"}-${shortHash(trimmed)}`
}

export function personaSkillRoot(projectPath: string): string {
  return `${normalizePath(projectPath)}/${PERSONA_SKILLS_DIR}`
}

export function personaSkillIndexPath(projectPath: string): string {
  return `${personaSkillRoot(projectPath)}/${PERSONA_SKILL_INDEX_FILE}`
}

export function personaSkillSightingsPath(projectPath: string): string {
  return `${personaSkillRoot(projectPath)}/${PERSONA_SKILL_SIGHTINGS_FILE}`
}

export function personaSkillDirectory(projectPath: string, id: string): string {
  return `${personaSkillRoot(projectPath)}/${id}`
}

export function personaSkillDocumentPath(projectPath: string, id: string): string {
  return `${personaSkillDirectory(projectPath, id)}/${PERSONA_SKILL_DOCUMENT_FILE}`
}

export function personaSkillResearchDirectory(projectPath: string, id: string): string {
  return `${personaSkillDirectory(projectPath, id)}/${PERSONA_SKILL_RESEARCH_DIR}`
}

/** 读 JSON；文件不存在 / 坏 JSON 一律返回 null，由调用方降级成空。 */
async function readJsonOrNull(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path))
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function sanitizeMeta(raw: unknown): PersonaSkillMeta | null {
  const record = asRecord(raw)
  if (!record) return null
  const characterName = typeof record.characterName === "string" ? record.characterName.trim() : ""
  if (!characterName) return null
  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : personaSkillIdFor(characterName),
    characterName,
    aliases: asStringArray(record.aliases),
    roleType: typeof record.roleType === "string" ? record.roleType.trim() : "",
    tier: record.tier === "minor" ? "minor" : "major",
    pinned: record.pinned === true,
    status: record.status === "dormant" || record.status === "archived" ? record.status : "active",
    firstChapter: asNumber(record.firstChapter),
    lastChapter: asNumber(record.lastChapter),
    appearanceCount: asNumber(record.appearanceCount),
    createdChapter: asNumber(record.createdChapter),
    lastLearnedChapter: asNumber(record.lastLearnedChapter),
    skillRevision: asNumber(record.skillRevision),
    editedByUser: record.editedByUser === true,
    hasResearch: record.hasResearch === true,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
  }
}

function sanitizeSighting(raw: unknown): PersonaSkillSighting | null {
  const record = asRecord(raw)
  if (!record) return null
  const characterName = typeof record.characterName === "string" ? record.characterName.trim() : ""
  if (!characterName) return null
  return {
    characterName,
    aliases: asStringArray(record.aliases),
    roleType: typeof record.roleType === "string" ? record.roleType.trim() : "",
    appearanceCount: asNumber(record.appearanceCount, 1),
    firstChapter: asNumber(record.firstChapter),
    lastChapter: asNumber(record.lastChapter),
    chapters: Array.isArray(record.chapters)
      ? record.chapters.filter((item): item is number => typeof item === "number")
      : [],
  }
}

export async function loadPersonaSkillIndex(projectPath: string): Promise<PersonaSkillIndex> {
  const raw = asRecord(await readJsonOrNull(personaSkillIndexPath(projectPath)))
  if (!raw || !Array.isArray(raw.skills)) return { version: 1, skills: [] }
  return {
    version: 1,
    skills: raw.skills
      .map(sanitizeMeta)
      .filter((meta): meta is PersonaSkillMeta => meta != null),
  }
}

export async function savePersonaSkillIndex(projectPath: string, index: PersonaSkillIndex): Promise<void> {
  await createDirectory(personaSkillRoot(projectPath))
  await writeFileAtomic(
    personaSkillIndexPath(projectPath),
    JSON.stringify({ version: 1, skills: index.skills }, null, 2),
  )
}

export async function loadPersonaSightings(projectPath: string): Promise<PersonaSkillSightings> {
  const raw = asRecord(await readJsonOrNull(personaSkillSightingsPath(projectPath)))
  if (!raw || !Array.isArray(raw.sightings)) return { version: 1, sightings: [] }
  return {
    version: 1,
    sightings: raw.sightings
      .map(sanitizeSighting)
      .filter((item): item is PersonaSkillSighting => item != null),
  }
}

export async function savePersonaSightings(
  projectPath: string,
  sightings: PersonaSkillSightings,
): Promise<void> {
  await createDirectory(personaSkillRoot(projectPath))
  await writeFileAtomic(
    personaSkillSightingsPath(projectPath),
    JSON.stringify({ version: 1, sightings: sightings.sightings }, null, 2),
  )
}

export async function readPersonaSkillDocument(projectPath: string, id: string): Promise<string> {
  try {
    return await readFile(personaSkillDocumentPath(projectPath, id))
  } catch {
    return ""
  }
}

export async function writePersonaSkillDocument(
  projectPath: string,
  id: string,
  content: string,
): Promise<void> {
  await createDirectory(personaSkillDirectory(projectPath, id))
  await writeFileAtomic(personaSkillDocumentPath(projectPath, id), content)
}

/** 读某人的研究文件：文件名（去 .md）→ 正文。目录不存在就返回空对象。 */
export async function readPersonaSkillResearch(
  projectPath: string,
  id: string,
): Promise<Record<string, string>> {
  let nodes
  try {
    nodes = await listDirectory(personaSkillResearchDirectory(projectPath, id), {
      includeHidden: false,
      maxDepth: 1,
    })
  } catch {
    return {}
  }
  const docs: Record<string, string> = {}
  for (const node of nodes) {
    if (node.is_dir || !node.name.endsWith(".md")) continue
    try {
      docs[node.name.replace(/\.md$/, "")] = await readFile(node.path)
    } catch {
      // 单个研究文件读不了不影响其余
    }
  }
  return docs
}

/** 写研究文件；空白内容跳过。返回真正落盘的路径。 */
export async function writePersonaSkillResearch(
  projectPath: string,
  id: string,
  docs: Record<string, string>,
): Promise<string[]> {
  const names = Object.keys(docs).filter((name) => docs[name]?.trim())
  if (names.length === 0) return []
  const dir = personaSkillResearchDirectory(projectPath, id)
  await createDirectory(dir)
  const paths: string[] = []
  for (const name of names) {
    const path = `${dir}/${name}.md`
    await writeFileAtomic(path, docs[name].trim())
    paths.push(path)
  }
  return paths
}

/**
 * 按 key 串行的互斥锁。同一章的两次并发摄取、或「学习」与「用户在 UI 上点绿勾」
 * 同时改 index.json 时，靠它保证读-改-写不互相覆盖。
 */
const locks = new Map<string, Promise<unknown>>()

export function withPersonaSkillLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  const next = previous.then(task, task)
  locks.set(key, next.catch(() => undefined))
  return next
}

export function __resetPersonaSkillLocksForTesting(): void {
  locks.clear()
}

/** 读-改-写索引。mutate 返回 undefined 表示「没变化」，此时不落盘。 */
export async function updatePersonaSkillIndex(
  projectPath: string,
  mutate: (index: PersonaSkillIndex) => PersonaSkillIndex | void,
): Promise<PersonaSkillIndex> {
  return withPersonaSkillLock(`index:${normalizePath(projectPath)}`, async () => {
    const index = await loadPersonaSkillIndex(projectPath)
    const next = mutate(index)
    if (!next) return index
    await savePersonaSkillIndex(projectPath, next)
    return next
  })
}

/** 读-改-写候选池。mutate 返回 undefined 表示「没变化」，此时不落盘。 */
export async function updatePersonaSightings(
  projectPath: string,
  mutate: (sightings: PersonaSkillSightings) => PersonaSkillSightings | void,
): Promise<PersonaSkillSightings> {
  return withPersonaSkillLock(`sightings:${normalizePath(projectPath)}`, async () => {
    const sightings = await loadPersonaSightings(projectPath)
    const next = mutate(sightings)
    if (!next) return sightings
    await savePersonaSightings(projectPath, next)
    return next
  })
}
