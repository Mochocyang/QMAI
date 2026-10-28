/**
 * `impl: "prompt"` 的钩子实现：把模板里的 `{{text}}` 换成原文，用当前模型再跑一次，
 * 返回新文本（设计 D5：让 80% 的钩子保持零代码）。
 *
 * 这一层刻意很薄：插值复用 `declarative/interpolate.ts`，模型调用复用
 * `declarative/run.ts` 的 `LlmCaller`。二者都已被声明式动作验证过（未知变量不炸、
 * 流式增量、真中止），这里再写一套"钩子专用插值/调用"只会得到第二份行为略有差异
 * 的实现 —— 那种差异永远只会在线上被发现。
 *
 * `{{text}}` 的取值按事件决定（见 `resolveHookText`）：请求前是最后一条 user 消息，
 * 响应后是 `context.response.text`，工作流事件是章节正文。
 */
import { collectVariables, interpolate } from "../declarative/interpolate"
import type {
  HookContext,
  HookDeps,
  HookLlmPayload,
  HookPatch,
  HookResult,
  PluginHookView,
} from "./types"
import { isObserverEvent } from "./types"

/**
 * 固定的 system 提示词。
 *
 * 为什么写死而不是让作者配：这是**接线**而不是**创作**。作者要表达的是"怎么改"，
 * 模板负责那件事；若 system 也交给作者，他们一定会写出"你是世界上最棒的编辑，
 * 请思考三步后输出 Markdown 代码块"，而宿主会在 `patch.response.text` 里得到一段
 * 带围栏、带解释的文本，然后把它当成正文写回章节。固定的 system 是这条链路唯一的
 * "输出就是文本本身"的保证。
 */
export const PROMPT_HOOK_SYSTEM = "你是一个文本后处理器，只输出处理后的文本，不要解释。"

/** 钩子配置/上下文有误时抛的错误（信息可直接展示给插件作者）。 */
export class HookPromptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "HookPromptError"
  }
}

/** 最后一条 user 消息的正文（没有就返回 undefined）。 */
function lastUserMessage(messages: HookLlmPayload["messages"] | undefined): string | undefined {
  if (!Array.isArray(messages)) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === "user" && typeof message.content === "string") return message.content
  }
  return undefined
}

/**
 * 钩子要处理的"原文"。
 *
 * 按事件取值而不是"谁有就取谁"，是因为同一份上下文里可能同时有章节正文与上游消息
 * （例如 `beforeChapterDraft` 在带模型的流水线里）。让取值顺序随字段存在性漂移，
 * 同一个插件在不同的调用点就会处理到不同的文本 —— 那是作者完全无法调试的行为。
 *
 * 返回 `undefined` 表示"这个事件没有可处理的文本"，由调用方报可读错误。
 */
export function resolveHookText(context: HookContext): string | undefined {
  switch (context.event) {
    case "beforeLlmRequest":
      return (
        lastUserMessage(context.llm?.messages) ??
        context.response?.text ??
        context.chapter?.text
      )
    case "afterLlmResponse":
      return context.response?.text ?? context.chapter?.text
    default:
      // 工作流事件：钩子要处理的就是章节正文；其次是响应文本（after* 组）。
      return context.chapter?.text ?? context.response?.text ?? lastUserMessage(context.llm?.messages)
  }
}

/** 把 messages 里最后一条 user 换成 `text`，其余原样保留（返回新数组，不改入参）。 */
export function replaceLastUserMessage(
  messages: ReadonlyArray<{ role: string; content: string }>,
  text: string,
): Array<{ role: string; content: string }> {
  const next = messages.map((message) => ({ role: message.role, content: message.content }))
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index].role === "user") {
      next[index] = { role: "user", content: text }
      return next
    }
  }
  // 没有 user 消息的请求是不成立的（模型没有可回答的东西）；补一条也比改写 system 诚实。
  next.push({ role: "user", content: text })
  return next
}

/**
 * 处理后的文本该写回哪里。
 *
 * 规则只有两条，够用且可预测：
 *   - `beforeLlmRequest` 且上下文真的有 `llm` → 替换最后一条 user 消息；
 *   - 其余事件 → 写 `patch.response.text`。
 *
 * `response` 虽然是 HookPatch 里声明过的字段，但工作流事件（`beforeChapterDraft` 等）
 * 的上下文**没有** `response` —— 宿主在那些接缝里通过 `outcome.context.response?.text`
 * 读取改写结果并把正文换掉。把它做成"总是写 response"，是为了让两类事件返回同一种
 * patch 形状，接缝代码不必按事件分支。
 *
 * process 实现（`dispatcher.ts` 内）用的是同一个函数：两种实现产出文本的语义一致，
 * 用户换 `impl` 时上下文行为不会变。
 */
export function buildHookTextPatch(context: HookContext, text: string): HookPatch {
  if (context.event === "beforeLlmRequest" && context.llm) {
    return { llm: { messages: replaceLastUserMessage(context.llm.messages, text) } }
  }
  return { response: { text } }
}

/**
 * 执行一个声明式钩子。
 *
 * @param signal 由调度器为**这一个钩子**建的中止信号（超时即 abort）。
 *               必须一路传到 `deps.llm.call` —— 设计 D6：超时要**真取消**，
 *               只在前端"不再等待"、请求仍在跑，等于边停止边计费。
 * @throws HookPromptError 模板缺 `{{text}}`、事件没有可处理文本、模型返回空文本
 *                         （调度器会把它记成 failures，按 gate 与否决定是否阻断）。
 */
export async function runPromptHook(
  hook: PluginHookView["hook"],
  pluginId: string,
  context: HookContext,
  deps: HookDeps,
  signal: AbortSignal,
): Promise<HookResult> {
  const warn = deps.onWarn ?? ((message: string) => console.warn(message))

  if (isObserverEvent(context.event)) {
    // 观测事件的结果一律被丢弃（见 OBSERVER_EVENTS 的注释）。如果允许它继续往下跑，
    // 我们会为一个**不会被使用**的结果付一次真实的模型调用 —— 没有任何产出的账单。
    throw new HookPromptError(
      `观测事件 ${context.event} 不支持 prompt 实现：结果不会被使用，请改用 process 实现或删掉这个钩子。`,
    )
  }

  const template = typeof hook?.template === "string" ? hook.template : ""
  if (template.trim() === "") {
    throw new HookPromptError("钩子缺少 template：impl 为 prompt 时必须提供提示词模板。")
  }

  const variables = collectVariables(template)
  if (!variables.includes("text")) {
    /*
     * 为什么是硬错误而不是"那就处理整段"：`{{text}}` 是作者唯一能指定"处理哪段原文"的
     * 手段。缺了它，模板跑出来的结果是固定的（例如"请总结一下"），把它当作改写结果
     * 写回正文会直接毁掉内容。宁可让这个钩子失败并显示在人话错误里。
     * 注意 `\{{text}}` 是转义写法，`collectVariables` 已排除，所以也会走到这里。
     */
    throw new HookPromptError("钩子模板必须包含 {{text}}：否则宿主不知道要处理哪段原文。")
  }

  const source = resolveHookText(context)
  if (source === undefined) {
    throw new HookPromptError(
      `事件 ${context.event} 的上下文里没有可处理的原文（缺少 response.text / 用户消息 / 章节正文）。`,
    )
  }

  // 只有模板真的用到 `config.*` 才读配置：少一次 IPC，也少一分"插件随手读配置"的面。
  let config: Record<string, unknown> | undefined
  if (variables.some((name) => name.startsWith("config."))) {
    try {
      config = await deps.getConfig(pluginId)
    } catch (cause) {
      // 读不到配置不打断：模板里的 `{{config.x}}` 会被插成空串，模型仍能给出结果，
      // 而"没填配置"最常见的后果只是效果差一点。原因进 warn 供作者排查。
      warn(`[plugins] 读取插件 ${pluginId} 的配置失败，钩子模板里的 config.* 将为空：${String(cause)}`)
    }
  }

  const scope = {
    fields: { text: source },
    ...(config ? { config } : {}),
    ...(context.project ? { project: context.project } : {}),
    ...(context.chapter
      ? { chapter: { title: context.chapter.title, text: context.chapter.text } }
      : {}),
  }

  const interpolated = interpolate(template, scope)
  if (interpolated.missing.length > 0) {
    // 未知变量不抛错（沿用声明式动作的规则），但要让作者知道模板里有空变量 ——
    // 否则"我明明写了 {{project.bookTags}}，为什么没生效"永远无解。
    warn(
      `[plugins] 插件 ${pluginId} 的钩子模板引用了拿不到的变量：${interpolated.missing.join("、")}（已按空串处理）`,
    )
  }

  if (signal.aborted) throw new HookPromptError("钩子已取消，未发起模型调用。")

  const result = await deps.llm.call(
    { system: PROMPT_HOOK_SYSTEM, user: interpolated.text },
    () => {
      // 钩子是"等结果"而不是"看过程"：流式增量在这里没有消费者。
      // 丢弃增量不等于不能真取消 —— 中止仍经 signal 到达底层 fetch。
    },
    signal,
  )

  const text = typeof result?.text === "string" ? result.text : ""
  if (text.trim() === "") {
    // 空文本绝不能被当作有效改写：`patch.response.text = ""` 会把章节正文清空，
    // 而用户看到的只是"AI 把这一章写没了"。宁可让这个钩子失败（fail-open 用原文继续）。
    throw new HookPromptError("钩子返回了空结果：不把空文本当作有效改写。")
  }

  return { patch: buildHookTextPatch(context, text) }
}
