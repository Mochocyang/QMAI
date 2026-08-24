import { getMainGenreLabel } from "@/lib/novel/outline-genres"

export type OutlineWizardTask =
  | "newBook"
  | "fromExisting"
  | "volumeOutline"
  | "chapterOutline"
  | "modifyOutline"
  | "fillMissing"

export type OutlineWizardLength = "long" | "short" | "mediumShort" | "auto"
export type OutlineWizardChannel = "male" | "female" | "auto"
export type OutlineWizardNarrative =
  | "firstPerson"
  | "thirdPerson"
  | "multiPov"
  | "auto"
export type OutlineWizardMaterialSource = "none" | "project" | "pasteLater"

export interface OutlineWizardOption<T extends string> {
  value: T
  label: string
}

interface OutlineWizardGenreOption {
  value: string
  label: string
}

export type OutlineWizardExplicitField = "task" | "length" | "channel" | "genre" | "customGenre" | "inspiration" | "sellingPoints" | "targets" | "scale" | "narrative" | "materialSource"

export interface OutlineWizardRequest {
  task: OutlineWizardTask
  length: OutlineWizardLength
  channel: OutlineWizardChannel
  genre: string
  customGenre: string
  inspiration: string
  sellingPoints: string[]
  targets: string[]
  scale: string
  narrative: OutlineWizardNarrative
  materialSource: OutlineWizardMaterialSource
  explicit?: Partial<Record<OutlineWizardExplicitField, boolean>>
}

export const OUTLINE_WIZARD_TASK_OPTIONS: OutlineWizardOption<OutlineWizardTask>[] = [
  { value: "newBook", label: "创建新书大纲" },
  { value: "fromExisting", label: "根据已有资料生成大纲" },
  { value: "volumeOutline", label: "生成卷纲" },
  { value: "chapterOutline", label: "生成章纲" },
  { value: "modifyOutline", label: "修改已有大纲/章纲" },
  { value: "fillMissing", label: "补全缺失设定" },
]

export const OUTLINE_WIZARD_LENGTH_OPTIONS: OutlineWizardOption<OutlineWizardLength>[] =
  [
    { value: "long", label: "长篇小说" },
    { value: "short", label: "短篇小说" },
    { value: "mediumShort", label: "中短篇小说" },
    { value: "auto", label: "暂不确定，让 AI 判断" },
  ]

export const OUTLINE_WIZARD_CHANNEL_OPTIONS: OutlineWizardOption<OutlineWizardChannel>[] =
  [
    { value: "male", label: "男频" },
    { value: "female", label: "女频" },
    { value: "auto", label: "暂不确定，让 AI 判断" },
  ]

export const OUTLINE_WIZARD_SELLING_POINTS = [
  "升级变强",
  "打脸逆袭",
  "情绪拉扯",
  "悬疑反转",
  "规则破解",
  "家国高燃",
  "事业成长",
  "感情修复",
  "AI 根据灵感推荐",
]

export const OUTLINE_WIZARD_TARGETS = [
  "完整新书规划",
  "总纲",
  "卷纲",
  "章节规划表",
  "章纲",
  "人物小传",
  "世界观/设定",
  "伏笔表",
]

export const OUTLINE_WIZARD_NARRATIVE_OPTIONS: OutlineWizardOption<OutlineWizardNarrative>[] =
  [
    { value: "firstPerson", label: "第一人称" },
    { value: "thirdPerson", label: "第三人称" },
    { value: "multiPov", label: "多视角" },
    { value: "auto", label: "AI 根据题材推荐" },
  ]

export const OUTLINE_WIZARD_MATERIAL_OPTIONS: OutlineWizardOption<OutlineWizardMaterialSource>[] =
  [
    { value: "none", label: "没有，从零开始" },
    { value: "project", label: "读取当前项目文件" },
    { value: "pasteLater", label: "有，我稍后粘贴" },
  ]

const OUTLINE_BASE_SKILLS = [
  "outline-master-builder",
  "story-plot-seed",
  "story-selling-point",
  "story-goal-ladder",
] as const

const GENRE_SKILL_NAMES: Record<string, string> = {
  xuanhuan: "male-xuanhuan-xianxia",
  xiuxian: "male-xuanhuan-xianxia",
  xianxia: "male-xuanhuan-xianxia",
  gaowu: "male-xuanhuan-xianxia",
  dushi: "male-urban-highmartial",
  dushi_yineng: "male-urban-highmartial",
  dushi_rixiang: "male-urban-highmartial",
  dushi_naodong: "male-urban-system",
  xitongliu: "male-urban-system",
  guizeguaitan: "rule-mystery-suspense",
  xuanyi: "rule-mystery-suspense",
  xianyilingyi: "rule-mystery-suspense",
  wuxianliu: "male-infinite-sci-fi-apocalypse",
  kehuan: "male-infinite-sci-fi-apocalypse",
  moshi: "male-infinite-sci-fi-apocalypse",
  lishi: "male-history-alt-history",
  lishi_naodong: "male-history-alt-history",
  kangzhandiezhan: "male-history-alt-history",
  niandai: "male-history-alt-history",
  wenyu: "entertainment-livestream-esports",
  zhibo: "entertainment-livestream-esports",
  dianjing: "entertainment-livestream-esports",
  zhongtian: "farming-business-adventure",
  xihuan: "western-fantasy-cosmic-dark",
  kesulu: "western-fantasy-cosmic-dark",
  heian: "western-fantasy-cosmic-dark",
  huanxiangyanqing: "female-xuanhuan-fantasy",
  xianyan: "female-modern-romance",
  xianyan_naodong: "female-modern-romance",
  haomenzongcai: "female-rich-family-ceo",
  zhuiqihuozangchang: "female-chasing-wife",
  gouxueyanqing: "female-chasing-wife",
  tishenwen: "female-substitute-romance",
  guyan: "female-house-palace",
  gongdouzhaidou: "female-house-palace",
  zhichanghunlian: "female-workplace-youth-sweet",
  qingchuntianchong: "female-workplace-youth-sweet",
  nvpinxuanyi: "female-mystery-republic",
  minguoyanqing: "female-mystery-republic",
  shiqing: "family-drama-short",
  zhihuduanpian: "zhihu-short",
}

const SUPPORT_SKILLS_BY_TOPIC: Record<string, string[]> = {
  "male-xuanhuan-xianxia": ["world-rules", "power-system", "faction-system", "map-progression"],
  "female-xuanhuan-fantasy": ["relationship-emotion", "world-rules", "power-system"],
  "male-urban-highmartial": ["power-system", "map-progression", "combat-action"],
  "male-urban-system": ["idea-market-positioning", "power-system"],
  "rule-mystery-suspense": ["world-rules", "foreshadowing-suspense", "map-progression"],
  "male-infinite-sci-fi-apocalypse": ["world-rules", "foreshadowing-suspense", "map-progression"],
  "male-history-alt-history": ["idea-market-positioning", "supporting-cast"],
  "entertainment-livestream-esports": ["idea-market-positioning", "dialogue-emotion"],
  "farming-business-adventure": ["faction-system", "map-progression"],
  "western-fantasy-cosmic-dark": ["world-rules", "foreshadowing-suspense"],
  "female-modern-romance": ["relationship-emotion", "dialogue-emotion"],
  "female-rich-family-ceo": ["relationship-emotion", "dialogue-emotion"],
  "female-chasing-wife": ["relationship-emotion", "foreshadowing-suspense"],
  "female-substitute-romance": ["relationship-emotion", "foreshadowing-suspense"],
  "female-house-palace": ["faction-system", "supporting-cast"],
  "female-workplace-youth-sweet": ["relationship-emotion", "dialogue-emotion"],
  "female-mystery-republic": ["foreshadowing-suspense", "relationship-emotion"],
  "family-drama-short": ["short-form-drafting", "character-design"],
  "zhihu-short": ["short-form-drafting", "foreshadowing-suspense"],
}

const MALE_GENRES: OutlineWizardGenreOption[] = [
  { value: "dushi", label: "都市" },
  { value: "dushi_yineng", label: "都市异能" },
  { value: "dushi_rixiang", label: "都市日常" },
  { value: "dushi_naodong", label: "都市脑洞" },
  { value: "xuanhuan", label: "玄幻" },
  { value: "xiuxian", label: "修仙" },
  { value: "xianxia", label: "仙侠" },
  { value: "gaowu", label: "高武" },
  { value: "xitongliu", label: "系统流" },
  { value: "guizeguaitan", label: "规则怪谈" },
  { value: "xuanyi", label: "悬疑" },
  { value: "xianyilingyi", label: "悬疑灵异" },
  { value: "wuxianliu", label: "无限流" },
  { value: "kehuan", label: "科幻" },
  { value: "moshi", label: "末世" },
  { value: "lishi", label: "历史" },
  { value: "lishi_naodong", label: "历史脑洞" },
  { value: "wenyu", label: "文娱娱乐圈" },
  { value: "zhibo", label: "直播文" },
  { value: "dianjing", label: "电竞" },
  { value: "zhongtian", label: "种田" },
  { value: "xihuan", label: "西幻" },
  { value: "kesulu", label: "克苏鲁" },
  { value: "heian", label: "黑暗题材" },
  { value: "niandai", label: "年代" },
  { value: "kangzhandiezhan", label: "抗战谍战" },
  { value: "custom", label: "其他，由我输入" },
]

const FEMALE_GENRES: OutlineWizardGenreOption[] = [
  { value: "xianyan", label: "现言" },
  { value: "xianyan_naodong", label: "现言脑洞" },
  { value: "guyan", label: "古言" },
  { value: "huanxiangyanqing", label: "幻想言情" },
  { value: "haomenzongcai", label: "豪门总裁" },
  { value: "gongdouzhaidou", label: "宫斗宅斗" },
  { value: "gouxueyanqing", label: "狗血言情" },
  { value: "zhuiqihuozangchang", label: "追妻火葬场" },
  { value: "tishenwen", label: "替身文" },
  { value: "zhichanghunlian", label: "职场婚恋" },
  { value: "qingchuntianchong", label: "青春甜宠" },
  { value: "nvpinxuanyi", label: "女频悬疑" },
  { value: "minguoyanqing", label: "民国言情" },
  { value: "shiqing", label: "世情" },
  { value: "zhihuduanpian", label: "知乎短篇" },
  { value: "custom", label: "其他，由我输入" },
]

const AUTO_GENRES: OutlineWizardGenreOption[] = [
  { value: "auto", label: "暂不确定，让 AI 根据灵感判断" },
  ...MALE_GENRES.filter((genre) => genre.value !== "custom").slice(0, 10),
  ...FEMALE_GENRES.filter((genre) => genre.value !== "custom").slice(0, 8),
  { value: "custom", label: "其他，由我输入" },
]

function optionLabel<T extends string>(
  options: OutlineWizardOption<T>[],
  value: T,
): string {
  return options.find((option) => option.value === value)?.label ?? value
}

export function getOutlineWizardGenres(
  channel: OutlineWizardChannel,
): OutlineWizardGenreOption[] {
  if (channel === "male") return MALE_GENRES
  if (channel === "female") return FEMALE_GENRES
  return AUTO_GENRES
}

export function getOutlineWizardGenreLabel(
  request: Pick<OutlineWizardRequest, "channel" | "genre" | "customGenre">,
): string {
  if (request.genre === "custom") return request.customGenre.trim() || "其他"
  const matched = getOutlineWizardGenres(request.channel).find(
    (genre) => genre.value === request.genre,
  )
  if (matched) return matched.label
  if (request.channel === "male" || request.channel === "female") {
    return getMainGenreLabel(request.channel, request.genre)
  }
  return request.genre
}

export function getOutlineWizardValidationError(
  request: OutlineWizardRequest,
): string | null {
  if (!request.inspiration.trim()) return "请先填写故事灵感或处理要求。"
  if (request.genre === "custom" && !request.customGenre.trim()) {
    return "请选择题材或填写自定义题材。"
  }
  if (request.targets.length === 0) return "请至少选择一个生成目标。"
  return null
}

export function getOutlineWizardSkillNames(request: OutlineWizardRequest): string[] {
  const names = new Set<string>(OUTLINE_BASE_SKILLS)
  const topicSkill = GENRE_SKILL_NAMES[request.genre]

  if (topicSkill) {
    names.add(topicSkill)
    for (const skillName of SUPPORT_SKILLS_BY_TOPIC[topicSkill] ?? []) {
      names.add(skillName)
    }
  } else {
    names.add("idea-market-positioning")
    names.add("character-design")
  }

  if (request.targets.some((target) => target.includes("章纲"))) {
    names.add("outline-final-assembler")
    names.add("protagonist-plot-fit")
  }
  if (request.length === "short" || request.length === "mediumShort") {
    names.add("short-form-drafting")
  }

  return Array.from(names)
}

export function buildOutlineWizardPrompt(
  request: OutlineWizardRequest,
  options?: { mode?: "fast" | "standard" },
): string {
  const task = optionLabel(OUTLINE_WIZARD_TASK_OPTIONS, request.task)
  const length = optionLabel(OUTLINE_WIZARD_LENGTH_OPTIONS, request.length)
  const channel = optionLabel(OUTLINE_WIZARD_CHANNEL_OPTIONS, request.channel)
  const narrative = optionLabel(
    OUTLINE_WIZARD_NARRATIVE_OPTIONS,
    request.narrative,
  )
  const materialSource = optionLabel(
    OUTLINE_WIZARD_MATERIAL_OPTIONS,
    request.materialSource,
  )
  const genre = getOutlineWizardGenreLabel(request)
  const demand = [
    "用户已提交小说生成需求：",
    "",
    `- 任务：${task}`,
    `- 篇幅：${length}`,
    `- 频道：${channel}`,
    `- 题材：${genre}`,
    `- 故事灵感/处理要求：${request.inspiration.trim()}`,
    `- 核心卖点：${
      request.sellingPoints.length
        ? request.sellingPoints.join("、")
        : "AI 根据灵感推荐"
    }`,
    `- 生成目标：${request.targets.join("、")}`,
    `- 作品规模：${request.scale.trim() || "AI 根据篇幅和题材推荐"}`,
    `- 叙事要求：${narrative}`,
    `- 已有资料：${materialSource}`,
  ]

  if (options?.mode === "fast") {
    return [
      ...demand,
      "",
      "请根据以上需求直接生成可保存的大纲正文，不要进入需求分析、意图分析或多 Agent 编排，不要等待用户确认后再写。",
    ].join("\n")
  }

  const skillNames = getOutlineWizardSkillNames(request)
  return [
    ...demand,
    "",
    "## 本次优先调用 Skill",
    "请优先使用以下 SkillHub Skill 进行需求分析、题材判断和大纲生成，不要输出 Skill 说明：",
    ...skillNames.map((name, index) => `${index + 1}. ${name}`),
    "",
    "## 固定工作流",
    "请先分析该需求，判断还缺少哪些必要信息。",
    "1. 充分性闸门：先判断是否已经具备篇幅、频道、题材、故事灵感、核心卖点、作品规模、主要人物方向、世界观/背景方向、预期章节结构这些必要信息。",
    "2. 信息不足时，只追问最关键的缺失项，不要生成完整大纲，不要调用保存工具。",
    "3. 如果信息足够，请给出生成方案并询问用户是否确认开始生成。",
    "4. 方案阶段只输出生成方案、文件清单、保存位置和生成顺序；用户确认前不得生成完整文件，不得写入文件。",
    "5. 长篇小说必须先卷后章：先生成核心设定、总纲、卷节拍表、卷时间线和卷纲，再生成章纲。",
    "6. 章纲采用滚动章纲方式生成：优先生成前 10 章或用户指定范围，后续根据已确认内容继续补齐，不一次性强行铺完整本。",
    "7. 章纲生成后必须进行质量检查，检查核心事件、场景顺序、CBN/CPNs/CEN、时间承接、钩子、伏笔、人物状态、必须覆盖节点和本章禁区。",
    "8. 生成过程中新增的人物、势力、世界观规则、伏笔、地图地点和状态变化，先进入新增设定写回清单，等待用户确认后再分类保存。",
  ].join("\n")
}
