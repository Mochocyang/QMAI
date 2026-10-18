/**
 * 卷纲折叠树 HTML 渲染（方案 B：系统套模板）。
 *
 * AI 只负责产出结构化数据（10 故事 × 10 环节），样式由技能目录下的
 * template.html 提供，由本模块读取模板并把数据注入，渲染出最终 HTML。
 *
 * ⚠️ 设计原则（2026-10-17 按用户要求重做）：**只留故事本身**。
 * 卷级定位 / 主题句 / 叙事形态 / 结构选用 / 悬念债务 / 对手推进 / 人物成长 /
 * 地点索引 / 伏笔追踪 / 人物出场表 / 整卷账本 / 三层线配比 / 期待感曲线 /
 * 反转类型分布 / 支线推进矩阵 / 节拍体检 / 环节完整性矩阵 —— 全部删除。
 *
 * 理由不是审美，而是成本：这些"仪表盘"每一样都要模型在 JSON 里多写一份数据
 * （position 6 个字段、roles 6 条、escalation 10 条、rivals/growth/places/
 * foreshadows/cast 各若干条），一个 10 故事的卷纲因此多出 3000+ 字输出，
 * 而写小说的人根本不会看这些表。省下来的每一个 token 都是用户的钱。
 *
 * 现在一个卷纲的数据只有三层：卷 → 故事（标题 + 章号）→ 环节（人物 + 3 条内容）。
 */

import templateHtml from "../../../skills/SkillHub/DagangSkill/juangangzhedieshu/template.html?raw"
import { fileExists, getExecutableDir, getResourceDir, listDirectory, readFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { parseChineseNumber } from "./chapter-utils"

export interface VolumeOutlineStage {
  stage: string
  /** 可选：该故事对这个环节的专属小标题（如「沐浴昏死」），与固定环节名并存。 */
  label?: string
  /** 出场人物（可带功能位备注）。 */
  who?: string
  /** 这个环节里具体发生了什么，2–3 条。 */
  p: string[]
}

export interface VolumeOutlineStory {
  id: number
  /** 章号范围（如「第 1–12 章」）。 */
  range: string
  title: string
  /**
   * 可选：12 章节拍序列（平升起紧落缓升紧顶缓顶悬）。
   * 卷纲视图不再展示它，但章纲要拿它对齐，所以仍然保留这个字段。
   */
  beats?: string
  st: VolumeOutlineStage[]
}

/**
 * 旧版台账字段（**只读兼容，不再生成、不再渲染**）。
 *
 * 4.3.5 及以前的卷纲结构里带 cast / rivals / foreshadows 三张表，
 * 章纲的「卷纲↔章纲」交叉校验会读它们。新版不再要求模型输出，
 * 但项目里已经存下的旧 .json 仍然解析进这三个字段，让老项目继续享有交叉校验。
 */
export interface VolumeOutlineCast {
  n: string
  role: string
  stories: string
  u: string
}

export interface VolumeOutlineRival {
  n: string
  moves: Array<{ id: number; v: string }>
}

export interface VolumeOutlineForeshadow {
  v: string
  seed: string
  pay: string
}

export interface VolumeOutlineData {
  title: string
  /** 本卷大高潮一句话目标（可空）。 */
  goal?: string
  stories: VolumeOutlineStory[]
  /** @deprecated 旧版字段，仅用于老项目兼容，不再生成/渲染。 */
  cast?: VolumeOutlineCast[]
  /** @deprecated 旧版字段，仅用于老项目兼容，不再生成/渲染。 */
  rivals?: VolumeOutlineRival[]
  /** @deprecated 旧版字段，仅用于老项目兼容，不再生成/渲染。 */
  foreshadows?: VolumeOutlineForeshadow[]
}

/**
 * 12 章节拍纪律体检：不连续 3 章同拍、顶最多 2 连、顶后接落/缓、悬落末章。
 * 卷纲视图不再展示体检面板，但章纲仍然用它校验逐章节拍，所以保留。
 */
export const BEATS_ALLOWED = ["平", "升", "起", "落", "缓", "紧", "顶", "悬"]

export const BEAT_INTENSITY: Record<string, number> = {
  平: 1, 缓: 1.6, 落: 2.2, 升: 2.8, 起: 3.2, 紧: 4.2, 悬: 4.6, 顶: 5,
}

export function checkBeats(beats: string): string[] {
  const list = Array.from(beats || "")
  const issues: string[] = []
  if (list.length !== 12) issues.push(`节拍数 ${list.length}（标准为 12）`)
  for (let index = 2; index < list.length; index += 1) {
    if (list[index] === list[index - 1] && list[index] === list[index - 2] && list[index] !== "顶") {
      issues.push(`第 ${index - 1}–${index + 1} 章连续 3 章同为「${list[index]}」`)
    }
  }
  let topRun = 0
  list.forEach((beat, index) => {
    topRun = beat === "顶" ? topRun + 1 : 0
    if (beat === "顶" && topRun > 2) issues.push(`第 ${index + 1} 章「顶」三连（最多 2 连）`)
  })
  for (let index = 0; index < list.length - 1; index += 1) {
    const next = list[index + 1]
    // 收尾的「顶 → 悬」是允许的写法（悬必须落在末章，由下一条规则单独把守）
    const closingHook = next === "悬" && index + 1 === list.length - 1
    if (list[index] === "顶" && !["落", "缓"].includes(next) && !closingHook) {
      issues.push(`第 ${index + 1} 章「顶」后接「${next}」（应接 落 / 缓，收尾的 顶→悬 除外）`)
    }
  }
  list.forEach((beat, index) => {
    if (beat === "悬" && index !== list.length - 1) issues.push(`第 ${index + 1} 章出现「悬」，但悬只能落在末章`)
  })
  const unknown = [...new Set(list.filter((beat) => !BEATS_ALLOWED.includes(beat)))]
  if (unknown.length) issues.push(`出现未知节拍「${unknown.join("")}」`)
  return [...new Set(issues)]
}

/**
 * 模板占位符。折叠树完全静态渲染（原生 details/summary），
 * 不依赖 JavaScript —— 软件内的预览 iframe 受 CSP 限制无法执行内联脚本。
 */
const TITLE_PLACEHOLDER = "__VOLUME_TITLE__"
const GOAL_PLACEHOLDER = "__VOLUME_GOAL__"
const CHIPS_PLACEHOLDER = "__VOLUME_CHIPS__"
const NAV_PLACEHOLDER = "__VOLUME_NAV__"
const TREE_PLACEHOLDER = "__VOLUME_TREE__"
const REQUIRED_PLACEHOLDERS = [
  TITLE_PLACEHOLDER,
  GOAL_PLACEHOLDER,
  CHIPS_PLACEHOLDER,
  NAV_PLACEHOLDER,
  TREE_PLACEHOLDER,
]

/** 程序运行目录下的模板相对路径（便携版 / 安装版通用）。 */
const TEMPLATE_RELATIVE_PATHS = [
  "skills/SkillHub/DagangSkill/juangangzhedieshu/template.html",
  "_up_/skills/SkillHub/DagangSkill/juangangzhedieshu/template.html",
]

/** 项目内可覆盖模板的相对路径（用户在项目里改样式，改完立即生效）。 */
const PROJECT_OVERRIDE_RELATIVE_PATH = ".qmai/卷纲模板.html"

/**
 * 当前生效模板。null 表示使用构建期内置模板。
 * 运行时按「项目目录覆盖 → 程序 skills 目录 → 内置」三级回退。
 */
let activeTemplate: string | null = null

/** 取当前生效的模板内容（默认内置模板）。 */
export function getVolumeOutlineTemplate(): string {
  return activeTemplate ?? templateHtml
}

/** 供测试重置运行时模板状态。 */
export function resetVolumeOutlineTemplateForTest(): void {
  activeTemplate = null
}

async function resolveRuntimeDirs(): Promise<string[]> {
  const dirs: string[] = []
  try {
    dirs.push(normalizePath(await getExecutableDir()))
  } catch {
    // 非 Tauri 环境（浏览器/测试）没有可执行目录，忽略
  }
  try {
    dirs.push(normalizePath(await getResourceDir()))
  } catch {
    // 同上
  }
  return dirs
}

/**
 * 预加载运行时模板：优先项目目录覆盖，其次程序 skills 目录，最后回退内置模板。
 * 读取失败或内容缺少占位符时静默回退，不影响主流程。
 */
export async function primeVolumeOutlineTemplate(projectPath?: string | null): Promise<void> {
  const candidates: string[] = []
  if (projectPath?.trim()) {
    candidates.push(`${normalizePath(projectPath)}/${PROJECT_OVERRIDE_RELATIVE_PATH}`)
  }
  for (const dir of await resolveRuntimeDirs()) {
    for (const relative of TEMPLATE_RELATIVE_PATHS) {
      candidates.push(`${dir}/${relative}`)
    }
  }

  for (const candidate of candidates) {
    try {
      if (!(await fileExists(candidate))) continue
      const content = await readFile(candidate)
      if (REQUIRED_PLACEHOLDERS.every((placeholder) => content.includes(placeholder))) {
        activeTemplate = content
        return
      }
    } catch {
      // 单个候选读取失败继续尝试下一个
    }
  }
  activeTemplate = null
}

const REQUIRED_STAGES = [
  "起①", "起②", "起③", "承①", "承②", "承③", "转①", "转②", "合①", "合②",
]

const MIN_STORY_COUNT = 10
const MIN_STAGE_COUNT = 10
const MIN_ENTRY_COUNT = 3

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim()
  // 数字同样接住：`"who": 3`、「章号范围」写成数字一类的偏差不该让整格变空。
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return ""
}

/**
 * 故事序号归一化：数字 / 数字字符串都认，认不出才回退到序号。
 *
 * 序号是锚点导航的 id（`#story-N`）。旧写法只认 number，模型把 id 写成 `"2"`
 * 时就会退化成 `index + 1` —— 两个故事可能拿到同一个 id，导航点第二个跳到第一个，
 * 而页面上完全看不出异常。
 */
function storyNumberOf(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value)
  const digits = asString(value).match(/\d+/)?.[0]
  const num = digits ? Number.parseInt(digits, 10) : Number.NaN
  return Number.isFinite(num) && num > 0 ? num : fallback
}

/**
 * 12 章节拍的容错读取：模型既可能给字符串（「平升起紧落缓升紧顶缓顶悬」），
 * 也可能给数组（["平","升",…]）。数组形态按顺序无损拼成字符串。
 */
function asBeatSequence(value: unknown): string {
  if (!Array.isArray(value)) return ""
  return value.map((item) => asString(item)).filter(Boolean).join("")
}

function escapeHtml(value: unknown): string {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const STAGE_META: Array<{ id: string; k: string; name: string }> = [
  { id: "起①", k: "qi", name: "常态与破口" },
  { id: "起②", k: "qi", name: "人物站定" },
  { id: "起③", k: "qi", name: "目标与代价" },
  { id: "承①", k: "cheng", name: "尝试与失败" },
  { id: "承②", k: "cheng", name: "资源拼图" },
  { id: "承③", k: "cheng", name: "中点反转" },
  { id: "转①", k: "zhuan", name: "认知反转" },
  { id: "转②", k: "zhuan", name: "代价抉择" },
  { id: "合①", k: "he", name: "小高潮" },
  { id: "合②", k: "he", name: "引线与余震" },
]

/**
 * 12 章内 10 环节的固定章号定位（相对本故事）。
 * 起①=第1章、起②=第2章、起③=第3章、承①=第4–5章、承②=第6–7章、
 * 承③=第8–9章、转①=第10章、转②=第11章、合①=第11–12章、合②=第12章。
 */
export const STAGE_CHAPTER_MAP: Record<string, string> = {
  "起①": "第 1 章",
  "起②": "第 2 章",
  "起③": "第 3 章",
  "承①": "第 4–5 章",
  "承②": "第 6–7 章",
  "承③": "第 8–9 章",
  "转①": "第 10 章",
  "转②": "第 11 章",
  "合①": "第 11–12 章",
  "合②": "第 12 章",
}

function detailsNode(summaryHtml: string, kidsHtml: string, open: boolean): string {
  return `<details class="nd"${open ? " open" : ""}><summary>${summaryHtml}</summary><div class="kids">${kidsHtml}</div></details>`
}

function stageNode(index: number, stage: VolumeOutlineStage): string {
  const meta = STAGE_META.find((item) => item.id === stage.stage) ?? STAGE_META[index] ?? { id: stage.stage, k: "qi", name: "" }
  const chapterLabel = STAGE_CHAPTER_MAP[stage.stage] ?? ""
  // 环节名 = 固定环节名（常态与破口）＋ 该故事的专属小标题（沐浴昏死）。
  const stageTitle = stage.label && stage.label !== meta.name
    ? (meta.name ? `${meta.name} · ${stage.label}` : stage.label)
    : meta.name
  const tags = chapterLabel ? `<span class="tag chap">${escapeHtml(chapterLabel)}</span>` : ""
  const summary = `<span class="line"><span class="k k-${meta.k}">${escapeHtml(meta.id)}</span><span class="t2">${escapeHtml(stageTitle)}</span>${tags}</span>`
  const kids = [
    stage.who ? `<div class="who"><span class="lb">人物</span><span class="nm">${escapeHtml(stage.who)}</span></div>` : "",
    ...stage.p.map((item) => `<p class="txt">${escapeHtml(item)}</p>`),
  ].join("")
  return detailsNode(summary, kids, true)
}

function storyNode(story: VolumeOutlineStory): string {
  const summary = `<span class="line"><span class="k k-s">${escapeHtml(story.range || "章号未定")}</span><span class="t">${escapeHtml(String(story.id))}. ${escapeHtml(story.title || "未命名故事")}</span></span>`
  const kids = story.st.length
    ? story.st.map((stage, index) => stageNode(index, stage)).join("")
    : `<p class="empty">这个故事还没有环节内容，请重新生成。</p>`
  return `<div class="story-wrap" id="story-${escapeHtml(String(story.id))}">${detailsNode(summary, kids, true)}</div>`
}

/** 生成静态折叠树 HTML（无 JavaScript，原生 details/summary 折叠，默认全部展开）。 */
function buildTreeHtml(data: VolumeOutlineData): string {
  const stories = data.stories
  return stories.length
    ? stories.map((story) => storyNode(story)).join("")
    : `<p class="empty">未包含卷纲数据（stories 为空），请重新生成卷纲。</p>`
}

/** 故事锚点导航（纯静态 a[href=#story-N] + :target 高亮，不依赖脚本）。 */
function buildNavHtml(data: VolumeOutlineData): string {
  if (data.stories.length === 0) return ""
  const links = data.stories.map((story) =>
    `<a class="navlink" href="#story-${escapeHtml(String(story.id))}"><b>${escapeHtml(String(story.id))}</b>${escapeHtml(story.title || "未命名")}</a>`).join("")
  return `<nav class="nav"><span class="navt">跳到故事</span>${links}</nav>`
}

/** 解析「第 1–12 章」这类章节范围，取起止章号。 */
function parseChapterRange(range: string): { start: number; end: number } | null {
  const numbers = String(range).match(/\d+/g)
  if (!numbers || numbers.length === 0) return null
  const start = Number(numbers[0])
  const end = numbers.length > 1 ? Number(numbers[1]) : start
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return { start, end }
}

/** 全卷章数：优先按各故事章号范围汇总，解析不到时按 12 章 / 故事估算。 */
function volumeChapterStats(data: VolumeOutlineData): { total: number; estimated: boolean } {
  const parsed = data.stories.map((story) => parseChapterRange(story.range))
  if (parsed.length > 0 && parsed.every((item) => item)) {
    return {
      total: parsed.reduce((sum, item) => sum + (item!.end - item!.start + 1), 0),
      estimated: false,
    }
  }
  return { total: data.stories.length * 12, estimated: true }
}

function buildChipsHtml(data: VolumeOutlineData): string {
  const stats = volumeChapterStats(data)
  return [
    `<span class="chip"><b>${data.stories.length}</b> 个故事</span>`,
    `<span class="chip"><b>${stats.total}</b> 章${stats.estimated ? "（估算）" : ""}</span>`,
  ].join("")
}

/**
 * 用模板渲染卷纲 HTML。
 * 纯静态（无脚本），避免软件预览 iframe 因 CSP 拦截内联脚本而显示空白。
 */
export function renderVolumeOutlineHtml(
  data: VolumeOutlineData,
  template: string = getVolumeOutlineTemplate(),
): string {
  /*
   * 卷纲提示词明确禁止输出「卷级定位（卷定位 / 主题句 / …）」（见
   * `outline-chat-panel.tsx#getOutlineSectionOutputRules`），所以新产线的
   * `goal` **恒为空**。模板里是 `<p class="goal">__VOLUME_GOAL__</p>`，而 `.goal`
   * 的 `line-height` 是 1.95 —— 空标签会在 H1 与芯片行之间撑出整整一行（约 29px）
   * 的空白，看着像「标题下面漏了一块内容」。
   *
   * 在**渲染器**里整块摘掉，而不是只给内置模板补一条 `.goal:empty{display:none}`：
   * 用户放在 `.qmai/卷纲模板.html` 的覆盖模板不受我们控制，靠模板侧兜底会漏。
   * 只摘「元素内容就是这个占位符」的那种（带空白也算），里面还有别的子节点的
   * 原样保留 —— 那种模板是有意留位置的，清空会把它的排版打乱。
   */
  const goalText = (data.goal ?? "").trim()
  const goalOnlyElement = new RegExp(`<([a-zA-Z][\\w-]*)([^>]*)>\\s*${GOAL_PLACEHOLDER}\\s*</\\1>`, "i")
  const base = goalText ? template : template.replace(goalOnlyElement, "")
  const placeholders: Record<string, string> = {
    [TITLE_PLACEHOLDER]: escapeHtml(data.title || "卷纲"),
    [GOAL_PLACEHOLDER]: escapeHtml(data.goal ?? ""),
    [CHIPS_PLACEHOLDER]: buildChipsHtml(data),
    [NAV_PLACEHOLDER]: buildNavHtml(data),
    [TREE_PLACEHOLDER]: buildTreeHtml(data),
  }
  // 用函数替换器，避免内容里的 $& / $1 等被当作替换模式
  const html = Object.entries(placeholders).reduce(
    (output, [placeholder, value]) => output.replace(placeholder, () => value),
    base,
  )
  /*
   * 旧版模板（用户自己放在 .qmai/卷纲模板.html 的）里可能还留着已删除面板的
   * 占位符（__VOLUME_LEDGER__ 等）。这里统一清空，绝不能让占位符原文漏到页面上。
   */
  return html.replace(/__VOLUME_[A-Z_]+__/g, "")
}

/**
 * 由结构化数据反推 MD 正文。
 *
 * 为什么需要它：MD 正文里的每一个字都能从结构化数据里原样得到，让模型
 * 再写一遍等于让用户为同一份内容付两遍输出费。所以提示词里已经取消
 * 「MD 正文」这一项，保存时由这里生成，保证 .md 与 .html 内容一致。
 */
export function renderVolumeOutlineMarkdown(data: VolumeOutlineData): string {
  const lines: string[] = [`# ${data.title || "卷纲"}`, ""]
  if (data.goal?.trim()) {
    lines.push(`> ${data.goal.trim()}`, "")
  }
  data.stories.forEach((story) => {
    lines.push(`## 故事${story.id}${story.title ? `：${story.title}` : ""}`, "")
    // 空字段不导出：「未定」是编辑界面的占位提示，写进 .md 只是噪声。
    if (story.range?.trim()) lines.push(`- **章号范围：** ${story.range.trim()}`)
    if (story.beats?.trim()) lines.push(`- **章情节拍：** ${story.beats.trim()}`)
    lines.push("")
    story.st.forEach((stage, index) => {
      const meta = STAGE_META.find((item) => item.id === stage.stage) ?? STAGE_META[index]
      const heading = meta?.name ? `${stage.stage || meta.id} ${meta.name}` : (stage.stage || meta?.id || "")
      /*
       * 环节小标题与固定环节名相同时不重复拼（「常态与破口 · 常态与破口」）——
       * HTML 视图的 `stageNode` 已经是这个口径，两边必须一致，否则同一份卷纲
       * 存成 .md 和 .html 会读出两种标题。
       */
      const label = stage.label?.trim() && stage.label.trim() !== meta?.name ? ` · ${stage.label.trim()}` : ""
      // 环节本身没有任何内容时连标题一起跳过：只留 10 个空环节名，读起来像模板骨架。
      const points = stage.p.map((item) => item.trim()).filter(Boolean)
      if (points.length === 0 && !stage.who?.trim()) return
      lines.push(`### ${heading}${label}`, "")
      if (stage.who?.trim()) lines.push(`- **人物：** ${stage.who.trim()}`)
      points.forEach((item) => lines.push(`- ${item}`))
      lines.push("")
    })
  })
  return lines.join("\n").trimEnd() + "\n"
}

/** 归一化 AI 输出的卷纲数据（容错：字段缺失取空、类型不符丢弃）。 */
export function normalizeVolumeOutlineData(raw: unknown): VolumeOutlineData | null {
  if (!isRecord(raw)) return null
  const storiesRaw = Array.isArray(raw.stories) ? raw.stories : []
  const stories: VolumeOutlineStory[] = storiesRaw.filter(isRecord).map((item, index) => {
    const stRaw = Array.isArray(item.st) ? item.st : []
    const stages = stRaw.filter(isRecord).map((stage) => {
      /*
       * 环节标识必须容忍别名。
       *
       * 实测故障（2026-10-09）：模型把 10 个环节写成 `{ "k": "起①", "name": "沐浴昏死", … }`
       * —— 内容一条不少，只是键名用了 k。旧代码只读 stage，于是整批环节被静默丢成空串，
       * 校验器随后报「第 N 个故事缺少环节 起①…合②」（10 故事 × 10 环节 = 100 项假警报）。
       */
      const stageId = asString(stage.stage)
        || asString(stage.k)
        || asString(stage.stageId)
        || asString(stage.key)
        || asString(stage.phase)
        || asString(stage.id)
      return {
        stage: stageId,
        label: asString(stage.name) || asString(stage.label) || asString(stage.title),
        who: asString(stage.who),
        /*
         * `p` 三种形态都要接：字符串数组（提示词口径）、单个字符串、
         * `[{"v": "…"}] / [{"text": "…"}]` 对象数组。
         * 旧写法对非数组直接给 `[]` —— 模型把三条事件合成一段字符串写进 `p` 时，
         * 这个环节在折叠树里就只剩标题，正文一个字都没有（数据明明在）。
         */
        p: (Array.isArray(stage.p) ? stage.p : [stage.p])
          .map((entry) => (isRecord(entry) ? asString(entry.v) || asString(entry.text) : asString(entry)))
          .filter(Boolean),
      }
    })
    return {
      id: storyNumberOf(item.id, index + 1),
      range: asString(item.range),
      title: asString(item.title) || asString(item.name),
      beats: asString(item.beats) || asBeatSequence(item.beats),
      st: stages,
    }
  })
  if (stories.length === 0) return null

  // 旧版台账字段：只读兼容，新生成的卷纲不会再有这三个字段
  const cast = (Array.isArray(raw.cast) ? raw.cast : []).filter(isRecord)
    .map((item) => ({
      n: asString(item.n),
      role: asString(item.role),
      stories: asString(item.stories),
      u: asString(item.u),
    }))
    .filter((item) => item.n)
  const rivals = (Array.isArray(raw.rivals) ? raw.rivals : []).filter(isRecord)
    .map((item) => ({
      n: asString(item.n),
      moves: (Array.isArray(item.moves) ? item.moves : []).filter(isRecord)
        .map((move, index) => ({ id: typeof move.id === "number" ? move.id : index + 1, v: asString(move.v) }))
        .filter((move) => move.v),
    }))
    .filter((item) => item.n)
  const foreshadows = (Array.isArray(raw.foreshadows) ? raw.foreshadows : []).filter(isRecord)
    .map((item) => ({ v: asString(item.v), seed: asString(item.seed), pay: asString(item.pay) }))
    .filter((item) => item.v || item.seed || item.pay)

  return {
    title: asString(raw.title) || "卷纲",
    ...(asString(raw.goal) ? { goal: asString(raw.goal) } : {}),
    stories,
    ...(cast.length ? { cast } : {}),
    ...(rivals.length ? { rivals } : {}),
    ...(foreshadows.length ? { foreshadows } : {}),
  }
}

/** 校验卷纲数据是否完整（10 故事 × 10 环节 × 3 条目）。 */
export function validateVolumeOutlineData(
  data: VolumeOutlineData | null,
  md = "",
): { ok: boolean; problems: string[] } {
  const problems: string[] = []

  if (!data) {
    problems.push(
      md.trim()
        ? "未解析到卷纲结构化数据（volumeOutlineData），无法渲染 HTML。"
        : "未解析到卷纲结构化数据（volumeOutlineData），无法生成卷纲。",
    )
    return { ok: false, problems }
  }

  if (data.stories.length < MIN_STORY_COUNT) {
    problems.push(`故事数量不足 10 个（当前 ${data.stories.length} 个）。`)
  }

  data.stories.forEach((story, index) => {
    const label = `第 ${index + 1} 个故事`
    if (!story.title) problems.push(`${label}缺少故事标题。`)
    if (!story.range) problems.push(`${label}缺少章号范围 range。`)
    if (story.st.length < MIN_STAGE_COUNT) {
      problems.push(`${label}环节不足 10 个（当前 ${story.st.length} 个）。`)
    }
    const stageIds = story.st.map((stage) => stage.stage)
    for (const required of REQUIRED_STAGES) {
      if (!stageIds.includes(required)) problems.push(`${label}缺少环节「${required}」。`)
    }
    story.st.forEach((stage) => {
      if (stage.p.length < MIN_ENTRY_COUNT) {
        problems.push(`${label}「${stage.stage || "未知环节"}」内容不足 3 条（当前 ${stage.p.length} 条）。`)
      }
    })
  })

  return { ok: problems.length === 0, problems }
}

/** 从一段候选文本里扫出所有 `{`…`}` 平衡块。 */
function balancedJsonBlock(candidate: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < candidate.length; index += 1) {
    const ch = candidate[index]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === "{") depth += 1
    else if (ch === "}") {
      depth -= 1
      if (depth === 0) return candidate.slice(start, index + 1)
    }
  }
  return null
}

/**
 * 解析 AI 回复里**所有**卷纲结构化数据块（不只是第一份）。
 *
 * 为什么需要「所有」：一条回复里完全可能出现两份 volumeOutlineData
 * （用户说「卷一和卷二一起写」，模型就照做了），而两个保存请求共用同一段原文。
 * 只取第一份会让两个文件都写进卷一的内容 —— 文本与折叠树都不是用户要的那一卷，
 * 而且文件确实生成成功了，谁都不会发现。
 */
export function extractVolumeOutlineDataList(text: string): VolumeOutlineData[] {
  const candidates: string[] = []
  const fencePattern = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi
  for (const match of text.matchAll(fencePattern)) {
    if (/volumeOutlineData/i.test(match[1])) candidates.push(match[1])
  }
  if (candidates.length === 0 && /volumeOutlineData/i.test(text)) {
    candidates.push(text)
  }

  const result: VolumeOutlineData[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    let cursor = 0
    let start = candidate.indexOf("{", cursor)
    while (start >= 0) {
      const block = balancedJsonBlock(candidate, start)
      if (!block) break
      try {
        const payload = JSON.parse(block) as unknown
        const raw = isRecord(payload) && isRecord(payload.volumeOutlineData)
          ? payload.volumeOutlineData
          : payload
        const normalized = normalizeVolumeOutlineData(raw)
        if (normalized) {
          const key = `${normalized.title}|${normalized.stories.length}|${normalized.stories[0]?.range ?? ""}`
          if (!seen.has(key)) {
            seen.add(key)
            result.push(normalized)
          }
        }
        // 命中一个完整对象就跳过它：里面的 stories / st 不是卷纲数据本身
        cursor = start + block.length
      } catch {
        cursor = start + 1
      }
      start = candidate.indexOf("{", cursor)
    }
  }
  return result
}

/**
 * 「第二卷」/「卷二」/「卷2」/「第 12 卷」里的卷序号；取不到返回 null。
 *
 * 两种语序都要认：标题普遍写成「卷二 千碑之城」（卷在前、序号在后，**不带第**），
 * 文件名则多写成「卷纲-第二卷.md」（第在前）。只认一种的话，多卷并存时匹配不上，
 * 会退回「取最全的那份」，第二个文件还是拿到第一卷的内容。
 */
function volumeOrdinal(text: string): number | null {
  const source = String(text ?? "")
  const match = source.match(/第\s*(\d+|[零〇一二三四五六七八九十百千万两]+)\s*卷/)
    ?? source.match(/卷\s*(\d+|[零〇一二三四五六七八九十百千万两]+)/)
  if (!match) return null
  const raw = match[1]
  if (/^\d+$/.test(raw)) return Number(raw)
  return parseChineseNumber(raw)
}

/** 数据完整度打分：故事数优先，其次环节数与条目数。用于无法按卷号匹配时取「最全的那份」。 */
function volumeDataScore(data: VolumeOutlineData): number {
  return data.stories.length * 1000
    + data.stories.reduce((sum, story) => sum
      + story.st.length * 20
      + story.st.reduce((count, stage) => count + stage.p.length, 0), 0)
}

/**
 * 给一个卷纲保存请求挑出「这一段原文里属于它的那份」结构化数据。
 *
 * 只有一份时直接用；多份时按「文件名 / sourceIntent 的卷序号」与数据标题里的卷序号对齐，
 * 对不上则取最完整的那份（而不是盲取第一份）。
 */
export function pickVolumeOutlineDataForRequest(
  text: string,
  request: { fileName?: string; sourceIntent?: string },
): VolumeOutlineData | null {
  const list = extractVolumeOutlineDataList(text)
  if (list.length === 0) return null
  if (list.length === 1) return list[0]
  const wanted = [request.fileName, request.sourceIntent]
    .map((value) => volumeOrdinal(value ?? ""))
    .filter((value): value is number => value !== null)
  if (wanted.length > 0) {
    const hit = list.find((data) => {
      const ordinal = volumeOrdinal(data.title)
      return ordinal !== null && wanted.includes(ordinal)
    })
    if (hit) return hit
  }
  return [...list].sort((a, b) => volumeDataScore(b) - volumeDataScore(a))[0]
}

/** 从 AI 回复中提取并解析 volumeOutlineData（优先在 ```json 围栏内查找）。 */
export function extractVolumeOutlineData(text: string): VolumeOutlineData | null {
  const list = extractVolumeOutlineDataList(text)
  return list.length > 0 ? list[0] : null
}

/** 供测试使用：模板是否成功加载。 */
export const VOLUME_OUTLINE_TEMPLATE_READY = REQUIRED_PLACEHOLDERS.every((placeholder) =>
  templateHtml.includes(placeholder))

/**
 * 给卷纲保存请求补上 htmlContent（以及缺失的 MD 正文）：
 * 若请求是卷纲，则优先用 AI 原文的 volumeOutlineData 套模板渲染 HTML；
 * 只有现有 htmlContent 确实是 HTML 文档时才原样保留。非卷纲请求原样返回。
 */
export function attachVolumeOutlineHtml<
  T extends { fileType: string; htmlContent?: string; content: string; structuredData?: string; fileName?: string; sourceIntent?: string },
>(request: T, sourceText: string): T {
  if (request.fileType !== "volume-outline") return request
  const existing = request.htmlContent?.trim() ?? ""
  // 与保存正文同一口径挑数据：一条回复里有两卷时，不能两个文件都用第一卷的折叠树
  const data = pickVolumeOutlineDataForRequest(sourceText, request)
  // 数据可解析时始终带上结构化数据（保存为伴生 .json，供章纲做交叉校验）
  const withData = data ? { ...request, structuredData: JSON.stringify(data) } : request
  const withContent = data && !request.content.trim()
    ? { ...withData, content: renderVolumeOutlineMarkdown(data) }
    : withData
  // 已有真正的 HTML 文档则保留原 HTML
  if (/<html[\s>]/i.test(existing)) return withContent
  if (!data) return existing ? { ...withContent, htmlContent: undefined } : withContent
  return { ...withContent, htmlContent: renderVolumeOutlineHtml(data) }
}

/** 卷纲保存目录（伴生 .json 与 .md/.html 同目录）。 */
const SAVED_VOLUME_DIR_RELATIVE = "wiki/outlines/卷纲"

/**
 * 读取项目里已保存的卷纲结构化数据（伴生 .json），供章纲做「卷纲↔章纲」交叉校验。
 * 目录不存在、没有 .json、或单个文件损坏时静默跳过，返回空数组。
 */
export async function loadSavedVolumeOutlineDataList(projectPath: string): Promise<VolumeOutlineData[]> {
  if (!projectPath?.trim()) return []
  const dir = `${normalizePath(projectPath)}/${SAVED_VOLUME_DIR_RELATIVE}`
  let nodes: Array<{ name: string; path: string; is_dir: boolean }> = []
  try {
    nodes = await listDirectory(dir)
  } catch {
    return []
  }
  const files = nodes.filter((node) => !node.is_dir && /\.json$/i.test(node.name))
  const result: VolumeOutlineData[] = []
  for (const file of files) {
    try {
      const parsed = JSON.parse(await readFile(file.path)) as unknown
      const normalized = normalizeVolumeOutlineData(parsed)
      if (normalized) result.push(normalized)
    } catch {
      // 单个文件损坏不影响其它卷纲
    }
  }
  return result
}

/** 把卷纲结构化数据整理成「真骨架参考清单」，供章纲提示词原样引用。 */
export function buildVolumeSkeletonReference(volumes: VolumeOutlineData[]): string {
  const lines: string[] = []
  volumes.forEach((volume) => {
    volume.stories.forEach((story) => {
      const beatsPart = story.beats ? `｜节拍：${story.beats}` : ""
      lines.push(
        `- 卷《${volume.title || "未命名卷"}》故事${story.id}${story.title ? ` ${story.title}` : ""}｜章号区间：${story.range || "未填"}${beatsPart}`,
      )
    })
  })
  if (lines.length === 0) {
    return [
      "【卷纲骨架】项目里还没有可用的卷纲结构化数据（伴生 .json）。",
      "此时 story 骨架（index / name / range / beats）必须从卷纲 MD 原文**逐字抄写**，不得改写或自创。",
    ].join("\n")
  }
  return [
    "【卷纲真骨架（必须原样使用）】本次要拆的故事必须从下面清单里选一个，story 字段（index / name / range / beats）必须**逐字原样复制**，禁止改写、拼接或自创：",
    ...lines,
    "若清单里没有你要拆的故事，说明该卷纲还没用新版保存过，此时才允许从卷纲 MD 原文逐字抄写。",
  ].join("\n")
}

/** 运行时缓存的卷纲真骨架参考文本（像模板一样预加载，供同步的提示词拼装使用）。 */
let activeVolumeSkeletonReference: string | null = null

/** 取当前缓存的卷纲骨架参考文本；未预加载时返回空串。 */
export function getVolumeSkeletonReference(): string {
  return activeVolumeSkeletonReference ?? ""
}

/** 供测试重置运行时缓存。 */
export function resetVolumeSkeletonReferenceForTest(): void {
  activeVolumeSkeletonReference = null
}

/**
 * 预加载卷纲真骨架参考文本：读取项目已保存的卷纲伴生 .json 并整理成清单。
 * 没有数据时不写缓存（提示词会退回「从卷纲 MD 逐字抄写」的说明）。
 */
export async function primeVolumeSkeletonReference(projectPath?: string | null): Promise<void> {
  if (!projectPath?.trim()) {
    activeVolumeSkeletonReference = null
    return
  }
  try {
    const volumes = await loadSavedVolumeOutlineDataList(projectPath)
    activeVolumeSkeletonReference = volumes.length > 0
      ? buildVolumeSkeletonReference(volumes)
      : null
  } catch {
    activeVolumeSkeletonReference = null
  }
}
