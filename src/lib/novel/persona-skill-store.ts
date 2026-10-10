import { createDirectory, fileExists, listDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizeComparablePath, normalizePath } from "@/lib/path-utils"
import {
  PERSONA_SKILL_DOCUMENT_FILE,
  PERSONA_SKILL_INDEX_FILE,
  PERSONA_SKILL_RESEARCH_DIR,
  PERSONA_SKILL_SIGHTINGS_FILE,
  PERSONA_SKILLS_DIR,
  resolvePersonaTier,
  type PersonaSkillIndex,
  type PersonaSkillMeta,
  type PersonaSkillSighting,
  type PersonaSkillSightings,
} from "./persona-skill-types"

const UNSAFE_ID_CHARS = /[\\/:*?"<>|\s]/g

/** 全点号的名字：`.` / `..` 是目录引用，绝不能原样当路径的一段。 */
const DOTS_ONLY = /^\.+$/

/** 同步短哈希（FNV-1a）：只在名字含路径非法字符时用来消歧，不承担安全职责。 */
function shortHash(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

/**
 * 有没有路径非法字符。刻意用 replace 而不是 test：
 * UNSAFE_ID_CHARS 带 /g，test 会推进 lastIndex，跨次调用状态泄漏。
 */
function containsUnsafeIdChars(value: string): boolean {
  return value.replace(UNSAFE_ID_CHARS, "") !== value
}

/** 人物名 → 目录名。合法名原样用（便于人肉打开文件夹排查）。 */
export function personaSkillIdFor(characterName: string): string {
  const trimmed = characterName.trim()
  const safe = trimmed.replace(UNSAFE_ID_CHARS, "")
  // 全点号（`.` / `..`）即使「没有非法字符」也必须走哈希分支，否则会穿越一层目录。
  if (safe.length > 0 && safe === trimmed && !DOTS_ONLY.test(trimmed)) return safe
  return `${safe || "persona"}-${shortHash(trimmed)}`
}

/**
 * 磁盘上的 id 一律不信任。index.json 可能被外部改过，id 会直接进路径拼接，
 * 所以任何形状不对的值（含 `..`、路径分隔符、非法字符）都回落到按人名重算的 id。
 */
function safeId(raw: unknown, characterName: string): string {
  const fallback = personaSkillIdFor(characterName)
  if (typeof raw !== "string") return fallback
  const trimmed = raw.trim()
  if (!trimmed) return fallback
  if (DOTS_ONLY.test(trimmed)) return fallback
  if (containsUnsafeIdChars(trimmed)) return fallback
  return trimmed
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

/**
 * 读 JSON；文件不存在 / 坏 JSON / 读失败一律返回 null，由调用方降级成空。
 * 宽松版：**注入路径**（章节生成时读索引）用它，索引损坏也绝不能让写作失败。
 */
async function readJsonOrNull(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path))
  } catch {
    return null
  }
}

/**
 * 严格读的结果。必须把「文件不存在」和「读出来了但是什么」分开表达：
 * 混成一个 null，调用方就再也分不清「真的没有索引」与「索引坏了」。
 */
interface StrictJsonResult {
  missing: boolean
  value: unknown
}

/**
 * 读 JSON，供**写入前**使用：文件不存在 → `{ missing: true }`；
 * 存在但读不出来 / 不是合法 JSON → console.warn 后抛。
 * 关键在 fileExists：把「没有文件」和「文件坏了」混成一个 null，就会让下一次保存
 * 拿空索引覆盖掉整库元数据。
 */
async function readJsonStrict(path: string): Promise<StrictJsonResult> {
  if (!(await fileExists(path))) return { missing: true, value: null }
  let text: string
  try {
    text = await readFile(path)
  } catch (error) {
    console.warn(`人物 Skill 索引读不出来，已停止写入以避免覆盖：${path}`, error)
    throw new Error(`人物 Skill 索引读不出来，已停止写入以避免覆盖：${path}`)
  }
  try {
    return { missing: false, value: JSON.parse(text) }
  } catch (error) {
    console.warn(`人物 Skill 索引损坏（JSON 解析失败），已停止写入以避免覆盖：${path}`, error)
    throw new Error(`人物 Skill 索引损坏（JSON 解析失败），已停止写入以避免覆盖：${path}`)
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
  const roleType = typeof record.roleType === "string" ? record.roleType.trim() : ""
  const pinned = record.pinned === true
  return {
    id: safeId(record.id, characterName),
    characterName,
    aliases: asStringArray(record.aliases),
    roleType,
    // 档位按真源重算，不听磁盘上的值：拼错的 tier 会被静默「升级」成 major = 全字段注入。
    tier: resolvePersonaTier(roleType, pinned),
    pinned,
    status: record.status === "dormant" || record.status === "archived" ? record.status : "active",
    firstChapter: asNumber(record.firstChapter),
    lastChapter: asNumber(record.lastChapter),
    appearanceCount: asNumber(record.appearanceCount),
    createdChapter: asNumber(record.createdChapter),
    lastLearnedChapter: asNumber(record.lastLearnedChapter),
    skillRevision: asNumber(record.skillRevision),
    editedByUser: record.editedByUser === true,
    // 只认显式的 false：字段出现之前写下的老索引按「已有研究文件」处理，
    // 宁可漏生成一轮，也不能重写掉累积的研究内容（见 commit 44c1311）。
    hasResearch: record.hasResearch !== false,
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

/**
 * 写入前用的严格读。文件不存在返回 null；坏 JSON、读失败、条目会被静默丢弃、
 * 版本不认识 —— 一律 console.warn 后抛。抛是对的：宁可这一轮失败，
 * 也不能把「丢过字段 / 丢过条目」的结果写回磁盘，那等于永久删除。
 */
async function loadPersonaSkillIndexStrict(projectPath: string): Promise<PersonaSkillIndex | null> {
  const path = personaSkillIndexPath(projectPath)
  const read = await readJsonStrict(path)
  if (read.missing) return null
  const raw = asRecord(read.value)
  if (!raw || !Array.isArray(raw.skills)) {
    console.warn(`人物 Skill 索引结构不认识，已停止写入以避免覆盖：${path}`)
    throw new Error(`人物 Skill 索引结构不认识，已停止写入以避免覆盖：${path}`)
  }
  if (raw.version !== undefined && raw.version !== 1) {
    console.warn(`人物 Skill 索引版本不认识（version=${String(raw.version)}），已停止写入以避免覆盖：${path}`)
    throw new Error(
      `人物 Skill 索引版本不认识（version=${String(raw.version)}），已停止写入以避免覆盖：${path}`,
    )
  }
  const skills: PersonaSkillMeta[] = []
  for (const entry of raw.skills) {
    const meta = sanitizeMeta(entry)
    if (!meta) {
      console.warn(`人物 Skill 索引里有无法识别的条目，已停止写入以避免覆盖：${path}`)
      throw new Error(`人物 Skill 索引里有无法识别的条目，已停止写入以避免覆盖：${path}`)
    }
    skills.push(meta)
  }
  return { version: 1, skills }
}

/** 宽松读：永不抛，坏 JSON / 读失败都降级为空索引。注入路径专用。 */
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

/** 研究文件名必须是纯名字：不许有路径分隔符或其它非法字符，否则会写到目录之外。 */
function isSafeResearchDocumentName(name: string): boolean {
  if (!name) return false
  if (DOTS_ONLY.test(name)) return false
  return !containsUnsafeIdChars(name)
}

/** 写研究文件；空白内容跳过，文件名不安全的也跳过（跳过的不计入返回值）。 */
export async function writePersonaSkillResearch(
  projectPath: string,
  id: string,
  docs: Record<string, string>,
): Promise<string[]> {
  const names = Object.keys(docs)
    .filter((name) => docs[name]?.trim())
    .filter((name) => {
      if (isSafeResearchDocumentName(name)) return true
      // 跳过而不是改写：写侧的名字必须与读侧 listDirectory 拿到的真名一致，
      // 否则写出去的东西自己读不回来。
      console.warn(`人物 Skill 研究文件名不安全，已跳过：${name}`)
      return false
    })
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
  // 上一个任务无论成功还是失败都要放行下一个（入链的是 catch 过的版本，所以锁不会泄漏），
  // 但绝不能把上一个任务的结果当实参传进来 —— task 声明为零参。
  const next = previous.then(
    () => task(),
    () => task(),
  )
  locks.set(
    key,
    next.catch(() => undefined),
  )
  return next
}

export function __resetPersonaSkillLocksForTesting(): void {
  locks.clear()
}

/**
 * 锁键必须对「指向同一目录的不同写法」等价：`C:/p`、`C:/p/`、`c:/p` 是同一个项目，
 * 各拿一把锁就等于没有锁（并发读-改-写互相覆盖）。Windows 盘符大小写不敏感，一并折平。
 */
export function personaSkillLockKey(projectPath: string): string {
  const normalized = normalizeComparablePath(projectPath)
  return /^[a-zA-Z]:/.test(normalized) ? normalized.toLowerCase() : normalized
}

/** 读-改-写索引。mutate 返回 undefined 表示「没变化」，此时不落盘。 */
export async function updatePersonaSkillIndex(
  projectPath: string,
  mutate: (index: PersonaSkillIndex) => PersonaSkillIndex | void,
): Promise<PersonaSkillIndex> {
  return withPersonaSkillLock(personaSkillLockKey(projectPath), async () => {
    // 读用严格版：索引损坏时这一轮直接失败，而不是拿空索引把整库抹掉。
    const index = (await loadPersonaSkillIndexStrict(projectPath)) ?? { version: 1, skills: [] }
    const next = mutate(index)
    if (!next) return index
    await savePersonaSkillIndex(projectPath, next)
    return next
  })
}

/**
 * 读-改-写候选池。mutate 返回 undefined 表示「没变化」，此时不落盘。
 * 与索引共用同一把锁（见 updatePersonaSkillState 的说明）。
 */
export async function updatePersonaSightings(
  projectPath: string,
  mutate: (sightings: PersonaSkillSightings) => PersonaSkillSightings | void,
): Promise<PersonaSkillSightings> {
  return withPersonaSkillLock(personaSkillLockKey(projectPath), async () => {
    const sightings = await loadPersonaSightings(projectPath)
    const next = mutate(sightings)
    if (!next) return sightings
    await savePersonaSightings(projectPath, next)
    return next
  })
}

export interface PersonaSkillState {
  index: PersonaSkillIndex
  sightings: PersonaSkillSightings
}

/**
 * 在**同一把锁**内一次读两份文件、调 mutate、再只落盘它返回的那几部分。
 *
 * 索引与候选池之间有跨文件不变量（「一旦建档就把它从 sightings 移走」），
 * 两把独立的锁无法保证它 —— 两次并发学习会各自基于同一份计数判定达标。
 * 所以这里与 updatePersonaSkillIndex / updatePersonaSightings 共用同一把锁。
 *
 * mutate 返回 undefined 或空对象表示什么都不写；只返回 { sightings } 时就只写候选池
 * （每章都会变的只有它，没必要连带重写没变化的索引）。返回的是合并后的完整 state。
 * 索引那份的读用严格版：损坏就抛，不许把丢过字段的结果写回去。
 */
export async function updatePersonaSkillState(
  projectPath: string,
  mutate: (state: PersonaSkillState) => Partial<PersonaSkillState> | void,
): Promise<PersonaSkillState> {
  return withPersonaSkillLock(personaSkillLockKey(projectPath), async () => {
    const index = (await loadPersonaSkillIndexStrict(projectPath)) ?? { version: 1, skills: [] }
    const sightings = await loadPersonaSightings(projectPath)
    const patch = mutate({ index, sightings })
    if (!patch) return { index, sightings }
    if (patch.index) await savePersonaSkillIndex(projectPath, patch.index)
    if (patch.sightings) await savePersonaSightings(projectPath, patch.sightings)
    return {
      index: patch.index ?? index,
      sightings: patch.sightings ?? sightings,
    }
  })
}
