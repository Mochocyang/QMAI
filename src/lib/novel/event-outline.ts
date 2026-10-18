/**
 * 事件细纲（轻量章细纲）。
 *
 * 与重型「章节细纲」（chapter-outline：17 节 / 整故事 3 章一批 / 必须对齐卷纲骨架）
 * 是两条独立产线。本模块只服务「今天这一章写哪几件事」：一章一批、4~8 个连续事件，
 * 每个事件给一句 20 字左右的标题加若干可直接落笔的细节抓手。
 *
 * 刻意不参与 chapterOutlineData 的解析、分批续跑与校验链路，也不注册为上下文索引
 * 的 chapter kind —— 详见 docs/scratch-20261010-分支说明.md 第 2.3 节。
 */

import { DE_AI_GENERATION_RULES } from "./de-ai-generation-rules"

export const EVENT_OUTLINE_VERSION = 1
export const EVENT_OUTLINE_MIN_EVENTS = 4
export const EVENT_OUTLINE_MAX_EVENTS = 8
export const EVENT_OUTLINE_DEFAULT_EVENTS = 6
export const EVENT_OUTLINE_TITLE_MAX_CHARS = 24
export const EVENT_OUTLINE_MIN_POINTS = 2
export const EVENT_OUTLINE_MAX_POINTS = 5
/**
 * 单个事件展开成正文的参考字数区间。只用于软性提示（advisories），不阻断扩写：
 * 单章目标字数设置被钳在 1000~10000（见 deep-chapter-prompts.ts），
 * 4~8 个事件下平均字数天然可能落在区间外（如 4000/4=1000、10000/4=2500），
 * 若当作硬性错误会让完全合法的细纲用不了「用这份细纲写这一章」。
 */
export const EVENT_OUTLINE_MIN_WORDS_PER_EVENT = 150
export const EVENT_OUTLINE_MAX_WORDS_PER_EVENT = 800

export interface EventOutlineEvent {
  /** 从 1 起的连续序号。 */
  id: number
  /** 一句话事件，约 20 字。 */
  title: string
  /**
   * 2~5 条细节抓手，以「故事推进」为首，其余按需：
   * 冲突与转折 / 关键台词 / 环境与物件 / 伏笔或钩子。
   * （2026-10-13 前的旧细纲可能是「关键台词 / 神情动作 / 环境物件 / 推进与收束」口径，照旧能读。）
   */
  points: string[]
}

export interface EventOutlineData {
  version: number
  chapterNumber: number
  /** 「第N章 · 一句话章名」。 */
  title: string
  /** 本章目标字数（展开成正文的目标）。 */
  targetWords: number
  events: EventOutlineEvent[]
  /** 全章结尾钩子。 */
  endingHook: string
  /**
   * 用户在向导里填的「对本章的想法或硬要求」。
   *
   * 可选、且读旧数据时为 undefined —— 生成细纲时它只进提示词，以前没有被带进落库的数据，
   * 结果扩写这一步拿不到它。加字段而不是改结构，老细纲行为完全不变。
   */
  requirement?: string
}

/** 一次事件细纲生成请求（向导产出）。 */
export interface EventOutlineRequest {
  chapterNumber: number
  eventCount: number
  targetWords: number
  /** 用户对本章的想法或硬要求，可为空。 */
  requirement: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function positiveInteger(value: unknown, fallback: number): number {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
  }
  // 不能只认开头的数字：AI 常写「约3000字」「第12章」，要扫到第一段数字。
  const digits = text(value).match(/\d+/)?.[0]
  const num = digits ? Number.parseInt(digits, 10) : Number.NaN
  return Number.isFinite(num) && num > 0 ? num : fallback
}

function normalizePoints(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => text(item)).filter(Boolean)
}

function normalizeEvents(value: unknown): EventOutlineEvent[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .map((raw) => ({ title: text(raw.title), points: normalizePoints(raw.points) }))
    // 连标题和抓手都没有的空槽直接丢掉，不占用 4~8 的名额。
    .filter((item) => item.title || item.points.length > 0)
    .map((item, index) => ({ id: index + 1, title: item.title, points: item.points }))
}

/** 把一个「已经是数据本身」的对象读成事件细纲；events 为空则不算数据。 */
function readEventOutline(raw: Record<string, unknown>): EventOutlineData | null {
  const events = normalizeEvents(raw.events)
  if (events.length === 0) return null
  return {
    version: positiveInteger(raw.version, EVENT_OUTLINE_VERSION),
    chapterNumber: positiveInteger(raw.chapterNumber, 0),
    title: text(raw.title),
    targetWords: positiveInteger(raw.targetWords, 0),
    events,
    endingHook: text(raw.endingHook),
    // 旧细纲没有这个字段 -> undefined（不是空字符串），扩写时才不会多出一个空小节。
    requirement: text(raw.requirement) || undefined,
  }
}

/**
 * 宽容归一化：不管 AI 用 `eventOutlineData` 信封还是裸对象，只要 events 非空就认。
 * 缺字段取安全默认值，让校验去挑毛病 —— 与 normalizeChapterOutlineData 同一口径。
 */
export function normalizeEventOutlineData(raw: unknown): EventOutlineData | null {
  if (!isRecord(raw)) return null
  // 先当裸对象试；再按「单键信封」把它包着的值当数据试一次 —— 与 chapterDataFromPayload 同一策略。
  const direct = readEventOutline(raw)
  if (direct) return direct
  for (const value of Object.values(raw)) {
    if (!isRecord(value)) continue
    const inner = readEventOutline(value)
    if (inner) return inner
  }
  return null
}

/**
 * 校验返回问题清单而不是布尔值：与 validateChapterOutlineData 同风格，
 * 卡片上逐条标红 + 给修复建议，用户仍可选择「保存当前内容」。
 *
 * `problems` 只装结构性缺陷（缺字段、数量越界、序号不连续），`ok` 也随之只反映结构；
 * 字数分配、标题超长一类的软性建议放 `advisories`，不参与 `ok`，避免合法细纲被误判为不可用。
 * 契约：任何非 null 对象都只返回清单，绝不抛异常。
 */export function validateEventOutlineData(
  data: EventOutlineData | null,
): { ok: boolean; problems: string[]; advisories: string[] } {
  if (!data) {
    return { ok: false, problems: ["未解析到事件细纲结构化数据（eventOutlineData）。"], advisories: [] }
  }

  const problems: string[] = []
  const advisories: string[] = []
  // 入参可能来自卡片上被手改过的草稿，不假设它已经归一化，逐字段做存在性兜底。
  const events = Array.isArray(data.events) ? data.events : []

  if (events.length < EVENT_OUTLINE_MIN_EVENTS || events.length > EVENT_OUTLINE_MAX_EVENTS) {
    problems.push(
      `事件数为 ${events.length}，应在 ${EVENT_OUTLINE_MIN_EVENTS}~${EVENT_OUTLINE_MAX_EVENTS} 个之间。`,
    )
  }

  events.forEach((event, index) => {
    if (!isRecord(event)) {
      problems.push(`第 ${index + 1} 个事件不是对象。`)
      return
    }
    if (event.id !== index + 1) {
      problems.push(`第 ${index + 1} 个事件的序号是 ${event.id}，事件序号必须从 1 起连续递增。`)
    }
    // 校验不假设入参已经归一化（用户可能在卡片上直接改过草稿），字符串一律去空白再判断。
    const title = text(event.title)
    if (!title) {
      problems.push(`第 ${index + 1} 个事件缺少一句话标题。`)
    } else if (title.length > EVENT_OUTLINE_TITLE_MAX_CHARS) {
      // 标题超标只是排版提示，不参与 ok：当成硬错误会让卡片隐藏「用这份细纲写这一章」，
      // 一个超几个字的标题就逼用户多跑一整轮 LLM。缺标题仍然是硬错误（上面那条）。
      advisories.push(
        `第 ${index + 1} 个事件标题 ${title.length} 字，超过 ${EVENT_OUTLINE_TITLE_MAX_CHARS} 字，请压到 20 字左右。`,
      )
    }
    if (!Array.isArray(event.points)) {
      // 别把非列表说成「1 条」——那会让用户以为只要再加一条。
      problems.push(`第 ${index + 1} 个事件的细节抓手不是列表。`)
    } else {
      const points = event.points
      if (points.length < EVENT_OUTLINE_MIN_POINTS || points.length > EVENT_OUTLINE_MAX_POINTS) {
        problems.push(
          `第 ${index + 1} 个事件的细节抓手为 ${points.length} 条，应有 ${EVENT_OUTLINE_MIN_POINTS}~${EVENT_OUTLINE_MAX_POINTS} 条。`,
        )
      }
    }
  })

  if (!text(data.endingHook)) {
    problems.push("缺少全章结尾钩子（endingHook）。")
  }

  // 与 targetWords 同用取反写法：缺失/NaN 也算缺章号。
  if (!(data.chapterNumber > 0)) {
    problems.push("缺少目标章号（chapterNumber）。")
  }

  // 用取反写法，缺失/NaN 也算缺目标字数（正向的 `<= 0` 对 undefined 不成立）。
  if (!(data.targetWords > 0)) {
    problems.push("缺少本章目标字数（targetWords）。")
  }

  if (data.targetWords > 0 && events.length > 0) {
    const perEvent = Math.round(data.targetWords / events.length)
    if (perEvent < EVENT_OUTLINE_MIN_WORDS_PER_EVENT || perEvent > EVENT_OUTLINE_MAX_WORDS_PER_EVENT) {
      advisories.push(
        `目标 ${data.targetWords} 字分给 ${events.length} 个事件，每个事件约 ${perEvent} 字，展开时注意节奏。`,
      )
    }
  }

  return { ok: problems.length === 0, problems, advisories }
}

/**
 * 抓手开头的类别词白名单。
 *
 * 当前提示词（2026-10-13 起）要求抓手写成「类别：正文」，第一条固定「故事推进」，
 * 其余按需取用：冲突与转折 / 关键台词 / 环境与物件 / 伏笔或钩子。卡片据此把一条长
 * 抓手拆成「类别 + 正文」两列 —— 不拆的话，几条长抓手挤成几段话，用户拿到的观感
 * 就是「乱」（用户 2026-10-13 反馈）。
 *
 * 下半截那批（环境物件 / 神情动作 / 关键台词 / 推进与收束 …）是 2026-10-13 之前的
 * 提示词口径，**刻意保留**：提示词改了，磁盘上已有的旧细纲不改，旧卡片还要照旧
 * 排成两列。缺了它们，历史细纲的抓手会全部退化成整行铺满。
 *
 * 刻意用白名单，而不是「冒号前不超过 8 个字就当类别」：后者会把
 * 「杨震的神色：阴冷如冰」这类正常句子也误拆出一列类别，排版反而更乱。
 * 没命中的抓手整行原样显示，一个字都不改。
 */
export const EVENT_POINT_LABELS = [
  // 故事向（当前提示词口径）
  "故事推进",
  "剧情推进",
  "情节推进",
  "推进与收束",
  "推进",
  "收束",
  "冲突与转折",
  "冲突",
  "转折",
  "伏笔或钩子",
  "伏笔",
  "钩子",
  "章尾钩子",
  "线索",
  "目标",
  "动机",
  "结果",
  "后果",
  "信息",
  "变化",
  "关系",
  // 描写向（2026-10-13 之前的旧口径，保留以兼容历史细纲）
  "环境物件",
  "环境与物件",
  "环境",
  "物件",
  "场景",
  "地点",
  "时间",
  "神情动作",
  "神情与动作",
  "神情",
  "神态",
  "表情",
  "动作",
  "心理",
  "情绪",
  "关键台词",
  "台词",
  "对白",
]

/** 一条抓手拆出来的两半（卡片排版用）。 */
export interface EventPointParts {
  /** 类别词（「环境物件」「关键台词」…）；没有可识别类别时是空串。 */
  label: string
  /** 类别词之后的正文；没有类别词时就是整条抓手（原样，不裁字）。 */
  text: string
}

/**
 * 把一条抓手拆成「类别 + 正文」。
 *
 * 只认白名单里的类别词；认不出来就整条当正文返回（`label` 为空串）——
 * 排版层据此把那一条铺满整行，而不是硬塞进类别列里。
 */
export function splitEventPointLabel(point: string): EventPointParts {
  const raw = point.trim()
  const match = raw.match(/^([^：:]{1,8})[：:]\s*(\S[\s\S]*)$/)
  if (!match) return { label: "", text: raw }
  const label = match[1].trim()
  if (!EVENT_POINT_LABELS.includes(label)) return { label: "", text: raw }
  return { label, text: match[2].trim() }
}

/** 从 `{` 开始配平花括号，返回一个完整 JSON 对象文本；尊重字符串与转义。 */
function balancedJsonBlock(candidate: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < candidate.length; index += 1) {
    const ch = candidate[index]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === "\"") inString = false
      continue
    }
    if (ch === "\"") inString = true
    else if (ch === "{") depth += 1
    else if (ch === "}") {
      depth -= 1
      if (depth === 0) return candidate.slice(start, index + 1)
    }
  }
  return null
}

/**
 * 从 AI 回复里提取事件细纲数据（优先在 ```json 围栏内查找）。
 * 与 extractChapterOutlineData 同构：逐个围栏试，哪个能解析成事件细纲就用哪个，
 * 于是「模型换了个信封名」不会导致卡片渲染不出来。
 *
 * 三个层次的宽容都必要（都对应实测过的「卡片空白但没有任何解释」）：
 * 1. 整段回复永远参与候选 —— 围栏可能被写坏、被吞掉，而保存请求围栏常常排在数据围栏前面；
 * 2. 一个候选里从每个 `{` 都重试一次 —— 模型爱先输出示例对象、或在围栏正文里提到花括号；
 * 3. 单个对象配平后仍可能不是合法 JSON（尾随逗号），解析失败就继续往右扫。
 *
 * 信封解包不在本函数做：`normalizeEventOutlineData` 已经负责那一层，
 * 这里只负责「从文本里找到 JSON」。两处都解包会变成两层宽容度，也会重复代码。
 *
 * `balancedJsonBlock` 刻意保持私有，不与 chapter-outline-template.ts 共享：
 * 那个文件不在本分支范围内，不为它建共享模块。
 *
 * 第二个参数是「用户对本章的要求」：模型有时不会把向导里那段要求照抄进 JSON，
 * 而它对本条产线是权威输入，所以在解析时就地补上（传入优先于模型自己写的那份）。
 * 可选参数，既有调用点不传即行为不变。
 */
export function extractEventOutlineData(content: string, requirement?: string): EventOutlineData | null {
  const fencePattern = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi
  const candidates: string[] = []
  for (const match of content.matchAll(fencePattern)) {
    if (match[1].includes("{")) candidates.push(match[1])
  }
  // 整段回复永远作为最后一个候选：围栏可能被模型写坏、被吞掉，或数据就在围栏外面。
  // 只在「一个围栏都没有」时兜底是不够的 —— 保存请求围栏常常排在数据围栏前面。
  if (content.includes("{")) candidates.push(content)

  for (const candidate of candidates) {
    // 一个候选里可能有多个对象（附带示例、先输出别的 JSON、正文里提到花括号）。
    // 逐个 `{` 往右试，直到配平出一个能用的对象，而不是只试第一个。
    let start = candidate.indexOf("{")
    while (start >= 0) {
      const block = balancedJsonBlock(candidate, start)
      if (block) {
        try {
          const data = normalizeEventOutlineData(JSON.parse(block) as unknown)
          if (data) return withRequirement(data, requirement)
        } catch {
          // 该对象不是合法 JSON，继续往右找下一个
        }
      }
      start = candidate.indexOf("{", start + 1)
    }
  }
  return null
}

/** 用向导里的要求覆盖/补齐解析结果；没有要求时原样返回，行为等同现状。 */
function withRequirement(data: EventOutlineData, requirement?: string): EventOutlineData {
  const trimmed = requirement?.trim()
  return trimmed ? { ...data, requirement: trimmed } : data
}

/**
 * 事件细纲数据 → 可直接保存/阅读的 Markdown 正文。
 *
 * 为什么要有它：提示词此前要求模型先写一份 Markdown 细纲、再给一个 `eventOutlineData`
 * 围栏，同一份内容被付费两次；而气泡展示时那份 Markdown 又会被 `stripEventOutlineDataFence`
 * 之外的处理链丢弃/覆盖（卡片才是主展示）。2026-10-18 起模型只输出 JSON，正文由这里反推，
 * 字段一个不落地还原成旧提示词要求的形状（`# 事件细纲 · 第N章 名` / `## 事件N 标题` /
 * 抓手逐条），所以外部读 `# 事件细纲` 的旧逻辑与老用例都还能命中。
 */
export function renderEventOutlineMarkdown(data: EventOutlineData): string {
  /*
   * title 的写法是「第12章 · 令牌初现」，而 H1 的旧形状是「事件细纲 · 第12章 令牌初现」
   * （章号与章名之间是空格）。直接拼会变成「… · 第12章 · 令牌初现」，两个分隔符连用。
   * 只把**紧跟在章号后的那个**「·」换成空格，其余原样 —— 章名里自带的「·」不该被动。
   */
  const chapterTitle = data.title
    .trim()
    .replace(/^(第[0-9零一二三四五六七八九十百千两]+章)\s*[·・:：]\s*/, "$1 ")
  const heading = chapterTitle
    ? `# 事件细纲 · ${chapterTitle}`
    : `# 事件细纲 · 第${data.chapterNumber}章`
  const lines: string[] = [heading, ""]
  if (data.targetWords > 0) lines.push(`目标字数：约 ${data.targetWords} 字`, "")
  data.events.forEach((event) => {
    // 标题后空一行再列抓手：与文档其余部分（标题 → 空行 → 内容）保持同一节奏，
    // 也让「## 事件N」这段在纯文本阅读时不会和下面第一条挤在一起。
    lines.push(`## 事件${event.id} ${event.title}`.trim(), "")
    event.points.forEach((point) => lines.push(`- ${point}`))
    lines.push("")
  })
  if (data.endingHook.trim()) lines.push("## 本章结尾钩子", data.endingHook.trim(), "")
  return `${lines.join("\n").trimEnd()}\n`
}

/**
 * 摘掉数据围栏后剩下的文字，是否只是「已生成第N章事件细纲」这类交代语。
 *
 * 为什么需要判定：结构化-only 之后提示词**允许**模型在围栏外留一句说明
 * （「围栏外最多留一句『已生成…』」）。气泡如果拿「有文字就显示原文」来判，
 * 那这句说明就顶掉了本该展示的细纲正文 —— 用户看到的是一条只有 12 个字的回复，
 * 而正文其实完整地躺在 JSON 里，只是没人把它渲染出来。
 *
 * 判据故意不认关键词、只认形状：没有标题行 + 去掉空白后极短。
 * 一份真正手写的细纲至少包含 `#`/`##` 标题与四条事件，短不到 60 字；
 * 用关键词（「已生成」「完成」）判断反而会被模型换一种说法绕过。
 */
export function looksLikeEventOutlineDeliveryNote(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return true
  if (/^#{1,6}\s/m.test(trimmed)) return false
  return trimmed.replace(/\s+/g, "").length <= 60
}

/**
 * 把承载细纲数据的 ```json 围栏从**展示文本**里摘掉。
 *
 * 用在哪里：聊天面板的气泡用的是 Markdown 渲染。2026-10-18 前细纲提示词要求模型
 * 先给一份 Markdown 细纲、再给一个 `eventOutlineData` 围栏，于是气泡里会同时出现
 * 「一份好看的细纲正文」和「一大坨裸 JSON」——后者是给程序看的，不是给人看的。
 * 现在提示词只要 JSON，正文由 `renderEventOutlineMarkdown` 反推；本函数仍要保留，
 * 因为**历史消息里**还压着大量模型手写的 MD + 围栏，读旧会话时同样要把围栏摘掉。
 *
 * ⚠️ 只摘**能解析成事件细纲**的那一份，其余围栏原样保留：同一条回复里可能还有
 * 别的 json（例如保存请求），它们不属于本函数的目标，删掉就是删掉用户要看的内容。
 *
 * 只用于展示层：模型历史、落盘内容、`extractEventOutlineData` 的输入都不经过它。
 *
 * 两道剥离（围栏里的 + 没围栏的）都要做：提示词要求了围栏，但模型确实会漏写 ——
 * 用户 2026-10-13 实测到的气泡里就是一段没围栏的裸 JSON（连代码块都不是，直接以正文
 * 形态铺在气泡里）。只认围栏的话，那一段会一直露着。
 */
export function stripEventOutlineDataFence(content: string): string {
  const fencePattern = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi
  return stripBareEventOutlineJson(
    content.replace(fencePattern, (whole: string, body: string) => {
      if (!body.includes("{")) return whole
      let start = body.indexOf("{")
      while (start >= 0) {
        const block = balancedJsonBlock(body, start)
        if (block) {
          try {
            if (normalizeEventOutlineData(JSON.parse(block) as unknown)) return ""
          } catch {
            // 这个对象不是合法 JSON，继续往右找下一个
          }
        }
        start = body.indexOf("{", start + 1)
      }
      return whole
    }),
  ).trim()
}

/**
 * 摘掉**没有围栏**的事件细纲 JSON（模型漏写围栏时的兜底）。
 *
 * 两道闸都不能省，理由与「只摘能解析成事件细纲的那一份」同源：
 * 1. 先做子串预筛 `eventOutlineData` —— 绝大多数回复连这个词都没有，预筛之后
 *    完全不进那段逐字符配平的扫描（气泡每次重渲染都会跑这个函数）；
 * 2. 只删**能解析成事件细纲**的对象 —— 一段恰好提到花括号的正文不会被误删。
 */
function stripBareEventOutlineJson(text: string): string {
  if (!text.includes("eventOutlineData")) return text
  let result = ""
  let cursor = 0
  let start = text.indexOf("{", cursor)
  while (start >= 0) {
    const block = balancedJsonBlock(text, start)
    let stripped = false
    if (block) {
      try {
        if (normalizeEventOutlineData(JSON.parse(block) as unknown)) {
          result += text.slice(cursor, start)
          cursor = start + block.length
          stripped = true
        }
      } catch {
        // 不是合法 JSON，按普通花括号处理
      }
    }
    if (!stripped) {
      result += text.slice(cursor, start + 1)
      cursor = start + 1
    }
    start = text.indexOf("{", cursor)
  }
  return result + text.slice(cursor)
}

/**
 * 事件细纲的生成提示词。范围（章号 / 事件数 / 字数）由向导定死，所以不开意图分析。
 *
 * `hasFileTools` 决定要不要写「先读资料（list_chapters / …）」那一条硬要求，
 * 默认 `true` 保持大纲面板既有的逐字输出不变。
 *
 * 为什么必须由调用方声明，而不是在系统提示词里写「请忽略上面那条」：
 * 章节区那条链路**没有工具循环**（资料是事先装配进 user 消息的），
 * 系统提示词明确说了「你没有读取文件的工具，不要尝试调用任何工具」。
 * 若 user 消息反过来要求它先调 list_chapters，两者直接冲突，
 * 模型很可能输出一段工具调用旁白而不是细纲 —— 白烧 token 且拿不到结果。
 * 用「请不要理会那条指令」去修补互相矛盾的提示词是脆的（顺序、措辞一变就失效），
 * 所以按能力生成提示词本身。
 */
export function buildEventOutlinePrompt(
  request: EventOutlineRequest,
  options: { hasFileTools?: boolean } = {},
): string {
  const hasFileTools = options.hasFileTools ?? true
  const requirement = request.requirement.trim()
  // 事件数虽然来自向导的下拉框（固定 4~8），但这是导出 API：0 / 小数 / NaN 会让除法
  // 吐出 Infinity 或 NaN，提示词立刻变成「每个事件约 Infinity 字」这种自相矛盾的指导。
  const eventCount = Number.isInteger(request.eventCount) && request.eventCount > 0
    ? request.eventCount
    : EVENT_OUTLINE_DEFAULT_EVENTS
  const perEventWords = request.targetWords > 0 ? Math.round(request.targetWords / eventCount) : 0
  // 示例 JSON 交给 JSON.stringify 生成：手写字符串一旦漏引号或漏括号，就会教模型输出坏数据。
  // requirement 一并写进示例（无要求时 JSON.stringify 会丢掉 undefined 键），
  // 否则用户填的要求只活在生成细纲那一次提示词里，扩写时无处可取。
  const example = JSON.stringify({
    eventOutlineData: {
      version: 1,
      chapterNumber: request.chapterNumber,
      title: "第N章 · 一句话章名",
      targetWords: request.targetWords,
      events: [
        {
          id: 1,
          title: "一句话事件",
          points: ["故事推进：…", "冲突与转折：…", "关键台词：谁——『…』"],
        },
      ],
      endingHook: "章尾钩子",
      requirement: requirement || undefined,
    },
  })
  // 这里**刻意不再要求 outlineSaveRequest**：事件细纲只作为大纲对话里的消息 + 卡片存在
  // （已经随 .qmai/outline-chats.json 持久化），不再写进 wiki/outlines/事件细纲/。
  // 提示词里留着保存请求示例的话，模型会照抄出一份保存请求，诱导用户把它当大纲归档。
  return [
    `请为第 ${request.chapterNumber} 章生成一份「事件细纲」：把这一章拆成 ${eventCount} 个连续事件。`,
    "",
    `- 目标章号：第 ${request.chapterNumber} 章`,
    `- 事件数量：${eventCount} 个（必须正好 ${eventCount} 个）`,
    `- 本章目标字数：约 ${request.targetWords} 字${perEventWords > 0 ? `（每个事件约 ${perEventWords} 字）` : ""}`,
    ...(requirement ? [`- 用户对本章的要求：${requirement}`] : []),
    "",
    "## 每个事件必须包含",
    `1. title：一句话说清这个事件发生了什么 —— 谁做了什么、结果如何，20 字左右，不超过 ${EVENT_OUTLINE_TITLE_MAX_CHARS} 字；`,
    `2. points：${EVENT_OUTLINE_MIN_POINTS}~${EVENT_OUTLINE_MAX_POINTS} 条细节抓手，每条写成「类别：正文」的形式。第一条固定是「故事推进」，其余按需取用：`,
    "- 故事推进（必写）：这个事件把情节推到了哪一步 —— 谁做了什么、得到了或失去了什么、局面因此发生了什么变化；",
    "- 冲突与转折：本事件的阻碍、对抗，或意料之外的反转；有就写，没有不要硬凑；",
    "- 关键台词（有才写）：仅当**确实有角色说出一句推动剧情、或暴露要害的话**时才写，并点明说话人（形如「关键台词：林砚——『令牌的事，你别问。』」）。一章里关键台词宁缺毋滥：不是每个事件都有台词，也不是每个出场角色都有关键台词；没有就让这一条缺席，不要为凑条数硬编；",
    "- 环境与物件（有用才写）：只写对剧情有作用的场景或关键道具（布置、线索、要紧物），不要为写景而写景；",
    "- 伏笔或钩子：本事件埋下、后面需要兑现的线头。",
    "",
    "## 硬要求",
    "- 事件之间必须前后连续、按时间与因果串成一条线：除第一个事件外，每个事件的「故事推进」都要先说清它承接上一个事件的什么结果，再说这个事件把局面推进到了哪一步，不能是并列的碎片；",
    "- 整章要有一条清晰的故事主线：这几个事件合起来要讲完一个小故事（起因 → 发展 → 转折 → 收束），而不是几个互不相干的片段；",
    "- 每个事件都要有实实在在的情节推进（谁做了什么、局面怎么变），不要只写氛围、环境或人物状态；",
    "- 不要写人物神情、表情、神态和细微小动作这一类表演性描写 —— 这些留给正文；人物推动剧情的行动照写；",
    "- 最后一个事件之后必须留下一个能勾住读者的章尾钩子；",
    "- **不要写正文**，不要展开描写，只给事件、故事推进与上述按需的抓手；",
    // 只有真的有工具循环时才要求读资料 —— 章节区那条链路没有工具，见函数注释
    ...(hasFileTools
      ? ["- 先读资料（list_chapters / read_chapter / list_outlines / read_outline）确认前文与已有章纲，再动笔；"]
      : []),
    "- 不要输出工具调用报告和分析过程。",
    "",
    "## 输出格式（缺一不可）",
    "只输出一个 ```json 围栏，顶层字段为 eventOutlineData：",
    "```json",
    example,
    "```",
    `（上面的 events 只演示单个事件的字段格式；实际必须按上面要求写满 ${eventCount} 个事件，用真实的 chapterNumber 与 targetWords。）`,
    "",
    "- title 写成「第N章 · 一句话章名」（章号带「第」「章」，中间用「·」分隔）——软件用它拼出正文的一级标题；",
    "- **不要手写 Markdown 细纲**，也不要写 HTML：软件会把这份结构化数据一个字段不落地还原成「# 事件细纲 · 第N章 章名」的正文。再手写一遍等于让用户为同一份内容付两次钱。围栏外最多留一句「已生成第N章事件细纲」的说明。",
  ].join("\n")
}

/**
 * 把事件细纲变成写作输入框里的提示词。
 *
 * 走「用户指定」这一档（FIELD_PRIORITY 最前）：不新增上下文数据源、不改 token 预算，
 * 由用户在写作现场确认后自行发送。
 */
export function eventOutlineToProsePrompt(data: EventOutlineData): string {
  const lines: string[] = [
    `请根据下面这份「事件细纲」写出第 ${data.chapterNumber} 章正文。`,
    "",
    "## 本章事件序列（必须按此顺序全部覆盖，不得跳过、不得调换顺序与因果）",
  ]
  data.events.forEach((event) => {
    lines.push(`${event.id}. ${event.title}`)
    event.points.forEach((point) => lines.push(`   - ${point}`))
  })
  if (data.endingHook.trim()) {
    lines.push("", "## 本章结尾钩子", data.endingHook)
  }
  // 用户要求为空时整节不出现：留下一个空标题会让模型去猜「要求是什么」。
  if (data.requirement?.trim()) {
    lines.push("", "## 用户对本章的要求", data.requirement.trim())
  }
  lines.push(
    "",
    "## 写作要求",
    `- 目标约 ${data.targetWords} 字，允许 ±10% 浮动；把这几个事件串成一个连贯的故事，因果与推进要交代清楚，不要写成事件流水账；场景、对话与人物神态点到为止，服务于故事本身；`,
    "- 只输出可直接保存到章节库的小说正文，不要解释，不要列提纲，不要输出工具调用报告。",
    "",
    DE_AI_GENERATION_RULES,
  )
  return lines.join("\n")
}
