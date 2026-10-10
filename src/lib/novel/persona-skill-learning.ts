import { listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { streamChat } from "@/lib/llm-client"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"
import { parseLlmJsonObject } from "./book-analysis/llm-json"
import { parseCharacterRoleFileName } from "./extract-established-context"
import {
  PERSONA_MAJOR_FIELDS,
  PERSONA_MINOR_FIELDS,
  PERSONA_SUPPLEMENT_HEADING,
  normalizePersonaName,
  planPersonaSkillRound,
  resolvePersonaStatus,
  type PersonaSkillIndex,
  type PersonaSkillMeta,
  type PersonaSkillPlan,
  type PersonaSkillSighting,
  type PersonaSkillSightings,
  type PersonaSkillTier,
} from "./persona-skill-types"
import {
  loadPersonaSkillIndex,
  personaSkillIdFor,
  readPersonaSkillDocument,
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
}

export interface PersonaSkillDraft {
  characterName: string
  fields: Record<string, string>
  research: Record<string, string>
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
    })),
    currentChapter,
  )
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") result[key.trim()] = entry.trim()
  }
  return result
}

/** 解析模型返回的多人 JSON。根对象不可解析 / 没有 skills 数组时返回 null（整轮跳过）。 */
export function parsePersonaSkillDrafts(
  raw: string,
  plans: readonly PersonaSkillPlan[],
): PersonaSkillDraft[] | null {
  const parsed = parseLlmJsonObject(raw)
  if (!parsed || !Array.isArray(parsed.skills)) return null
  const byName = new Map<string, PersonaSkillPlan>()
  for (const plan of plans) {
    byName.set(normalizePersonaName(plan.characterName), plan)
    for (const alias of plan.aliases) byName.set(normalizePersonaName(alias), plan)
  }
  const drafts: PersonaSkillDraft[] = []
  for (const entry of parsed.skills) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const plan = byName.get(normalizePersonaName(typeof record.name === "string" ? record.name : ""))
    if (!plan) continue
    drafts.push({
      characterName: plan.characterName,
      fields: normalizeStringRecord(record.fields),
      research: normalizeStringRecord(record.research),
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
}

export function renderPersonaSkillDocument(input: RenderPersonaSkillDocumentInput): string {
  const order = input.tier === "major" ? PERSONA_MAJOR_FIELDS : PERSONA_MINOR_FIELDS
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
    return [
      frontmatter,
      "",
      title,
      "",
      stripDocumentPreamble(input.existing),
      "",
      `## ${PERSONA_SUPPLEMENT_HEADING}（第 ${input.chapterNumber} 章）`,
      "",
      sections,
      "",
    ].join("\n")
  }

  return [frontmatter, "", title, "", sections, ""].join("\n")
}

const inFlightRounds = new Set<string>()

export function __resetPersonaSkillRoundsForTesting(): void {
  inFlightRounds.clear()
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
      const status = resolvePersonaStatus(meta.lastChapter, currentChapter, meta.pinned)
      if (status === meta.status) return meta
      changed = true
      return { ...meta, status, updatedAt }
    })
    if (!changed) return undefined
    return { version: 1, skills }
  })
}

async function requestPersonaSkillDrafts(input: {
  llmConfig: LlmConfig
  chapterNumber: number
  chapterBody: string
  plans: readonly PersonaSkillPlan[]
  existing: Map<string, string>
  signal?: AbortSignal
}): Promise<PersonaSkillDraft[] | null> {
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
  return parsePersonaSkillDrafts(result, input.plans)
}

export interface ApplyPersonaSkillInput {
  projectPath: string
  index: PersonaSkillIndex
  appearances: readonly PersonaChapterAppearance[]
  plans: readonly PersonaSkillPlan[]
  drafts: readonly PersonaSkillDraft[]
  chapterNumber: number
}

/** 把草稿落到 SKILL.md / 研究文件 / index，并把已建档的人从候选池移走。返回真正写入的人数。 */
export async function applyPersonaSkillDrafts(input: ApplyPersonaSkillInput): Promise<number> {
  const appearanceByName = new Map(
    input.appearances.map((item) => [normalizePersonaName(item.characterName), item]),
  )
  const updatedAt = new Date().toISOString()
  const upserts: PersonaSkillMeta[] = []

  for (const plan of input.plans) {
    const draft = input.drafts.find(
      (item) => normalizePersonaName(item.characterName) === normalizePersonaName(plan.characterName),
    )
    if (!draft) continue
    if (Object.values(draft.fields).every((value) => !value.trim())) continue

    const existing = findPersonaSkillMeta(input.index, plan.characterName, plan.aliases)
    const id = existing?.id ?? personaSkillIdFor(plan.characterName)
    const appearance = appearanceByName.get(normalizePersonaName(plan.characterName))
    const previousDocument = existing ? await readPersonaSkillDocument(input.projectPath, id) : ""

    await writePersonaSkillDocument(
      input.projectPath,
      id,
      renderPersonaSkillDocument({
        characterName: plan.characterName,
        aliases: existing ? uniqueNames([...existing.aliases, ...plan.aliases]) : plan.aliases,
        roleType: plan.roleType || existing?.roleType || "",
        tier: plan.tier,
        pinned: plan.pinned,
        appearanceCount: Math.max(plan.appearanceCount, existing?.appearanceCount ?? 0),
        firstChapter: existing?.firstChapter || appearance?.firstChapter || input.chapterNumber,
        lastChapter: input.chapterNumber,
        chapterNumber: input.chapterNumber,
        fields: draft.fields,
        existing: previousDocument,
        editedByUser: existing?.editedByUser ?? false,
      }),
    )

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
      lastChapter: input.chapterNumber,
      appearanceCount: Math.max(plan.appearanceCount, existing?.appearanceCount ?? 0),
      createdChapter: existing?.createdChapter || input.chapterNumber,
      lastLearnedChapter: input.chapterNumber,
      skillRevision: (existing?.skillRevision ?? 0) + 1,
      editedByUser: existing?.editedByUser ?? false,
      hasResearch,
      updatedAt,
    })
  }

  if (upserts.length === 0) return 0

  // 「插进 index」与「从候选池移走」必须原子：分两次写的话，中间崩溃会让人物
  // 同时留在两个文件里，违反 D7「sightings 只记还没建档的人」。所以走一个入口。
  await updatePersonaSkillState(input.projectPath, (state) => {
    const skills = [...state.index.skills]
    for (const meta of upserts) {
      const position = skills.findIndex((item) => item.id === meta.id)
      if (position >= 0) skills[position] = { ...skills[position], ...meta }
      else skills.push(meta)
    }

    const createdIds = new Set(upserts.map((meta) => normalizePersonaName(meta.characterName)))
    const sightings = state.sightings.sightings.filter(
      (item) => !createdIds.has(normalizePersonaName(item.characterName)),
    )

    return {
      index: { version: 1, skills },
      sightings:
        sightings.length === state.sightings.sightings.length
          ? state.sightings
          : { version: 1, sightings },
    }
  })

  return upserts.length
}

/**
 * 章节摄取后的后台学习入口。永不抛：外层兜住一切，只 warn。
 * 只处理「本章出场、且达到门槛」的人物，整轮只发一次 LLM 请求。
 */
export async function learnPersonaSkillsFromChapter(options: LearnPersonaSkillsOptions): Promise<void> {
  const pp = normalizePath(options.projectPath)
  const { chapter, llmConfig, signal } = options
  if (chapter.characters.length === 0) return

  const roundKey = `${pp}#${chapter.chapterNumber}`
  if (inFlightRounds.has(roundKey)) return
  inFlightRounds.add(roundKey)

  try {
    const roleTypes = await loadCharacterRoleTypes(pp)
    // 候选池是纯计数，先落盘：即使后面模型失败，下场也还能接着数。
    // 走 updatePersonaSkillState：读两份 + 计数 + 只写 sightings 全在同一把锁内，
    // 这样并发的另一次学习不会把这里的计数覆盖掉。
    // index 顺手从同一次锁内快照里捞出来，供后面查「这个人是否已建档」——
    // 权威写入在 applyPersonaSkillDrafts 里会于锁内重读，这里只用于按名字找 id。
    let appearances: PersonaChapterAppearance[] = []
    let index: PersonaSkillIndex = { version: 1, skills: [] }
    await updatePersonaSkillState(pp, (state) => {
      // 注意：mutate 必须是同步的，别在这里 await（会拖住候选池落盘）。
      index = state.index
      const collected = collectChapterAppearances(state.index, state.sightings, chapter, roleTypes)
      appearances = collected.appearances
      return { sightings: collected.sightings }
    })

    const plans = planPersonaSkillRoundForChapter(appearances, chapter.chapterNumber)
    if (plans.length === 0) {
      await refreshPersonaSkillStatuses(pp, chapter.chapterNumber)
      return
    }

    if (!hasUsableLlm(llmConfig, useWikiStore.getState().providerConfigs)) {
      console.warn("[Persona Skill] 提取模型不可用，跳过本轮人物 Skill 学习")
      return
    }

    const existing = new Map<string, string>()
    for (const plan of plans) {
      const meta = findPersonaSkillMeta(index, plan.characterName, plan.aliases)
      if (!meta) continue
      existing.set(plan.characterName, await readPersonaSkillDocument(pp, meta.id))
    }

    const drafts = await requestPersonaSkillDrafts({
      llmConfig,
      chapterNumber: chapter.chapterNumber,
      chapterBody: chapter.chapterBody,
      plans,
      existing,
      signal,
    })
    if (!drafts) {
      console.warn("[Persona Skill] 模型没有返回可解析的 JSON，本轮跳过（不推进 lastLearnedChapter）")
      return
    }

    const written = await applyPersonaSkillDrafts({
      projectPath: pp,
      index,
      appearances,
      plans,
      drafts,
      chapterNumber: chapter.chapterNumber,
    })
    if (written > 0) console.log(`[Persona Skill] 第 ${chapter.chapterNumber} 章更新 ${written} 个人物 Skill`)

    await refreshPersonaSkillStatuses(pp, chapter.chapterNumber)
  } catch (err) {
    console.warn("[Persona Skill] 人物 Skill 学习失败:", err instanceof Error ? err.message : err)
  } finally {
    inFlightRounds.delete(roundKey)
  }
}

/**
 * 重新整理某人的研究文件。素材只有「他自己现有的档案」——
 * 不读章节快照、不引入新事实，所以这是一次「整理」而不是「再提取」。
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
    const research = parsed ? normalizeStringRecord(parsed.research) : {}
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
