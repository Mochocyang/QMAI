/**
 * 拆书故事导图 - 提取/汇总 prompt + 解析（chaishugushidaotu 分支）
 *
 * 目标：让 LLM 逐章输出「主线事件链 + 分支」结构化 JSON，
 * 分支必须标明由主线哪一环节触发；解析容错对标 style-prompts。
 */
import type { BookStoryFrameworkChapter } from "./story-framework-extraction"
import type { StoryMap } from "./story-map-types"
import { normalizeStoryMap } from "./story-map-types"
import { CHAPTER_BODY_EXCERPT_MAX_CHARS } from "@/lib/novel/chapter-excerpts"

const SAMPLE_TEXT_LIMIT = 24000

function truncate(value: string, limit: number): string {
  if (!value) return ""
  if (value.length <= limit) return value
  return value.slice(0, limit) + "\n\n…（样本过长已截断）…"
}

/** 构建逐章故事导图提取 prompt（输出 JSON） */
export function buildStoryMapPrompt(input: {
  bookTitle: string
  chapters: BookStoryFrameworkChapter[]
  temporaryCharacters?: Array<{ name: string; aliases: string[]; category: string }>
}): string {
  const chapterBlocks = input.chapters.map((chapter) => {
    const content = chapter.content.trim().length <= CHAPTER_BODY_EXCERPT_MAX_CHARS
      ? chapter.content.trim()
      : `${chapter.content.trim().slice(0, CHAPTER_BODY_EXCERPT_MAX_CHARS)}\n[本章内容过长已截断]`
    return `【章节ID：${chapter.id} · 第 ${chapter.order} 章 · ${chapter.title}】\n${content}`
  }).join("\n\n———\n\n")

  const characterLines = input.temporaryCharacters?.length
    ? [
        "临时人物线索（只用于理解人物关系、目标和冲突）：",
        ...input.temporaryCharacters.map((c) => `- ${c.name}${c.aliases.length ? `（别名：${c.aliases.join("、")}）` : ""} · ${c.category}`),
        "禁止输出角色 Skill、角色档案或人物仿写指令。",
        "",
      ]
    : []

  return [
    `拆书作品：《${input.bookTitle}》`,
    "",
    ...characterLines,
    "你是小说故事结构拆解专家。请把下面提供的章节拆解成「主线 + 分支」的故事导图（思维导图式结构），供作者写新书时复用节奏与结构。",
    "",
    "核心约定：",
    "- 主线 = 支撑全书推进的核心事件链（每章按推进顺序列出主线事件）。",
    "- 分支 = 由主线某环节生发的新故事：支线（sub）、任务（task）、伏笔（foreshadow）、世界观展开（world）、情感线（emotion）。",
    "- 每个分支必须写清 triggeredBy（由本章哪个主线事件触发，填该主线事件的 label 原文）。",
    "- 事件只描述结构与功能（怎么推进、怎么施压、怎么释放），不复述原作专有设定、不复用原作人物名设定名（角色名仅用于标注涉及谁）。",
    "- 全部使用中文。不要编造：某章确实没有分支时 branches 返回空数组。",
    "",
    "只输出一个 JSON 对象（不要 markdown 围栏、不要解释），结构如下：",
    "{",
    '  "mainLineLabel": "主线名（如：主角成长+复仇主线）",',
    '  "mainSummary": "主线整体一句话概括",',
    '  "chapters": [',
    "    {",
    '      "id": "必须使用上文【章节ID：】中的 ID",',
    '      "order": 章节序号,',
    '      "title": "章节标题",',
    '      "summary": "本章发生了什么（一句话概括）",',
    '      "mainEvents": [',
    "        {",
    '          "label": "主线事件一句话（导图节点主文本）",',
    '          "beats": ["具体情节点1", "情节点2"],',
    '          "characters": ["涉及角色名"],',
    '          "spinoff": "由此延伸的悬念（可省略）"',
    "        }",
    "      ],",
    '      "branches": [',
    "        {",
    '          "id": "branch-ch0001-0",',
    '          "kind": "sub|task|foreshadow|world|emotion",',
    '          "label": "分支名（如：炼丹师大赛支线）",',
    '          "triggeredBy": "由本章哪个主线事件触发（填其 label）",',
    '          "events": [ { "label": "分支事件一句话", "beats": ["..."], "characters": ["..."] } ]',
    "        }",
    "      ]",
    "    }",
    "  ]",
    "}",
    "",
    "原文样本（已截断）：",
    truncate(chapterBlocks, SAMPLE_TEXT_LIMIT),
  ].join("\n")
}

/** 多区块汇总 prompt：合并各区块 StoryMap JSON，保留衔接 */
export function buildStoryMapAggregatePrompt(maps: unknown[]): string {
  return [
    "你是小说故事导图汇总专家。以下是同一作品不同章节区块已经完成的故事导图 JSON。",
    "请合并为一个导图：按章节 order 排序、主线事件链保持推进顺序、同名/同功能分支去重合并，",
    "分支的 triggeredBy 保持指向合并后的主线事件 label。不得新增未分析章节，不得编造事件。",
    "输出与输入相同结构的单个 JSON（含 mainLineLabel / mainSummary / chapters），不要围栏与解释。",
    "",
    ...maps.map((map, index) => `区块 ${index + 1}：\n${JSON.stringify(map)}`),
  ].join("\n\n")
}

/** 解析 LLM 输出为 StoryMap：剥围栏 + 取最外层 {}；失败返回 null（由调用方降级） */
export function parseStoryMapResult(
  raw: string,
  input: { bookId: string; bookTitle: string; chapterIds: string[]; createdAt?: number },
): StoryMap | null {
  const fenceStripped = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw
  const objectText = fenceStripped.match(/\{[\s\S]*\}/)?.[0]
  if (!objectText) return null
  try {
    const parsed: unknown = JSON.parse(objectText)
    const map = normalizeStoryMap({ ...input, raw: parsed })
    return map.chapters.length > 0 ? map : null
  } catch {
    return null
  }
}
