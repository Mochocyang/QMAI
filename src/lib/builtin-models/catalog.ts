/**
 * 内置模型的展示元数据。
 *
 * 网关 `GET /v1/models` 只给模型 id，没有中文名、上下文长度、擅不擅长写小说。
 * 这一层负责把 id 翻译成作者看得懂的信息，并给一个**保守**的上下文默认值。
 *
 * 注意：QMAI 的上下文下限是 204800（长篇小说写作的硬要求），
 * `normalizeUserLlmContextSize` 会把更小的值抬回 204800。所以这里直接按
 * ≥204800 声明，避免界面显示 131k、实际却按 200k 发请求的错位。
 * 用户仍可在「大语言模型」里逐项改小/改大。
 */

export interface BuiltinModelMeta {
  id: string
  /** 展示名（作者看得懂的中文）。 */
  label: string
  /** 一句话定位。 */
  note: string
  /** 保守的上下文窗口（tokens），不低于 QMAI 的 204800 下限。 */
  contextSize: number
  /** 保守的单次输出上限（tokens）。 */
  maxOutputTokens: number
  /** 是否推荐给小说写作。只影响「推荐」标记与默认勾选。 */
  recommended: boolean
}

const DEFAULT_CONTEXT_SIZE = 204800
const DEFAULT_MAX_OUTPUT_TOKENS = 32768

/** 显式列出的常见模型；没列到的走下面的前缀推断。 */
const KNOWN_MODELS: Record<string, Omit<BuiltinModelMeta, "id">> = {
  auto: {
    label: "自动路由",
    note: "由网关自动挑模型，速度与费用不可控，不建议用来写正文",
    contextSize: DEFAULT_CONTEXT_SIZE,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    recommended: false,
  },
  "glm-5.3": {
    label: "GLM 5.3",
    note: "中文长文稳定，适合正文续写",
    contextSize: 204800,
    maxOutputTokens: 32768,
    recommended: true,
  },
  "glm-4.7": {
    label: "GLM 4.7",
    note: "性价比高的中文写作模型",
    contextSize: 204800,
    maxOutputTokens: 32768,
    recommended: true,
  },
  "glm-4.7-flash": {
    label: "GLM 4.7 Flash",
    note: "便宜、快，适合摘要与提取",
    contextSize: 204800,
    maxOutputTokens: 16384,
    recommended: true,
  },
  "glm-4.6": {
    label: "GLM 4.6",
    note: "上一代中文写作模型",
    contextSize: 204800,
    maxOutputTokens: 16384,
    recommended: false,
  },
  "deepseek-v4-pro": {
    label: "DeepSeek V4 Pro",
    note: "推理强，适合大纲与审稿",
    contextSize: 204800,
    maxOutputTokens: 32768,
    recommended: true,
  },
  "deepseek-flash": {
    label: "DeepSeek Flash",
    note: "便宜、快，适合摘要与批量提取",
    contextSize: 204800,
    maxOutputTokens: 16384,
    recommended: false,
  },
  "kimi-k3": {
    label: "Kimi K3",
    note: "超长上下文，适合整卷回顾与连贯性检查",
    contextSize: 262144,
    maxOutputTokens: 32768,
    recommended: true,
  },
  "kimi-k2.5": {
    label: "Kimi K2.5",
    note: "长上下文，适合大纲梳理",
    contextSize: 262144,
    maxOutputTokens: 16384,
    recommended: false,
  },
  "grok-4.7": {
    label: "Grok 4.7",
    note: "推理强，适合剧情推演与设定校验",
    contextSize: 204800,
    maxOutputTokens: 32768,
    recommended: true,
  },
  "grok-chat-fast": {
    label: "Grok Chat Fast",
    note: "响应快，适合对话与快速改写",
    contextSize: 204800,
    maxOutputTokens: 16384,
    recommended: true,
  },
  "grok-composer-2.5-fast": {
    label: "Grok Composer 2.5 Fast",
    note: "快速草稿",
    contextSize: 204800,
    maxOutputTokens: 16384,
    recommended: false,
  },
  "gemini-3.8-flash-high": {
    label: "Gemini 3.8 Flash High",
    note: "长上下文、快，适合资料检索与摘要",
    contextSize: 262144,
    maxOutputTokens: 32768,
    recommended: true,
  },
}

function familyDefaults(id: string): Omit<BuiltinModelMeta, "id"> | null {
  const lower = id.toLowerCase()
  if (lower.startsWith("claude")) {
    return { label: id, note: "Claude 系列，长文与对话质量稳", contextSize: 204800, maxOutputTokens: 32768, recommended: false }
  }
  if (lower.startsWith("gpt-5") || lower.startsWith("gpt-6")) {
    return { label: id, note: "OpenAI 系列", contextSize: 204800, maxOutputTokens: 32768, recommended: false }
  }
  if (lower.startsWith("gemini")) {
    return { label: id, note: "Gemini 系列，长上下文", contextSize: 262144, maxOutputTokens: 32768, recommended: false }
  }
  if (lower.startsWith("deepseek")) {
    return { label: id, note: "DeepSeek 系列", contextSize: 204800, maxOutputTokens: 32768, recommended: false }
  }
  if (lower.startsWith("glm")) {
    return { label: id, note: "智谱 GLM 系列", contextSize: 204800, maxOutputTokens: 32768, recommended: false }
  }
  if (lower.startsWith("kimi") || lower.startsWith("moonshot")) {
    return { label: id, note: "月之暗面 Kimi 系列", contextSize: 262144, maxOutputTokens: 16384, recommended: false }
  }
  if (lower.startsWith("grok")) {
    return { label: id, note: "Grok 系列", contextSize: 204800, maxOutputTokens: 32768, recommended: false }
  }
  if (lower.startsWith("qwen")) {
    return { label: id, note: "通义千问系列", contextSize: 204800, maxOutputTokens: 16384, recommended: false }
  }
  if (lower.startsWith("doubao") || lower.startsWith("seed")) {
    return { label: id, note: "豆包系列", contextSize: 204800, maxOutputTokens: 16384, recommended: false }
  }
  if (lower.startsWith("minimax")) {
    return { label: id, note: "MiniMax 系列", contextSize: 204800, maxOutputTokens: 16384, recommended: false }
  }
  return null
}

export function describeBuiltinModel(id: string): BuiltinModelMeta {
  const known = KNOWN_MODELS[id]
  const meta = known ?? familyDefaults(id) ?? {
    label: id,
    note: "网关提供的模型",
    contextSize: DEFAULT_CONTEXT_SIZE,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    recommended: false,
  }
  return { id, ...meta }
}

/** 推荐模型优先，其次按已知表顺序，最后按字母序；同 id 去重。 */
export function sortBuiltinModelIds(ids: string[]): string[] {
  const unique = [...new Set(ids)]
  const order = Object.keys(KNOWN_MODELS)
  const rank = (id: string): number => {
    const index = order.indexOf(id)
    return index === -1 ? order.length : index
  }
  return unique.sort((a, b) => {
    const metaA = describeBuiltinModel(a)
    const metaB = describeBuiltinModel(b)
    if (metaA.recommended !== metaB.recommended) return metaA.recommended ? -1 : 1
    const byRank = rank(a) - rank(b)
    if (byRank !== 0) return byRank
    return a.localeCompare(b)
  })
}

/** 默认勾选项：网关里实际存在的推荐模型；一个都没有时退回前三个。 */
export function defaultSelectedModelIds(ids: string[]): string[] {
  const recommended = ids.filter((id) => describeBuiltinModel(id).recommended)
  if (recommended.length > 0) return recommended
  return ids.slice(0, 3)
}
