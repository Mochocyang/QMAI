/**
 * 内置模型的展示元数据。
 *
 * 中转站 `GET /v1/models` 只给对外名（qmai-standard 等），没有中文名、上下文长度、
 * 擅不擅长写小说。这一层负责把对外名翻译成作者看得懂的信息，并给一个**保守**的上下文默认值。
 *
 * 注意：QMAI 的上下文下限是 204800（长篇小说写作的硬要求），
 * `normalizeUserLlmContextSize` 会把更小的值抬回 204800。所以这里直接按
 * ≥204800 声明，避免界面显示 131k、实际却按 200k 发请求的错位。
 *
 * 为什么对外名固定：上游真实模型（DeepSeek / Qwen / Kimi / GLM）由网关的路由表决定，
 * 换供应商、调价格、加降级都不用发客户端版本。客户端只需要认识这几个名字。
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

/** 与网关 model_routes 里的 public_name 一一对应。 */
const KNOWN_MODELS: Record<string, Omit<BuiltinModelMeta, "id">> = {
  "qmai-standard": {
    label: "青幕标准版",
    note: "日常正文续写，速度与质量平衡",
    contextSize: 204800,
    maxOutputTokens: 32768,
    recommended: true,
  },
  "qmai-long": {
    label: "青幕长文版",
    note: "整卷回顾、连贯性检查，适合长上下文任务",
    contextSize: 204800,
    maxOutputTokens: 32768,
    recommended: true,
  },
  "qmai-fast": {
    label: "青幕轻量版",
    note: "便宜、快，适合摘要、提取与批量改写",
    contextSize: 204800,
    maxOutputTokens: 16384,
    recommended: true,
  },
}

/** 旧网关可能残留的名字，兼容一下，避免老用户配置显示成裸 id。 */
const LEGACY_ALIASES: Record<string, keyof typeof KNOWN_MODELS> = {
  auto: "qmai-standard",
  "glm-5.3": "qmai-standard",
  "deepseek-v4-pro": "qmai-standard",
  "kimi-k3": "qmai-long",
  "glm-4.7-flash": "qmai-fast",
}

function familyDefaults(id: string): Omit<BuiltinModelMeta, "id"> | null {
  const lower = id.toLowerCase()
  if (lower.startsWith("qmai-")) {
    return { label: id, note: "青幕内置模型", contextSize: DEFAULT_CONTEXT_SIZE, maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS, recommended: false }
  }
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
  if (lower.startsWith("qwen")) {
    return { label: id, note: "通义千问系列", contextSize: 204800, maxOutputTokens: 16384, recommended: false }
  }
  return null
}

export function describeBuiltinModel(id: string): BuiltinModelMeta {
  const alias = LEGACY_ALIASES[id]
  const known = KNOWN_MODELS[id] ?? (alias ? KNOWN_MODELS[alias] : undefined)
  const meta = known ?? familyDefaults(id) ?? {
    label: id,
    note: "网关提供的模型",
    contextSize: DEFAULT_CONTEXT_SIZE,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    recommended: false,
  }
  // 无论新旧名字，展示时都以 id 为准（调用方可能拿旧 id 来问元数据）。
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
