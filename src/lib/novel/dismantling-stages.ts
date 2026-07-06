/**
 * 分阶段拆文提示词 + 提取函数 + 合并 agent
 *
 * 设计依据：docs/superpowers/specs/2026-07-05-chaishuku-framework-extract-design.md
 *
 * 各阶段提示词都以 buildDismantlingCachePrefix 输出开头，
 * 使 API 供应商的前缀缓存命中（前缀只全价一次，后续按约 1/10 计费）。
 */

import { buildDismantlingCachePrefix, type DismantlingChapter } from "./dismantling"
import type { PlotFrameworkCharacter } from "./plot-framework"

// ─────────────────────────────────────────
// 阶段1-4 提示词构建函数
// ─────────────────────────────────────────

interface StagePromptInput {
  projectTitle: string
  chapters: DismantlingChapter[]
}

/** 阶段1：角色作用拆解 */
export function buildDismantlingCharacterPrompt(input: StagePromptInput): string {
  return [
    buildDismantlingCachePrefix(input.projectTitle, input.chapters),
    "",
    "你是小说拆文分析助手。请针对上面章节，拆解涉及的角色及其在剧情框架中的作用定位。",
    "",
    "输出要求：",
    "1. 只输出 Markdown 结构化结果，不要输出解释或前言。",
    "2. 按以下格式输出：",
    "## 涉及角色与作用",
    "- 角色名：在该框架中的作用定位（一句话说明角色在钩子/铺垫/爽点/结尾钩子中的作用）",
    "3. 每个角色必须给出具体作用，不要写「配角」「路人」等笼统标签。",
    "4. 角色作用要说明该角色如何服务于四段循环（如衬托、压制、震惊、引出目标等）。",
  ].join("\n")
}

/** 阶段2：方向指引拆解 */
export function buildDismantlingDirectionPrompt(input: StagePromptInput): string {
  return [
    buildDismantlingCachePrefix(input.projectTitle, input.chapters),
    "",
    "你是小说拆文分析助手。请针对上面章节，拆解可复用的方向指引。",
    "",
    "方向指引是让 AI 理解「什么时候该做什么」的约束，例如：",
    "- 震惊时机：什么情境下角色表现震惊最能刺激读者",
    "- 装逼时机：什么情境下主角装逼最有反差效果",
    "- 压制时机：什么情境下铺垫最能积累负面情绪",
    "- 释放时机：什么情境下爽点最能释放情绪",
    "",
    "输出要求：",
    "1. 只输出 Markdown 结构化结果，不要输出解释或前言。",
    "2. 按以下格式输出：",
    "## 方向指引",
    "震惊时机：具体说明",
    "装逼时机：具体说明",
    "压制时机：具体说明",
    "释放时机：具体说明",
    "3. 每个时机必须落到本批章节的具体剧情，不要写笼统套话。",
    "4. 方向指引必须可被其他故事套用，不含本作人物设定。",
  ].join("\n")
}

/** 阶段3：作者发挥空间拆解 */
export function buildDismantlingHandcraftPrompt(input: StagePromptInput): string {
  return [
    buildDismantlingCachePrefix(input.projectTitle, input.chapters),
    "",
    "你是小说拆文分析助手。请针对上面章节，拆解适合作者手工发挥的空间。",
    "",
    "框架是 AI 能做的，血肉层（人设、文风、对话、整活、玩梗、小癖好）让位作者手搓。",
    "请分析本批章节的哪些节点最适合作者发挥创意，标注发挥类型和建议方向。",
    "",
    "输出要求：",
    "1. 只输出 Markdown 结构化结果，不要输出解释或前言。",
    "2. 按以下格式输出：",
    "## 作者发挥空间",
    "- 钩子处：适合发挥的类型（如玩梗/对话设计/人设展示）+ 建议方向",
    "- 铺垫处：适合发挥的类型 + 建议方向",
    "- 爽点处：适合发挥的类型 + 建议方向",
    "- 结尾钩子处：适合发挥的类型 + 建议方向",
    "3. 发挥类型包括但不限于：玩梗、整活、对话设计、人设展示、神态描写、小癖好。",
    "4. 建议方向要具体到「什么样的内容能卷过其他作者」，不要写笼统套话。",
  ].join("\n")
}

/** 阶段4：伏笔拆解 */
export function buildDismantlingForeshadowingPrompt(input: StagePromptInput): string {
  return [
    buildDismantlingCachePrefix(input.projectTitle, input.chapters),
    "",
    "你是小说拆文分析助手。请针对上面章节，拆解本框架埋设或回收的伏笔。",
    "",
    "输出要求：",
    "1. 只输出 Markdown 结构化结果，不要输出解释或前言。",
    "2. 按以下格式输出：",
    "## 伏笔",
    "- 伏笔描述（埋设/回收）+ 对应章节",
    "3. 只列出本框架循环内涉及的伏笔，不要列其他框架的伏笔。",
    "4. 如果本框架没有伏笔，输出「无」。",
  ].join("\n")
}

// ─────────────────────────────────────────
// 阶段1-4 提取函数
// ─────────────────────────────────────────

/** 从阶段1输出提取角色列表 */
export function extractCharactersFromStage(raw: string): PlotFrameworkCharacter[] {
  const section = readStageSection(raw, /##\s*涉及角色与作用[^\n]*\n/)
  if (!section) return []
  const lines = section.split(/\r?\n/).filter((l) => l.trim().startsWith("-"))
  const result: PlotFrameworkCharacter[] = []
  for (const line of lines) {
    const text = line.replace(/^[-*\s]+/, "").trim()
    // 格式：角色名：作用
    const colonIdx = text.search(/[：:]/)
    if (colonIdx >= 0) {
      const match = text.match(/^([^：:]+)[：:](.+)/)
      if (match) {
        const name = match[1].trim()
        const role = match[2].trim()
        if (name && role) result.push({ name, role })
      }
    } else if (text) {
      // 没有冒号，只有名字
      result.push({ name: text, role: "" })
    }
  }
  return result
}

/** 从阶段2输出提取方向指引 */
export function extractDirectionHintsFromStage(raw: string): string {
  const section = readStageSection(raw, /##\s*方向指引[^\n]*\n/)
  if (!section) return ""
  return section.trim()
}

/** 从阶段3输出提取作者发挥空间提示 */
export function extractHandcraftHintsFromStage(raw: string): string {
  const section = readStageSection(raw, /##\s*作者发挥空间[^\n]*\n/)
  if (!section) return ""
  return section.trim()
}

/** 从阶段4输出提取伏笔列表 */
export function extractForeshadowingFromStage(raw: string): string[] {
  const section = readStageSection(raw, /##\s*伏笔[^\n]*\n/)
  if (!section) return []
  if (section.trim() === "无") return []
  const lines = section.split(/\r?\n/).filter((l) => l.trim().startsWith("-"))
  return lines
    .map((l) => l.replace(/^[-*\s]+/, "").trim())
    .filter((l) => l && l !== "无" && l !== "—" && l !== "-")
}

/** 读取 markdown 中某个 ## 段落的内容（到下一个 ## 或文末） */
function readStageSection(markdown: string, headerRe: RegExp): string | null {
  const start = markdown.search(headerRe)
  if (start === -1) return null
  const match = markdown.match(headerRe)
  if (!match) return null
  const after = markdown.slice(start + match[0].length)
  const nextHeader = after.search(/^##\s/m)
  const body = nextHeader === -1 ? after : after.slice(0, nextHeader)
  return body.trim() || null
}

// ─────────────────────────────────────────
// 阶段5：合并 agent
// ─────────────────────────────────────────

interface FrameworkMergePromptInput {
  projectTitle: string
  chapters: DismantlingChapter[]
  stageOutputs: {
    beats: string
    characters: string
    direction: string
    handcraft: string
    foreshadowing: string
  }
}

/** 阶段5：合并 agent 提示词 */
export function buildFrameworkMergePrompt(input: FrameworkMergePromptInput): string {
  return [
    buildDismantlingCachePrefix(input.projectTitle, input.chapters),
    "",
    "你是剧情框架合并助手。下面是针对同一批章节的 5 个维度的拆解结果，",
    "请合并成一个统一的剧情框架 JSON。",
    "",
    "拆解结果：",
    "=== 四段框架 ===",
    input.stageOutputs.beats,
    "",
    "=== 角色作用 ===",
    input.stageOutputs.characters,
    "",
    "=== 方向指引 ===",
    input.stageOutputs.direction,
    "",
    "=== 作者发挥空间 ===",
    input.stageOutputs.handcraft,
    "",
    "=== 伏笔 ===",
    input.stageOutputs.foreshadowing,
    "",
    "硬性要求：",
    "1. 只输出一个 JSON 对象，不要输出解释、前言或代码块标记。",
    "2. 四段（hook/buildup/payoff/endingHook）任一为空，整个输出返回 {\"error\": \"四段不完整\"}。",
    "3. characters 必须包含 name 和 role 两个字段。",
    "4. 合并时如果各维度有矛盾，以四段框架为准，其他维度服从四段。",
    "5. directionHints 和 handcraftHints 不可为空字符串。",
    "6. line 必须是 \"main\" 或 \"sub\"。",
    "7. 输出 JSON 字段：title, beats{hook,buildup,payoff,endingHook}, characters[{name,role}], foreshadowing[], line, prevConnector, nextConnector, reusableTemplate, directionHints, handcraftHints",
  ].join("\n")
}

/** 合并 agent 输出的结构化类型 */
export interface ParsedFrameworkMerge {
  title: string
  beats: { hook: string; buildup: string; payoff: string; endingHook: string }
  characters: PlotFrameworkCharacter[]
  foreshadowing: string[]
  line: "main" | "sub"
  prevConnector: string
  nextConnector: string
  reusableTemplate: string
  directionHints: string
  handcraftHints: string
}

/** 解析合并 agent 的 JSON 输出，校验后返回结构化对象，失败抛错 */
export function parseFrameworkMergeOutput(raw: string): ParsedFrameworkMerge {
  // 去掉可能的 ```json 代码块标记
  let cleaned = raw.trim()
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "")
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error("合并 agent 输出不是合法 JSON")
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("合并 agent 输出不是 JSON 对象")
  }

  const obj = parsed as Record<string, unknown>

  // 检查 error 字段
  if (typeof obj.error === "string" && obj.error) {
    throw new Error(obj.error)
  }

  // 校验 beats 四段
  const beats = obj.beats as Record<string, unknown> | undefined
  if (!beats || typeof beats !== "object") {
    throw new Error("合并 agent 输出缺少 beats 字段")
  }
  const hook = typeof beats.hook === "string" ? beats.hook.trim() : ""
  const buildup = typeof beats.buildup === "string" ? beats.buildup.trim() : ""
  const payoff = typeof beats.payoff === "string" ? beats.payoff.trim() : ""
  const endingHook = typeof beats.endingHook === "string" ? beats.endingHook.trim() : ""
  if (!hook || !buildup || !payoff || !endingHook) {
    throw new Error("四段不可为空（钩子/铺垫/爽点/结尾钩子）")
  }

  // 校验 line
  const line = obj.line
  if (line !== "main" && line !== "sub") {
    throw new Error("line 必须是 main 或 sub")
  }

  // 校验 directionHints
  const directionHints = typeof obj.directionHints === "string" ? obj.directionHints.trim() : ""
  if (!directionHints) {
    throw new Error("方向指引不可为空")
  }

  // 校验 handcraftHints
  const handcraftHints = typeof obj.handcraftHints === "string" ? obj.handcraftHints.trim() : ""
  if (!handcraftHints) {
    throw new Error("作者发挥空间提示不可为空")
  }

  // 解析 characters
  const characters: PlotFrameworkCharacter[] = []
  if (Array.isArray(obj.characters)) {
    for (const c of obj.characters) {
      if (c && typeof c === "object") {
        const co = c as Record<string, unknown>
        const name = typeof co.name === "string" ? co.name.trim() : ""
        const role = typeof co.role === "string" ? co.role.trim() : ""
        if (name) characters.push({ name, role })
      }
    }
  }

  // 解析 foreshadowing
  const foreshadowing: string[] = []
  if (Array.isArray(obj.foreshadowing)) {
    for (const f of obj.foreshadowing) {
      if (typeof f === "string" && f.trim()) foreshadowing.push(f.trim())
    }
  }

  return {
    title: typeof obj.title === "string" ? obj.title.trim() : "未命名剧情框架",
    beats: { hook, buildup, payoff, endingHook },
    characters,
    foreshadowing,
    line: line as "main" | "sub",
    prevConnector: typeof obj.prevConnector === "string" ? obj.prevConnector.trim() : "",
    nextConnector: typeof obj.nextConnector === "string" ? obj.nextConnector.trim() : "",
    reusableTemplate: typeof obj.reusableTemplate === "string" ? obj.reusableTemplate.trim() : "",
    directionHints,
    handcraftHints,
  }
}
