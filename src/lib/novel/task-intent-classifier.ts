/**
 * 一次便宜的结构化意图分类。
 *
 * 复用主链路的 streamChat（与写作实体判定、大纲意图分析同一条模型栈），
 * 不另起 HTTP 客户端。失败时返回 null，由 routeTask 降级，不再回退到关键词打分。
 */

import { hasUsableLlm } from "@/lib/has-usable-llm"
import { streamChat, type ChatMessage, type StreamCallbacks } from "@/lib/llm-client"
import type { RequestOverrides } from "@/lib/llm-providers"
import { parseLlmJsonObject } from "@/lib/novel/book-analysis/llm-json"
import { resolveModelConfig } from "@/lib/novel/model-resolver"
import { withReasoningDisabled } from "@/lib/reasoning-retry"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"

const CLASSIFIER_INPUT_CAP = 4000
const CLASSIFIER_MAX_TOKENS = 80

export const TASK_INTENT_CLASSIFIER_SYSTEM = [
  "你是小说写作任务意图分类器。只输出一个 JSON 对象，不要解释，不要使用 Markdown。",
  '格式：{"intent":"<意图>","confidence":0到1之间的小数}',
  "confidence 是你对这次判断的把握，由你估计，不要套固定公式。",
  "intent 只能是下面之一：",
  "write_chapter（写新章节）",
  "continue_chapter（续写章节）",
  "rewrite_chapter（改写章节）",
  "polish_chapter（润色章节）",
  "review_chapter（审稿）",
  "lint_chapter（连贯性检查）",
  "generate_outline（生成大纲）",
  "search_plot（在本书内检索剧情，不是公网搜索）",
  "extract_memory（章节摄取）",
  "character_query（查询本书人物）",
  "foreshadowing_query（查询本书伏笔）",
  "timeline_query（查询本书时间线）",
  "setting_query（查询本书设定）",
  "general_chat（与本书任务无关的闲聊）",
  "story_framework_generate（故事框架生成）",
  "multi_agent_simulate（多智能体推演）",
  "character_interview（角色采访）",
  "scenario_simulate（舞台情景）",
  "判断规则：",
  "- 换一种说法的写作、续写、改写、润色、审稿，仍选对应写作意图，不要因为措辞不在常见词表里就判成 general_chat。",
  "- 查本书伏笔、人物、设定、时间线、剧情是对应的 query 或 search_plot。这些是库内问题，不是公网搜索。",
  "- 消息里出现「搜索」「最新」「查一下」不能单独决定意图。",
  "- 只有与当前小说任务无关的闲聊才是 general_chat。",
  "- 不要输出章节号；章节号由程序另行解析。",
].join("\n")

export interface TaskIntentClassification {
  intent: string
  confidence: number
}

type StreamChatFn = (
  config: LlmConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  requestOverrides?: RequestOverrides,
) => Promise<void>

export interface ClassifyTaskIntentInput {
  userInput: string
  llmConfig?: LlmConfig
  signal?: AbortSignal
  streamChat?: StreamChatFn
}

export function parseTaskIntentClassification(raw: string): TaskIntentClassification | null {
  const record = parseLlmJsonObject(raw)
  if (!record) return null
  const intent = String(record.intent ?? "").trim()
  if (!intent) return null
  const confidence = typeof record.confidence === "number"
    ? record.confidence
    : Number(record.confidence)
  if (!Number.isFinite(confidence)) return null
  return { intent, confidence }
}

export async function classifyTaskIntent(
  input: ClassifyTaskIntentInput,
): Promise<TaskIntentClassification | null> {
  const text = input.userInput.trim()
  if (!text) return null

  const llmConfig = resolveClassifierConfig(input.llmConfig)
  if (!llmConfig) return null

  try {
    const raw = await completeClassifierText(
      input.streamChat ?? streamChat,
      llmConfig,
      [
        { role: "system", content: TASK_INTENT_CLASSIFIER_SYSTEM },
        { role: "user", content: text.slice(0, CLASSIFIER_INPUT_CAP) },
      ],
      input.signal,
    )
    return parseTaskIntentClassification(raw)
  } catch {
    return null
  }
}

function resolveClassifierConfig(explicit?: LlmConfig): LlmConfig | null {
  const state = useWikiStore.getState()
  const providerConfigs = state.providerConfigs ?? {}
  if (explicit) return hasUsableLlm(explicit, providerConfigs) ? explicit : null

  const target = typeof state.aiChatModel === "string" ? state.aiChatModel.trim() : ""
  const resolved = target
    ? resolveModelConfig(target, state.llmConfig, providerConfigs)
    : state.llmConfig
  return hasUsableLlm(resolved, providerConfigs) ? resolved : null
}

async function completeClassifierText(
  stream: StreamChatFn,
  llmConfig: LlmConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  let result = ""
  const failures: Error[] = []
  await stream(
    llmConfig,
    messages,
    {
      onToken: (token) => { result += token },
      onDone: () => {},
      onError: (error) => { failures.push(error) },
    },
    signal,
    withReasoningDisabled({
      max_tokens: CLASSIFIER_MAX_TOKENS,
      temperature: 0,
      toolChoice: "none",
      skipUserMemory: true,
    }),
  )
  const text = result.trim()
  if (!text && failures.length > 0) throw failures[0]
  return text
}
