export type OutlineSectionGenerationKey =
  | "chapterOutlines"
  | "characterBriefs"
  | "organizationsOutline"
  | "powerSystem"
  | "goldenFinger"
  | "backgroundSetting"
  | "geographySetting"
  | "foreshadowingPlan"
  | "locationsOutline"

export type OutlineOutputMode = "per_chapter" | "per_item" | "single"

export interface OutlineSectionGenerationConfig {
  key: OutlineSectionGenerationKey
  title: string
  englishTitle: string
  englishFileName: string
  requestHint: string
  outputMode: OutlineOutputMode
}

export const OUTLINE_SECTION_GENERATION_CONFIGS: OutlineSectionGenerationConfig[] = [
  {
    key: "chapterOutlines",
    title: "章节细纲",
    englishTitle: "Chapter Outlines",
    englishFileName: "chapter-outlines.md",
    requestHint: "根据已有总纲、分卷大纲与章节推进需要，生成或完善章节细纲，明确每章目标、冲突、转折和结尾钩子。",
    outputMode: "per_chapter",
  },
  {
    key: "characterBriefs",
    title: "人物小传",
    englishTitle: "Character Briefs",
    englishFileName: "character-briefs.md",
    requestHint: "根据已有大纲和项目记忆，整理主要人物的小传、动机、弧线、关系网络与当前状态。",
    outputMode: "per_item",
  },
  {
    key: "organizationsOutline",
    title: "组织势力设定",
    englishTitle: "Faction Notes",
    englishFileName: "organizations.md",
    requestHint: "根据已有大纲和项目记忆，补完组织、势力、阵营目标、关系、冲突与剧情作用。",
    outputMode: "per_item",
  },
  {
    key: "powerSystem",
    title: "力量体系",
    englishTitle: "Power System",
    englishFileName: "power-system.md",
    requestHint: "根据已有大纲和项目记忆，整理力量体系、等级规则、修炼路径、限制、代价与剧情作用。",
    outputMode: "per_item",
  },
  {
    key: "goldenFinger",
    title: "金手指设定",
    englishTitle: "Golden Finger",
    englishFileName: "golden-finger.md",
    requestHint: "根据已有大纲和项目记忆，整理金手指/系统/外挂的规则、触发条件、成长路径、限制与剧情作用。",
    outputMode: "per_item",
  },
  {
    key: "backgroundSetting",
    title: "背景设定",
    englishTitle: "Background Setting",
    englishFileName: "background-setting.md",
    requestHint: "根据已有大纲和项目记忆，整理世界观背景、时代风貌、文化习俗、历史沿革与核心设定规则。",
    outputMode: "single",
  },
  {
    key: "geographySetting",
    title: "地理设定",
    englishTitle: "Geography Setting",
    englishFileName: "geography-setting.md",
    requestHint: "根据已有大纲和项目记忆，整理地理区域划分、重要地点、地域特色、势力分布地图。",
    outputMode: "per_item",
  },
  {
    key: "foreshadowingPlan",
    title: "伏笔计划",
    englishTitle: "Foreshadowing Plan",
    englishFileName: "foreshadowing-plan.md",
    requestHint: "根据已有大纲和项目记忆，整理伏笔的埋设、推进、回收节奏与对应章节节点。",
    outputMode: "per_item",
  },
  {
    key: "locationsOutline",
    title: "地点设定",
    englishTitle: "Location Notes",
    englishFileName: "locations.md",
    requestHint: "根据已有大纲和项目记忆，整理重要地点、地点规则、所属势力与剧情作用。",
    outputMode: "per_item",
  },
]
