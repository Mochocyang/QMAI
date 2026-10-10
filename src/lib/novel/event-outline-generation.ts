import type { ChatMessage } from "@/lib/llm-providers"
import { streamChat } from "@/lib/llm-client"
import { isUserAbortError, throwIfAborted } from "@/lib/user-abort"
import type { LlmConfig } from "@/stores/wiki-store"
import { buildContextPack, contextPackToPrompt, SourceCanonOverflowError } from "./context-engine"
import { PersonalityConstraintError } from "./portable-personality"
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
 * 「人格规则没能完整保留」的判定。
 *
 * 为什么要靠消息文本：这句抛在 `context-engine.ts:1130`，而那是**守门文件**，
 * 不允许改动（加了专用错误类就破坏了守门检查），所以拿不到类型信息。
 * 字面量若被改写，本判定会静默失效 —— 因此有一条源码扫描测试
 * （event-outline-generation.spec.ts）直接读 context-engine.ts 断言它仍存在。
 */
const PERSONALITY_PRESERVATION_MESSAGE = "角色人格规则未完整保留"

function isPersonalityPreservationError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(PERSONALITY_PRESERVATION_MESSAGE)
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
    // hasFileTools: false —— 同 generateEventOutline：这条链路没有工具循环
    buildEventOutlinePrompt(request, { hasFileTools: false }),
  ].filter(Boolean).join("\n\n---\n\n")

  return [
    { role: "system", content: EVENT_OUTLINE_CHAPTER_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ]
}

/**
 * 供检索用的短查询。
 *
 * **刻意短**，与「把整份提示词丢进去」正好相反：`buildContextPack` 的第三个参数
 * （上游是 task）有两个身份 ——
 * 1. 它会被 `contextPackToPrompt` 渲染成「当前任务」写进资料区
 *    （context-engine.ts:1176-1177 `sections.push(pack.task)`）；
 * 2. 它同时是**检索查询**：context-engine.ts:864 `tokenizeQuery(task)`、
 *    :875 `query = queryParts.join(" ")`。
 *
 * 而完整的提示词（含 JSON 骨架、`## 输出格式`、`## 硬要求`、示例围栏）已经由
 * buildEventOutlineMessages 追加进 user 消息了。所以传整份提示词会
 * **重复注入一遍**，还会让 JSON 骨架污染实体提示与检索排序 —— 两头都亏。
 * 这里只挑真正有检索价值的词：章号、事件细纲、事件数、用户要求。
 */
function buildEventOutlineRetrievalQuery(request: EventOutlineRequest): string {
  return [
    `第${request.chapterNumber}章`,
    "事件细纲",
    `${request.eventCount} 个事件`,
    request.requirement?.trim(),
  ].filter(Boolean).join(" ")
}

/**
 * 生成一份事件细纲。
 *
 * 资料装配失败**不会**中断生成：细纲仍可按用户填的要求产出，只是失去前文一致性，
 * 这比直接报错让用户什么都没得到要好。四类例外必须原样抛出：
 *
 * 1. 用户主动取消（`isUserAbortError`）—— 否则取消会被当成「生成成功但解析失败」，
 *    卡片上出现一条莫名其妙的错误。
 * 2. `SourceCanonOverflowError` —— 正典是硬约束。本仓所有既有消费方
 *    （chat-panel 的两处、trim-context-plugin、context-hub/composer）都把它当作
 *    「停机并告知用户」，没有一处降级继续。这里若跟着吞掉，就会在预算装不下正典时
 *    产出一份**零资料**的细纲，而用户以为原作正典被遵守了 —— 比报错更糟。
 * 3. `PersonalityConstraintError` —— 人格规则与正典同级，同样是 fail-closed。
 *    两个来源都会抛它：
 *    - `buildContextPack` → `buildCharacterSoulContext`（character-aura.ts:663）
 *      在**绑定的人格规则损坏**时抛出。吞掉它 = 用户的人格绑定已经坏了，
 *      却拿到一份零上下文的细纲，而没有任何地方告诉他要先去修绑定。
 *    - `contextPackToPrompt` 侧（context-engine.ts:1129-1131）在预算装不下人格规则时
 *      抛的是**普通 Error**（「上下文预算不足，角色人格规则未完整保留。」）。
 *      既有先例 deep-chapter-generation.ts:2640 对前者就是 `throw error`，
 *      所以这里也原样抛出，只降级**文风画像**那一档
 *      （丢掉文风提示不影响细纲作为「事件列表」的可用性）。
 * 4. 流式阶段用户取消 —— 这条**不是**靠 catch 拿到的，见下面 `throwIfAborted(signal)`
 *    的注释：`streamChat` 在取消时正常调用 onDone() 后返回，不 reject。
 *    取消语义的唯一归属点在本模块；调用方不应在 result 回调里再查一次信号。
 *
 * ⚠️ 上面第 3 条的后一半只能靠**消息文本**匹配（`角色人格规则未完整保留`）：
 * `context-engine.ts` 是守门文件（不得改动），无法在里面新增专用错误类。
 * 为了防止这句话被改写后这里静默失效，`event-outline-generation.spec.ts` 里有一条
 * **源码扫描测试**，直接读 context-engine.ts 断言该字面量仍然存在。
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
      // 短查询，不是整份提示词：理由见 buildEventOutlineRetrievalQuery 的注释
      buildEventOutlineRetrievalQuery(request),
      request.chapterNumber,
    )
    materials = deps.contextPackToPrompt(pack, undefined, {
      maxContextSize: llmConfig.maxContextSize,
    })
  } catch (error) {
    if (isUserAbortError(error)) throw error
    if (error instanceof SourceCanonOverflowError) throw error
    // 人格规则与正典同级，fail-closed。两种形态都要拦：
    // - buildContextPack 侧抛的是 PersonalityConstraintError（人格绑定损坏）
    // - contextPackToPrompt 侧抛的是普通 Error（预算装不下人格规则）
    if (error instanceof PersonalityConstraintError) throw error
    if (isPersonalityPreservationError(error)) throw error
    console.warn("[事件细纲] 前文资料装配失败，改为仅按生成要求产出:", error)
  }

  let rawContent = ""
  let failure: Error | null = null
  try {
    /*
     * 进入流式之前再查一次信号。
     *
     * 取消可能发生在上面 `buildContextPack` 期间，而**那一步不吃 signal**。
     * 此时 signal 已经是 aborted 状态，而 llm-client.ts:449 是在 signal 上
     * `addEventListener("abort", …)` —— 按 DOM 规范，对**已经 aborted** 的 signal
     * 注册监听器永远不会被触发，于是 combinedSignal 不会被 abort，
     * 这次 streamChat 会**真的把请求发出去**。用户为一次已被取消的生成付费，
     * 拿回来的结果还会被下面的 throwIfAborted 丢掉。
     *
     * 修在这里而不是 llm-client.ts：那个文件在禁改清单上，
     * 而取消语义的归属点本来就是本模块。
     */
    throwIfAborted(signal)
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

  /*
   * 取消的**唯一归属点**就是这个模块，调用方不再重复判断。
   *
   * 为什么这一行是必需的：`streamChat` 在用户取消时**不 reject**，它调用 onDone()
   * 后正常返回（llm-client.ts 里两处：请求阶段 `signal?.aborted` 那支，以及读取流时
   * `isUserAbortError` 那支）。于是上面的 await 会平静地 resolve、failure 仍是 null，
   * 本函数就会继续解析一份半截内容并返回一个**看起来正常**的结果 ——
   * 调用方拿到的不是取消，而是「模型输出里没有细纲」这种误导性错误。
   *
   * 所以在这里（await 之后、解析之前）显式检查一次信号：取消一律以 USER_ABORT_MESSAGE
   * 抛出，交给调用方的 catch 统一收尾。调用方因此**不需要**在 .then 里再查一次
   * `signal.aborted` —— 两处都查会让「谁负责收尾取消」变得含糊，
   * 也容易演成两处各 remove 一次任务。
   */
  throwIfAborted(signal)

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
