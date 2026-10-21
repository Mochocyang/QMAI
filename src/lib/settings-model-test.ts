import { fetchEmbedding, getLastEmbeddingError, resetLastEmbeddingError } from "@/lib/embedding"
import { streamChat } from "@/lib/llm-client"
import { isDirectRerankEndpoint, requestDirectRerank } from "@/lib/rerank-api"
import { fetchLlmModelList } from "@/lib/settings-model-list"
import type { EmbeddingConfig, LlmConfig, RerankConfig } from "@/stores/wiki-store"

const TEST_TIMEOUT_MS = 30_000

interface LlmModelTestResult {
  model: string
  content: string
}

interface EmbeddingModelTestResult {
  model: string
  dimensions: number
}

interface RerankModelTestResult {
  model: string
  content: string
}

function ensureModel(model: string, emptyMessage: string): string {
  const trimmed = model.trim()
  if (!trimmed) {
    throw new Error(emptyMessage)
  }
  return trimmed
}

export function normalizeModelTestError(error: Error): Error {
  const message = error.message

  if (message === "Load failed" || /failed to fetch|networkerror|load failed/i.test(message)) {
    return new Error(
      "无法连接模型接口（Load failed）。若使用 Cursor CLI，请先在设置中重新检查 CLI 状态，确认 proxy 已拉起后再测。",
    )
  }

  if (/insufficient account balance/i.test(message)) {
    return new Error("当前中转站账户余额不足，或该模型没有可用额度，请先充值或切换可用模型。")
  }

  if (/client not allowed/i.test(message)) {
    return new Error("当前中转站限制了客户端来源，拒绝了桌面端、浏览器或常见 SDK 请求。请联系中转站放开通用 OpenAI 兼容 API，或切换可直连的中转站。")
  }

  const unsupportedModel = extractUnsupportedModel(message)
  if (unsupportedModel || (/HTTP 404/i.test(message) && /模型|model/i.test(message))) {
    return new Error(
      `当前接口不支持所选模型${unsupportedModel ? ` ${unsupportedModel}` : ""}。请从模型下拉框选择已拉取到的模型，或向中转站确认正确模型 ID。`,
    )
  }

  return error
}

function extractUnsupportedModel(message: string): string | null {
  const patterns = [
    /不支持所选模型\s*["“]?([^"”\s，,]+)/i,
    /unsupported(?: selected)? model\s*["']?([^"'\s,}]+)/i,
    /model\s+["']?([^"'\s,}]+)["']?\s+(?:is\s+)?(?:not found|not supported)/i,
  ]

  for (const pattern of patterns) {
    const matched = message.match(pattern)?.[1]?.trim()
    if (matched) return matched
  }
  return null
}

async function resolveChatModelConfig(config: LlmConfig): Promise<{ config: LlmConfig; model: string }> {
  const explicitModel = config.model.trim()
  if (explicitModel) {
    return { config, model: explicitModel }
  }

  if (config.provider === "claude-code" || config.provider === "codex-cli") {
    const result = await fetchLlmModelList(config)
    const model = ensureModel(
      result.models[0] ?? "",
      "请先在本地 CLI 中设置默认模型，或在软件里手动填写模型后再测试。",
    )
    return {
      config: { ...config, model },
      model,
    }
  }

  return {
    config,
    model: ensureModel(explicitModel, "请先填写模型名称后再测试。"),
  }
}

async function runChatModelTest(config: LlmConfig, prompt: string): Promise<LlmModelTestResult> {
  const resolved = await resolveChatModelConfig(config)
  let content = ""
  let streamError: Error | null = null

  await streamChat(
    resolved.config,
    [{ role: "user", content: prompt }],
    {
      onToken: (token) => {
        content += token
      },
      onDone: () => undefined,
      onError: (error) => {
        streamError = error
      },
    },
    AbortSignal.timeout(TEST_TIMEOUT_MS),
    {
      temperature: 0,
      max_tokens: 80,
    },
  )

  if (streamError) {
    throw normalizeModelTestError(streamError)
  }

  const trimmed = content.trim()
  if (!trimmed) {
    throw new Error("模型已连接，但没有返回可用内容。")
  }

  return {
    model: resolved.model,
    content: trimmed,
  }
}

function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced?.match(/\{[\s\S]*\}/)?.[0] ?? raw.match(/\{[\s\S]*\}/)?.[0]
  if (!candidate) {
    throw new Error("模型返回了内容，但不是可用的 JSON 结果。")
  }
  return candidate
}

/**
 * 常见重排模型名族。这些模型只能走直连重排接口（…/rerank），
 * 丢到 /chat/completions 上服务端只会回「模型不存在」，用户很难自己看出来。
 */
function isRerankModelName(model: string): boolean {
  return /bge[-_]rerank|qwen\d?[./_-]rerank|gte[-_]rerank|jina[-_]reranker|bce[-_]rerank|bge[-_]reranker/i.test(model)
}

function resolveRerankTestConfig(llmConfig: LlmConfig, rerankConfig: RerankConfig): {
  config: LlmConfig
  model: string
} {
  const model = ensureModel(rerankConfig.model, "请先填写重排模型名称后再测试。")
  if (/embedding/i.test(model)) {
    throw new Error("当前填写的更像是嵌入模型。重排模型需要可生成 JSON 的聊天模型，不能使用嵌入模型。")
  }
  if (!isDirectRerankEndpoint({
    provider: rerankConfig.provider,
    customEndpoint: rerankConfig.customEndpoint,
  }) && isRerankModelName(model)) {
    throw new Error(
      `当前接口地址不是直连重排接口（需以 /rerank 结尾），却在使用重排模型 ${model}。`
      + "请把接口地址填成完整的重排地址（例如 https://api.siliconflow.cn/v1/rerank），"
      + "或改用能返回 JSON 的聊天模型。",
    )
  }
  return {
    config: {
      provider: rerankConfig.provider,
      apiKey: rerankConfig.apiKey,
      model,
      ollamaUrl: rerankConfig.ollamaUrl,
      customEndpoint: rerankConfig.customEndpoint,
      apiMode: rerankConfig.provider === "custom" ? rerankConfig.apiMode : undefined,
      maxContextSize: Math.min(llmConfig.maxContextSize ?? 65_536, 65_536),
      reasoning: { mode: "off" },
    },
    model,
  }
}

export async function testSettingsLlmModel(config: LlmConfig): Promise<LlmModelTestResult> {
  return runChatModelTest(
    config,
    "你正在执行模型连通性测试。请只回答“模型测试成功”。",
  )
}

/**
 * 把 embedding 管线记下来的原始原因（HTTP 状态 + 服务端回包 / 网络错误）
 * 翻成一句能照做的下一步。原因本身保留在消息里，方便对照服务商文档。
 */
function embeddingFailureHint(message: string): string {
  // 管线里的原始原因形如「API 401 Unauthorized — {…} at …」，先按状态码判，
  // 再退回文本特征，避免被服务端回包里的任意一个 "invalid" 带偏。
  const status = Number(message.match(/(?:API|HTTP)\s(\d{3})/)?.[1] ?? 0)
  if (status === 404 || status === 405 || /not found/i.test(message)) {
    return "接口地址可能不完整：多数服务商要求填写到 /v1/embeddings（只填基础地址会 404）。"
  }
  if (status === 401 || /token is invalid|invalid api key|unauthorized/i.test(message)) {
    return "API 密钥可能无效、已过期或不是该接口签发。"
  }
  if (status === 403) {
    return "密钥没有该模型的调用权限，或被网关按来源拒绝。"
  }
  if (status === 429) {
    return "请求被限流，请稍后重试。"
  }
  if (status === 400) {
    return "模型名称可能不存在，或该接口不提供向量模型；建议先用「拉取模型」拿到准确的模型 ID。"
  }
  if (/missing .*(data\[|embeddings|output)/i.test(message)) {
    return "接口返回的不是标准向量格式，请确认接口地址指向向量接口（而不是聊天或重排接口）。"
  }
  if (/network error|load failed|failed to fetch|error sending request/i.test(message)) {
    return "网络不可达：请检查接口地址、代理与网络连通性。"
  }
  return ""
}

export async function testSettingsEmbeddingModel(config: EmbeddingConfig): Promise<EmbeddingModelTestResult> {
  const model = ensureModel(config.model, "请先填写嵌入模型名称后再测试。")
  if (!config.endpoint.trim()) {
    throw new Error("请先填写嵌入接口地址后再测试。")
  }

  // 先清掉上一次留下的原因，失败时读到的才是本次的。
  resetLastEmbeddingError()
  const vector = await fetchEmbedding(
    "这是一段用于测试嵌入模型可用性的短文本。",
    config,
    1,
  )

  if (!vector || vector.length === 0) {
    const reason = getLastEmbeddingError()
    if (!reason) {
      throw new Error("嵌入模型没有返回有效向量，请检查接口、密钥和模型名称。")
    }
    const hint = embeddingFailureHint(reason)
    throw new Error(`嵌入模型测试失败：${reason}${hint ? ` ${hint}` : ""}`)
  }

  return {
    model,
    dimensions: vector.length,
  }
}

export async function testSettingsRerankModel(
  llmConfig: LlmConfig,
  rerankConfig: RerankConfig,
): Promise<RerankModelTestResult> {
  const { config, model } = resolveRerankTestConfig(llmConfig, rerankConfig)
  if (isDirectRerankEndpoint(config)) {
    const directResults = await requestDirectRerank(
      config,
      "主角寻找关键线索",
      [
        "主角在旧仓库翻到了旧地图，并确认线索来源。",
        "配角讨论午饭吃什么，与寻找线索无关。",
      ],
      AbortSignal.timeout(TEST_TIMEOUT_MS),
    )
    if (!Array.isArray(directResults) || directResults.length === 0 || directResults[0]?.index === undefined) {
      throw new Error("重排模型已返回内容，但结果格式不正确。")
    }
    return {
      model,
      content: JSON.stringify(directResults),
    }
  }

  const result = await runChatModelTest(
    config,
    [
      "你正在执行重排模型测试。",
      "请根据查询将候选结果按相关性排序，只返回 JSON。",
      '返回格式必须是：{"order":[{"id":"a","score":1},{"id":"b","score":0.5}]}',
      "查询：主角寻找关键线索",
      "候选：",
      JSON.stringify([
        { id: "a", title: "主角在旧仓库找到线索", snippet: "主角在旧仓库翻到了旧地图，并确认线索来源。" },
        { id: "b", title: "配角午饭安排", snippet: "配角讨论午饭吃什么，与查找线索无关。" },
      ], null, 2),
    ].join("\n"),
  )

  const jsonText = extractJsonObject(result.content)
  const parsed = JSON.parse(jsonText) as { order?: Array<{ id?: string }> }
  if (!Array.isArray(parsed.order) || parsed.order.length === 0 || !parsed.order[0]?.id) {
    throw new Error("重排模型返回了内容，但结果格式不正确。")
  }

  return {
    model,
    content: result.content,
  }
}
