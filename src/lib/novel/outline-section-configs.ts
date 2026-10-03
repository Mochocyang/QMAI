type OutlineSectionGenerationKey =
  | "volumeOutline"
  | "chapterOutlines"
  | "characterBriefs"
  | "organizationsOutline"
  | "powerSystem"
  | "goldenFinger"
  | "backgroundSetting"
  | "geographySetting"
  | "foreshadowingPlan"
  | "locationsOutline"

type OutlineOutputMode = "per_chapter" | "per_item" | "single"

interface OutlineSectionGenerationConfig {
  key: OutlineSectionGenerationKey
  title: string
  englishTitle: string
  englishFileName: string
  requestHint: string
  outputMode: OutlineOutputMode
}

export const OUTLINE_SECTION_GENERATION_CONFIGS: OutlineSectionGenerationConfig[] = [
  {
    key: "volumeOutline",
    title: "卷纲",
    englishTitle: "Volume Outline",
    englishFileName: "volume-outline.md",
    requestHint: "根据已有总纲、人物小传与设定，按「卷纲折叠树」结构生成卷纲：1 卷 = 10 个小故事 = 1 个大高潮，每故事固定 10 环节（起3+承3+转2+合2），遵循 8 类期待感、7 类反转库、8 种情绪结构、10 种叙事结构选用纪律、三层线与 12 章排布；产出 MD 正文与 volumeOutlineData 结构化数据（每故事 link、每环节 pay，顶层 position/roles/foreshadows/cast/escalation/debts/rivals/growth/places），由软件套模板渲染折叠树 HTML（含卷级定位、整卷账本、期待感曲线、节拍体检、各类台账面板，保存时可选择 HTML/MD 格式）。若存在多卷，先明确当前要生成哪一卷（默认第 1 卷）。",
    outputMode: "single",
  },
  {
    key: "chapterOutlines",
    title: "章节细纲",
    englishTitle: "Chapter Outlines",
    englishFileName: "chapter-outlines.md",
    requestHint: "把选定的故事（10–12 章）拆成逐章可执行的章纲：每章必须写满 17 节标准（基础信息 / 上章承接 / 本章定位 / 浓缩剧情 / 核心事件链（≥6 条有因果）/ 关键词与必要条件 / 四段式 / 情绪曲线 / 爽点与看点 / 关键信息扩写 / 画面细节 / 伏笔与钩子 / 角色状态变化 / 设定增量 / 写作约束 / 下一章交接 / 写作检查清单），并补齐对齐字段（所属环节、章内节拍、主期待感、时间、地点、预埋与回收的伏笔）；节拍、章号、环节必须与卷纲骨架逐字一致。产出 MD 正文与 chapterOutlineData 结构化数据，由软件套模板渲染卡片流 HTML（保存时可选择 HTML/MD 格式）。若存在多卷多故事，先明确当前要拆哪一个故事（默认第一个未完成的故事）。",
    outputMode: "single",
  },
  {
    key: "characterBriefs",
    title: "人物小传",
    englishTitle: "Character Briefs",
    englishFileName: "character-briefs.md",
    requestHint: "根据已有大纲和项目记忆，整理主要人物的小传、动机、弧线、关系网络与当前状态；产出 MD 正文与配套的结构化数据（软件据此渲染同名 HTML 卡，保存时可选择 HTML/MD 格式），你无需自己写 HTML。",
    outputMode: "per_item",
  },
  {
    key: "organizationsOutline",
    title: "组织势力设定",
    englishTitle: "Faction Notes",
    englishFileName: "organizations.md",
    requestHint: "根据已有大纲和项目记忆，补完组织、势力、阵营目标、关系、冲突与剧情作用；产出 MD 正文与配套的结构化数据（软件据此渲染同名 HTML 卡，保存时可选择 HTML/MD 格式），你无需自己写 HTML。",
    outputMode: "per_item",
  },
  {
    key: "powerSystem",
    title: "力量体系",
    englishTitle: "Power System",
    englishFileName: "power-system.md",
    requestHint: "根据已有大纲和项目记忆，整理力量体系、等级规则、修炼路径、限制、代价与剧情作用；产出 MD 正文与配套的结构化数据（软件据此渲染同名 HTML 卡，保存时可选择 HTML/MD 格式），你无需自己写 HTML。",
    outputMode: "per_item",
  },
  {
    key: "goldenFinger",
    title: "金手指设定",
    englishTitle: "Golden Finger",
    englishFileName: "golden-finger.md",
    requestHint: "根据已有大纲和项目记忆，整理金手指/系统/外挂的规则、触发条件、成长路径、限制与剧情作用；产出 MD 正文与配套的结构化数据（软件据此渲染同名 HTML 卡，保存时可选择 HTML/MD 格式），你无需自己写 HTML。",
    outputMode: "per_item",
  },
  {
    key: "backgroundSetting",
    title: "背景设定",
    englishTitle: "Background Setting",
    englishFileName: "background-setting.md",
    requestHint: "根据已有大纲和项目记忆，整理世界观背景、时代风貌、文化习俗、历史沿革与核心设定规则；产出 MD 正文与配套的结构化数据（软件据此渲染同名 HTML 卡，保存时可选择 HTML/MD 格式），你无需自己写 HTML。",
    outputMode: "single",
  },
  {
    key: "geographySetting",
    title: "地理设定",
    englishTitle: "Geography Setting",
    englishFileName: "geography-setting.md",
    requestHint: "根据已有大纲和项目记忆，整理地理区域划分、重要地点、地域特色、势力分布地图；产出 MD 正文与配套的结构化数据（软件据此渲染同名 HTML 卡，保存时可选择 HTML/MD 格式），你无需自己写 HTML。",
    outputMode: "per_item",
  },
  {
    key: "foreshadowingPlan",
    title: "伏笔计划",
    englishTitle: "Foreshadowing Plan",
    englishFileName: "foreshadowing-plan.md",
    requestHint: "根据已有大纲和项目记忆，整理伏笔的埋设、推进、回收节奏与对应章节节点；产出 MD 正文与配套的结构化数据（软件据此渲染同名 HTML 卡，保存时可选择 HTML/MD 格式），你无需自己写 HTML。",
    outputMode: "per_item",
  },
  {
    key: "locationsOutline",
    title: "地点设定",
    englishTitle: "Location Notes",
    englishFileName: "locations.md",
    requestHint: "根据已有大纲和项目记忆，整理重要地点、地点规则、所属势力与剧情作用；产出 MD 正文与配套的结构化数据（软件据此渲染同名 HTML 卡，保存时可选择 HTML/MD 格式），你无需自己写 HTML。",
    outputMode: "per_item",
  },
]
