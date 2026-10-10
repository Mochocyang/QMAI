/**
 * 「人物 Skill」的类型与阈值单点。
 *
 * 与「角色灵魂」CharacterAura 完全隔离：不共用 store、不共用绑定、不共用 SKILL.md 目录。
 * 这里只放纯数据与纯判定；读写盘在 persona-skill-store.ts，编排在 persona-skill-learning.ts。
 */

export type PersonaSkillTier = "major" | "minor"
export type PersonaSkillStatus = "active" | "dormant" | "archived"
export type PersonaSkillMode = "create" | "refine"

/** 定位 → 档位。定位取自 wiki/characters/角色-<定位>-<名>.md 的文件名。 */
export const PERSONA_MAJOR_ROLE_TYPES = ["主角", "男主", "女主", "反派", "导师"] as const
export const PERSONA_MINOR_ROLE_TYPES = ["男配", "女配", "配角", "盟友"] as const

/** 首次建档所需的累计出场次数。 */
export const PERSONA_MAJOR_FIRST_APPEARANCE = 1
export const PERSONA_MINOR_FIRST_APPEARANCE = 2
/** 没有定位的名字不进档位表，用更保守的门槛，龙套永远不会被建档。 */
export const PERSONA_UNKNOWN_FIRST_APPEARANCE = 3

/** 再次完善所需的累计出场次数。 */
export const PERSONA_MAJOR_REFINE_APPEARANCE = 2
export const PERSONA_MINOR_REFINE_APPEARANCE = 3

/** 生命周期：连续多少章没出场算潜伏 / 归档。永不自动删除文件。 */
export const PERSONA_DORMANT_GAP_CHAPTERS = 10
export const PERSONA_ARCHIVED_GAP_CHAPTERS = 30

/** 注入上限（D5）。 */
export const PERSONA_INJECT_MAX_SKILLS = 12
export const PERSONA_INJECT_CHAR_BUDGET = 4000
export const PERSONA_INJECT_FIELD_CHARS = 260
/** 双向包含匹配的最小长度：单字称呼（如单姓「林」）会污染匹配，只允许精确相等。 */
export const PERSONA_MIN_SUBSTRING_MATCH_CHARS = 2

/** SKILL.md 的字段名就是「## 标题」；数组顺序就是注入顺序。 */
export const PERSONA_MAJOR_FIELDS = [
  "怎么说话",
  "怎么判断",
  "在意什么",
  "底线与逆鳞",
  "关系网",
  "语言标记",
  "成长轨迹",
] as const
export const PERSONA_MINOR_FIELDS = ["怎么说话", "怎么判断"] as const
/** 用户手改过的档案只在文末追加这个段落，AI 不覆盖既有内容。 */
export const PERSONA_SUPPLEMENT_HEADING = "补充"
/** 只有绿勾（pinned）人物才生成研究文件。 */
export const PERSONA_RESEARCH_DOCUMENTS = [
  "人物小传",
  "语言习惯",
  "关键关系",
  "动机与弧光",
  "名场面",
  "禁忌与误区",
] as const

export const PERSONA_SKILLS_DIR = ".qmai/persona-skills"
export const PERSONA_SKILL_INDEX_FILE = "index.json"
export const PERSONA_SKILL_SIGHTINGS_FILE = "sightings.json"
export const PERSONA_SKILL_DOCUMENT_FILE = "SKILL.md"
export const PERSONA_SKILL_RESEARCH_DIR = "references/research"

/** index.json 里一条人物 Skill 的元数据。 */
export interface PersonaSkillMeta {
  id: string
  characterName: string
  aliases: string[]
  roleType: string
  tier: PersonaSkillTier
  /** 绿勾：用户手动点亮的「重要人物」，一票否决自动分档。 */
  pinned: boolean
  status: PersonaSkillStatus
  firstChapter: number
  lastChapter: number
  appearanceCount: number
  createdChapter: number
  lastLearnedChapter: number
  skillRevision: number
  /** 用户手改过正文；之后 AI 只追加「补充」，不整篇重写。 */
  editedByUser: boolean
  hasResearch: boolean
  updatedAt: string
}

export interface PersonaSkillIndex {
  version: 1
  skills: PersonaSkillMeta[]
}

/**
 * sightings.json 只装「还没有档案的人物」的出场计数，用来判断有没有到门槛。
 * 一旦建档就把它从这里移走 —— 所以这个文件的规模是「配角池」，不是全库。
 */
export interface PersonaSkillSighting {
  characterName: string
  aliases: string[]
  roleType: string
  appearanceCount: number
  firstChapter: number
  lastChapter: number
  chapters: number[]
}

export interface PersonaSkillSightings {
  version: 1
  sightings: PersonaSkillSighting[]
}

export function isMajorRoleType(roleType: string): boolean {
  return (PERSONA_MAJOR_ROLE_TYPES as readonly string[]).includes(roleType.trim())
}

export function isMinorRoleType(roleType: string): boolean {
  return (PERSONA_MINOR_ROLE_TYPES as readonly string[]).includes(roleType.trim())
}

export function firstAppearanceThreshold(roleType: string): number {
  if (isMajorRoleType(roleType)) return PERSONA_MAJOR_FIRST_APPEARANCE
  if (isMinorRoleType(roleType)) return PERSONA_MINOR_FIRST_APPEARANCE
  return PERSONA_UNKNOWN_FIRST_APPEARANCE
}

export function refineAppearanceThreshold(roleType: string): number {
  return isMajorRoleType(roleType) ? PERSONA_MAJOR_REFINE_APPEARANCE : PERSONA_MINOR_REFINE_APPEARANCE
}

/** 绿勾一律按 major 注入；其余按定位分档。 */
export function resolvePersonaTier(roleType: string, pinned: boolean): PersonaSkillTier {
  if (pinned) return "major"
  return isMajorRoleType(roleType) ? "major" : "minor"
}

/** 连续多少章未出场决定状态；绿勾永远 active。 */
export function resolvePersonaStatus(
  lastChapter: number,
  currentChapter: number,
  pinned: boolean,
): PersonaSkillStatus {
  if (pinned) return "active"
  const gap = currentChapter - lastChapter
  if (gap >= PERSONA_ARCHIVED_GAP_CHAPTERS) return "archived"
  if (gap >= PERSONA_DORMANT_GAP_CHAPTERS) return "dormant"
  return "active"
}

/** 归一化人物名：去空白与标点、折叠大小写、NFKC。匹配只在归一化空间里做。 */
export function normalizePersonaName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "")
}

/** planPersonaSkillRound 的输入：一个人物在本章之后的累计状态。 */
export interface PersonaSkillPlanInput {
  characterName: string
  aliases: string[]
  roleType: string
  appearanceCount: number
  hasSkill: boolean
  /** 已经生成过研究文件。研究文件只「首次生成」，之后刷新由用户在界面上手动触发。 */
  hasResearch: boolean
  pinned: boolean
  lastLearnedChapter: number
}

export interface PersonaSkillPlan {
  characterName: string
  aliases: string[]
  roleType: string
  tier: PersonaSkillTier
  pinned: boolean
  appearanceCount: number
  mode: PersonaSkillMode
  /**
   * 本轮该「首次生成」研究文件：绿勾人物 + 还没有研究文件。
   * 已经有研究文件的一律不重写 —— 章节学习的提示词只看得到 SKILL.md，
   * 看不到那 6 份研究文件，重写等于用只有本章的素材覆盖掉累积内容。
   */
  withResearch: boolean
}

/**
 * 本轮该对哪些人物做什么，纯函数。
 *
 * 幂等：已建档的人物如果 lastLearnedChapter 已经等于当前章就跳过，重复摄取同一章不会二次烧模型。
 * 未建档的人物不受 lastLearnedChapter 约束 —— 那是有意的 fail-open：没有档案就该建档，
 * 万一有调用方给未建档条目填了 lastLearnedChapter，最坏也只是重复规划一次，不会永久静默跳过。
 *
 * 输入须已按 normalizePersonaName 去重（同名人物传两次会产出两条 plan）。
 */
export function planPersonaSkillRound(
  inputs: readonly PersonaSkillPlanInput[],
  currentChapter: number,
): PersonaSkillPlan[] {
  const plans: PersonaSkillPlan[] = []
  for (const input of inputs) {
    const tier = resolvePersonaTier(input.roleType, input.pinned)
    const withResearch = input.pinned && !input.hasResearch
    if (input.hasSkill) {
      if (input.lastLearnedChapter >= currentChapter) continue
      // 复用 major 首现门槛 = D6「绿勾一票升级为 major」，不是巧合。
      const threshold = input.pinned ? PERSONA_MAJOR_FIRST_APPEARANCE : refineAppearanceThreshold(input.roleType)
      if (input.appearanceCount < threshold) continue
      plans.push({
        characterName: input.characterName,
        aliases: [...input.aliases],
        roleType: input.roleType,
        tier,
        pinned: input.pinned,
        appearanceCount: input.appearanceCount,
        mode: "refine",
        withResearch,
      })
      continue
    }
    const threshold = input.pinned ? PERSONA_MAJOR_FIRST_APPEARANCE : firstAppearanceThreshold(input.roleType)
    if (input.appearanceCount < threshold) continue
    plans.push({
      characterName: input.characterName,
      aliases: [...input.aliases],
      roleType: input.roleType,
      tier,
      pinned: input.pinned,
      appearanceCount: input.appearanceCount,
      mode: "create",
      withResearch,
    })
  }
  return plans
}
