/**
 * 「人物 Skill」的类型与阈值单点。
 *
 * 与「角色灵魂」CharacterAura 完全隔离：不共用 store、不共用绑定、不共用 SKILL.md 目录。
 * 这里只放纯数据与纯判定；读写盘在 persona-skill-store.ts，编排在 persona-skill-learning.ts。
 */

export type PersonaSkillTier = "major" | "minor"
export type PersonaSkillStatus = "active" | "dormant" | "archived"
export type PersonaSkillMode = "create" | "refine"

/**
 * 建档/落盘时抽取的字段：**一律是全部 5 个**，与档位无关。
 *
 * 这是刻意的分工：档位（major/minor）决定的是**注入写正文时给几段**
 * （见 `renderPersonaSkillBlock`），而不是「学多少」。原因有两条：
 * 1. 用户要的是「第一章角色一出现，他的 skill 基本就成型了」。提示词如果只问
 *    2 个字段，模型连另外 3 个都不会产 —— 卡片永远缺 3 格，只能等后续章节补，
 *    而那正是用户觉得「不像档案」的地方。
 * 2. 学习成本与字段数**无关**：整章所有人物合并成一次 LLM 请求，多写 3 个字段
 *    不多花一次调用；真正稀缺的是写正文时的上下文预算，那一层已经由档位守住了。
 *
 * 所以别把这里改成按档位取值 —— 那会把「省注入」和「省学习」混为一谈。
 * 定义在 PERSONA_MAJOR_FIELDS 之后，避免 TDZ。
 */

/** 定位 → 档位。定位取自 wiki/characters/角色-<定位>-<名>.md 的文件名。 */
export const PERSONA_MAJOR_ROLE_TYPES = ["主角", "男主", "女主", "反派", "导师"] as const
export const PERSONA_MINOR_ROLE_TYPES = ["男配", "女配", "配角", "盟友"] as const

/** 首次建档所需的累计出场次数。 */
export const PERSONA_MAJOR_FIRST_APPEARANCE = 1
export const PERSONA_MINOR_FIRST_APPEARANCE = 2
/**
 * 没有定位的名字不进档位表，用更保守的门槛：出场满 3 次才按 minor 处理。
 * 「一笔带过的路人」就是被这个门槛滤掉的——不是靠某个叫「龙套」的定位标签。
 * 注意别把它读成「永不确定」：出场真的到了 3 次，就该建档。
 */
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

/**
 * SKILL.md 的字段名就是「## 标题」；数组顺序就是注入顺序。
 *
 * 这 5 个是设计规格 07 节批准的「演技」字段 —— 一律回答「这一场该怎么演他」，
 * 都是正文生成当场就要用的东西。设计原文还列了「分类 · 摘要」两项，已删：
 * 人物名/定位/档位/出场次数由注入区块的标题行给出，整份 SKILL.md 压缩摘要
 * 又单独跟着注入，再加两个字段纯属重复占预算。
 *
 * 也刻意不装「关系网 / 成长轨迹」这类深度材料 —— 那些归研究文件的
 * 「关键关系」「动机与弧光」「禁忌与误区」，只给绿勾人物生成（D6）。
 * 字段表一旦装了它们，研究文件就白生成了，注入预算还会被非绿勾人物占满。
 * 加字段前先确认它不属于研究文件那一档。
 */
export const PERSONA_MAJOR_FIELDS = [
  "怎么说话",
  "怎么想",
  "怎么判断",
  "什么不做",
  "知道局限",
] as const
/** 次要人物只给两条（设计 07 节）：这两条在 major 表里也有，必须是它的子集。 */
export const PERSONA_MINOR_FIELDS = ["怎么说话", "怎么判断"] as const
/**
 * 建档/落盘时抽取的字段：**一律是全部 5 个**，与档位无关。
 *
 * 这是刻意的分工：档位（major/minor）决定的是**注入写正文时给几段**
 * （见 `renderPersonaSkillBlock`），而不是「学多少」。原因有两条：
 * 1. 用户要的是「第一章角色一出现，他的 skill 基本就成型了」。提示词如果只问
 *    2 个字段，模型连另外 3 个都不会产 —— 卡片永远缺 3 格，只能等后续章节补，
 *    而那正是用户觉得「不像档案」的地方。
 * 2. 学习成本与字段数**无关**：整章所有人物合并成一次 LLM 请求，多写 3 个字段
 *    不多花一次调用；真正稀缺的是写正文时的上下文预算，那一层已经由档位守住了。
 *
 * 所以别把这里改成按档位取值 —— 那会把「省注入」和「省学习」混为一谈。
 */
export const PERSONA_STORED_FIELDS = PERSONA_MAJOR_FIELDS
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

/**
 * 建档门槛（首次出场）。
 *
 * `knownCharacter` 是「已经能确认他是本作的一个真实人物」——判据是
 * `wiki/entities/` 下有一张 `tags` 含 `character` 的实体页（见
 * `resolveKnownCharacters`）。这个信号的宝贵之处在于**它天然斩断了路人**：
 * 摄取管线只会给值得追踪的实体建页，正文里一笔带过的「老太太 / 老头 /
 * 小男孩」根本没有实体页。
 *
 * 为什么必须认这个信号：定位（主角/配角…）只写在
 * `wiki/characters/角色-<定位>-<名>.md` 的文件名里，而那个目录只有跑过
 * 「人物」多智能体生成才会出现。真实项目里它往往不存在 → 所有人 roleType
 * 都是空 → 一律落到 `PERSONA_UNKNOWN_FIRST_APPEARANCE = 3`。实测一个 12 章
 * 的项目里最高出场数才 2，于是**一个人都建不了档，功能整体静默失效**。
 * 有了这道兜底，确认过的人物第一次出场就建档；档位仍是 minor（浅档、省预算），
 * 由用户点绿勾或声明定位来升级。
 */
export function firstAppearanceThreshold(roleType: string, knownCharacter = false): number {
  if (isMajorRoleType(roleType)) return PERSONA_MAJOR_FIRST_APPEARANCE
  if (isMinorRoleType(roleType)) return PERSONA_MINOR_FIRST_APPEARANCE
  if (knownCharacter) return PERSONA_MAJOR_FIRST_APPEARANCE
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
  /**
   * 已确认是本作的真实人物（`wiki/entities/` 有 `tags` 含 `character` 的实体页）。
   * 只影响建档门槛，不影响档位 —— 档位仍由 roleType / 绿勾决定。
   */
  knownCharacter: boolean
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
    const threshold = input.pinned
      ? PERSONA_MAJOR_FIRST_APPEARANCE
      : firstAppearanceThreshold(input.roleType, input.knownCharacter)
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
