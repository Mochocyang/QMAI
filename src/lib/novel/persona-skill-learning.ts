import { listDirectory, readFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { findChapterFileByNumber } from "@/lib/novel/chapter-utils"
import { streamChat } from "@/lib/llm-client"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"
import { parseLlmJsonArray, parseLlmJsonObject } from "./book-analysis/llm-json"
import { appendChapterIngestLog, previewLlmOutput } from "./chapter-ingest-log"
import { parseCharacterRoleFileName } from "./extract-established-context"
import {
  PERSONA_DOCUMENT_FIELDS,
  PERSONA_FIELD_SHRINK_RATIO,
  PERSONA_MAJOR_FIELDS,
  PERSONA_MIN_SUBSTRING_MATCH_CHARS,
  PERSONA_PRIOR_EVIDENCE_CHAPTERS,
  PERSONA_PROFILE_FIELDS,
  PERSONA_RESEARCH_DOCUMENTS,
  PERSONA_SKILL_BATCH_SIZE,
  PERSONA_STORED_FIELDS,
  PERSONA_SUPPLEMENT_HEADING,
  PERSONA_SUPPLEMENT_MAX_CHARS,
  firstAppearanceThreshold,
  normalizePersonaName,
  planPersonaSkillRound,
  resolvePersonaStatus,
  resolvePersonaTier,
  type PersonaSkillIndex,
  type PersonaSkillMeta,
  type PersonaSkillPlan,
  type PersonaSkillSighting,
  type PersonaSkillSightings,
  type PersonaSkillTier,
} from "./persona-skill-types"
import {
  applyPersonaProfileEdits,
  readPersonaDocumentFields,
} from "./persona-skill-profile"
import {
  syncPersonaSkillChapterFacts,
  type PersonaChapterFactSource,
} from "./persona-skill-facts"
import {
  loadPersonaSkillIndex,
  loadPersonaSkillIndexStrict,
  loadPersonaSightings,
  personaSkillIdFor,
  personaSkillLockKey,
  savePersonaSkillIndex,
  savePersonaSightings,
  withPersonaSkillLock,
  readPersonaSkillDocument,
  snapshotPersonaSkillRevision,
  updatePersonaSkillIndex,
  updatePersonaSkillState,
  writePersonaSkillDocument,
  writePersonaSkillResearch,
} from "./persona-skill-store"
import {
  PERSONA_SKILL_REQUEST_OVERRIDES,
  buildPersonaSkillMessages,
  buildPersonaSkillResearchMessages,
  type PersonaSkillPromptTarget,
} from "./persona-skill-prompt"
import { PERSONA_PRIOR_EVIDENCE_CHARS, extractCharacterEvidence } from "./persona-skill-evidence"

export interface PersonaChapterInput {
  chapterNumber: number
  chapterBody: string
  characters: string[]
  /** 快照里的别名表：规范名 → 别名列表。 */
  characterAliases?: Record<string, string[]>
}

export interface LearnPersonaSkillsOptions {
  projectPath: string
  chapter: PersonaChapterInput
  llmConfig: LlmConfig
  signal?: AbortSignal
  /**
   * 本章快照：走「动态区块」投影（当前状态 / 出场组织 / 认知变化 / 关系变化）。
   *
   * 可选是为了兼容只造了 chapter 的旧调用（测试、外部调用）。传了就一定同步 ——
   * 且在 `finally` 里做，保证「本章没达标 / 没模型 / 模型报错」时**也会**更新，
   * 因为状态与关系不该依赖模型是否可用。
   */
  chapterSnapshot?: PersonaChapterFactSource
}

export interface PersonaSkillDraft {
  characterName: string
  fields: Record<string, string>
  research: Record<string, string>
  /** 手改档案的唯一「补充」段（模型合并后的完整内容）；没给时为空串。 */
  supplement: string
}

/** 本章出场人物的累计状态（含已有档案的人）。 */
export interface PersonaChapterAppearance {
  characterName: string
  aliases: string[]
  roleType: string
  appearanceCount: number
  firstChapter: number
  hasSkill: boolean
  hasResearch: boolean
  pinned: boolean
  lastLearnedChapter: number
  /** 已确认是本作真实人物（`wiki/entities/` 里有 `tags` 含 `character` 的实体页）。 */
  knownCharacter: boolean
}

export function uniqueNames(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    const key = normalizePersonaName(trimmed)
    if (!trimmed || !key || seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

/**
 * 一次目录列举，从 wiki/characters/角色-<定位>-<名>.md 的文件名读定位。
 * 只解析文件名、不读正文，所以零额外 LLM 成本（D2）。
 */
export async function loadCharacterRoleTypes(projectPath: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  let nodes
  try {
    nodes = await listDirectory(`${normalizePath(projectPath)}/wiki/characters`)
  } catch {
    return result
  }
  for (const node of nodes) {
    if (node.is_dir) continue
    const parsed = parseCharacterRoleFileName(node.name)
    if (!parsed) continue
    // 键必须归一化：文件名里的名字已被 buildCharacterFileName 净化过
    // （sanitizeOutlineFileNamePart 去空白、把 \ / : * ? " < > | 换成 -），
    // 而快照里的 characters 是 LLM 抽出的原始规范名。不归一化的话，
    // 一个叫「Lin Chen」的主角会因为文件里存成「LinChen」而查不到定位 → 静默降成次要档。
    result[normalizePersonaName(parsed.name)] = parsed.role
  }
  return result
}

/**
 * 查角色定位。必须走归一化键——`loadCharacterRoleTypes` 的键与快照里的
 * characters 是两种写法（见那边的注释），直接下标取值会静默取不到。
 */
export function lookupRoleType(roleTypes: Record<string, string>, name: string): string {
  return roleTypes[normalizePersonaName(name)] ?? ""
}

/** 实体页 frontmatter 里的标签：支持 `tags: [a, b]`、`tags: a, b` 与 `tags:` 换行块列表。 */
function frontmatterTags(content: string): string[] {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return []
  const lines = match[1].split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!/^tags\s*:/.test(line.trim())) continue
    const inline = line.slice(line.indexOf(":") + 1).trim()
    if (inline) {
      const body = inline.replace(/^\[/, "").replace(/\]$/, "")
      return body
        .split(",")
        .map((tag) => tag.trim().replace(/^["']|["']$/g, "").toLowerCase())
        .filter(Boolean)
    }
    // 块列表：紧跟着的 `- 名称` 行都算标签，遇到别的键就停
    const collected: string[] = []
    for (let next = index + 1; next < lines.length; next += 1) {
      const item = lines[next].match(/^\s*-\s+(.*)$/)
      if (!item) break
      collected.push(item[1].trim().replace(/^["']|["']$/g, "").toLowerCase())
    }
    return collected
  }
  return []
}

/**
 * 判断实体页是不是人物页：`type: entity` + `tags` 含 `character`。
 * 与仓库既有判据保持一致（`character-aura.ts` 的 `isCharacterEntityContent`
 * 用的是同一条，角色灵魂就靠它枚举可绑定人物）。
 */
function isCharacterEntityPage(content: string): boolean {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return false
  if (!/^type\s*:\s*entity\s*$/m.test(match[1])) return false
  return frontmatterTags(content).includes("character")
}

/**
 * 从 `wiki/entities/` 认出「已确认是本作真实人物」的那一批。
 *
 * 只对**本章出场的名字**做探测：先列一次目录拿「归一化名 → 路径」，
 * 再逐个读命中的实体页。不是遍历全部实体页 —— 一个两百万字的项目里
 * `wiki/entities` 可以有几百上千个文件，每章都全读一遍太贵。
 */
export async function resolveKnownCharacters(
  projectPath: string,
  names: readonly string[],
): Promise<Set<string>> {
  const known = new Set<string>()
  const wanted = new Map<string, string>()
  for (const name of names) {
    const key = normalizePersonaName(name)
    if (key) wanted.set(key, name)
  }
  if (wanted.size === 0) return known

  const candidates = new Map<string, string>()
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 3) return
    let nodes
    try {
      nodes = await listDirectory(dir)
    } catch {
      return
    }
    for (const node of nodes) {
      if (node.is_dir) {
        await walk(node.path, depth + 1)
        continue
      }
      if (!node.name.toLowerCase().endsWith(".md")) continue
      const key = normalizePersonaName(node.name.replace(/\.md$/i, ""))
      // 同归一化名有多张页时保留先出现的，避免目录顺序影响结论
      if (key && !candidates.has(key)) candidates.set(key, node.path)
    }
  }
  await walk(`${normalizePath(projectPath)}/wiki/entities`, 0)

  for (const [key] of wanted) {
    const path = candidates.get(key)
    if (!path) continue
    try {
      if (isCharacterEntityPage(await readFile(path))) known.add(key)
    } catch {
      // 单张读不出来就当没认出来，不影响其余人物
    }
  }
  return known
}

export function findPersonaSkillMeta(
  index: PersonaSkillIndex,
  characterName: string,
  aliases: readonly string[] = [],
): PersonaSkillMeta | undefined {
  const wanted = new Set([characterName, ...aliases].map(normalizePersonaName).filter(Boolean))
  return index.skills.find((meta) => {
    const names = [meta.characterName, ...meta.aliases].map(normalizePersonaName)
    return names.some((name) => wanted.has(name))
  })
}

function findSighting(
  sightings: PersonaSkillSightings,
  characterName: string,
  aliases: readonly string[],
): PersonaSkillSighting | undefined {
  const wanted = new Set([characterName, ...aliases].map(normalizePersonaName).filter(Boolean))
  return sightings.sightings.find((item) =>
    [item.characterName, ...item.aliases].some((candidate) => wanted.has(normalizePersonaName(candidate))),
  )
}

/**
 * 把本章出场并进候选池，并汇总出每个人物的累计状态。
 * 已建档的人走 index（不在候选池里），未建档的人走候选池。
 */
export function collectChapterAppearances(
  index: PersonaSkillIndex,
  sightings: PersonaSkillSightings,
  chapter: PersonaChapterInput,
  roleTypes: Record<string, string>,
  knownCharacters: ReadonlySet<string> = new Set(),
): { appearances: PersonaChapterAppearance[]; sightings: PersonaSkillSightings } {
  const nextSightings: PersonaSkillSightings = {
    version: 1,
    sightings: sightings.sightings.map((item) => ({
      ...item,
      aliases: [...item.aliases],
      chapters: [...item.chapters],
    })),
  }
  const appearances = new Map<string, PersonaChapterAppearance>()
  const isKnown = (name: string) => knownCharacters.has(normalizePersonaName(name))

  const put = (appearance: PersonaChapterAppearance) => {
    const key = normalizePersonaName(appearance.characterName)
    const current = appearances.get(key)
    if (!current) {
      appearances.set(key, appearance)
      return
    }
    appearances.set(key, {
      ...current,
      aliases: uniqueNames([...current.aliases, ...appearance.aliases, appearance.characterName]),
      appearanceCount: Math.max(current.appearanceCount, appearance.appearanceCount),
      firstChapter: Math.min(current.firstChapter, appearance.firstChapter),
      roleType: current.roleType || appearance.roleType,
      hasSkill: current.hasSkill || appearance.hasSkill,
      hasResearch: current.hasResearch || appearance.hasResearch,
      pinned: current.pinned || appearance.pinned,
      lastLearnedChapter: Math.max(current.lastLearnedChapter, appearance.lastLearnedChapter),
      knownCharacter: current.knownCharacter || appearance.knownCharacter,
    })
  }

  for (const rawName of chapter.characters) {
    const name = rawName.trim()
    if (!name) continue
    const aliases = uniqueNames(chapter.characterAliases?.[name] ?? [])
    const meta = findPersonaSkillMeta(index, name, aliases)
    if (meta) {
      // 同一章重复摄取时 lastChapter 已经是本章，不重复加一
      const alreadyCounted = meta.lastChapter === chapter.chapterNumber
      put({
        characterName: meta.characterName,
        aliases: uniqueNames([...meta.aliases, ...aliases, name]),
        roleType: meta.roleType || lookupRoleType(roleTypes, name) || "",
        appearanceCount: meta.appearanceCount + (alreadyCounted ? 0 : 1),
        firstChapter: meta.firstChapter || chapter.chapterNumber,
        hasSkill: true,
        hasResearch: meta.hasResearch,
        pinned: meta.pinned,
        lastLearnedChapter: meta.lastLearnedChapter,
        knownCharacter: isKnown(meta.characterName),
      })
      continue
    }

    const sighting = findSighting(nextSightings, name, aliases)
    if (sighting) {
      if (!sighting.chapters.includes(chapter.chapterNumber)) {
        sighting.appearanceCount += 1
        sighting.chapters.push(chapter.chapterNumber)
      }
      sighting.firstChapter = sighting.firstChapter || chapter.chapterNumber
      sighting.lastChapter = Math.max(sighting.lastChapter, chapter.chapterNumber)
      sighting.aliases = uniqueNames([...sighting.aliases, ...aliases])
      sighting.roleType = sighting.roleType || lookupRoleType(roleTypes, name) || ""
      put({
        characterName: sighting.characterName,
        aliases: sighting.aliases,
        roleType: sighting.roleType,
        appearanceCount: sighting.appearanceCount,
        firstChapter: sighting.firstChapter,
        hasSkill: false,
        hasResearch: false,
        pinned: false,
        lastLearnedChapter: 0,
        knownCharacter: isKnown(sighting.characterName),
      })
      continue
    }

    const created: PersonaSkillSighting = {
      characterName: name,
      aliases,
      roleType: lookupRoleType(roleTypes, name),
      appearanceCount: 1,
      firstChapter: chapter.chapterNumber,
      lastChapter: chapter.chapterNumber,
      chapters: [chapter.chapterNumber],
    }
    nextSightings.sightings.push(created)
    put({
      characterName: name,
      aliases: created.aliases,
      roleType: created.roleType,
      appearanceCount: 1,
      firstChapter: created.firstChapter,
      hasSkill: false,
      hasResearch: false,
      pinned: false,
      lastLearnedChapter: 0,
      knownCharacter: isKnown(name),
    })
  }

  return { appearances: [...appearances.values()], sightings: nextSightings }
}

export function planPersonaSkillRoundForChapter(
  appearances: readonly PersonaChapterAppearance[],
  currentChapter: number,
): PersonaSkillPlan[] {
  return planPersonaSkillRound(
    appearances.map((item) => ({
      characterName: item.characterName,
      aliases: item.aliases,
      roleType: item.roleType,
      appearanceCount: item.appearanceCount,
      hasSkill: item.hasSkill,
      hasResearch: item.hasResearch,
      pinned: item.pinned,
      lastLearnedChapter: item.lastLearnedChapter,
      knownCharacter: item.knownCharacter,
    })),
    currentChapter,
  )
}

/**
 * 字段名容错表：模型常把 5 个规范字段名改写成近义词。
 *
 * 提示词里写着「字段名必须逐字一致」，但真实项目里模型不照抄：实测会出现
 * 「说话方式」「思维方式」「判断方式」这类改写。而 `renderPersonaSkillDocument`
 * 是**按规范名逐字取值**的 —— 差一个字，那一格就是空的；5 格全差，整份
 * SKILL.md 就退化成一页只有 frontmatter 的空档案（技能库里有卡片、点开什么都没有），
 * 而且**一个字的日志都不会打**。用户看到的正是「显示还是为空」。
 *
 * 认下来比不认好：字段内容本身就是模型写出来的真实观察，只因标题不同就丢掉不合算。
 */
const PERSONA_FIELD_ALIASES: Record<string, string> = {
  说话: "怎么说话",
  说话方式: "怎么说话",
  语言: "怎么说话",
  语言习惯: "怎么说话",
  语言风格: "怎么说话",
  口头禅: "怎么说话",
  台词: "怎么说话",
  想: "怎么想",
  想法: "怎么想",
  思维: "怎么想",
  思维方式: "怎么想",
  思考方式: "怎么想",
  心理: "怎么想",
  内心: "怎么想",
  判断: "怎么判断",
  判断方式: "怎么判断",
  决策: "怎么判断",
  决策方式: "怎么判断",
  行事逻辑: "怎么判断",
  不做: "什么不做",
  不会做: "什么不做",
  禁忌: "什么不做",
  底线: "什么不做",
  局限: "知道局限",
  盲区: "知道局限",
  弱点: "知道局限",
  认知边界: "知道局限",
}

/**
 * 档案字段的字段名容错。与演技字段同样的道理：差一个字，那一格就是空的，
 * 而空白档案在界面上看起来像「AI 什么都没学到」，实际只是标题没对上。
 *
 * ⚠️ 「动机」不再映射到「怎么想」（它是档案字段的规范名，规范名优先命中）；
 * 「补充说明」不收：文档里以「补充」开头的段属于手改档案的追加区，
 * 让它同时是「备注」的别名会让两套语义互相踩。
 */
const PERSONA_PROFILE_FIELD_ALIASES: Record<string, string> = {
  所属势力: "势力组织",
  势力: "势力组织",
  阵营: "势力组织",
  组织: "势力组织",
  门派: "势力组织",
  家族: "势力组织",
  隶属: "势力组织",
  外形: "外貌",
  外表: "外貌",
  容貌: "外貌",
  长相: "外貌",
  形象: "外貌",
  相貌: "外貌",
  性情: "性格",
  性格特点: "性格",
  性情特点: "性格",
  性子: "性格",
  出身: "背景",
  身世: "背景",
  来历: "背景",
  背景故事: "背景",
  目的: "动机",
  欲望: "动机",
  追求: "动机",
  目标: "动机",
  实力: "能力",
  技能: "能力",
  战力: "能力",
  能力与资源: "能力",
  关系: "关系网",
  人际关系: "关系网",
  关系网络: "关系网",
  人物关系: "关系网",
  成长: "成长轨迹",
  成长经历: "成长轨迹",
  经历: "成长轨迹",
  弧光: "成长轨迹",
  人物弧光: "成长轨迹",
  说明: "备注",
  其他: "备注",
}

/** 别名表没命中时的兜底：按关键词判归属。顺序即优先级（「不做」必须先于「想」）。 */
const PERSONA_FIELD_KEYWORDS: ReadonlyArray<readonly [string, string]> = [
  ["不做", "什么不做"],
  ["不会", "什么不做"],
  ["禁忌", "什么不做"],
  ["底线", "什么不做"],
  ["局限", "知道局限"],
  ["盲区", "知道局限"],
  ["弱点", "知道局限"],
  ["边界", "知道局限"],
  ["判断", "怎么判断"],
  ["决策", "怎么判断"],
  ["说话", "怎么说话"],
  ["语言", "怎么说话"],
  ["口头", "怎么说话"],
  ["语气", "怎么说话"],
  ["台词", "怎么说话"],
  ["思维", "怎么想"],
  ["思考", "怎么想"],
  ["心理", "怎么想"],
  ["内心", "怎么想"],
  ["想法", "怎么想"],
  ["动机", "怎么想"],
  ["想", "怎么想"],
]

/** 模型给的字段名 → 规范名之一；认不出来返回 null（宁可丢掉，也不硬塞错格）。 */
export function canonicalPersonaFieldName(raw: string): string | null {
  const key = raw.trim()
  if (!key) return null
  // 规范名优先，但**只认 AI 该写的两类**（档案 + 演技）。
  // 动态区块（当前状态/出场组织/认知变化/关系变化）由快照投影维护：
  // 让模型输出它们既不划算（快照里已有结构化数据），也会把投影写的事实覆盖成编造。
  if (
    (PERSONA_PROFILE_FIELDS as readonly string[]).includes(key) ||
    (PERSONA_MAJOR_FIELDS as readonly string[]).includes(key)
  ) {
    return key
  }
  const profileAlias = PERSONA_PROFILE_FIELD_ALIASES[key]
  if (profileAlias) return profileAlias
  const alias = PERSONA_FIELD_ALIASES[key]
  if (alias) return alias
  for (const [needle, target] of PERSONA_FIELD_KEYWORDS) {
    if (key.includes(needle)) return target
  }
  return null
}

/** 字段值容错：字符串直接用；数组拼成多行；其余丢弃。 */
function flattenPersonaFieldValue(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .join("\n")
  }
  return ""
}

/** 把模型给的任意键值对象归一化成「规范字段名 → 正文」。同名先到先得。 */
function canonicalPersonaFields(value: unknown): Record<string, string> {
  const result: Record<string, string> = {}
  if (!value || typeof value !== "object" || Array.isArray(value)) return result
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const field = canonicalPersonaFieldName(rawKey)
    if (!field || result[field]) continue
    const text = flattenPersonaFieldValue(rawValue)
    if (text) result[field] = text
  }
  return result
}

/**
 * 草稿的字段既可能挂在 `fields` 下，也可能被模型直接平铺在条目顶层（实测两者都有）。
 * 两层都读，`fields` 优先。
 */
function extractPersonaDraftFields(entry: Record<string, unknown>): Record<string, string> {
  const flat = canonicalPersonaFields(entry)
  const nested = canonicalPersonaFields(entry.fields)
  return Object.keys(nested).length > 0 ? { ...flat, ...nested } : flat
}

/** 6 份研究文件的键名容错：同样只按规范名写盘，差一个字就等于没写。 */
function canonicalPersonaResearch(value: unknown): Record<string, string> {
  const result: Record<string, string> = {}
  if (!value || typeof value !== "object" || Array.isArray(value)) return result
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = rawKey.trim()
    const target = (PERSONA_RESEARCH_DOCUMENTS as readonly string[]).includes(key)
      ? key
      : PERSONA_RESEARCH_DOCUMENTS.find((name) => key.includes(name))
    if (!target || result[target]) continue
    const text = flattenPersonaFieldValue(rawValue)
    if (text) result[target] = text
  }
  return result
}

const PERSONA_DRAFT_NAME_KEYS = ["name", "characterName", "character_name", "人物", "角色", "人物名"] as const

function readPersonaDraftName(entry: Record<string, unknown>): string {
  for (const key of PERSONA_DRAFT_NAME_KEYS) {
    const value = entry[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

/** 去掉「（男主）」「【反派】」这类装饰，只留名字本体。 */
function stripPersonaNameDecoration(raw: string): string {
  return raw
    .replace(/[（(【[][^）)】\]]*[）)】\]]/g, "")
    .replace(/[：:、,，。.\s]+$/g, "")
    .trim()
}

/**
 * 模型给的草稿名字 → 本轮计划。逐级放宽：规范名 → 去掉装饰 → 双向包含。
 * 单字名一律不参与包含匹配（「林」会命中半个名单）。
 */
function matchPersonaPlan(
  byName: ReadonlyMap<string, PersonaSkillPlan>,
  plans: readonly PersonaSkillPlan[],
  rawName: string,
): PersonaSkillPlan | undefined {
  const direct = byName.get(normalizePersonaName(rawName))
  if (direct) return direct

  const stripped = stripPersonaNameDecoration(rawName)
  if (stripped && stripped !== rawName) {
    const hit = byName.get(normalizePersonaName(stripped))
    if (hit) return hit
  }

  const key = normalizePersonaName(stripped || rawName)
  if (key.length < PERSONA_MIN_SUBSTRING_MATCH_CHARS) return undefined
  for (const plan of plans) {
    const planKey = normalizePersonaName(plan.characterName)
    if (planKey.length < PERSONA_MIN_SUBSTRING_MATCH_CHARS) continue
    if (key.includes(planKey) || planKey.includes(key)) return plan
  }
  return undefined
}

/** 草稿条目：优先 `{"skills":[…]}`；模型只给裸数组时也认。都拿不到返回 null（整轮跳过）。 */
function parsePersonaSkillDraftEntries(raw: string): unknown[] | null {
  const parsed = parseLlmJsonObject(raw)
  if (parsed && Array.isArray(parsed.skills)) return parsed.skills
  const array = parseLlmJsonArray(raw)
  if (array) return array
  return null
}

/** 解析模型返回的多人 JSON。根对象不可解析 / 没有 skills 数组时返回 null（整轮跳过）。 */
export function parsePersonaSkillDrafts(
  raw: string,
  plans: readonly PersonaSkillPlan[],
): PersonaSkillDraft[] | null {
  const entries = parsePersonaSkillDraftEntries(raw)
  if (!entries) return null
  const byName = new Map<string, PersonaSkillPlan>()
  for (const plan of plans) {
    byName.set(normalizePersonaName(plan.characterName), plan)
    for (const alias of plan.aliases) byName.set(normalizePersonaName(alias), plan)
  }
  const drafts: PersonaSkillDraft[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const plan = matchPersonaPlan(byName, plans, readPersonaDraftName(record))
    if (!plan) continue
    drafts.push({
      characterName: plan.characterName,
      fields: extractPersonaDraftFields(record),
      research: canonicalPersonaResearch(record.research),
      supplement: flattenPersonaFieldValue(record.supplement ?? record[PERSONA_SUPPLEMENT_HEADING]),
    })
  }
  return drafts
}

function stripFrontmatter(markdown: string): string {
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return match ? markdown.slice(match[0].length) : markdown
}

function stripDocumentPreamble(markdown: string): string {
  return stripFrontmatter(markdown).replace(/^\s*#\s+.*\r?\n/, "").trim()
}

function renderFieldSections(fields: Record<string, string>, order: readonly string[]): string {
  const blocks: string[] = []
  for (const name of order) {
    const value = (fields[name] ?? "").trim()
    if (!value) continue
    blocks.push(`## ${name}`, "", value, "")
  }
  return blocks.join("\n").trimEnd()
}

export interface RenderPersonaSkillDocumentInput {
  characterName: string
  aliases: readonly string[]
  roleType: string
  tier: PersonaSkillTier
  pinned: boolean
  appearanceCount: number
  firstChapter: number
  lastChapter: number
  chapterNumber: number
  fields: Record<string, string>
  existing?: string
  editedByUser: boolean
  /** 手改档案：模型合并好的「补充」段。 */
  supplement?: string
}

/**
 * 只取已知字段的正文（档案 + 演技）。
 *
 * ⚠️ 必须覆盖**全部**文档字段：这里读出来的东西是完善时合并的「基线」。
 * 只读 5 个演技字段的话，档案字段的旧值在合并时等于不存在 ——
 * 模型这一章没提到「外貌」，`## 外貌` 就在落盘时被整段删掉。
 */
export function readStoredPersonaFields(document: string): Record<string, string> {
  return readPersonaDocumentFields(document)
}

/**
 * 完善时逐字段合并：新值为空，或短于旧值的 {@link PERSONA_FIELD_SHRINK_RATIO}，
 * 都视为模型漏写，保留旧值。`kept` 列出被护栏保住的字段，供日志使用。
 *
 * 遍历**全部**文档字段（档案 + 演技）：护栏若只护 5 个演技字段，
 * 档案页里的「外貌 / 背景」会在每次完善时被本章的空白替换掉。
 */
export function mergePersonaFields(
  previous: Record<string, string>,
  next: Record<string, string>,
): { fields: Record<string, string>; kept: string[] } {
  const fields: Record<string, string> = {}
  const kept: string[] = []
  for (const name of PERSONA_DOCUMENT_FIELDS) {
    const before = (previous[name] ?? "").trim()
    const after = (next[name] ?? "").trim()
    if (!after) {
      if (before) fields[name] = before
      continue
    }
    if (before && after.length < before.length * PERSONA_FIELD_SHRINK_RATIO) {
      fields[name] = before
      kept.push(name)
      continue
    }
    fields[name] = after
  }
  return { fields, kept }
}

/** 把正文里所有「## 补充…」段摘出来：返回去掉补充后的正文，和补充段拼起来的内容。 */
function splitSupplementSections(body: string): { body: string; supplement: string } {
  const kept: string[] = []
  const supplements: string[] = []
  let inSupplement = false
  let current: string[] = []
  const flush = () => {
    const text = current.join("\n").trim()
    if (text) supplements.push(text)
    current = []
  }
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading || /^#\s/.test(line)) {
      if (inSupplement) flush()
      inSupplement = Boolean(heading && heading[1].trim().startsWith(PERSONA_SUPPLEMENT_HEADING))
      if (inSupplement) continue
    }
    if (inSupplement) current.push(line)
    else kept.push(line)
  }
  if (inSupplement) flush()
  return { body: kept.join("\n").trim(), supplement: supplements.join("\n") }
}

function renderFieldsAsLines(fields: Record<string, string>): string {
  return PERSONA_STORED_FIELDS.map((name) => {
    const value = (fields[name] ?? "").trim()
    return value ? `${name}：${value}` : ""
  })
    .filter(Boolean)
    .join("\n")
}

/**
 * 手改档案的补充段只有一个。优先用模型合并好的版本；模型没给、或明显比旧补充短
 * （漏写）时，退回「旧补充 + 本章新观察」拼接，超长时保留最新的部分。
 */
function resolveSupplement(
  previous: string,
  merged: string | undefined,
  fields: Record<string, string>,
  chapterNumber: number,
): string {
  const before = previous.trim()
  const candidate = (merged ?? "").trim()
  if (candidate && (!before || candidate.length >= before.length * PERSONA_FIELD_SHRINK_RATIO)) {
    return candidate
  }
  const fresh = renderFieldsAsLines(fields)
  const joined = [before, fresh ? `第 ${chapterNumber} 章：\n${fresh}` : ""].filter(Boolean).join("\n")
  const cap = PERSONA_SUPPLEMENT_MAX_CHARS * 2
  return joined.length <= cap ? joined : joined.slice(-cap)
}

export function renderPersonaSkillDocument(input: RenderPersonaSkillDocumentInput): string {
  // 档案字段也渲染进 SKILL.md：界面点开一个人，读的就是这份文档。
  // 注入另有其人（renderPersonaSkillBlock 只取 5 个演技字段），两者不冲突。
  const order = PERSONA_DOCUMENT_FIELDS
  const frontmatter = [
    "---",
    `character: ${input.characterName}`,
    `role: ${input.roleType || "未标注"}`,
    `tier: ${input.tier}`,
    `pinned: ${input.pinned ? "true" : "false"}`,
    `appearances: ${input.appearanceCount}`,
    `firstChapter: ${input.firstChapter}`,
    `lastChapter: ${input.lastChapter}`,
    ...(input.aliases.length > 0 ? [`aliases: ${input.aliases.join("、")}`] : []),
    "---",
  ].join("\n")
  const title = `# ${input.characterName} · 人物 Skill`
  const sections = renderFieldSections(input.fields, order)

  if (input.editedByUser && input.existing?.trim()) {
    const split = splitSupplementSections(stripDocumentPreamble(input.existing))
    const supplement = resolveSupplement(split.supplement, input.supplement, input.fields, input.chapterNumber)
    return [
      frontmatter,
      "",
      title,
      "",
      split.body,
      ...(supplement
        ? ["", `## ${PERSONA_SUPPLEMENT_HEADING}（截至第 ${input.chapterNumber} 章）`, "", supplement]
        : []),
      "",
    ].join("\n")
  }

  return [frontmatter, "", title, "", sections, ""].join("\n")
}

const inFlightRounds = new Set<string>()
/**
 * 同一项目的学习轮次串行执行。调用点是 `void learnPersonaSkillsFromChapter(...)`，
 * 批量提取时多章的轮次会同时起跑：两轮同时完善同一个人，都基于同一份旧档案，
 * 后写的会把先写的结果整份盖掉。
 */
const learningQueues = new Map<string, Promise<void>>()

export function __resetPersonaSkillRoundsForTesting(): void {
  inFlightRounds.clear()
  learningQueues.clear()
}

/** 按当前章号刷新所有人的生命周期状态。没有变化就不落盘。 */
export async function refreshPersonaSkillStatuses(
  projectPath: string,
  currentChapter: number,
): Promise<void> {
  const updatedAt = new Date().toISOString()
  await updatePersonaSkillIndex(projectPath, (index) => {
    let changed = false
    const skills = index.skills.map((meta) => {
      // 回填旧章时不能按旧章号重算：本章比这个人的最后一次出场还早，
      // 说明这是一次乱序补提取，与「他最近有没有出场」无关。
      // （若把 currentChapter 夹成 max(currentChapter, meta.lastChapter)，gap 恒为 0，
      //   会把已归档的人一律复活 —— 方向正好反了，别那么写。）
      if (currentChapter < meta.lastChapter) return meta
      const status = resolvePersonaStatus(meta.lastChapter, currentChapter, meta.pinned)
      if (status === meta.status) return meta
      changed = true
      return { ...meta, status, updatedAt }
    })
    if (!changed) return undefined
    return { version: 1, skills }
  })
}

export interface PersonaPriorEvidence {
  chapterNumber: number
  text: string
}

/**
 * 建档素材：该人物此前出场过的最近几章里与他相关的段落。
 * 首版档案若只凭当前一章，多半有几格是空的；候选池里本来就记着他在哪几章出过场。
 */
export async function loadPersonaPriorEvidence(
  projectPath: string,
  chapters: readonly number[],
  names: readonly string[],
  currentChapter: number,
  cache: Map<number, string> = new Map(),
): Promise<PersonaPriorEvidence[]> {
  const picked = [...new Set(chapters)]
    .filter((chapter) => chapter > 0 && chapter < currentChapter)
    .sort((a, b) => b - a)
    .slice(0, PERSONA_PRIOR_EVIDENCE_CHAPTERS)
    .sort((a, b) => a - b)
  const result: PersonaPriorEvidence[] = []
  for (const chapterNumber of picked) {
    let body = cache.get(chapterNumber)
    if (body === undefined) {
      body = ""
      try {
        const path = await findChapterFileByNumber(projectPath, chapterNumber)
        if (path) body = stripFrontmatter(await readFile(path))
      } catch {
        // 读不到就少一份素材，不影响本轮
      }
      cache.set(chapterNumber, body)
    }
    const text = extractCharacterEvidence(body, names, PERSONA_PRIOR_EVIDENCE_CHARS)
    if (text) result.push({ chapterNumber, text })
  }
  return result
}

async function requestPersonaSkillDrafts(input: {
  llmConfig: LlmConfig
  chapterNumber: number
  chapterBody: string
  plans: readonly PersonaSkillPlan[]
  existing: Map<string, string>
  editedByUser?: ReadonlySet<string>
  priorEvidence?: ReadonlyMap<string, PersonaPriorEvidence[]>
  signal?: AbortSignal
}): Promise<{ drafts: PersonaSkillDraft[] | null; raw: string }> {
  const targets: PersonaSkillPromptTarget[] = input.plans.map((plan) => ({
    characterName: plan.characterName,
    aliases: plan.aliases,
    roleType: plan.roleType,
    tier: plan.tier,
    mode: plan.mode,
    pinned: plan.pinned,
    withResearch: plan.withResearch,
    appearanceCount: plan.appearanceCount,
    existingSkill: input.existing.get(plan.characterName),
    editedByUser: input.editedByUser?.has(plan.characterName) ?? false,
    priorEvidence: input.priorEvidence?.get(plan.characterName),
  }))

  let result = ""
  let streamError: Error | null = null
  await streamChat(
    input.llmConfig,
    buildPersonaSkillMessages({
      chapterNumber: input.chapterNumber,
      chapterBody: input.chapterBody,
      targets,
    }),
    {
      onToken: (token: string) => {
        result += token
      },
      onDone: () => {},
      onError: (error: Error) => {
        streamError = error
      },
    },
    input.signal,
    PERSONA_SKILL_REQUEST_OVERRIDES,
  )
  if (streamError) throw streamError
  if (!result.trim()) throw new Error("人物 Skill 提取失败：模型返回空内容")
  // 原始输出一并交回调用方：解析失败时要靠它才能知道模型到底吐了什么。
  return { drafts: parsePersonaSkillDrafts(result, input.plans), raw: result }
}

/**
 * 本轮没建出档案时，必须留下可查的痕迹。
 *
 * 以前这条路径是**全静默**的：草稿解析成空数组不打日志、`applyPersonaSkillDrafts`
 * 返回 0 也不打日志。用户看到的就是「提取完了技能库还是空的」，而开发者手上什么都没有
 * —— 真实项目里就是这么查不下去的。现在原因、人数与**原始输出**一起写进
 * `.qmai/chapter-ingest.log`（与章节提取失败同一个文件，用户手上已经有它），
 * 同时推给界面弹一次 toast，不再让人只能猜。
 */
async function reportPersonaRoundFailure(input: {
  projectPath: string
  chapterNumber: number
  reason: string
  detail: string
  raw?: string
}): Promise<void> {
  const message = `人物 Skill 本轮未建档（${input.reason}）：${input.detail}`
  console.warn(`[Persona Skill] ${message}`)
  useWikiStore.getState().setPersonaSkillLearningError?.(message)
  await appendChapterIngestLog(input.projectPath, {
    event: "fail",
    chapterNumber: input.chapterNumber,
    failReason: `persona_${input.reason}`,
    error: message,
    outputChars: input.raw?.length,
    outputPreview: input.raw ? previewLlmOutput(input.raw, 600) : undefined,
  })
}

export interface ApplyPersonaSkillInput {
  projectPath: string
  appearances: readonly PersonaChapterAppearance[]
  plans: readonly PersonaSkillPlan[]
  drafts: readonly PersonaSkillDraft[]
  chapterNumber: number
}

/** 把草稿落到 SKILL.md / 研究文件 / index，并把已建档的人从候选池移走。返回本轮新增/更新的人物名。 */
export async function applyPersonaSkillDrafts(
  input: ApplyPersonaSkillInput,
): Promise<{ created: string[]; updated: string[] }> {
  // 全程在同一把锁内：从读新鲜索引到写回索引，中间不放任何别的写者进来。
  // 关键是「新鲜」二字 —— 用户可能在整轮 LLM 调用期间（数秒到数十秒）在
  // 「人物 Skill」页保存过手改正文。若拿外面那份快照判定 editedByUser，
  // 会走进 renderPersonaSkillDocument 的 false 分支，把用户正文整份覆盖掉。
  return withPersonaSkillLock(personaSkillLockKey(input.projectPath), async () => {
    const index = (await loadPersonaSkillIndexStrict(input.projectPath)) ?? { version: 1, skills: [] }
    const sightings = await loadPersonaSightings(input.projectPath)
    const appearanceByName = new Map(
      input.appearances.map((item) => [normalizePersonaName(item.characterName), item]),
    )
    const updatedAt = new Date().toISOString()
    const upserts: PersonaSkillMeta[] = []
    const created: string[] = []
    const updated: string[] = []

    for (const plan of input.plans) {
      const draft = input.drafts.find(
        (item) => normalizePersonaName(item.characterName) === normalizePersonaName(plan.characterName),
      )
      if (!draft) continue
      const hasFields = Object.values(draft.fields).some((value) => value.trim())
      if (!hasFields && !draft.supplement.trim()) continue

      const existing = findPersonaSkillMeta(index, plan.characterName, plan.aliases)
      const id = existing?.id ?? personaSkillIdFor(plan.characterName)
      const appearance = appearanceByName.get(normalizePersonaName(plan.characterName))
      const previousDocument = existing ? await readPersonaSkillDocument(input.projectPath, id) : ""
      const editedByUser = existing?.editedByUser ?? false
      // 手改档案只有补充、没有字段时也照常写：补充段本身就是这一轮的产出。
      if (!hasFields && !editedByUser) continue

      let fields = draft.fields
      if (!editedByUser && previousDocument.trim()) {
        const merged = mergePersonaFields(readStoredPersonaFields(previousDocument), draft.fields)
        fields = merged.fields
        if (merged.kept.length > 0) {
          console.info(
            `[Persona Skill] 第 ${input.chapterNumber} 章「${plan.characterName}」字段疑似漏写，保留旧值：${merged.kept.join("、")}`,
          )
        }
      }
      const lastChapter = Math.max(existing?.lastChapter ?? 0, input.chapterNumber)

      const nextDocument = renderPersonaSkillDocument({
        characterName: plan.characterName,
        aliases: existing ? uniqueNames([...existing.aliases, ...plan.aliases]) : plan.aliases,
        roleType: plan.roleType || existing?.roleType || "",
        tier: plan.tier,
        pinned: plan.pinned,
        appearanceCount: Math.max(plan.appearanceCount, existing?.appearanceCount ?? 0),
        firstChapter: existing?.firstChapter || appearance?.firstChapter || input.chapterNumber,
        lastChapter,
        chapterNumber: input.chapterNumber,
        fields,
        existing: previousDocument,
        editedByUser,
        supplement: draft.supplement,
      })
      if (existing && previousDocument.trim() && previousDocument !== nextDocument) {
        await snapshotPersonaSkillRevision(input.projectPath, id, existing.skillRevision, previousDocument)
      }
      await writePersonaSkillDocument(input.projectPath, id, nextDocument)

      let hasResearch = existing?.hasResearch ?? false
      if (plan.withResearch && Object.keys(draft.research).length > 0) {
        const written = await writePersonaSkillResearch(input.projectPath, id, draft.research)
        if (written.length > 0) hasResearch = true
      }

      upserts.push({
        id,
        characterName: plan.characterName,
        aliases: uniqueNames([...(existing?.aliases ?? []), ...plan.aliases]),
        roleType: plan.roleType || existing?.roleType || "",
        tier: plan.tier,
        pinned: plan.pinned,
        status: "active",
        firstChapter: existing?.firstChapter || appearance?.firstChapter || input.chapterNumber,
        // 只增不减：批量提取时后面的章可能先学完，旧章晚到时不能把进度拨回去。
        lastChapter,
        appearanceCount: Math.max(plan.appearanceCount, existing?.appearanceCount ?? 0),
        createdChapter: existing?.createdChapter || input.chapterNumber,
        lastLearnedChapter: Math.max(existing?.lastLearnedChapter ?? 0, input.chapterNumber),
        skillRevision: (existing?.skillRevision ?? 0) + 1,
        editedByUser,
        hasResearch,
        updatedAt,
      })
      if (existing) updated.push(plan.characterName)
      else created.push(plan.characterName)
    }

    if (upserts.length === 0) return { created: [], updated: [] }

    // 「插进 index」与「从候选池移走」在同一个锁内、同一个决策点完成。
    // 注意仍是两次 writeFileAtomic，中间崩溃会留下一条冗余的 sighting ——
    // 但顺序是 index 先、sightings 后，反过来崩会把人从候选池彻底丢掉，那更糟。
    const skills = [...index.skills]
    for (const meta of upserts) {
      const position = skills.findIndex((item) => item.id === meta.id)
      if (position >= 0) skills[position] = { ...skills[position], ...meta }
      else skills.push(meta)
    }
    await savePersonaSkillIndex(input.projectPath, { version: 1, skills })

    const createdIds = new Set(upserts.map((meta) => normalizePersonaName(meta.characterName)))
    const remaining = sightings.sightings.filter(
      (item) => !createdIds.has(normalizePersonaName(item.characterName)),
    )
    if (remaining.length !== sightings.sightings.length) {
      await savePersonaSightings(input.projectPath, { version: 1, sightings: remaining })
    }
    return { created, updated }
  })
}

/**
 * 章节摄取后的后台学习入口。永不抛：外层兜住一切，只 warn。
 * 只处理「本章出场、且达到门槛」的人物；同一项目的轮次排队串行，
 * 每轮按 {@link PERSONA_SKILL_BATCH_SIZE} 人一批调用模型。
 */
export function learnPersonaSkillsFromChapter(options: LearnPersonaSkillsOptions): Promise<void> {
  const pp = normalizePath(options.projectPath)
  const roundKey = `${pp}#${options.chapter.chapterNumber}`
  if (inFlightRounds.has(roundKey)) return Promise.resolve()
  inFlightRounds.add(roundKey)

  const queueKey = personaSkillLockKey(pp)
  const previous = learningQueues.get(queueKey) ?? Promise.resolve()
  const run = previous
    .then(() => runPersonaSkillRound(pp, options))
    .finally(() => inFlightRounds.delete(roundKey))
  const tail = run.catch(() => undefined)
  learningQueues.set(queueKey, tail)
  void tail.then(() => {
    if (learningQueues.get(queueKey) === tail) learningQueues.delete(queueKey)
  })
  return run
}

function chunkPlans(plans: readonly PersonaSkillPlan[], size: number): PersonaSkillPlan[][] {
  const batches: PersonaSkillPlan[][] = []
  for (let start = 0; start < plans.length; start += size) batches.push(plans.slice(start, start + size))
  return batches
}

async function runPersonaSkillRound(pp: string, options: LearnPersonaSkillsOptions): Promise<void> {
  const { chapter, llmConfig, signal } = options
  try {
    // 这道守卫必须在 try 里面：它是调用方给的数据，缺字段时以前会**抛出 try 之外**，
    // 而调用点是 `void learnPersonaSkillsFromChapter(...)` —— 变成无人处理的 rejection，
    // 连一句 warn 都没有。
    if (!chapter.characters || chapter.characters.length === 0) return
    const roleTypes = await loadCharacterRoleTypes(pp)
    // 「已确认是本作真实人物」名单：`wiki/entities/` 里有 `tags` 含 `character`
    // 的实体页。定位（主角/配角…）只存在于 `wiki/characters/角色-<定位>-<名>.md`
    // 的文件名里，而那个目录只有跑过「人物」多智能体生成才有 —— 真实项目里通常
    // 不存在，于是所有人 roleType 为空、一律按「未标注」要 3 次出场才建档，
    // 表现为功能整体静默失效。实体页这条判据天然斩断路人（正文里一笔带过的
    // 「老太太/老头/小男孩」不会建实体页），所以拿它兜底把门槛降回 1。
    // 名字与别名都要探测：出场可能是在别名下匹配到已建档条目的。
    const knownCharacters = await resolveKnownCharacters(pp, [
      ...chapter.characters,
      ...Object.values(chapter.characterAliases ?? {}).flat(),
    ])
    // 候选池是纯计数，先落盘：即使后面模型失败，下场也还能接着数。
    // 走 updatePersonaSkillState：读两份 + 计数 + 只写 sightings 全在同一把锁内，
    // 这样并发的另一次学习不会把这里的计数覆盖掉。
    // index 顺手从同一次锁内快照里捞出来，只用于「按名字找已有 id」。
    // applyPersonaSkillDrafts 会在自己的锁内重新读一份新鲜索引来判定
    // editedByUser / hasResearch —— 那份快照到 apply 之间隔着整轮模型调用，
    // 用它判定会把用户在调用期间保存的手改正文覆盖掉。
    let appearances: PersonaChapterAppearance[] = []
    let index: PersonaSkillIndex = { version: 1, skills: [] }
    let sightings: PersonaSkillSightings = { version: 1, sightings: [] }
    await updatePersonaSkillState(pp, (state) => {
      // 注意：mutate 必须是同步的，别在这里 await（会拖住候选池落盘）。
      index = state.index
      const collected = collectChapterAppearances(
        state.index,
        state.sightings,
        chapter,
        roleTypes,
        knownCharacters,
      )
      appearances = collected.appearances
      sightings = collected.sightings

      // 已建档人物的出场记账必须在这里落盘，不能只留在内存里等 applyPersonaSkillDrafts：
      // 那一趟要求模型返回可用草稿，模型漏了这个人或字段全空时它会整条跳过，
      // 而这些人的 lastChapter 就永远停在旧值 → 下一句 refresh 按旧值算 gap → 把
      // 正在场上的人判成 dormant/archived（D5 规定不注入，等于人凭空从上下文里消失）。
      // 这里只动「出场事实」三个字段，绝不动 lastLearnedChapter / skillRevision。
      const skills = state.index.skills.map((meta) => {
        const appearance = collected.appearances.find(
          (item) => normalizePersonaName(item.characterName) === normalizePersonaName(meta.characterName),
        )
        if (!appearance) return meta
        // 回填旧章：本章比这个人的最后一次出场还早，这跟「他最近有没有出场」无关。
        // 一律不动 —— 既不把已归档的人复活（Step 4 那道守卫防的是同一件事的另一半），
        // 也不给计数灌水：index 里没有 chapters[]，无从判断这一次是不是早就计过了。
        if (chapter.chapterNumber < meta.lastChapter) return meta
        return {
          ...meta,
          appearanceCount: Math.max(meta.appearanceCount, appearance.appearanceCount),
          lastChapter: Math.max(meta.lastChapter, chapter.chapterNumber),
          status: "active" as const,
        }
      })

      // 只有真的改到了才返回 index。无条件返回的话，一个还没建档过任何人的项目
      // 每轮都会凭空多出一个空的 index.json —— 那就把「从没建过档」和「建过档」
      // 这两件事混掉了（既有用例正盯着这一点：次要人物第一次出场必须不建 index）。
      const changed = skills.some((meta, position) => meta !== state.index.skills[position])
      if (!changed) return { sightings: collected.sightings }

      return { index: { version: 1, skills }, sightings: collected.sightings }
    })

    const plans = planPersonaSkillRoundForChapter(appearances, chapter.chapterNumber)
    if (plans.length === 0) {
      // 这一支是「什么都没发生」的默认结局：没有档案、没有日志，用户只会看到
      // 技能库是空的。以前它完全静默 —— 定位查不到、门槛没到都是走这里。
      // 打一行 diagnosable 的日志，把「谁在门口、差多少」说清楚。
      if (appearances.length > 0) {
        const pending = appearances
          .filter((item) => !item.hasSkill)
          .map((item) => {
            const threshold = item.pinned
              ? 1
              : firstAppearanceThreshold(item.roleType, item.knownCharacter)
            const tier = item.roleType || (item.knownCharacter ? "已建实体页" : "未标注")
            return `${item.characterName}(${tier} ${item.appearanceCount}/${threshold})`
          })
        if (pending.length > 0) {
          console.log(
            `[Persona Skill] 第 ${chapter.chapterNumber} 章无人物达标：${pending.join("、")}`,
          )
        }
      }
      await refreshPersonaSkillStatuses(pp, chapter.chapterNumber)
      return
    }

    if (!hasUsableLlm(llmConfig, useWikiStore.getState().providerConfigs)) {
      await reportPersonaRoundFailure({
        projectPath: pp,
        chapterNumber: chapter.chapterNumber,
        reason: "no_llm",
        detail: "提取模型没配好（缺 Key 或模型名），本轮无法学习",
      })
      return
    }

    const existing = new Map<string, string>()
    const editedByUser = new Set<string>()
    const priorEvidence = new Map<string, PersonaPriorEvidence[]>()
    const chapterCache = new Map<number, string>()
    for (const plan of plans) {
      const meta = findPersonaSkillMeta(index, plan.characterName, plan.aliases)
      if (meta) {
        existing.set(plan.characterName, await readPersonaSkillDocument(pp, meta.id))
        if (meta.editedByUser) editedByUser.add(plan.characterName)
        continue
      }
      const sighting = findSighting(sightings, plan.characterName, plan.aliases)
      if (!sighting) continue
      const prior = await loadPersonaPriorEvidence(
        pp,
        sighting.chapters,
        [plan.characterName, ...plan.aliases],
        chapter.chapterNumber,
        chapterCache,
      )
      if (prior.length > 0) priorEvidence.set(plan.characterName, prior)
    }

    // 分批：某一批失败（坏 JSON、调用报错）只丢这一批，其余照常落盘。
    // 每种失败都要分开留痕：「模型没返回」和「返回了但一条都对不上」是两回事。
    const drafts: PersonaSkillDraft[] = []
    let lastRaw = ""
    for (const batch of chunkPlans(plans, PERSONA_SKILL_BATCH_SIZE)) {
      if (signal?.aborted) break
      const names = batch.map((plan) => plan.characterName).join("、")
      try {
        const result = await requestPersonaSkillDrafts({
          llmConfig,
          chapterNumber: chapter.chapterNumber,
          chapterBody: chapter.chapterBody,
          plans: batch,
          existing,
          editedByUser,
          priorEvidence,
          signal,
        })
        lastRaw = result.raw
        if (!result.drafts) {
          await reportPersonaRoundFailure({
            projectPath: pp,
            chapterNumber: chapter.chapterNumber,
            reason: "unparsable_json",
            detail: `模型返回的内容里没有可用的 skills 数组（本批 ${batch.length} 人：${names}）`,
            raw: result.raw,
          })
          continue
        }
        if (result.drafts.length === 0) {
          await reportPersonaRoundFailure({
            projectPath: pp,
            chapterNumber: chapter.chapterNumber,
            reason: "no_matching_entries",
            detail: `模型返回了 JSON，但没有一条能对上本轮计划的人物（计划：${names}）`,
            raw: result.raw,
          })
          continue
        }
        drafts.push(...result.drafts)
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        await reportPersonaRoundFailure({
          projectPath: pp,
          chapterNumber: chapter.chapterNumber,
          reason: "round_error",
          detail: `本轮学习抛错（${names}）：${detail}`,
        })
      }
    }
    if (drafts.length === 0) return
    const raw = lastRaw

    const { created, updated } = await applyPersonaSkillDrafts({
      projectPath: pp,
      appearances,
      plans,
      drafts,
      chapterNumber: chapter.chapterNumber,
    })
    const written = created.length + updated.length
    if (written > 0) {
      console.log(`[Persona Skill] 第 ${chapter.chapterNumber} 章更新 ${written} 个人物 Skill`)
      useWikiStore.getState().setPersonaSkillCompletion({ created, updated })
    } else {
      await reportPersonaRoundFailure({
        projectPath: pp,
        chapterNumber: chapter.chapterNumber,
        reason: "empty_fields",
        detail: `解析出 ${drafts.length} 条草稿，但规范字段全空（模型给的字段名与 5 个规范名都对不上）`,
        raw,
      })
    }

    await refreshPersonaSkillStatuses(pp, chapter.chapterNumber)
  } catch (err) {
    // 这里也必须留痕：模型调用本身抛错（鉴权、网络、参数被服务商拒）以前只写 console，
    // 用户在界面上看到的同样是「技能库空的」。而这条路径根本走不到上面那几个 if。
    const detail = err instanceof Error ? err.message : String(err)
    await reportPersonaRoundFailure({
      projectPath: pp,
      chapterNumber: chapter.chapterNumber,
      reason: "round_error",
      detail: `本轮学习抛错：${detail}`,
    })
  } finally {
    /*
     * 动态区块投影必须放在 finally：
     * 「本章没人达到学习门槛 / 没配模型 / 模型返回坏 JSON / 调用抛错」这几条路径
     * 都会提前 return 或跳进 catch，但它们**同样需要**更新状态、出场组织、
     * 认知与关系 —— 这些是事实，不该由模型是否可用决定。
     * 也放在学习之后：新建档的人此时才有 SKILL.md 可写。
     * 函数自身永不抛，失败只 warn，不会把 here 变成新的失败源。
     */
    if (options.chapterSnapshot) {
      await syncPersonaSkillChapterFacts(pp, options.chapterSnapshot)
    }
  }
}

/**
 * 重新整理某人的研究文件。素材只有「他自己现有的档案」——
 * 不读章节快照、不引入新事实，所以这是一次「整理」而不是「再提取」。
 *
 * 只有绿勾（pinned）人物才有研究文件（D6）：一个角色被取消绿勾后，盘上那几份
 * 文件还在，视图就会以为「他有研究文件」而露出按钮 —— 必须在这里挡住，
 * 否则会给他重新生成一份、还把 hasResearch 又写回 true，等于绕过了 D6。
 *
 * 永不抛：失败返回 false，由 UI 提示。
 */
export async function regeneratePersonaSkillResearch(options: {
  projectPath: string
  characterName: string
  llmConfig: LlmConfig
  signal?: AbortSignal
}): Promise<boolean> {
  const pp = normalizePath(options.projectPath)
  try {
    const index = await loadPersonaSkillIndex(pp)
    const meta = findPersonaSkillMeta(index, options.characterName)
    if (!meta) return false
    if (!meta.pinned) return false
    const document = await readPersonaSkillDocument(pp, meta.id)
    if (!document.trim()) return false

    let result = ""
    let streamError: Error | null = null
    await streamChat(
      options.llmConfig,
      buildPersonaSkillResearchMessages({
        characterName: meta.characterName,
        roleType: meta.roleType,
        document,
      }),
      {
        onToken: (token: string) => {
          result += token
        },
        onDone: () => {},
        onError: (error: Error) => {
          streamError = error
        },
      },
      options.signal,
      PERSONA_SKILL_REQUEST_OVERRIDES,
    )
    if (streamError) throw streamError

    const parsed = parseLlmJsonObject(result)
    const research = parsed ? canonicalPersonaResearch(parsed.research) : {}
    const written = await writePersonaSkillResearch(pp, meta.id, research)
    if (written.length === 0) return false

    await updatePersonaSkillIndex(pp, (current) => ({
      version: 1,
      skills: current.skills.map((item) =>
        item.id === meta.id
          ? { ...item, hasResearch: true, updatedAt: new Date().toISOString() }
          : item,
      ),
    }))
    return true
  } catch (err) {
    console.warn("[Persona Skill] 研究文件重新整理失败:", err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * 用户在技能库把「候选人物」点亮绿勾时立即建档。
 *
 * 候选（sightings）里没有正文，只有出场章号 —— 用最后一次出场那一章的文件
 * 作为素材，按 pinned、带研究文件的规格建一次档；建成后候选会被
 * applyPersonaSkillDrafts 从候选池移走。
 *
 * 永不抛：没有候选、定位不到章节文件或模型没给出有效内容时返回 false。
 */
export async function promotePersonaSighting(options: {
  projectPath: string
  characterName: string
  llmConfig: LlmConfig
  signal?: AbortSignal
}): Promise<boolean> {
  const pp = normalizePath(options.projectPath)
  try {
    const index = await loadPersonaSkillIndex(pp)
    const sightings = await loadPersonaSightings(pp)
    const sighting = findSighting(sightings, options.characterName, [])
    if (!sighting) return false
    // 已经有档案的人不该出现在候选池里；真出现就当作已建档，不重复建。
    if (findPersonaSkillMeta(index, options.characterName, sighting.aliases)) return false

    const chapterPath = await findChapterFileByNumber(pp, sighting.lastChapter)
    if (!chapterPath) return false
    const chapterBody = await readFile(chapterPath)

    /*
     * `knownCharacter` 在这条路径上**不影响结果**（`pinned: true` 已把门槛压到 1、
     * 档位也由绿勾固定为 major），但仍如实探测一次而不写死：
     * 这个字段是 `PersonaChapterAppearance` 的必填项，且下游任何按它分支的逻辑
     * 都该拿到真值。只探一个名字，一次目录列表 + 一次读文件。
     */
    const knownCharacters = await resolveKnownCharacters(pp, [
      sighting.characterName,
      ...sighting.aliases,
    ])

    const plan: PersonaSkillPlan = {
      characterName: sighting.characterName,
      aliases: [...sighting.aliases],
      roleType: sighting.roleType,
      tier: resolvePersonaTier(sighting.roleType, true),
      pinned: true,
      appearanceCount: sighting.appearanceCount,
      mode: "create",
      withResearch: true,
    }

    const prior = await loadPersonaPriorEvidence(
      pp,
      sighting.chapters,
      [sighting.characterName, ...sighting.aliases],
      sighting.lastChapter,
    )
    const { drafts } = await requestPersonaSkillDrafts({
      llmConfig: options.llmConfig,
      chapterNumber: sighting.lastChapter,
      chapterBody: stripFrontmatter(chapterBody),
      plans: [plan],
      existing: new Map<string, string>(),
      priorEvidence: new Map([[plan.characterName, prior]]),
      signal: options.signal,
    })
    if (!drafts || drafts.length === 0) return false

    const appearance: PersonaChapterAppearance = {
      characterName: sighting.characterName,
      aliases: [...sighting.aliases],
      roleType: sighting.roleType,
      appearanceCount: sighting.appearanceCount,
      firstChapter: sighting.firstChapter,
      hasSkill: false,
      hasResearch: false,
      pinned: true,
      lastLearnedChapter: 0,
      knownCharacter: knownCharacters.has(normalizePersonaName(sighting.characterName)),
    }

    const { created, updated } = await applyPersonaSkillDrafts({
      projectPath: pp,
      appearances: [appearance],
      plans: [plan],
      drafts,
      chapterNumber: sighting.lastChapter,
    })
    return created.length + updated.length > 0
  } catch (err) {
    console.warn("[Persona Skill] 候选人建档失败:", err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * 用户在「档案」界面保存手改内容。
 *
 * 与 {@link savePersonaSkillDocumentByUser} 的区别：那个保存的是**整篇 Markdown**
 * （原文编辑器），这个保存的是**表单字段**，由 `applyPersonaProfileEdits` 重建文档 ——
 * frontmatter、H1、自定义分区与「补充」段都会原样保留。
 *
 * 顺带允许改「定位」：定位决定档位（注入预算），但它只存在 index.json 里，
 * 写回时必须用 `resolvePersonaTier` 重算，不能让界面自己拼 tier。
 *
 * 全程同一把锁：正文与 editedByUser 必须在同一个原子操作里落盘，否则后台学习
 * 会挤在中间按「没被改过」把用户刚写的内容覆盖掉（与 savePersonaSkillDocumentByUser 同理）。
 */
export interface SavePersonaProfileInput {
  projectPath: string
  id: string
  fields: Record<string, string>
  /** 界面改过的定位；不传表示不动。 */
  roleType?: string
}

export async function savePersonaSkillProfileByUser(
  input: SavePersonaProfileInput,
): Promise<PersonaSkillIndex> {
  const pp = normalizePath(input.projectPath)
  return withPersonaSkillLock(personaSkillLockKey(pp), async () => {
    const index = (await loadPersonaSkillIndexStrict(pp)) ?? { version: 1, skills: [] }
    const meta = index.skills.find((item) => item.id === input.id)
    const previous = await readPersonaSkillDocument(pp, input.id)
    // 没有正文时先造一个壳：applyPersonaProfileEdits 只重建分区，
    // 空文档会让 frontmatter 与 H1 一起消失，档案看起来「没有主人」。
    const base = previous.trim()
      ? previous
      : `# ${meta?.characterName ?? input.id} · 人物 Skill\n`
    const next = applyPersonaProfileEdits(base, input.fields)
    if (meta && previous.trim() && previous !== next) {
      await snapshotPersonaSkillRevision(pp, input.id, meta.skillRevision, previous)
    }
    await writePersonaSkillDocument(pp, input.id, next)

    const updatedAt = new Date().toISOString()
    const nextIndex: PersonaSkillIndex = {
      version: 1,
      skills: index.skills.map((item) => {
        if (item.id !== input.id) return item
        const roleType = input.roleType === undefined ? item.roleType : input.roleType.trim()
        return {
          ...item,
          roleType,
          tier: resolvePersonaTier(roleType, item.pinned),
          editedByUser: true,
          skillRevision: item.skillRevision + 1,
          updatedAt,
        }
      }),
    }
    await savePersonaSkillIndex(pp, nextIndex)
    return nextIndex
  })
}

/**
 * 把已建档的人物退回候选池 —— 撤销在候选区误点的「建档」。
 *
 * 与 promotePersonaSighting 正好相反：从 index 拿掉、把出场记录写回候选池，
 * 同一把锁内完成，中间不放别的写者进来。
 *
 * 刻意**不删除档案文件与研究文件**。删除不可逆，而触发这条路径的场景恰恰是
 * 「点错了」——用户还没看清发生了什么的时刻。留着文件最坏只是占一点磁盘，
 * 下次再建档时整份重写；删掉则连他想找回的正文一起没了。
 *
 * `chapters` 写空数组：出场章号只存在候选池里，建档时没有抄进 index，
 * 所以退回时补不回来。它只用于「同一章重复摄取不重复计数」的去重，
 * 缺了最坏是多计一次章数，不会让谁少出场一次。
 *
 * 永不抛：没有这张档案、或严格读判定索引损坏时返回 false。
 */
export async function demotePersonaSkillToSighting(options: {
  projectPath: string
  characterName: string
}): Promise<boolean> {
  const pp = normalizePath(options.projectPath)
  try {
    return await withPersonaSkillLock(personaSkillLockKey(pp), async () => {
      const index = (await loadPersonaSkillIndexStrict(pp)) ?? { version: 1, skills: [] }
      const meta = findPersonaSkillMeta(index, options.characterName, [])
      if (!meta) return false

      // 先 index 后候选池。反过来崩在中间，这个人会同时出现在两处（档案区与候选区）；
      // 这个顺序下最坏只是候选池少一条，而他下次出场就会被重新并进去。
      await savePersonaSkillIndex(pp, {
        version: 1,
        skills: index.skills.filter((item) => item.id !== meta.id),
      })

      const sightings = await loadPersonaSightings(pp)
      if (!findSighting(sightings, meta.characterName, meta.aliases)) {
        await savePersonaSightings(pp, {
          version: 1,
          sightings: [
            ...sightings.sightings,
            {
              characterName: meta.characterName,
              aliases: [...meta.aliases],
              roleType: meta.roleType,
              appearanceCount: meta.appearanceCount,
              firstChapter: meta.firstChapter,
              lastChapter: meta.lastChapter,
              chapters: [] as number[],
            },
          ],
        })
      }
      return true
    })
  } catch (err) {
    console.warn("[Persona Skill] 退回候选池失败:", err instanceof Error ? err.message : err)
    return false
  }
}
