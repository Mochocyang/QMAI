import type { ChatMessage } from "@/lib/llm-providers"
import { streamChat } from "@/lib/llm-client"
import { isUserAbortError } from "@/lib/user-abort"
import type { LlmConfig } from "@/stores/wiki-store"
import { buildContextPack, contextPackToPrompt, SourceCanonOverflowError } from "./context-engine"
import {
  buildEventOutlinePrompt,
  extractEventOutlineData,
  type EventOutlineData,
  type EventOutlineRequest,
} from "./event-outline"

/**
 * 章节区直连的事件细纲生成。
 *
 * 为什么需要它：大纲对话那条链路是**带工具**的 agent（模型自己调 list_chapters /
 * read_chapter 取前文），而章节区没有工具循环。所以这里把「前文资料」改成
 * 生成前一次性装配好塞进提示词，模型只需要读、不需要取。
 *
 * 与大纲对话的差别仅在取资料的方式；产出的细纲结构完全一致
 * （同一个 extractEventOutlineData、同一个 EventOutlineCard）。
 */
export const EVENT_OUTLINE_CHAPTER_SYSTEM_PROMPT = [
  "你是小说创作助手，负责把一章拆成前后连续的若干事件，产出「事件细纲」。",
  "本章需要的资料已经全部随消息给出，你没有读取文件的工具，",
  "因此不要尝试调用任何工具，也不要输出工具调用说明或分析过程。",
  "直接输出细纲正文与 json 围栏即可，不要寒暄、不要复述要求。",
].join("\n")

export interface EventOutlineGenerationCallbacks {
  /** 流式增量。仅用于进度提示，正文由本模块自行累积。 */
  onToken?: (content: string, receivedChars: number) => void
}

export interface EventOutlineGenerationResult {
  /** 解析成功的事件细纲；失败时为 null。 */
  outline: EventOutlineData | null
  /** 模型这次回复的完整文本。解析失败时把前若干字回给用户看，便于判断是模型跑偏还是格式问题。 */
  rawContent: string
  /** 失败原因；成功时为 null。 */
  error: string | null
}

export interface EventOutlineGenerationDeps {
  streamChat: typeof streamChat
  buildContextPack: typeof buildContextPack
  contextPackToPrompt: typeof contextPackToPrompt
}

const defaultDeps: EventOutlineGenerationDeps = {
  streamChat,
  buildContextPack,
  contextPackToPrompt,
}

/**
 * 把「资料 + 生成要求」拼成一次对话。
 *
 * 资料在前、要求在后的顺序是刻意的：要求里带了输出格式与硬约束，
 * 贴着用户消息末尾对模型的约束力最强，也不容易被长资料冲淡。
 */
export function buildEventOutlineMessages(
  materials: string,
  request: EventOutlineRequest,
): ChatMessage[] {
  const materialBlock = materials.trim()
  const userContent = [
    materialBlock
      ? `以下是本章相关的既有资料（大纲、前情、设定等），请据此保持与前文一致：\n\n${materialBlock}`
      : "",
    buildEventOutlinePrompt(request),
  ].filter(Boolean).join("\n\n---\n\n")

  return [
    { role: "system", content: EVENT_OUTLINE_CHAPTER_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ]
}

/**
 * 生成一份事件细纲。
 *
 * 资料装配失败**不会**中断生成：细纲仍可按用户填的要求产出，只是失去前文一致性，
 * 这比直接报错让用户什么都没得到要好。两处例外必须原样抛出：
 *
 * 1. 用户主动取消（`isUserAbortError`）—— 否则取消会被当成「生成成功但解析失败」，
 *    卡片上出现一条莫名其妙的错误。
 * 2. `SourceCanonOverflowError` —— 正典是硬约束。本仓所有既有消费方
 *    （chat-panel 的两处、trim-context-plugin、context-hub/composer）都把它当作
 *    「停机并告知用户」，没有一处降级继续。这里若跟着吞掉，就会在预算装不下正典时
 *    产出一份**零资料**的细纲，而用户以为原作正典被遵守了 —— 比报错更糟。
 *    文风画像那条溢出（contextPackToPrompt 的另一个 throw）则仍然降级：
 *    对细纲而言丢掉文风提示不影响它作为「事件列表」的可用性。
 */
export async function generateEventOutline(
  projectPath: string,
  request: EventOutlineRequest,
  llmConfig: LlmConfig,
  callbacks: EventOutlineGenerationCallbacks = {},
  signal?: AbortSignal,
  deps: EventOutlineGenerationDeps = defaultDeps,
): Promise<EventOutlineGenerationResult> {
  let materials = ""
  try {
    const pack = await deps.buildContextPack(
      projectPath,
      buildEventOutlinePrompt(request),
      request.chapterNumber,
    )
    materials = deps.contextPackToPrompt(pack, undefined, {
      maxContextSize: llmConfig.maxContextSize,
    })
  } catch (error) {
    if (isUserAbortError(error)) throw error
    if (error instanceof SourceCanonOverflowError) throw error
    console.warn("[事件细纲] 前文资料装配失败，改为仅按生成要求产出:", error)
  }

  let rawContent = ""
  let failure: Error | null = null
  try {
    await deps.streamChat(
      llmConfig,
      buildEventOutlineMessages(materials, request),
      {
        onToken: (token) => {
          rawContent += token
          callbacks.onToken?.(token, rawContent.length)
        },
        onDone: () => {},
        onError: (error) => {
          failure = error
        },
      },
      signal,
    )
  } catch (error) {
    if (isUserAbortError(error)) throw error
    failure = error instanceof Error ? error : new Error(String(error))
  }

  if (failure) {
    if (isUserAbortError(failure)) throw failure
    return { outline: null, rawContent, error: failure.message }
  }

  const outline = extractEventOutlineData(rawContent, request.requirement)
  if (!outline) {
    return {
      outline: null,
      rawContent,
      error: rawContent.trim()
        ? "模型回复里没有找到可解析的事件细纲 JSON，请重试或换一个模型。"
        : "模型没有返回任何内容，请重试或检查模型配置。",
    }
  }
  return { outline, rawContent, error: null }
}
