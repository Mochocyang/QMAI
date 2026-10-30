/**
 * 「提取记忆」时把**章节快照**里的动态事实写进每个人物 Skill：
 * 当前状态 / 出场组织 / 认知变化 / 关系变化。
 *
 * 为什么不用模型：这四类信息在快照里已经是结构化的
 * （`characterStateChanges` / `organizations` / `knowledgeChanges` / `relationshipChanges`），
 * 再让模型写一遍既要多付 token，又会跟记忆中心的权威数据打架 ——
 * 同一个「右肩受伤」在 `.novel/character-states.json` 和 SKILL.md 里写成两句话，
 * 用户不知道该信哪个。这里做的是**投影**，不是二次创作。
 *
 * 另一个好处是可靠性：这条链路完全不依赖模型可用性。没配模型、模型超时、
 * 输出不是 JSON —— 状态与关系照样更新。
 *
 * 累积语义（别搞错）：
 * - `当前状态` 是快照，本章有新状态就整段替换；
 * - `出场组织` / `认知变化` / `关系变化` 是**累积**的，按出现顺序去重，超出上限丢最旧。
 */
import {
  loadPersonaSkillIndexStrict,
  personaSkillLockKey,
  readPersonaSkillDocument,
  savePersonaSkillIndex,
  withPersonaSkillLock,
  writePersonaSkillDocument,
} from "./persona-skill-store"
import { applyPersonaProfileEdits, splitPersonaSkillDocument } from "./persona-skill-profile"
import { loadMemoryCleanupPolicy, memoryRemovalKey } from "./memory-cleanup-policy"
import {
  PERSONA_LIVE_SECTION_LIMITS,
  normalizePersonaName,
  type PersonaSkillIndex,
} from "./persona-skill-types"

/** 只依赖快照里本模块真正读的字段：避免为了一个类型把整条摄取管线拖进来。 */
export interface PersonaChapterFactSource {
  chapterNumber: number
  characters: string[]
  characterAliases?: Record<string, string[]>
  organizations: string[]
  characterStateChanges: string[]
  relationshipChanges: string[]
  knowledgeChanges: string[]
  characterDetails?: Record<string, { identity: string; faction: string; goals: string; arcChange: string }>
  organizationDetails?: Record<string, { leader: string; members: string; goals: string; resources: string }>
  graphEdges: string[]
}

export interface PersonaChapterFacts {
  /** 本章快照：身份 / 阵营 / 目标 / 弧光 + 本章状态变化。没有内容时为空串。 */
  currentState: string
  /** 「组织名：关系（第 N 章）」 */
  organizations: string[]
  /** 「第 N 章：知道…／不知道…」 */
  cognition: string[]
  /** 「第 N 章：与 X 关系 → …」 */
  relations: string[]
  /** 供「关系网」字段合并的当前关系（不带章号，格式「对象：关系」）。 */
  relationNetwork: string[]
}

const RELATION_LABELS: Record<string, string> = {
  APPEARS_IN: "出场于",
  HAPPENS_IN: "发生于",
  BELONGS_TO: "属于",
  HAS_ITEM: "持有",
  ENEMY_OF: "敌对",
  ALLY_OF: "合作",
  SUSPECTS: "怀疑",
  HIDES_FROM: "隐瞒",
  KNOWS: "知道",
  DOES_NOT_KNOW: "不知道",
  CAUSES: "导致",
  REVEALS: "揭示",
  AFFECTS: "影响",
  LOCATED_AT: "位于",
}

function relationLabel(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return "关系"
  return RELATION_LABELS[trimmed.toUpperCase()] ?? trimmed
}

function namesOf(characterName: string, aliases: readonly string[]): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const raw of [characterName, ...aliases]) {
    const name = raw.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

function mentions(text: string, names: readonly string[]): boolean {
  return names.some((name) => name && text.includes(name))
}

/** `名:变化` / `名：变化`。冒号前后都可能是别名。 */
function splitQualifiedLine(line: string): { name: string; detail: string } | null {
  const match = line.match(/^\s*([^:：]{1,24})\s*[:：]\s*(.+)$/)
  if (!match) return null
  return { name: match[1].trim(), detail: match[2].trim() }
}

/** `A->REL->B`。 */
function parseEdge(line: string): { source: string; relation: string; target: string } | null {
  const parts = line.split("->")
  if (parts.length !== 3) return null
  const source = parts[0].trim()
  const relation = parts[1].trim()
  const target = parts[2].trim()
  if (!source || !target) return null
  return { source, relation, target }
}

function resolveDetail<T>(map: Record<string, T> | undefined, names: readonly string[]): T | null {
  if (!map) return null
  for (const name of names) {
    const direct = map[name]
    if (direct) return direct
  }
  // 快照里的键可能是别名（「二丫」vs「念念」）
  for (const [key, value] of Object.entries(map)) {
    if (names.includes(key)) return value
  }
  return null
}

/**
 * 认知行里的**主体**：`名知道…` / `名不知道…` / `名得知…`。
 *
 * 为什么必须认主体而不是「文本里出现过这个名字」：
 * 「沈砚不知道林清越见过账本」里同时出现了两个人，按包含匹配会把沈砚的盲区
 * 记到林清越头上 —— 认知写反了比没写更糟（AI 会照着一个错误前提写他）。
 */
const COGNITION_SUBJECT = /^\s*([^，。；、,;:：]{1,20}?)\s*(?:不知道|知道|得知|察觉到|意识到)/

function cognitionSubject(line: string): string | null {
  const match = line.match(COGNITION_SUBJECT)
  return match ? match[1].trim() : null
}

/**
 * 从快照里取出某个人物的本章事实。纯函数：同一份快照 + 同一个人，结果恒定。
 */
export function buildPersonaChapterFacts(
  source: PersonaChapterFactSource,
  characterName: string,
  aliases: readonly string[] = [],
): PersonaChapterFacts {
  const names = namesOf(characterName, aliases)
  const chapter = source.chapterNumber

  // 当前状态：本章变化优先，其次补身份 / 阵营 / 目标 / 弧光（让「状态」不只是一个词）。
  const stateChanges: string[] = []
  for (const line of source.characterStateChanges) {
    const qualified = splitQualifiedLine(line)
    if (qualified) {
      if (!mentions(qualified.name, names)) continue
      stateChanges.push(qualified.detail)
      continue
    }
    if (mentions(line, names)) stateChanges.push(line.trim())
  }
  const detail = resolveDetail(source.characterDetails, names)
  const detailLines: string[] = []
  if (detail) {
    if (detail.identity?.trim()) detailLines.push(`身份：${detail.identity.trim()}`)
    if (detail.faction?.trim()) detailLines.push(`阵营：${detail.faction.trim()}`)
    if (detail.goals?.trim()) detailLines.push(`目标：${detail.goals.trim()}`)
    if (detail.arcChange?.trim()) detailLines.push(`弧光：${detail.arcChange.trim()}`)
  }
  const stateParts = [...stateChanges.filter(Boolean), ...detailLines]
  const currentState = stateParts.length > 0 ? `第 ${chapter} 章：${stateParts.join("；")}` : ""

  // 出场组织：只写**有证据**关联的组织（成员表 / 属于边 / 其它关系边）。
  const organizations: string[] = []
  const belongs = new Set<string>()
  for (const edge of source.graphEdges) {
    const parsed = parseEdge(edge)
    if (!parsed) continue
    if (mentions(parsed.source, names) && parsed.relation.trim().toUpperCase() === "BELONGS_TO") {
      belongs.add(parsed.target)
    } else if (mentions(parsed.target, names) && parsed.relation.trim().toUpperCase() === "BELONGS_TO") {
      belongs.add(parsed.source)
    }
  }
  for (const organization of source.organizations) {
    const name = organization.trim()
    if (!name) continue
    const orgDetail = source.organizationDetails?.[name]
    if (orgDetail?.members && mentions(orgDetail.members, names)) {
      organizations.push(`${name}：成员（第 ${chapter} 章）`)
      continue
    }
    if (belongs.has(name)) {
      organizations.push(`${name}：属于（第 ${chapter} 章）`)
      continue
    }
    const related = source.graphEdges
      .map(parseEdge)
      .find(
        (parsed) =>
          parsed != null &&
          ((mentions(parsed.source, names) && parsed.target === name) ||
            (mentions(parsed.target, names) && parsed.source === name)),
      )
    if (related) {
      organizations.push(`${name}：${relationLabel(related.relation)}（第 ${chapter} 章）`)
    }
  }

  // 认知变化：快照里本来就写成「名知道…」「名不知道…」，整行带上章号即可。
  // 主体优先：认不出主体时才退回「文本里点名」（否则会把别人的盲区记到他头上）。
  const cognition = source.knowledgeChanges
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false
      const subject = cognitionSubject(line)
      if (subject) return names.includes(subject)
      return mentions(line, names)
    })
    .map((line) => `第 ${chapter} 章：${line}`)

  // 关系变化：A->REL->B；非边格式但点了名的行也留下（信息比格式重要）。
  const relations: string[] = []
  const relationNetwork: string[] = []
  for (const line of source.relationshipChanges) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed = parseEdge(trimmed)
    if (!parsed) {
      if (mentions(trimmed, names)) relations.push(`第 ${chapter} 章：${trimmed}`)
      continue
    }
    const sourceHit = mentions(parsed.source, names)
    const targetHit = mentions(parsed.target, names)
    if (!sourceHit && !targetHit) continue
    const other = sourceHit ? parsed.target.trim() : parsed.source.trim()
    if (!other || names.includes(other)) continue
    const label = relationLabel(parsed.relation)
    relations.push(`第 ${chapter} 章：与 ${other} 关系 → ${label}`)
    relationNetwork.push(`${other}：${label}`)
  }

  return { currentState, organizations, cognition, relations, relationNetwork }
}

/** 去掉「第 N 章：」前缀后的正文：同一条事实在不同章重复出现时，用新的替换旧的。 */
function lineKey(line: string): string {
  return line.replace(/^第\s*\d+\s*章\s*[：:]\s*/, "").trim()
}

/**
 * 累积合并：保留原有顺序，新行覆盖同键的旧行（章号随之更新），超出上限丢最旧。
 *
 * 上限存在的理由：认知与关系每章都可能有新条目，无上限的话几百章后
 * 一份 SKILL.md 会被历史流水撑爆，而其中 90% 早就过期了。
 */
export function mergeLiveLines(
  previous: string,
  additions: readonly string[],
  limit: number,
): string {
  const ordered: string[] = []
  const positions = new Map<string, number>()
  const push = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const key = lineKey(trimmed)
    const at = positions.get(key)
    if (at !== undefined) {
      ordered[at] = trimmed
      return
    }
    positions.set(key, ordered.length)
    ordered.push(trimmed)
  }
  for (const line of previous.split(/\r?\n/)) push(line)
  for (const line of additions) push(line)
  if (ordered.length <= limit) return ordered.join("\n")
  return ordered.slice(ordered.length - limit).join("\n")
}

/**
 * 把本章事实写进所有**本章出场且已建档**的人物 Skill。
 *
 * - 不调模型、不改 `updatedAt`（自进化用 updatedAt 判定新素材，这里只是投影，
 *   不该把一个人的档案重新推回进化队列）、不改 `lastLearnedChapter`（那是学习的事）。
 * - `editedByUser` 的人也照写：这四段是自动维护的事实，用户手写它们本来就会被覆盖；
 *   挡掉等于「手改过的人永远看不到当前状态」。
 * - 永不抛：失败只 warn，返回成功更新的人名。
 */
export async function syncPersonaSkillChapterFacts(
  projectPath: string,
  source: PersonaChapterFactSource,
): Promise<string[]> {
  const updated: string[] = []
  try {
    await withPersonaSkillLock(personaSkillLockKey(projectPath), async () => {
      // A background learning run may finish after maintenance. Apply the
      // current decisions while holding the same profile lock as maintenance.
      const policy = await loadMemoryCleanupPolicy(projectPath)
      const removed = policy.removed.filter((r) => r.chapterNumber === source.chapterNumber)
      const blocked = new Set(removed.map(memoryRemovalKey))
      source = {
        ...source,
        knowledgeChanges: source.knowledgeChanges.filter((text) => !blocked.has(memoryRemovalKey({ chapterNumber: source.chapterNumber, field: "knowledgeChanges", text }))),
        characterStateChanges: source.characterStateChanges.filter((text) => !blocked.has(memoryRemovalKey({ chapterNumber: source.chapterNumber, field: "characterStateChanges", text }))),
        graphEdges: source.graphEdges.filter((edge) => {
          const [subject, relation, object] = edge.split("->").map((s) => s.trim())
          return !subject || !object || !/知道|不知道|KNOWS|DOES_NOT_KNOW/.test(relation ?? "")
            || !removed.some((r) => r.field === "knowledgeChanges" && r.text.includes(subject) && r.text.includes(object))
        }),
      }
      const index: PersonaSkillIndex =
        (await loadPersonaSkillIndexStrict(projectPath)) ?? { version: 1, skills: [] }
      if (index.skills.length === 0) return

      const appearing = index.skills.filter((meta) =>
        source.characters.some(
          (name) =>
            normalizePersonaName(name) === normalizePersonaName(meta.characterName) ||
            meta.aliases.some((alias) => normalizePersonaName(alias) === normalizePersonaName(name)),
        ),
      )
      if (appearing.length === 0) return

      const bumped = new Set<string>()
      for (const meta of appearing) {
        const document = await readPersonaSkillDocument(projectPath, meta.id)
        if (!document.trim()) continue
        const facts = buildPersonaChapterFacts(source, meta.characterName, meta.aliases)
        const parsed = splitPersonaSkillDocument(document)
        const fields: Record<string, string> = { ...parsed.fields }

        // 当前状态是快照：本章有内容才覆盖，没提到就保留上一章的值。
        if (facts.currentState.trim()) fields["当前状态"] = facts.currentState
        fields["出场组织"] = mergeLiveLines(
          parsed.fields["出场组织"] ?? "",
          facts.organizations,
          PERSONA_LIVE_SECTION_LIMITS.出场组织,
        )
        fields["认知变化"] = mergeLiveLines(
          parsed.fields["认知变化"] ?? "",
          facts.cognition,
          PERSONA_LIVE_SECTION_LIMITS.认知变化,
        )
        fields["关系变化"] = mergeLiveLines(
          parsed.fields["关系变化"] ?? "",
          facts.relations,
          PERSONA_LIVE_SECTION_LIMITS.关系变化,
        )
        // 「关系网」也吃一份：它是档案里给人查的关系列表，本章的新关系不该等
        // 模型下一次 refine 才出现（模型还可能漏）。
        if (facts.relationNetwork.length > 0) {
          fields["关系网"] = mergeLiveLines(parsed.fields["关系网"] ?? "", facts.relationNetwork, 24)
        }

        const next = applyPersonaProfileEdits(document, fields)
        if (next === document) continue
        await writePersonaSkillDocument(projectPath, meta.id, next)
        bumped.add(meta.id)
        updated.push(meta.characterName)
      }

      if (bumped.size > 0) {
        await savePersonaSkillIndex(projectPath, {
          version: 1,
          skills: index.skills.map((meta) =>
            bumped.has(meta.id) ? { ...meta, skillRevision: meta.skillRevision + 1 } : meta,
          ),
        })
      }
    })
  } catch (error) {
    console.warn(
      "[Persona Skill] 章节动态同步失败（不影响本次提取记忆）：",
      error instanceof Error ? error.message : error,
    )
    return []
  }
  return updated
}
