/**
 * 人物性格标签库：固定基底 + 题材预制包。
 *
 * ⚠️ 准入判据（只有一条）：**这个词能不能演出一个具体动作或一句台词。**
 * 「毒舌」能演 —— 开口就是刺，台词可写。
 * 「严肃沉稳」演不出来 —— 它描述整体印象，写进正文对模型没有可执行指令。
 * 所以基底里没有「严肃沉稳」「性格开朗」「不爱说话」，这是刻意的，别好心补进去。
 */

export const PERSONALITY_TAG_MAX_CHARS = 12

export type PersonalityTagGroup = "语气" | "怪癖" | "关系" | "反差"

export interface PersonalityTag {
  label: string
  group: PersonalityTagGroup
}

/** 抽象印象词黑名单：命中即判为「演不出来」。 */
const ABSTRACT_WORDS = ["沉稳", "开朗", "内向", "外向", "性格", "善良", "正派", "普通", "正常"]

/**
 * 能不能演出一个具体表现。
 * 判据只有两条：不含抽象印象词、长度不超过上限。
 * 不做语义模型判断 —— 这是纯函数，必须可单测、零依赖。
 */
export function isPerformanceTag(label: string): boolean {
  const trimmed = label.trim()
  if (!trimmed || trimmed.length > PERSONALITY_TAG_MAX_CHARS) return false
  return !ABSTRACT_WORDS.some((word) => trimmed.includes(word))
}

const RAW_TAGS: ReadonlyArray<readonly [PersonalityTagGroup, readonly string[]]> = [
  ["语气", [
    "毒舌", "嘴硬心软", "阴阳怪气", "一本正经说胡话", "满口网络梗", "爱说歇后语",
    "爱用成语", "话痨", "闷葫芦", "开口必抬杠", "说话带刺", "爱用反问",
    "爱自称老子", "说话总带笑", "语速极快", "惜字如金", "爱念诗", "口头禅超多",
    "骂人不带脏字", "爱给人起外号",
  ]],
  ["怪癖", [
    "大吃货", "极度洁癖", "抠门到离谱", "嗜睡", "认死理", "脸盲", "路痴", "收集癖",
    "见到美酒走不动路", "必须把东西摆整齐", "随身带刀", "随时擦手",
    "记不住别人名字", "爱捡东西回家", "吃饭必点同一道菜", "出门必带伞",
    "对数字过目不忘", "见不得浪费粮食", "强迫症式锁门", "爱拆东西",
  ]],
  ["关系", [
    "护短", "记仇", "中央空调", "对谁都客气但没真心", "见强者就怂",
    "只对一个人笑", "对晚辈毫无耐心", "见不得女人哭", "见不得孩子受欺负",
    "对上司阳奉阴违", "兄弟的事比自己大", "嘴上嫌弃实际什么都管",
    "谁都不服就服能打的", "记不住恩只记仇", "被夸就飘", "见钱眼开",
    "护食", "对外人客气对家人刻薄", "爱当说客", "见谁都要教两句",
  ]],
  ["反差", [
    "外表凶内心怂", "严肃壳里抖机灵", "人前高冷人后话多", "嘴上说不在乎实际很在乎",
    "杀伐果断但怕虫子", "满口歪理却说得很准", "越紧张越讲冷笑话",
    "明明怕水却坐船", "说要杀人只砍柴", "装疯卖傻心里门清",
    "哭包但嘴硬", "一紧张就结巴", "越怒越冷静", "胆小却敢挡在前面",
    "衣冠楚楚满嘴脏话", "温柔脸说狠话", "当坏人当得很业余", "装高手装到露怯",
    "怕疼但要挡刀", "正经起来最可怕",
  ]],
]

export const PERSONALITY_TAGS: PersonalityTag[] = RAW_TAGS.flatMap(([group, labels]) =>
  labels.map((label) => ({ label, group })),
)

export interface PersonalityGenrePack {
  genre: string
  tags: readonly string[]
}

export const PERSONALITY_GENRE_PACKS: ReadonlyArray<PersonalityGenrePack> = [
  { genre: "仙侠", tags: ["看破红尘", "护道不护人", "口称本座", "见妖就上", "以命换道", "爱收徒弟"] },
  { genre: "都市", tags: ["满口网络梗", "职场老油条", "爱晒朋友圈", "外卖成瘾", "社恐但被迫社交", "报复性熬夜"] },
  { genre: "悬疑", tags: ["观察入微", "疑心极重", "爱记现场细节", "不信任何人", "沉默但一针见血", "强迫复盘"] },
  { genre: "言情", tags: ["嘴硬心软", "吃醋不承认", "别扭式关心", "黏人但装高冷", "说反话", "先动心的那个"] },
  { genre: "历史", tags: ["出口成章", "讲礼数不弯腰", "爱引经据典", "宁折不弯", "见官不跪", "算盘打得响"] },
]

export function personaTagsForGenre(genre: string): readonly string[] {
  return PERSONALITY_GENRE_PACKS.find((pack) => pack.genre === genre.trim())?.tags ?? []
}
