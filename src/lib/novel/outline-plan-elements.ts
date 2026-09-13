import { OUTLINE_SECTION_GENERATION_CONFIGS } from "./outline-section-configs"
import {
  CHAPTER_END_HOOK_TYPES,
  CHAPTER_HOOK_TYPES,
  CHAPTER_POSITION_TYPES,
  VOLUME_OUTLINE_REQUIRED_FIELDS,
} from "./outline-templates"
import {
  OUTLINE_WIZARD_CHANNEL_OPTIONS,
  OUTLINE_WIZARD_LENGTH_OPTIONS,
  OUTLINE_WIZARD_NARRATIVE_OPTIONS,
  OUTLINE_WIZARD_SELLING_POINTS,
  getOutlineWizardGenres,
} from "./outline-wizard"

/** 计划模式的要素规格；清单全部由现有大纲结构常量派生，不新造第二套 schema。 */
export interface OutlinePlanElementSpec {
  key: string
  label: string
  hint: string
  required: boolean
  /** 追问兜底选项，至少 3 个，保证代码生成的问题也满足「每问 ≥3 选项」。 */
  fallbackOptions: string[]
}

export type OutlinePlanModuleKind = "story" | "volume" | "chapter" | "section"

/** 任何要素都能用的通用兜底选项。 */
const GENERIC_FALLBACK_OPTIONS = [
  "沿用项目里已有的设定",
  "由 AI 根据已读取资料推断",
  "我来补充具体描述",
]

const STORY_MODULE_PATTERN = /新书|完整新书规划|故事大纲|总纲|全书/
const VOLUME_MODULE_PATTERN = /卷纲|分卷大纲|卷节拍/
const CHAPTER_MODULE_PATTERN = /章纲|章节细纲|章节大纲|细纲|章节规划/

/** 判断模块属于哪一类大纲结构，决定要素清单来源。 */
export function resolveOutlinePlanModuleKind(module: string): OutlinePlanModuleKind {
  const text = module.trim()
  if (CHAPTER_MODULE_PATTERN.test(text)) return "chapter"
  if (VOLUME_MODULE_PATTERN.test(text)) return "volume"
  if (STORY_MODULE_PATTERN.test(text)) return "story"
  return "section"
}

/** 新书/总纲要素：对齐 outline-wizard.ts 固定工作流里的充分性闸门九项。 */
function getStoryElements(): OutlinePlanElementSpec[] {
  return [
    {
      key: "length",
      label: "篇幅",
      hint: "长篇、中短篇还是短篇，决定卷章规模。",
      required: true,
      fallbackOptions: OUTLINE_WIZARD_LENGTH_OPTIONS.map((option) => option.label),
    },
    {
      key: "channel",
      label: "频道",
      hint: "男频还是女频，决定爽点结构和读者预期。",
      required: true,
      fallbackOptions: OUTLINE_WIZARD_CHANNEL_OPTIONS.map((option) => option.label),
    },
    {
      key: "genre",
      label: "题材",
      hint: "具体题材标签，决定套路模型和可调用 Skill。",
      required: true,
      fallbackOptions: getOutlineWizardGenres("auto")
        .filter((genre) => genre.value !== "custom")
        .slice(0, 6)
        .map((genre) => genre.label),
    },
    {
      key: "inspiration",
      label: "故事灵感",
      hint: "一句话核心创意或处理要求，是整本书的起点。",
      required: true,
      fallbackOptions: [
        "延续项目里已有的灵感设定",
        "由 AI 根据题材推荐一个灵感方向",
        "我来补充具体灵感",
      ],
    },
    {
      key: "sellingPoints",
      label: "核心卖点",
      hint: "主打的爽点类型，决定情绪节奏和兑现节点。",
      required: true,
      fallbackOptions: [...OUTLINE_WIZARD_SELLING_POINTS],
    },
    {
      key: "scale",
      label: "作品规模",
      hint: "预计总字数与卷数，决定阶段目标拆分粒度。",
      required: true,
      fallbackOptions: ["100 万字以上长篇", "50-100 万字中长篇", "30 万字以内"],
    },
    {
      key: "characterDirection",
      label: "主要人物方向",
      hint: "主角身份处境与关键配角阵容方向。",
      required: true,
      fallbackOptions: [
        "沿用项目已有的主要人物",
        "由 AI 按题材推荐人物阵容",
        "我来补充人物方向",
      ],
    },
    {
      key: "worldview",
      label: "世界观/背景方向",
      hint: "时代背景、核心规则与力量体系的大方向。",
      required: true,
      fallbackOptions: [
        "沿用项目已有的世界观设定",
        "由 AI 按题材推荐世界观框架",
        "我来补充世界观方向",
      ],
    },
    {
      key: "chapterStructure",
      label: "预期章节结构",
      hint: "分几卷、每卷多少章、首批要生成到哪里。",
      required: true,
      fallbackOptions: [
        "单卷推进，先规划前 20 章",
        "多卷结构，每卷 20-30 章",
        "由 AI 推荐卷章结构",
      ],
    },
  ]
}

/** 卷纲要素：直接由 VOLUME_OUTLINE_REQUIRED_FIELDS 派生，外加卷范围。 */
function getVolumeElements(): OutlinePlanElementSpec[] {
  const scopeElement: OutlinePlanElementSpec = {
    key: "volumeScope",
    label: "卷范围",
    hint: "第几卷、覆盖哪些章节区间。",
    required: true,
    fallbackOptions: [
      "紧接最新已确认卷纲的下一卷",
      "重做当前正在写的这一卷",
      "我来指定卷号和章节区间",
    ],
  }
  const fieldElements = VOLUME_OUTLINE_REQUIRED_FIELDS.map((field) => ({
    key: `volume:${field}`,
    label: field,
    hint: `卷纲必填项「${field}」的方向要求。`,
    required: true,
    fallbackOptions: GENERIC_FALLBACK_OPTIONS,
  }))
  return [scopeElement, ...fieldElements]
}

/** 章纲要素：取 CHAPTER_OUTLINE_REQUIRED_SECTIONS 各节所需的上游输入。 */
function getChapterElements(): OutlinePlanElementSpec[] {
  return [
    {
      key: "chapterRange",
      label: "章节范围",
      hint: "要生成哪些章的章纲，滚动章纲一次不超过 10 章。",
      required: true,
      fallbackOptions: [
        "接着最新已确认章纲往后 1 章",
        "接着往后 5 章",
        "接着往后 10 章",
      ],
    },
    {
      key: "upstreamBasis",
      label: "上层依据",
      hint: "对应「上层依据」节：总纲目标、卷纲目标、阶段节奏与前后章承接。",
      required: true,
      fallbackOptions: GENERIC_FALLBACK_OPTIONS,
    },
    {
      key: "chapterGoal",
      label: "本章目标",
      hint: "对应「本章目标」节：剧情、人物、情绪、信息释放和结尾效果。",
      required: true,
      fallbackOptions: GENERIC_FALLBACK_OPTIONS,
    },
    {
      key: "coreEventDirection",
      label: "核心事件方向",
      hint: "对应「核心事件」节，不少于 6 条事件的推进方向。",
      required: true,
      fallbackOptions: GENERIC_FALLBACK_OPTIONS,
    },
    {
      key: "sceneCount",
      label: "场景数",
      hint: "对应「场景顺序」节，标准结构为 2-4 个场景。",
      required: true,
      fallbackOptions: ["2 个场景", "3 个场景", "4 个场景"],
    },
    {
      key: "openingHookType",
      label: "章首钩子类型",
      hint: "对应「章首钩子」节，从章首钩子枚举中选择。",
      required: true,
      fallbackOptions: [...CHAPTER_HOOK_TYPES].slice(0, 4),
    },
    {
      key: "endingHookType",
      label: "章尾钩子类型",
      hint: "对应「章尾钩子」节，从章尾钩子枚举中选择。",
      required: true,
      fallbackOptions: [...CHAPTER_END_HOOK_TYPES].slice(0, 4),
    },
    {
      key: "foreshadowingState",
      label: "伏笔状态",
      hint: "对应「伏笔与追踪」节：本章投放、回收还是延后。",
      required: true,
      fallbackOptions: [
        "本章不新增伏笔，只推进已有伏笔",
        "本章埋设新伏笔",
        "本章回收已有伏笔",
      ],
    },
    {
      key: "wordCountTarget",
      label: "字数目标",
      hint: "对应「基础信息」节的字数目标。",
      required: true,
      fallbackOptions: ["2000 字", "3000 字", "4000 字"],
    },
    {
      key: "pov",
      label: "视角",
      hint: "对应「基础信息」节的视角设定。",
      required: true,
      fallbackOptions: OUTLINE_WIZARD_NARRATIVE_OPTIONS.map((option) => option.label),
    },
    {
      key: "timeAnchor",
      label: "时间锚点",
      hint: "对应「基础信息」节：时间锚点、章内时间跨度与上章时间差。",
      required: true,
      fallbackOptions: [
        "紧接上一章，无时间跳跃",
        "上一章之后数小时",
        "上一章之后数天",
      ],
    },
    {
      key: "chapterPosition",
      label: "章节定位",
      hint: "对应「基础信息」节的章节定位标签。",
      required: false,
      fallbackOptions: [...CHAPTER_POSITION_TYPES].slice(0, 4),
    },
  ]
}

/** 其余分项模块要素：由 OUTLINE_SECTION_GENERATION_CONFIGS 的 requestHint 与 outputMode 派生。 */
function getSectionElements(module: string): OutlinePlanElementSpec[] {
  const config = OUTLINE_SECTION_GENERATION_CONFIGS.find(
    (item) => item.title === module.trim() || module.includes(item.title),
  )
  const scopeHint = config?.outputMode === "per_item"
    ? "要覆盖哪些条目：全部缺失项、指定几项，还是最近范围。"
    : "要覆盖的范围：整本、当前卷，还是指定部分。"
  return [
    {
      key: "generationScope",
      label: "生成范围",
      hint: scopeHint,
      required: true,
      fallbackOptions: [
        "全部缺失项一次补齐",
        "只补最近范围内用得到的部分",
        "我来指定具体条目",
      ],
    },
    {
      key: "existingBaseline",
      label: "已有内容与缺口",
      hint: "项目里已经写好的部分，以及确认缺失的部分。",
      required: true,
      fallbackOptions: GENERIC_FALLBACK_OPTIONS,
    },
    {
      key: "moduleRequirement",
      label: "本模块内容要求",
      hint: config?.requestHint ?? `该模块「${module.trim() || "大纲"}」需要覆盖的具体内容要求。`,
      required: true,
      fallbackOptions: GENERIC_FALLBACK_OPTIONS,
    },
    {
      key: "storyConstraints",
      label: "上层约束",
      hint: "总纲、卷纲和设定里必须遵守的既有约束。",
      required: true,
      fallbackOptions: GENERIC_FALLBACK_OPTIONS,
    },
    ...(config?.outputMode === "per_item"
      ? [{
        key: "itemPriority",
        label: "条目优先级",
        hint: "先生成哪些条目，每条写到多细。",
        required: false,
        fallbackOptions: [
          "先做剧情用得最多的几条",
          "按已有大纲出场顺序推进",
          "我来指定优先级",
        ],
      }]
      : []),
  ]
}

/** 取某个大纲模块在计划模式下必须盘点的要素清单。 */
export function getOutlinePlanRequiredElements(module: string): OutlinePlanElementSpec[] {
  switch (resolveOutlinePlanModuleKind(module)) {
    case "story":
      return getStoryElements()
    case "volume":
      return getVolumeElements()
    case "chapter":
      return getChapterElements()
    default:
      return getSectionElements(module)
  }
}

/** 按 key 找要素规格，供协议校验生成兜底追问时使用。 */
export function findOutlinePlanElementSpec(
  specs: OutlinePlanElementSpec[],
  key: string,
): OutlinePlanElementSpec | undefined {
  const normalized = key.trim()
  return specs.find((spec) => spec.key === normalized || spec.label === normalized)
}
