export interface NextStepRecommendationItem {
  id: string
  label: string
  reason: string
}

export interface NextStepRecommendation {
  completedModule: string
  completedScope: string
  recommendations: NextStepRecommendationItem[]
}

const NEXT_STEP_PATTERN = /<!--\s*next_step\s*-->([\s\S]*?)<!--\s*\/next_step\s*-->/i

const FORBIDDEN_PATTERNS = [
  /生成.*正文/,
  /写.*正文/,
  /生成.*章节内容/,
  /生成.*正文章节/,
  /章节正文/,
  /写正文/,
  /生成正文/,
]

export function isRecommendationForbidden(label: string): boolean {
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(label))
}

export function parseNextStep(text: string): NextStepRecommendation | null {
  const match = text.match(NEXT_STEP_PATTERN)
  if (!match) return null

  let payload: unknown
  try {
    payload = JSON.parse(match[1].trim())
  } catch {
    return null
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null

  const raw = payload as Record<string, unknown>

  const recommendations: NextStepRecommendationItem[] = Array.isArray(raw.recommendations)
    ? raw.recommendations
        .filter((item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item))
        .map((item) => ({
          id: String(item.id ?? ""),
          label: String(item.label ?? ""),
          reason: String(item.reason ?? ""),
        }))
        .filter((item) => item.id && item.label)
        .filter((item) => !isRecommendationForbidden(item.label))
    : []

  return {
    completedModule: String(raw.completedModule ?? ""),
    completedScope: String(raw.completedScope ?? ""),
    recommendations,
  }
}

export function buildNextStepPromptSuffix(): string {
  return [
    "",
    "## 下一步推荐输出要求",
    "生成完成后，在回复末尾附加 <!-- next_step --> 标记块，按 JSON 输出。",
    "字段：completedModule、completedScope、recommendations(数组，每项含 id、label、reason)。",
    "推荐方向仅限大纲体系内：人物小传、组织势力设定、力量体系、金手指设定、背景设定、地理设定、伏笔计划、地点设定、章节细纲。",
    "严禁推荐「生成章节正文」「写正文」等正文生成类操作。",
    "推荐应由 AI 根据刚生成内容中提及但尚未建立的关联项动态推断。",
    "必须包含一个 id 为 D 的「自定义」选项。",
  ].join("\n")
}
