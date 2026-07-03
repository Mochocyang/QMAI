import type { PostWriteCheck, PostWriteCheckItem } from "../context-trace"
import type { ContextPack } from "@/lib/novel/context-engine"
import type { LlmConfig } from "@/stores/wiki-store"
import { streamChat } from "@/lib/llm-client"
import { resolveNovelModel, type NovelTaskType } from "@/lib/novel/model-resolver"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { runPostWriteCheck } from "./post-write-check-plugin"
import { useWikiStore } from "@/stores/wiki-store"

export interface PostWriteCheckAIResult {
  check: PostWriteCheck
  source: "ai" | "rule"
  fallbackReason?: string
}

const AI_CHECK_NAMES = [
  "剧情承接",
  "主线推进",
  "人物动机",
  "冲突强度",
  "伏笔处理",
  "节奏",
  "风格一致性",
] as const

const AI_TIMEOUT_MS = 30_000

const VALID_SEVERITIES = ["info", "warning", "error"] as const

function buildPostWriteCheckPrompt(chapterContent: string, contextPack?: ContextPack): string {
  const truncated = chapterContent.length > 8000
    ? chapterContent.slice(0, 8000) + "\n\n[正文已截断]"
    : chapterContent
  const chapterGoal = contextPack?.chapterGoal || "未提供"
  const previousEnding = contextPack?.previousChapterEnding || "未提供"
  const namesStr = AI_CHECK_NAMES.join("、")
  return [
    "## 章节正文",
    truncated,
    "",
    "## 上下文",
    `本章目标：${chapterGoal}`,
    `上一章结尾：${previousEnding}`,
    "",
    "## 任务",
    `对上述章节正文做 ${AI_CHECK_NAMES.length} 维度剧情自检，只输出 JSON，不要额外解释。`,
    "输出格式：",
    `{"items":[{"name":"${AI_CHECK_NAMES[0]}","passed":true,"detail":"详情","severity":"info","evidence":"证据","suggestion":"建议"},...]}`,
    "severity 取值：info（通过）、warning（轻微问题）、error（严重问题）。",
    `必须包含 ${AI_CHECK_NAMES.length} 项：${namesStr}。`,
  ].join("\n")
}

function parseAIResponse(text: string): PostWriteCheckItem[] | null {
  try {
    const trimmed = text.trim()
    const start = trimmed.indexOf("{")
    const end = trimmed.lastIndexOf("}")
    if (start === -1 || end === -1) return null
    const jsonStr = trimmed.slice(start, end + 1)
    const parsed = JSON.parse(jsonStr) as { items: PostWriteCheckItem[] }
    if (!Array.isArray(parsed.items)) return null
    if (parsed.items.length !== AI_CHECK_NAMES.length) return null

    const validItems: PostWriteCheckItem[] = []
    for (let i = 0; i < parsed.items.length; i++) {
      const item = parsed.items[i]
      const expectedName = AI_CHECK_NAMES[i]

      if (typeof item.name !== "string" || item.name !== expectedName) return null
      if (typeof item.passed !== "boolean") return null
      if (typeof item.detail !== "string") return null
      if (item.severity !== undefined && !VALID_SEVERITIES.includes(item.severity as any)) return null
      if (item.evidence !== undefined && typeof item.evidence !== "string") return null
      if (item.suggestion !== undefined && typeof item.suggestion !== "string") return null

      validItems.push({
        name: item.name,
        passed: item.passed,
        detail: item.detail,
        severity: item.severity,
        evidence: item.evidence,
        suggestion: item.suggestion,
      })
    }
    return validItems
  } catch {
    return null
  }
}

export async function runPostWriteCheckAI(params: {
  chapterContent: string
  contextPack?: ContextPack
  llmConfig?: LlmConfig
  signal?: AbortSignal
}): Promise<PostWriteCheckAIResult> {
  const { chapterContent, contextPack, llmConfig, signal } = params

  if (!chapterContent || chapterContent.trim().length === 0) {
    return {
      check: runPostWriteCheck(chapterContent),
      source: "rule",
      fallbackReason: "章节内容为空",
    }
  }

  const { providerConfigs, novelConfig } = useWikiStore.getState()
  const baseConfig: LlmConfig = llmConfig ?? ({} as LlmConfig)

  if (!hasUsableLlm(baseConfig, providerConfigs)) {
    return {
      check: runPostWriteCheck(chapterContent),
      source: "rule",
      fallbackReason: "未配置可用模型",
    }
  }

  const taskType: NovelTaskType = "review"
  const resolvedConfig = resolveNovelModel(baseConfig, novelConfig, taskType)

  const timeoutSignal = AbortSignal.timeout(AI_TIMEOUT_MS)
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal

  try {
    let responseText = ""
    let streamError: Error | null = null
    await streamChat(
      resolvedConfig,
      [
        { role: "system", content: "你是小说剧情自检助手，只输出 JSON，不要额外解释。" },
        { role: "user", content: buildPostWriteCheckPrompt(chapterContent, contextPack) },
      ],
      {
        onToken: (chunk: string) => {
          responseText += chunk
        },
        onDone: () => {},
        onError: (err: Error) => {
          streamError = err
        },
      },
      combinedSignal,
    )

    if (streamError) {
      throw streamError
    }

    const items = parseAIResponse(responseText)
    if (!items) {
      const isTimeout = combinedSignal.aborted
      return {
        check: runPostWriteCheck(chapterContent),
        source: "rule",
        fallbackReason: isTimeout ? "AI 推理超时" : "AI 返回格式无法解析",
      }
    }

    const passedCount = items.filter((i) => i.passed).length
    const totalCount = items.length
    const check: PostWriteCheck = {
      items,
      passedCount,
      totalCount,
      allPassed: passedCount === totalCount,
    }
    return { check, source: "ai" }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isTimeout = message.includes("aborted") || message.includes("timeout") || message.includes("超时")
    return {
      check: runPostWriteCheck(chapterContent),
      source: "rule",
      fallbackReason: isTimeout ? "AI 推理超时" : `AI 调用失败：${message}`,
    }
  }
}
