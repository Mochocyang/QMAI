import { describe, expect, it } from "vitest"
import type { ChatMessage } from "@/lib/llm-providers"
import { selectContextHistoryMessages } from "@/lib/context-hub/session-summary"
import { trimChatMessagesToTokenBudget } from "@/lib/chat-request-budget"
import { composeContext } from "@/lib/context-hub/composer"
import { buildContextHubPromptParts, withContextHubTaskContent } from "@/lib/context-hub/prompt-content"
import { buildFoldedChapterPointer, isFoldableChapterBody } from "@/lib/context-hub/chapter-body-injection"
import { contextPackToPrompt, type ContextPack } from "@/lib/novel/context-engine"
import { buildStableContextPrefix, CHAPTER_SYSTEM_PROMPT } from "@/lib/novel/deep-chapter-prompts"

/**
 * 缓存前缀诊断 v2：量出"本轮有多少输入能被上一轮缓存覆盖"。
 *
 * 口径：按 provider 实际看到的顺序把消息序列化成一条串（纯文本块数组会被
 * OpenAI/DeepSeek 线折叠，见 llm-providers.ts:518），
 * **命中率上限 = 公共前缀长度 / 本轮请求总长**（分母是本轮）。
 *
 * 尺寸取真实量级：system ≈ 12k 字、工具块 ≈ 3k 字、历史每条约 1.5k 字、
 * 动态资料（本轮资料 + 会话摘要）≈ 6k 字。
 * 全部使用真实实现，不复刻逻辑。
 */

const SEP_MESSAGE = "\u0002"
const SEP_FIELD = "\u0001"

function numbered(prefix: string, count: number, width = 40): string {
  const lines: string[] = []
  for (let index = 0; index < count; index += 1) {
    lines.push(`${prefix}第${String(index).padStart(3, "0")}行 ` + "内".repeat(width))
  }
  return lines.join("\n")
}

const SYSTEM = "## 软件规则\n你是专业小说写作助手，所有面向用户的回复必须使用中文。\n" + numbered("规则", 90) +
  "\n\n## 项目稳定核心\n### 作品灵魂\n" + numbered("魂", 40) +
  "\n### 硬性世界规则\n" + numbered("世", 40)

const TOOLS = JSON.stringify([
  { name: "read_chapter", description: "读取章节", parameters: { type: "object" } },
  { name: "read_outline", description: "读取大纲", parameters: { type: "object" } },
  { name: "read_memory", description: "读取记忆", parameters: { type: "object" } },
  { name: "run_chapter_workflow", description: "生成章节正文", parameters: { type: "object" } },
]) + numbered("工具描述", 30)

function flatten(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content
  return content.map((block) => block.type === "text" ? block.text : "<image>").join("")
}

function wire(messages: readonly ChatMessage[], toolsJson = ""): string {
  const body = messages
    .map((message) => `${message.role}${SEP_FIELD}${flatten(message.content)}`)
    .join(SEP_MESSAGE)
  return `${toolsJson}\u0003${body}`
}

function sharedLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  let index = 0
  while (index < limit && a[index] === b[index]) index += 1
  return index
}

function breakContext(a: string, b: string, index: number): string {
  return `断点@${index}：上轮尾部[…${JSON.stringify(a.slice(Math.max(0, index - 16), index))}] ` +
    `本轮此处起[${JSON.stringify(b.slice(index, index + 16))}]`
}

function measure(
  name: string,
  previous: ChatMessage[],
  next: ChatMessage[],
  tools: [string, string] = [TOOLS, TOOLS],
): { hitRate: number; shared: number; total: number } {
  const prevWire = wire(previous, tools[0])
  const nextWire = wire(next, tools[1])
  const shared = sharedLength(prevWire, nextWire)
  const hitRate = shared / nextWire.length
  // eslint-disable-next-line no-console
  console.log(
    `[probe] ${name}\n` +
    `        本轮 ${nextWire.length} 字 → 命中 ${shared}（${(hitRate * 100).toFixed(1)}%），未命中 ${nextWire.length - shared}\n` +
    `        ${breakContext(prevWire, nextWire, shared)}`,
  )
  return { hitRate, shared, total: nextWire.length }
}

const user = (text: string): ChatMessage => ({ role: "user", content: text })
const assistant = (text: string): ChatMessage => ({ role: "assistant", content: text })

/** 模拟 chat-panel 的尾部注入：本轮资料 + 执行要求都塞进当前 user 消息。 */
function injectedUser(rawText: string, materials: string, rules: string): ChatMessage {
  const blocks = withContextHubTaskContent(rawText, [
    { type: "text", text: materials },
    { type: "text", text: `## 本轮执行要求\n${rules}` },
  ])
  return { role: "user", content: blocks }
}

const MATERIALS_TURN_N = "## 当前会话摘要\n绪论：主角在雨夜接头，身份暴露。\n\n## 本轮参考资料\n" + numbered("伏笔线索", 40)
const MATERIALS_TURN_N1 = "## 当前会话摘要\n绪论：主角雨夜接头后转移据点，配角开始怀疑。\n\n## 本轮参考资料\n" + numbered("伏笔线索", 40)

describe("缓存前缀诊断 v2", () => {
  it("S1 理想基线：发送态 = 存储态，历史只追加", () => {
    const turn1: ChatMessage[] = [{ role: "system", content: SYSTEM }, user("写第一章" + numbered("要", 30))]
    const turn2: ChatMessage[] = [...turn1, assistant(numbered("正文", 40)), user("继续写第二章" + numbered("要", 30))]
    const { hitRate } = measure("S1 append-only（理想形态）", turn1, turn2)
    // 结构不变量：上一轮整条请求都是本轮的前缀。命中率本身随会话变长而单调上升，
    // 短会话（本轮新增 3.4k / 总量 15k）只有 77%，不能拿固定阈值卡死。
    expect(hitRate).toBeGreaterThan(0.7)
  })

  it("S2 旧布局（资料注入 user 尾部）：下一轮回放未注入原文，前缀在此断开", () => {
    const history: ChatMessage[] = [
      user("第一轮原始输入"), assistant(numbered("第一轮正文", 40)),
    ]
    const turnN: ChatMessage[] = [
      { role: "system", content: SYSTEM },
      ...history,
      injectedUser("写第三章" + numbered("要", 30), MATERIALS_TURN_N, "必须调用 run_chapter_workflow"),
    ]
    // 下一轮的 history 来自会话库：存的是原始文本，不是发送时注入后的文本
    const turnN1: ChatMessage[] = [
      { role: "system", content: SYSTEM },
      ...history,
      user("写第三章" + numbered("要", 30)),           // ← 存储态（无资料注入）
      assistant(numbered("第三章正文", 40)),
      injectedUser("继续写第四章" + numbered("要", 30), MATERIALS_TURN_N1, "必须调用 run_chapter_workflow"),
    ]
    const { hitRate } = measure("S2 发送态≠存储态（chat-panel 尾部注入）", turnN, turnN1)
    // 结构事实：注入把资料放在原始输入之前，所以"存储态原文"不是"发送态"的前缀，
    // 下一轮回放原文时前缀必然在此断开。命中率数字见上方日志（现状基线）。
    expect(flatten(turnN[turnN.length - 1]!.content).startsWith("写第三章")).toBe(false)
    expect(hitRate).toBeGreaterThan(0)
  })

  it("S2b 新布局（资料前移成独立消息）：第二轮可完整命中", () => {
    const parts = buildContextHubPromptParts("软件规则", {
      stableCore: "稳定核心",
      sessionSummary: "会话摘要 N",
      dynamicContext: "## 本轮参考资料\n" + numbered("伏笔", 40),
    } as never, ["## 本轮执行要求\n必须调用工具"])
    const history: ChatMessage[] = [user("第一轮原始输入"), assistant(numbered("第一轮正文", 40))]
    const turn1: ChatMessage[] = [
      { role: "system", content: parts.systemContent },
      { role: "user", content: parts.chapterPrefix },
      ...history,
      { role: "user", content: withContextHubTaskContent("写第三章", parts.taskContext) },
    ]
    const turn2: ChatMessage[] = [
      { role: "system", content: parts.systemContent },
      { role: "user", content: parts.chapterPrefix },
      ...history,
      { role: "user", content: "写第三章" },
      assistant(numbered("第三章正文", 40)),
      { role: "user", content: withContextHubTaskContent("继续写第四章", parts.taskContext) },
    ]
    const { hitRate } = measure("S2b 资料前移后的新布局", turn1, turn2)
    // 结构不变量：资料块与 system 逐字节相同 → 前缀至少覆盖 system + 资料 + 历史
    expect(hitRate).toBeGreaterThan(0.55)
  })

  it("S3 超预算裁剪：连续 3 轮，每轮起点都被重算", () => {
    const sys: ChatMessage = { role: "system", content: SYSTEM }
    const raw: ChatMessage[] = [sys,
      user("甲" + numbered("甲", 30)), assistant(numbered("乙", 30)),
      user("丙" + numbered("丙", 30)), assistant(numbered("丁", 30)),
    ]
    const t1 = trimChatMessagesToTokenBudget([...raw, user("追问一" + numbered("追", 30))], 13000)
    const t2 = trimChatMessagesToTokenBudget([...t1, assistant(numbered("戊", 30)), user("追问二" + numbered("追", 30))], 13000)
    const t3 = trimChatMessagesToTokenBudget([...t2, assistant(numbered("己", 30)), user("追问三" + numbered("追", 30))], 13000)
    const r1 = measure("S3-a 第1→2轮", t1, t2)
    const r2 = measure("S3-b 第2→3轮", t2, t3)
    // eslint-disable-next-line no-console
    console.log(`[probe] S3 裁剪链路：${(r1.hitRate * 100).toFixed(1)}% → ${(r2.hitRate * 100).toFixed(1)}%`)
    expect(r1.hitRate).toBeLessThan(0.95)
  })

  it("S4 任务契约写本轮输入：断点落在 system 块末尾", () => {
    const contract = (goal: string) => `## 任务契约\n初始任务目标：${goal.slice(0, 1800)}`
    const turn1: ChatMessage[] = [
      { role: "system", content: SYSTEM },
      { role: "system", content: contract("写第一章，主角雨夜接头") },
      user("写第一章，主角雨夜接头"),
    ]
    const turn2: ChatMessage[] = [
      { role: "system", content: SYSTEM },
      { role: "system", content: contract("继续写第二章，配角叛变") },
      ...turn1.slice(2),
      assistant(numbered("正文", 40)),
      user("继续写第二章，配角叛变"),
    ]
    const { hitRate } = measure("S4 任务契约含本轮输入（runner.ts:88）", turn1, turn2)
    // 结构事实：契约文本本身逐轮不同，且位于 system 块末尾 →
    // 它之后的一切（全部历史）都吃不到缓存。命中率数字见上方日志。
    expect(contract("写第一章，主角雨夜接头")).not.toBe(contract("继续写第二章，配角叛变"))
    expect(hitRate).toBeGreaterThan(0)
  })

  it("S5 stableCore 比例截断：前段 +40 行，后面各段截断位平移", () => {
    const pack = (canonRules: string): ContextPack => ({
      soulDoc: numbered("魂", 30),
      storyFrameworkBinding: numbered("架", 30),
      sourceCanon: "",
      canonRules,
      relatedSettings: numbered("设", 60),
      writingStyle: numbered("风", 60),
      outline: numbered("纲", 90),
      projectOutline: numbered("纲", 90),
      task: "写第 3 章",
      chapterGoal: "", chapterOutlineContext: "", relevantMaterials: "", mustDo: "", mustAvoid: "",
      sectionBriefing: "", previousChapterEnding: "", characterStates: "", foreshadowingStates: "",
      recentSummaries: [], revisionDirectives: "", timeline: "", cognitionStates: "",
      characterAuras: "", nextChapterAdvice: "", searchResults: "", graphSearchResults: "",
      recentChapterContents: [],
    } as unknown as ContextPack)
    const stamp = { fingerprint: "f", kinds: ["setting"], sourceCount: 1 } as never
    const build = (input: ContextPack) => composeContext({
      contextPack: input,
      dependencyStamp: stamp,
      maxContextSize: 8000,
    }).stableCore

    const before = build(pack(numbered("规", 27)))
    const after = build(pack(numbered("规", 28))) // 世界规则多一行
    const ratio = sharedLength(before, after) / after.length
    // eslint-disable-next-line no-console
    console.log(
      `[probe] S5 比例截断（fitFragmentsProportionally）\n` +
      `        stableCore ${before.length} → ${after.length} 字，公共前缀比 ${(ratio * 100).toFixed(1)}%\n` +
      `        ${breakContext(before, after, sharedLength(before, after))}`,
    )
    // 结构事实：stableCore 的截断位依赖"按剩余预算平均分配"，前段一变后段整体平移。
    // 数字见上方日志（现状约 44%），修复目标是让每个片段各占固定配额、互不影响。
    expect(before.length).toBeGreaterThan(0)
    expect(ratio).toBeLessThan(0.98)
  })

  it("S9 跨章前缀：作品大纲前置 + 章纲下沉 vs 旧写法（合并大纲在最前）", () => {
    const lines = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) => `${prefix}第${index}行 ` + "内".repeat(30)).join("\n")
    const base = {
      soulDoc: "### 作品灵魂\n" + lines("魂", 30),
      storyFrameworkBinding: "### 框架\n" + lines("架", 20),
      canonRules: "### 硬性世界规则\n" + lines("规", 40),
      relatedSettings: "### 核心设定\n" + lines("设", 40),
      writingStyle: "### 写作风格\n" + lines("风", 30),
      sourceCanon: "",
      projectOutline: "# 作品大纲\n" + lines("纲", 120),
      recentSummaries: [],
      recentChapterContents: [],
      personaSkills: "",
      characterAuras: "",
      cognitionStates: "",
      timeline: "",
      searchResults: "",
      graphSearchResults: "",
      revisionDirectives: "",
    }
    const chapterBits = (chapter: number) => ({
      task: `写第${chapter}章`,
      chapterGoal: `第${chapter}章目标：` + lines("目", 5),
      sectionBriefing: `第${chapter}章简报：` + lines("简", 5),
      mustDo: `第${chapter}章必须做到`,
      mustAvoid: `第${chapter}章必须避免`,
      nextChapterAdvice: `第${chapter}章之后建议`,
      chapterOutlineContext: `# 第${chapter}章章纲\n` + lines("章", 20),
      previousChapterEnding: `第${chapter - 1}章结尾：` + lines("尾", 5),
      characterStates: `第${chapter}章人物状态：` + lines("态", 8),
      foreshadowingStates: `第${chapter}章伏笔：` + lines("伏", 8),
    })

    // 旧写法：mergedOutline（作品+卷+章）整体放在最前，章纲随章变 → 断点紧跟在后
    const legacyPrompt = (chapter: number) => {
      const merged = base.projectOutline + "\n\n# 卷纲（第三章至第五章）\n" + lines("卷", 10) +
        "\n\n" + chapterBits(chapter).chapterOutlineContext
      const pack = { ...base, ...chapterBits(chapter), outline: merged } as unknown as ContextPack
      return "# 【强制遵守】作品完整大纲\n" + merged + "\n上下文：\n" +
        contextPackToPrompt(pack, 14000, { excludeOutline: true })
    }
    // 新写法：作品大纲在前；章纲走 chapterOutlineContext，排在稳定字段之后
    const currentPrompt = (chapter: number) => {
      const pack = { ...base, ...chapterBits(chapter), outline: base.projectOutline } as unknown as ContextPack
      return "# 【强制遵守】作品完整大纲\n" + base.projectOutline + "\n上下文：\n" +
        contextPackToPrompt(pack, 14000, { excludeOutline: true })
    }

    const legacy = [legacyPrompt(19), legacyPrompt(20)] as const
    const current = [currentPrompt(19), currentPrompt(20)] as const
    const legacyShared = sharedLength(legacy[0], legacy[1]) / legacy[1].length
    const currentShared = sharedLength(current[0], current[1]) / current[1].length
    // eslint-disable-next-line no-console
    console.log(
      `[probe] S9 跨章公共前缀：旧写法 ${(legacyShared * 100).toFixed(1)}% → 新写法 ${(currentShared * 100).toFixed(1)}%\n` +
      `        旧断点 ${breakContext(legacy[0], legacy[1], sharedLength(legacy[0], legacy[1]))}\n` +
      `        新断点 ${breakContext(current[0], current[1], sharedLength(current[0], current[1]))}`,
    )
    // 新写法下，作品大纲与作品级稳定字段都必须落在公共前缀里
    expect(current[0].indexOf("作品灵魂")).toBeLessThan(current[0].indexOf("本章章纲"))
    expect(currentShared).toBeGreaterThan(legacyShared + 0.3)
  })

  it("S10 章节 system 必须由写作与审稿**成对**携带，否则第 0 字节就错位", () => {
    const outline = "# 【强制遵守】作品完整大纲\n" + numbered("纲", 150)
    const context = "## 小说上下文包\n" + numbered("设", 200)
    const prefix = buildStableContextPrefix(outline, context)
    const system = CHAPTER_SYSTEM_PROMPT

    const frame = (withSystem: boolean, tail: string): ChatMessage[] => [
      ...(withSystem ? [{ role: "system" as const, content: system }] : []),
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: prefix, cacheControl: true },
          { type: "text" as const, text: tail },
        ],
      },
    ]

    const draft = frame(true, "\n\n你是专业小说正文写作助手。请起草章节正文。")
    const reviewPaired = frame(true, "\n\n你是专业小说审稿编辑。请逐维度审查。")
    const reviewUnpaired = frame(false, "\n\n你是专业小说审稿编辑。请逐维度审查。")

    // 章节链路不带工具块，传空串以免默认 TOOLS 的共同前缀被算进"命中"。
    const paired = measure("S10 写作→审稿（两边都带同一份 system）", draft, reviewPaired, ["", ""])
    const unpaired = measure("S10 写作→审稿（只有写作带 system）", draft, reviewUnpaired, ["", ""])

    // 成对携带：system + 前缀整段命中，只剩审稿文案全价。
    expect(paired.hitRate).toBeGreaterThan(0.9)
    // 不成对：第 0 个字节分别是 `system` / `user`，前缀直接归零。
    expect(unpaired.hitRate).toBeLessThan(0.05)
  })

  it("S6 正文折叠：入库 + 摘要各改一次字节", () => {
    const chapterBody = "第一章正文：" + numbered("文", 60)
    expect(isFoldableChapterBody(chapterBody)).toBe(true)
    const pointerNoSummary = buildFoldedChapterPointer({
      chapterNumber: 1, relativePath: "wiki/chapters/chapter-001.md", originalChars: chapterBody.length,
    })
    const pointerWithSummary = buildFoldedChapterPointer({
      chapterNumber: 1, relativePath: "wiki/chapters/chapter-001.md", originalChars: chapterBody.length,
      summary: "主角在雨夜接头，身份暴露。",
    })
    // eslint-disable-next-line no-console
    console.log(
      `[probe] S6 折叠\n        原文 ${chapterBody.length} 字 → 指针 ${pointerNoSummary.length} 字 → 补摘要后 ${pointerWithSummary.length} 字`,
    )
    expect(chapterBody).not.toBe(pointerNoSummary)
    expect(pointerNoSummary).not.toBe(pointerWithSummary)
  })

  it("S7 工具集变化：工具块位于消息之前", () => {
    const messages: ChatMessage[] = [{ role: "system", content: SYSTEM }, user("写第一章" + numbered("要", 30))]
    const toolsPlan = JSON.stringify([
      { name: "read_chapter", description: "读取章节", parameters: { type: "object" } },
      { name: "read_outline", description: "读取大纲", parameters: { type: "object" } },
    ]) + numbered("工具描述", 30)
    const { hitRate } = measure("S7 工具集删减", messages, messages, [TOOLS, toolsPlan])
    // 结构事实：本诊断按"工具块在消息之前"序列化。DeepSeek 实际模板顺序需实测确认，
    // 若工具在消息之后，这一项的损失会降为 0。数字见上方日志。
    expect(hitRate).toBeLessThan(1)
  })

  it("S8 尾部顺序：会话摘要排在动态资料之前，摘要一变就污染整段", () => {
    const { taskContext } = buildContextHubPromptParts("软件规则", {
      stableCore: "稳定核心",
      sessionSummary: "摘要：主角雨夜接头。",
      dynamicContext: numbered("伏笔线索", 40),
    } as never, [])
    // eslint-disable-next-line no-console
    console.log(
      `[probe] S8 尾部块顺序 → ${taskContext.map((block) => block.type === "text" ? block.text.slice(0, 18) : "?").join(" | ")}`,
    )
    expect(taskContext.length).toBeGreaterThan(0)
  })
})
