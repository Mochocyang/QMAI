/**
 * 卷纲折叠树 HTML 渲染（方案 B：系统套模板）。
 *
 * AI 只负责产出结构化数据（10 故事 × 10 环节），样式由技能目录下的
 * template.html 提供，由本模块读取模板并把数据注入，渲染出最终 HTML。
 * 好处：样式 100% 一致、AI 输出量减半不易截断、校验只需针对数据。
 */

import templateHtml from "../../../skills/SkillHub/DagangSkill/juangangzhedieshu/template.html?raw"
import { fileExists, getExecutableDir, getResourceDir, listDirectory, readFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export interface VolumeOutlineStage {
  stage: string
  who: string
  use: string
  p: string[]
  /** 可选：该环节埋下的期待在哪里兑现（如「合①」「故事五 承②」）。 */
  pay?: string
}

/** 伏笔追踪：埋设位置 → 回收位置。 */
export interface VolumeOutlineForeshadow {
  /** 伏笔内容 */
  v: string
  /** 埋设位置（如「故事一 起①」） */
  seed: string
  /** 回收位置（如「故事五 合①」），留空表示尚未回收 */
  pay: string
}

/** 人物出场表。 */
export interface VolumeOutlineCast {
  /** 人物名 */
  n: string
  /** 功能位（引路 / 阻力 / 镜子 / 代价 / 主角 / 预埋） */
  role: string
  /** 出场故事（如「1–4、7」） */
  stories: string
  /** 作用 */
  u: string
}

/** 卷级定位。 */
export interface VolumeOutlinePosition {
  /** 卷定位一句话 */
  pitch: string
  /** 主题句 */
  theme: string
  /** 叙事形态（本卷讲什么、从哪走到哪） */
  narrative: string
  /** 结构选用声明（全卷用哪个结构 / 单故事用哪个 / 逐章用什么 / 为什么不用其余） */
  structure: string
  /** 建议章数 */
  chapters: string
  /** 卷末落点 */
  ending: string
}

/** 卷级功能位总览。 */
export interface VolumeOutlineRole {
  /** 功能位（引路 / 主角 / 阻力 / 镜子 / 代价 / 预埋） */
  n: string
  /** 承担者与作用 */
  v: string
}

/** 大高潮分解 + 代价阶梯。 */
export interface VolumeOutlineEscalation {
  /** 故事序号 */
  id: number
  /** 赌注等级 */
  stake: string
  /** 本故事付出的代价（失去什么） */
  lose: string
  /** 抬升到什么（离大高潮又近一步在哪） */
  rise: string
}

/** 悬念债务（本卷结束时仍悬而未决的问题）。 */
export interface VolumeOutlineDebt {
  /** 悬而未决的问题 */
  q: string
  /** 从哪个位置开始悬着 */
  from: string
  /** 计划在哪里回收 */
  plan: string
}

/** 对手推进表。 */
export interface VolumeOutlineRival {
  /** 对手 / 组织名 */
  n: string
  /** 每个故事的出手目标与动作 */
  moves: Array<{ id: number; v: string }>
}

/** 人物成长与资源表。 */
export interface VolumeOutlineGrowth {
  /** 人物 */
  n: string
  /** 获得物 / 资源演进 */
  gains: string
  /** 能力与状态变化 */
  state: string
}

/** 地点 / 组织索引。 */
export interface VolumeOutlinePlace {
  /** 名称 */
  n: string
  /** 类型：地点 / 组织 */
  kind: string
  /** 出场故事 */
  stories: string
  /** 剧情作用 */
  u: string
}

export interface VolumeOutlineStory {
  id: number
  range: string
  title: string
  deliver: string
  gift: string
  mid: string
  twist: string
  hook: string
  climax: string
  beats: string
  line: {
    main: string
    sub: Array<{ n: string; v: string }>
    daily: { v: string; u: string }
  }
  st: VolumeOutlineStage[]
  /** 可选：本故事的引线在下一故事如何被接住（闭环说明）。 */
  link?: string
}

export interface VolumeOutlineData {
  title: string
  goal: string
  stories: VolumeOutlineStory[]
  /** 可选：卷级定位（卷定位 / 主题句 / 叙事形态 / 结构选用 / 建议章数 / 卷末落点）。 */
  position?: VolumeOutlinePosition
  /** 可选：卷级功能位总览（引路 / 主角 / 阻力 / 镜子 / 代价 / 预埋）。 */
  roles?: VolumeOutlineRole[]
  /** 可选：伏笔追踪表（埋设 → 回收）。 */
  foreshadows?: VolumeOutlineForeshadow[]
  /** 可选：人物出场表。 */
  cast?: VolumeOutlineCast[]
  /** 可选：大高潮分解 + 代价阶梯（每个故事的赌注 / 代价 / 抬升）。 */
  escalation?: VolumeOutlineEscalation[]
  /** 可选：悬念债务（本卷结束时仍悬而未决的问题）。 */
  debts?: VolumeOutlineDebt[]
  /** 可选：对手推进表。 */
  rivals?: VolumeOutlineRival[]
  /** 可选：人物成长与资源表。 */
  growth?: VolumeOutlineGrowth[]
  /** 可选：地点 / 组织索引。 */
  places?: VolumeOutlinePlace[]
}

/**
 * 模板占位符。折叠树完全静态渲染（原生 details/summary），
 * 不依赖 JavaScript —— 软件内的预览 iframe 受 CSP 限制无法执行内联脚本。
 */
const TITLE_PLACEHOLDER = "__VOLUME_TITLE__"
const GOAL_PLACEHOLDER = "__VOLUME_GOAL__"
const CHIPS_PLACEHOLDER = "__VOLUME_CHIPS__"
const POSITION_PLACEHOLDER = "__VOLUME_POSITION__"
const NAV_PLACEHOLDER = "__VOLUME_NAV__"
const LEDGER_PLACEHOLDER = "__VOLUME_LEDGER__"
const REVERSALS_PLACEHOLDER = "__VOLUME_REVERSALS__"
const SIDELINES_PLACEHOLDER = "__VOLUME_SIDELINES__"
const HOOKS_PLACEHOLDER = "__VOLUME_HOOKS__"
const ESCALATION_PLACEHOLDER = "__VOLUME_ESCALATION__"
const RIVALS_PLACEHOLDER = "__VOLUME_RIVALS__"
const FORESHADOWS_PLACEHOLDER = "__VOLUME_FORESHADOWS__"
const CAST_PLACEHOLDER = "__VOLUME_CAST__"
const PACING_PLACEHOLDER = "__VOLUME_PACING__"
const TREE_PLACEHOLDER = "__VOLUME_TREE__"
const REQUIRED_PLACEHOLDERS = [
  TITLE_PLACEHOLDER,
  GOAL_PLACEHOLDER,
  CHIPS_PLACEHOLDER,
  POSITION_PLACEHOLDER,
  NAV_PLACEHOLDER,
  LEDGER_PLACEHOLDER,
  REVERSALS_PLACEHOLDER,
  SIDELINES_PLACEHOLDER,
  HOOKS_PLACEHOLDER,
  ESCALATION_PLACEHOLDER,
  RIVALS_PLACEHOLDER,
  FORESHADOWS_PLACEHOLDER,
  CAST_PLACEHOLDER,
  PACING_PLACEHOLDER,
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
const MIN_RIVAL_MOVE_COUNT = 2

/** 卷级功能位总览必须覆盖的六个功能位。 */
const REQUIRED_ROLES = ["引路", "主角", "阻力", "镜子", "代价", "预埋"]

/** 卷级定位必须填全的六个字段。 */
const REQUIRED_POSITION_KEYS: Array<keyof VolumeOutlinePosition> = [
  "pitch", "theme", "narrative", "structure", "chapters", "ending",
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function escapeHtml(value: unknown): string {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const STAGE_META: Array<{ id: string; k: string; name: string; exp: string }> = [
  { id: "起①", k: "qi", name: "常态与破口", exp: "好奇期待" },
  { id: "起②", k: "qi", name: "人物站定", exp: "关系期待" },
  { id: "起③", k: "qi", name: "目标与代价预告", exp: "危机期待" },
  { id: "承①", k: "cheng", name: "尝试与失败", exp: "翻盘期待" },
  { id: "承②", k: "cheng", name: "资源拼图", exp: "成长期待" },
  { id: "承③", k: "cheng", name: "中点反转", exp: "反转期待" },
  { id: "转①", k: "zhuan", name: "认知反转", exp: "真相期待" },
  { id: "转②", k: "zhuan", name: "代价抉择", exp: "情感期待" },
  { id: "合①", k: "he", name: "小高潮兑现", exp: "爽点期待" },
  { id: "合②", k: "he", name: "引线与余震", exp: "续航期待" },
]

function leafRow(text: string): string {
  return `<div class="leafrow"><span class="sp"></span><div class="body"><div class="txt">${escapeHtml(text)}</div></div></div>`
}

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

function lineNode(story: VolumeOutlineStory): string {
  const subs = Array.isArray(story.line.sub) ? story.line.sub : []
  const rows = [
    `<div class="leafrow"><span class="sp"></span><div class="body"><div class="lrow main"><span class="lb">主线</span><span>${escapeHtml(story.line.main)}</span></div></div></div>`,
    ...subs.map((sub) =>
      `<div class="leafrow"><span class="sp"></span><div class="body"><div class="lrow sub"><span class="lb">支线</span><span class="nm">${escapeHtml(sub.n)}</span><span>${escapeHtml(sub.v)}</span></div></div></div>`),
    `<div class="leafrow"><span class="sp"></span><div class="body"><div class="lrow day"><span class="lb">日常</span><span>${escapeHtml(story.line.daily.v)}</span></div></div></div>`,
    `<div class="leafrow"><span class="sp"></span><div class="body"><div class="lrow day"><span class="lb">作用</span><span>${escapeHtml(story.line.daily.u)}</span></div></div></div>`,
  ].join("")
  const summary = `<span class="body"><span class="line"><span class="k k-s">线</span><span class="t2">本故事的三层线</span><span class="tag">主线 ×1</span><span class="tag">支线 ×${subs.length}</span><span class="tag">日常 ×1</span></span></span>`
  return detailsNode(summary, rows, false)
}

function beatNode(story: VolumeOutlineStory): string {
  const beats = Array.from(String(story.beats || ""))
  const inner = `<div class="leafrow"><span class="sp"></span><div class="body"><div class="beats">${
    beats.map((b, i) => `<span class="bt" data-b="${escapeHtml(b)}"><b>第${i + 1}章</b>${escapeHtml(b)}</span>`).join("")
  }</div></div></div>`
  const summary = `<span class="body"><span class="line"><span class="k k-s">拍</span><span class="t2">12 章情绪节拍</span><span class="tag exp">8 种情绪结构</span><span class="n">共 ${beats.length} 拍</span></span></span>`
  return detailsNode(summary, inner, false)
}

function stageNode(story: VolumeOutlineStory, index: number, stage: VolumeOutlineStage): string {
  const meta = STAGE_META.find((item) => item.id === stage.stage) ?? STAGE_META[index] ?? { id: stage.stage, k: "qi", name: "", exp: "" }
  const chapterLabel = STAGE_CHAPTER_MAP[stage.stage] ?? ""
  const tags = [
    chapterLabel ? `<span class="tag chap" title="相对本故事的章号定位">${escapeHtml(chapterLabel)}</span>` : "",
    meta.exp ? `<span class="tag exp">期待 · ${escapeHtml(meta.exp)}</span>` : "",
    stage.pay ? `<span class="tag pay">兑现 · ${escapeHtml(stage.pay)}</span>` : "",
    index === 5 && story.mid ? `<span class="tag twist">承③ · ${escapeHtml(story.mid)}</span>` : "",
    index === 6 && story.twist ? `<span class="tag twist">转① · ${escapeHtml(story.twist)}</span>` : "",
  ].join("")
  const summary = `<span class="body"><span class="line"><span class="k k-${meta.k}">${escapeHtml(meta.id)}</span><span class="t2">${escapeHtml(meta.name)}</span>${tags}</span></span>`
  const kids = [
    `<div class="leafrow"><span class="sp"></span><div class="body"><div class="who"><span class="lb">人物</span><span class="nm">${escapeHtml(stage.who)}</span><span class="ar">→</span><span>作用：${escapeHtml(stage.use)}</span></div></div></div>`,
    ...stage.p.map(leafRow),
  ].join("")
  return detailsNode(summary, kids, false)
}

function storyNode(story: VolumeOutlineStory, isFirst: boolean): string {
  const summary = [
    `<span class="body"><span class="line">`,
    `<span class="k k-s">${escapeHtml(story.range)}</span>`,
    `<span class="t">${escapeHtml(story.id)}. ${escapeHtml(story.title)}</span>`,
    `<span class="tag twist">承③ · ${escapeHtml(story.mid)}</span>`,
    `<span class="tag twist">转① · ${escapeHtml(story.twist)}</span>`,
    `<span class="tag climax">${escapeHtml(story.climax)}</span>`,
    `<span class="tag gift">交付 · ${escapeHtml(story.deliver)}</span>`,
    `<span class="tag">获得 · ${escapeHtml(story.gift)}</span>`,
    `<span class="tag warn">引线 · ${escapeHtml(story.hook)}</span>`,
    `</span></span>`,
  ].join("")
  const kids = [
    lineNode(story),
    beatNode(story),
    ...story.st.map((stage, index) => stageNode(story, index, stage)),
  ].join("")
  return `<div class="story-wrap" id="story-${escapeHtml(String(story.id))}">${detailsNode(summary, kids, isFirst)}</div>`
}

/** 生成静态折叠树 HTML（无 JavaScript，原生 details/summary 折叠）。 */
function buildTreeHtml(data: VolumeOutlineData): string {
  const stories = data.stories
  const rootSummary = `<span class="body"><span class="line"><span class="k k-root">卷 1</span><span class="t">${escapeHtml(data.title || "卷纲")}</span><span class="tag climax">10 环节 × ${stories.length} 故事</span></span><span class="sub">${escapeHtml(data.goal)}</span><span class="bar" style="display:block;max-width:420px"></span></span>`
  const kids = stories.length
    ? stories.map((story, index) => storyNode(story, index === 0)).join("")
    : leafRow("未包含卷纲数据（stories 为空），请重新生成卷纲。")
  return detailsNode(rootSummary, kids, true)
}

const REVERSAL_TYPES = ["认知", "规则", "立场", "身份", "时间", "代价", "主体"] as const

/** 归一化反转类型：「认知反转」「认知」都归为「认知反转」。 */
function reversalKind(value: string): string {
  const text = value.trim()
  if (!text) return "未标注"
  for (const kind of REVERSAL_TYPES) {
    if (text.includes(kind)) return `${kind}反转`
  }
  return text
}

function panelSection(title: string, note: string, body: string): string {
  const noteHtml = note ? `<span class="pn">${escapeHtml(note)}</span>` : ""
  return `<section class="panel"><h2>${escapeHtml(title)}${noteHtml}</h2>${body}</section>`
}

function emptyHint(text: string): string {
  return `<p class="empty">${escapeHtml(text)}</p>`
}

function kvRow(label: string, value: string): string {
  const text = value.trim() || "未填"
  return `<div class="kv"><span class="kk">${escapeHtml(label)}</span><span class="vv">${escapeHtml(text)}</span></div>`
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
function volumeChapterStats(data: VolumeOutlineData): { total: number; estimated: boolean; perStory: number[] } {
  const parsed = data.stories.map((story) => parseChapterRange(story.range))
  if (parsed.every((item) => item)) {
    const perStory = parsed.map((item) => item!.end - item!.start + 1)
    return { total: perStory.reduce((sum, count) => sum + count, 0), estimated: false, perStory }
  }
  const perStory = data.stories.map(() => 12)
  return { total: perStory.length * 12, estimated: true, perStory }
}

/** 卷级定位 + 卷级人物功能位总览。 */
function buildPositionHtml(data: VolumeOutlineData): string {
  const position = data.position
  const positionBody = position
    ? [
        kvRow("卷定位", position.pitch),
        kvRow("主题句", position.theme),
        kvRow("叙事形态", position.narrative),
        kvRow("结构选用", position.structure),
        kvRow("建议章数", position.chapters),
        kvRow("卷末落点", position.ending),
      ].join("")
    : emptyHint("本次未生成卷级定位（技能要求 position：pitch 卷定位 / theme 主题句 / narrative 叙事形态 / structure 结构选用 / chapters 建议章数 / ending 卷末落点）。")

  const roles = data.roles ?? []
  const rolesBody = roles.length
    ? roles.map((role) =>
      `<div class="rolecard"><span class="role ${castRoleClass(role.n)}">${escapeHtml(role.n)}</span><span class="vv">${escapeHtml(role.v)}</span></div>`).join("")
    : emptyHint("本次未生成卷级功能位总览（技能要求 roles：引路 / 主角 / 阻力 / 镜子 / 代价 / 预埋 六个功能位）。")

  return [
    panelSection("卷级定位", "", positionBody),
    panelSection("卷级人物功能位总览", roles.length ? `${roles.length} 个功能位` : "", rolesBody),
  ].join("")
}

/** 故事锚点导航（纯静态 a[href=#story-N] + :target 高亮，不依赖脚本）。 */
function buildNavHtml(data: VolumeOutlineData): string {
  if (data.stories.length === 0) return ""
  const links = data.stories.map((story) =>
    `<a class="navlink" href="#story-${escapeHtml(String(story.id))}"><b>${escapeHtml(String(story.id))}</b>${escapeHtml(story.title || "未命名")}</a>`).join("")
  return `<nav class="nav"><span class="navt">跳到故事</span>${links}</nav>`
}

export const BEAT_INTENSITY: Record<string, number> = {
  平: 1, 缓: 1.6, 落: 2.2, 升: 2.8, 起: 3.2, 紧: 4.2, 悬: 4.6, 顶: 5,
}

/** 期待感强度曲线（inline SVG，静态绘制全卷逐章节拍）。 */
function buildCurveHtml(data: VolumeOutlineData): string {
  const beats: string[] = []
  const counts: number[] = []
  data.stories.forEach((story) => {
    const list = Array.from(story.beats || "")
    counts.push(list.length)
    beats.push(...list)
  })
  if (beats.length < 2) {
    return panelSection("期待感强度曲线", "", emptyHint("本次未生成 12 章节拍（beats），无法绘制曲线。"))
  }

  const width = 1200
  const height = 240
  const padLeft = 46
  const padRight = 16
  const padTop = 22
  const padBottom = 34
  const innerW = width - padLeft - padRight
  const innerH = height - padTop - padBottom
  const pointX = (index: number) => padLeft + (innerW * index) / (beats.length - 1)
  const pointY = (value: number) => padTop + innerH * (1 - (value - 1) / 4)

  const line = beats.map((beat, index) => `${pointX(index).toFixed(1)},${pointY(BEAT_INTENSITY[beat] ?? 2.5).toFixed(1)}`).join(" ")
  const area = `${padLeft},${(padTop + innerH).toFixed(1)} ${line} ${(padLeft + innerW).toFixed(1)},${(padTop + innerH).toFixed(1)}`
  const guides = [
    { value: 5, label: "顶" },
    { value: 3.2, label: "起" },
    { value: 1, label: "平" },
  ].map((guide) => [
    `<line class="cg" x1="${padLeft}" x2="${padLeft + innerW}" y1="${pointY(guide.value).toFixed(1)}" y2="${pointY(guide.value).toFixed(1)}"/>`,
    `<text class="ct" x="${padLeft - 8}" y="${(pointY(guide.value) + 4).toFixed(1)}" text-anchor="end">${guide.label}</text>`,
  ].join("")).join("")

  const separators: string[] = []
  const storyLabels: string[] = []
  let cursor = 0
  data.stories.forEach((story, index) => {
    const count = counts[index] ?? 0
    if (count > 0) {
      const center = (pointX(cursor) + pointX(Math.min(cursor + count - 1, beats.length - 1))) / 2
      storyLabels.push(`<text class="ct" x="${center.toFixed(1)}" y="${height - 10}" text-anchor="middle">${escapeHtml(`${story.id}`)}</text>`)
    }
    cursor += count
    if (cursor > 0 && cursor < beats.length) {
      separators.push(`<line class="cs" x1="${pointX(cursor - 0.5).toFixed(1)}" x2="${pointX(cursor - 0.5).toFixed(1)}" y1="${padTop}" y2="${(padTop + innerH).toFixed(1)}"/>`)
    }
  })

  const peaks = beats.map((beat, index) =>
    (beat === "顶" ? `<circle class="cp" cx="${pointX(index).toFixed(1)}" cy="${pointY(5).toFixed(1)}" r="3"/>` : "")).join("")
  const peakCount = beats.filter((beat) => beat === "顶").length

  const svg = [
    `<div class="svgwrap"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="全卷逐章期待感强度曲线">`,
    guides,
    separators.join(""),
    `<polygon class="ca" points="${area}"/>`,
    `<polyline class="cl" points="${line}"/>`,
    peaks,
    storyLabels.join(""),
    `</svg></div>`,
  ].join("")

  const caption = `<p class="ecap">纵轴＝读者「想读下去」的强度（平 1 → 顶 5），横轴＝全卷逐章（下方数字为故事序号，竖虚线为故事分界）。低谷用来交代人物与攒资源，峰值（中点反转 / 真相 / 兑现 / 引线）用来收账。</p>`
  return panelSection("期待感强度曲线", `全卷 ${beats.length} 章 · 峰值（顶）${peakCount} 次`, svg + caption)
}

/** 整卷账本 + 三层线配比（软件派生）。 */
function buildLedgerHtml(data: VolumeOutlineData): string {
  const stories = data.stories
  const stats = volumeChapterStats(data)
  const words = (stats.total * 2500) / 10000
  const last = stories[stories.length - 1]
  const ledgerBody = [
    kvRow("全卷章数", `${stats.total} 章${stats.estimated ? "（按每故事 12 章估算）" : ""}`),
    kvRow("全卷字数", `约 ${words.toFixed(1)} 万字（按 2500 字 / 章估算）`),
    kvRow("小高潮数量", `${stories.length} 个`),
    kvRow("大高潮位置", last ? `${last.range || "末尾故事"}（合①–合②）` : "未填"),
    kvRow("每故事章节", `${Math.min(...stats.perStory)}–${Math.max(...stats.perStory)} 章`),
    kvRow("每故事环节数", "10 个（固定：起3 + 承3 + 转2 + 合2）"),
  ].join("")

  const subLineCount = collectSubLines(data).length
  const notReadyDaily = stories.filter((story) => !Array.from(story.beats || "").some((beat) => ["平", "落", "缓", "悬"].includes(beat)))
  const ratioBody = [
    kvRow("技能基线配比", "主线约 7 章 / 60% ｜ 支线约 3 章 / 25% ｜ 日常约 2 章 / 15%"),
    kvRow("支线标准落章", "第 2 / 6 / 7 / 10 / 12 章（主线降速处）"),
    kvRow("日常标准落章", "第 1 / 5 / 6 / 12 章（只落在 平 / 落 / 缓 / 悬）"),
    kvRow("全卷支线", `${data.stories.length} 个故事共 ${subLineCount} 条支线（每故事 1–2 条）`),
    kvRow("全卷日常", `${stories.length} 条日常插曲（每故事 1 条）`),
    notReadyDaily.length
      ? kvRow("日常落拍可落性", `故事 ${notReadyDaily.map((story) => story.id).join("、")} 的节拍里没有 平/落/缓/悬，日常无处可落`)
      : kvRow("日常落拍可落性", `${stories.length}/${stories.length} 个故事都含 平/落/缓/悬 拍，日常有可落处`),
  ].join("")

  return [
    panelSection("整卷账本", "", ledgerBody),
    panelSection("三层线配比", "主线 60% · 支线 25% · 日常 15%", ratioBody),
    buildCurveHtml(data),
  ].join("")
}

export const BEATS_ALLOWED = ["平", "升", "起", "落", "缓", "紧", "顶", "悬"]

/** 12 章节拍纪律体检：不连续 3 章同拍、顶最多 2 连、顶后接落/缓、悬落末章。 */
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

/** 节拍体检 + 10×10 环节完整性矩阵。 */
function buildPacingHtml(data: VolumeOutlineData): string {
  const stories = data.stories
  const okCount = stories.filter((story) => checkBeats(story.beats).length === 0).length
  const rows = stories.map((story) => {
    const issues = checkBeats(story.beats)
    const beatChips = Array.from(story.beats || "")
      .map((beat) => `<span class="bt" data-b="${escapeHtml(beat)}">${escapeHtml(beat)}</span>`).join("")
    const verdict = issues.length
      ? `<ul class="issues">${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>`
      : `<span class="st st-ok">合规</span>`
    return `<div class="pace"><div class="phead"><span class="sg">${escapeHtml(String(story.id))}</span><span class="t2">${escapeHtml(story.title || "未命名")}</span></div><div class="beats">${beatChips}</div>${verdict}</div>`
  }).join("")
  const pacingBody = rows
    ? `${rows}<p class="hint">12 拍纪律：不连续 3 章同节拍 ｜ 顶最多 2 连 ｜ 顶后接 落/缓（收尾的 顶→悬 除外）｜ 悬必须落在末章</p>`
    : emptyHint("本次未生成故事数据。")

  const stageHead = `<tr><th class="mxh">故事</th>${REQUIRED_STAGES.map((stage) => `<th>${escapeHtml(stage)}</th>`).join("")}<th class="mxh">完整度</th></tr>`
  const stageRows = stories.map((story) => {
    let full = 0
    const cells = REQUIRED_STAGES.map((stageId) => {
      const stage = story.st.find((item) => item.stage === stageId)
      if (!stage) return `<td class="cell-miss">·</td>`
      if (stage.p.length >= MIN_ENTRY_COUNT) {
        full += 1
        return `<td class="cell-ok">●</td>`
      }
      return `<td class="cell-part">○</td>`
    }).join("")
    return `<tr><th class="mxh">${escapeHtml(String(story.id))}</th>${cells}<td class="mxc"><b>${full}</b>/10</td></tr>`
  }).join("")
  const matrixBody = `<div class="mxwrap"><table class="mx heat"><thead>${stageHead}</thead><tbody>${stageRows}</tbody></table></div><p class="hint">● 环节齐全（≥3 条）　○ 环节存在但条目不足　· 环节缺失</p>`

  return [
    panelSection("节拍体检", `合规 ${okCount}/${stories.length} 个故事`, pacingBody),
    panelSection("环节完整性矩阵", `${stories.length} 个故事 × 10 环节`, matrixBody),
  ].join("")
}

/** 大高潮分解 + 代价阶梯 + 悬念债务表。 */
function buildEscalationHtml(data: VolumeOutlineData): string {
  const escalation = data.escalation ?? []
  const escalationBody = escalation.length
    ? `<div class="mxwrap"><table class="mx"><thead><tr><th class="mxh">故事</th><th>赌注等级</th><th>付出的代价</th><th>抬升到什么</th></tr></thead><tbody>${
      escalation.map((item) => `<tr><th class="mxh">${escapeHtml(String(item.id))}</th><td>${escapeHtml(item.stake || "未填")}</td><td>${escapeHtml(item.lose || "未填")}</td><td>${escapeHtml(item.rise || "未填")}</td></tr>`).join("")
    }</tbody></table></div>`
    : emptyHint("本次未生成大高潮分解与代价阶梯（技能要求 escalation：每条含 id 故事 / stake 赌注等级 / lose 付出的代价 / rise 抬升到什么）。")

  const debts = data.debts ?? []
  const debtsBody = debts.length
    ? `<div class="mxwrap"><table class="mx"><thead><tr><th>悬而未决的问题</th><th class="mxc">起始</th><th class="mxc">计划回收</th></tr></thead><tbody>${
      debts.map((item) => `<tr><td>${escapeHtml(item.q)}</td><td class="mxc">${escapeHtml(item.from || "未填")}</td><td class="mxc">${escapeHtml(item.plan || "未定")}</td></tr>`).join("")
    }</tbody></table></div>`
    : emptyHint("本次未生成悬念债务表（技能要求 debts：每条含 q 悬而未决的问题 / from 起始位置 / plan 计划回收位置）。")

  return [
    panelSection("大高潮分解 · 代价阶梯", escalation.length ? `${escalation.length} 个故事` : "", escalationBody),
    panelSection("悬念债务表", debts.length ? `${debts.length} 条悬念` : "", debtsBody),
  ].join("")
}

/** 对手推进表 + 人物成长与资源表 + 地点组织索引。 */
function buildRivalsHtml(data: VolumeOutlineData): string {
  const rivals = (data.rivals ?? []).filter((rival) => rival.moves.length > 0)
  const rivalsBody = rivals.length
    ? rivals.map((rival) => {
        const summary = `<span class="body"><span class="line"><span class="k k-s">敌</span><span class="t2">${escapeHtml(rival.n)}</span><span class="tag">出手 ${rival.moves.length} 次</span></span></span>`
        const kids = rival.moves.map((move) => leafRow(`故事${move.id}：${move.v}`)).join("")
        return `<details class="nd pnd"><summary>${summary}</summary><div class="kids">${kids}</div></details>`
      }).join("")
    : emptyHint("本次未生成对手推进表（技能要求 rivals：每条含 n 对手/组织名 / moves 每个故事的目标与动作）。")

  const growth = data.growth ?? []
  const growthBody = growth.length
    ? `<div class="mxwrap"><table class="mx"><thead><tr><th class="mxh">人物</th><th>获得物 / 资源演进</th><th>能力与状态变化</th></tr></thead><tbody>${
      growth.map((item) => `<tr><td class="mxh">${escapeHtml(item.n)}</td><td>${escapeHtml(item.gains || "未填")}</td><td>${escapeHtml(item.state || "未填")}</td></tr>`).join("")
    }</tbody></table></div>`
    : emptyHint("本次未生成人物成长与资源表（技能要求 growth：每条含 n 人物 / gains 获得物与资源演进 / state 能力与状态变化）。")

  const places = data.places ?? []
  const placesBody = places.length
    ? `<div class="mxwrap"><table class="mx"><thead><tr><th class="mxh">名称</th><th class="mxc">类型</th><th class="mxc">出场故事</th><th>剧情作用</th></tr></thead><tbody>${
      places.map((item) => `<tr><td class="mxh">${escapeHtml(item.n)}</td><td class="mxc"><span class="role role-seed">${escapeHtml(item.kind || "未标")}</span></td><td class="mxc">${escapeHtml(item.stories || "未填")}</td><td>${escapeHtml(item.u || "未填")}</td></tr>`).join("")
    }</tbody></table></div>`
    : emptyHint("本次未生成地点 / 组织索引（技能要求 places：每条含 n 名称 / kind 类型 / stories 出场故事 / u 剧情作用）。")

  return [
    panelSection("对手推进表", rivals.length ? `${rivals.length} 个对手` : "", rivalsBody),
    panelSection("人物成长与资源表", growth.length ? `${growth.length} 人` : "", growthBody),
    panelSection("地点 / 组织索引", places.length ? `${places.length} 项` : "", placesBody),
  ].join("")
}

/** 反转类型分布：全卷 20 次反转的类型覆盖、次数与重复情况。 */
function buildReversalsHtml(data: VolumeOutlineData): string {
  const stories = data.stories
  if (stories.length === 0) return ""
  const counts = new Map<string, number>()
  const bump = (value: string) => {
    if (!value.trim()) return
    const kind = reversalKind(value)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  stories.forEach((story) => {
    bump(story.mid)
    bump(story.twist)
  })

  const covered = REVERSAL_TYPES.filter((kind) => counts.has(`${kind}反转`)).length
  const chips = REVERSAL_TYPES.map((kind) => {
    const label = `${kind}反转`
    const count = counts.get(label) ?? 0
    return `<span class="chip rev${count === 0 ? " zero" : ""}">${escapeHtml(label)}<b>×${count}</b></span>`
  }).join("")

  const grid = stories.map((story) => [
    `<li><span class="sg">${escapeHtml(String(story.id))}</span>`,
    `<span class="sr"><b>承③</b>${escapeHtml(story.mid || "未填")}</span>`,
    `<span class="sr"><b>转①</b>${escapeHtml(story.twist || "未填")}</span></li>`,
  ].join("")).join("")

  const duplicated = [...counts.entries()]
    .filter(([, count]) => count > 2)
    .map(([kind, count]) => `${kind} ×${count}`)
    .join("、")

  const body = [
    `<div class="chips">${chips}</div>`,
    `<ul class="revgrid">${grid}</ul>`,
    duplicated
      ? `<p class="hint warnline">重复使用：${escapeHtml(duplicated)}（同一类型超过 2 次，建议换成其他类型）</p>`
      : "",
  ].join("")
  return panelSection("反转类型分布", `全卷 ${stories.length * 2} 次 · 覆盖 ${covered}/7 类（技能要求 ≥5 类）`, body)
}

/** 汇总全卷支线（按名称去重，保留首次出现顺序）。 */
function collectSubLines(data: VolumeOutlineData): Array<{ name: string; hits: Array<{ story: VolumeOutlineStory; v: string }> }> {
  const order: string[] = []
  const map = new Map<string, Array<{ story: VolumeOutlineStory; v: string }>>()
  data.stories.forEach((story) => {
    const subs = Array.isArray(story.line.sub) ? story.line.sub : []
    subs.forEach((sub) => {
      const name = sub.n.trim() || "未命名支线"
      if (!map.has(name)) {
        map.set(name, [])
        order.push(name)
      }
      map.get(name)?.push({ story, v: sub.v })
    })
  })
  return order.map((name) => ({ name, hits: map.get(name) ?? [] }))
}

/** 支线推进矩阵：每条支线在 10 个故事里的推进汇总。 */
function buildSideLinesHtml(data: VolumeOutlineData): string {
  const lines = collectSubLines(data)
  if (lines.length === 0) {
    return panelSection("支线推进矩阵", "", `<p class="empty">本次未生成支线数据（技能要求每个故事的 line.sub 至少 1 条支线）。</p>`)
  }
  const head = [
    `<tr><th class="mxh">支线</th>`,
    ...data.stories.map((story) => `<th title="${escapeHtml(`${story.id}. ${story.title}`)}">${escapeHtml(String(story.id))}</th>`),
    `<th class="mxh">出现</th></tr>`,
  ].join("")
  const rows = lines.map((line) => {
    const cells = data.stories.map((story) => {
      const hit = line.hits.find((item) => item.story.id === story.id)
      return hit
        ? `<td class="on" title="${escapeHtml(`${story.id}. ${story.title}：${hit.v}`)}">●</td>`
        : `<td>·</td>`
    }).join("")
    return `<tr><th class="mxh">${escapeHtml(line.name)}</th>${cells}<td class="mxc"><b>${line.hits.length}</b>/${data.stories.length}</td></tr>`
  }).join("")
  const detail = lines.map((line) => {
    const summary = `<span class="body"><span class="line"><span class="k k-s">支</span><span class="t2">${escapeHtml(line.name)}</span><span class="tag">出现 ${line.hits.length} 个故事</span></span></span>`
    const kids = line.hits.map((hit) => leafRow(`故事${hit.story.id}《${hit.story.title}》：${hit.v}`)).join("")
    return `<details class="nd pnd"><summary>${summary}</summary><div class="kids">${kids}</div></details>`
  }).join("")
  const body = [
    `<div class="mxwrap"><table class="mx"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`,
    `<div class="mxdetail">${detail}</div>`,
  ].join("")
  return panelSection("支线推进矩阵", `${lines.length} 条支线 × ${data.stories.length} 个故事`, body)
}

/** 引线闭环表：故事N 引线 → 故事N+1 的破口，检查首尾是否咬合。 */
function buildHooksHtml(data: VolumeOutlineData): string {
  const stories = data.stories
  if (stories.length === 0) return ""
  const rows = stories.map((story, index) => {
    const next = stories[index + 1]
    const opening = next?.st?.[0]?.p?.[0] ?? ""
    const target = next ? `${next.id}. ${next.title}` : "下一卷 起①"
    const bridge = story.link || opening
    const bridgeLabel = story.link ? "承接说明" : next ? "下一故事起①破口" : "卷末落点"
    return [
      `<tr>`,
      `<th class="mxh">${escapeHtml(String(story.id))}</th>`,
      `<td>${escapeHtml(story.hook || "未填")}</td>`,
      `<td class="mxc">${escapeHtml(target)}</td>`,
      `<td class="txt">${escapeHtml(bridge || "未填")}<span class="bl">${escapeHtml(bridgeLabel)}</span></td>`,
      `</tr>`,
    ].join("")
  }).join("")
  const head = `<tr><th class="mxh">故事</th><th>引线</th><th>承接</th><th>衔接依据</th></tr>`
  const body = `<div class="mxwrap"><table class="mx"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`
  return panelSection("引线闭环表", "上一故事合②引线 = 下一故事起①破口", body)
}

/** 伏笔追踪表：埋设位置 → 回收位置。 */
function buildForeshadowsHtml(data: VolumeOutlineData): string {
  const items = data.foreshadows ?? []
  if (items.length === 0) {
    return panelSection("伏笔追踪表", "", `<p class="empty">本次未生成伏笔追踪（技能要求 AI 输出 foreshadows 字段：每条含 v / seed / pay）。</p>`)
  }
  const closed = items.filter((item) => item.pay.trim()).length
  const rows = items.map((item) => {
    const unclosed = !item.pay.trim()
    return [
      `<tr>`,
      `<td>${escapeHtml(item.v || "未填")}</td>`,
      `<td class="mxc">${escapeHtml(item.seed || "未填")}</td>`,
      `<td class="mxc">${escapeHtml(item.pay || "未回收")}</td>`,
      `<td class="mxc"><span class="st${unclosed ? " st-open" : " st-ok"}">${unclosed ? "未闭环" : "已闭环"}</span></td>`,
      `</tr>`,
    ].join("")
  }).join("")
  const head = `<tr><th>伏笔</th><th>埋设位置</th><th>回收位置</th><th>状态</th></tr>`
  const body = `<div class="mxwrap"><table class="mx"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`
  return panelSection("伏笔追踪表", `${items.length} 条 · 已闭环 ${closed} 条`, body)
}

const CAST_ROLE_CLASS: Array<[string, string]> = [
  ["引路", "role-lead"],
  ["阻力", "role-block"],
  ["镜子", "role-mirror"],
  ["代价", "role-cost"],
  ["主角", "role-hero"],
  ["预埋", "role-seed"],
]

function castRoleClass(role: string): string {
  for (const [key, className] of CAST_ROLE_CLASS) {
    if (role.includes(key)) return className
  }
  return "role-other"
}

/** 人物出场表：出场故事 + 功能位 + 作用。 */
function buildCastHtml(data: VolumeOutlineData): string {
  const items = data.cast ?? []
  if (items.length === 0) {
    return panelSection("人物出场表", "", `<p class="empty">本次未生成人物出场表（技能要求 AI 输出 cast 字段：每条含 n / role / stories / u）。</p>`)
  }
  const rows = items.map((item) => [
    `<tr>`,
    `<td class="mxc"><b>${escapeHtml(item.n || "未填")}</b></td>`,
    `<td class="mxc"><span class="role ${castRoleClass(item.role)}">${escapeHtml(item.role || "未填")}</span></td>`,
    `<td class="mxc">${escapeHtml(item.stories || "未填")}</td>`,
    `<td>${escapeHtml(item.u || "未填")}</td>`,
    `</tr>`,
  ].join("")).join("")
  const head = `<tr><th>人物</th><th>功能位</th><th>出场故事</th><th>作用</th></tr>`
  const body = `<div class="mxwrap"><table class="mx"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`
  return panelSection("人物出场表", `${items.length} 人`, body)
}

function buildChipsHtml(data: VolumeOutlineData): string {
  const totalStages = data.stories.reduce((n, story) => n + story.st.length, 0)
  const kinds = new Set<string>()
  data.stories.forEach((story) => {
    if (story.mid.trim()) kinds.add(reversalKind(story.mid))
    if (story.twist.trim()) kinds.add(reversalKind(story.twist))
  })
  const subLineCount = collectSubLines(data).length
  const foreshadowCount = data.foreshadows?.length ?? 0
  const stats = volumeChapterStats(data)
  return [
    `<span class="chip"><b>${data.stories.length}</b> 个故事</span>`,
    `<span class="chip"><b>${stats.total}</b> 章${stats.estimated ? "（估算）" : ""}</span>`,
    `<span class="chip"><b>${totalStages}</b> 个环节</span>`,
    `<span class="chip"><b>10 环节</b> 起3+承3+转2+合2</span>`,
    `<span class="chip"><b>${kinds.size}/7</b> 类反转覆盖</span>`,
    `<span class="chip"><b>${subLineCount}</b> 条支线</span>`,
    `<span class="chip"><b>${foreshadowCount}</b> 条伏笔</span>`,
  ].join("")
}

/**
 * 用模板渲染卷纲折叠树 HTML。
 * 纯静态（无脚本），避免软件预览 iframe 因 CSP 拦截内联脚本而显示空白。
 */
export function renderVolumeOutlineHtml(
  data: VolumeOutlineData,
  template: string = getVolumeOutlineTemplate(),
): string {
  const placeholders: Record<string, string> = {
    [TITLE_PLACEHOLDER]: escapeHtml(data.title || "卷纲"),
    [GOAL_PLACEHOLDER]: escapeHtml(data.goal),
    [CHIPS_PLACEHOLDER]: buildChipsHtml(data),
    [POSITION_PLACEHOLDER]: buildPositionHtml(data),
    [NAV_PLACEHOLDER]: buildNavHtml(data),
    [LEDGER_PLACEHOLDER]: buildLedgerHtml(data),
    [REVERSALS_PLACEHOLDER]: buildReversalsHtml(data),
    [SIDELINES_PLACEHOLDER]: buildSideLinesHtml(data),
    [HOOKS_PLACEHOLDER]: buildHooksHtml(data),
    [ESCALATION_PLACEHOLDER]: buildEscalationHtml(data),
    [RIVALS_PLACEHOLDER]: buildRivalsHtml(data),
    [FORESHADOWS_PLACEHOLDER]: buildForeshadowsHtml(data),
    [CAST_PLACEHOLDER]: buildCastHtml(data),
    [PACING_PLACEHOLDER]: buildPacingHtml(data),
    [TREE_PLACEHOLDER]: buildTreeHtml(data),
  }
  // 用函数替换器，避免内容里的 $& / $1 等被当作替换模式
  return Object.entries(placeholders).reduce(
    (html, [placeholder, value]) => html.replace(placeholder, () => value),
    template,
  )
}

/** 归一化 AI 输出的卷纲数据（容错：字段缺失取空、类型不符丢弃）。 */
export function normalizeVolumeOutlineData(raw: unknown): VolumeOutlineData | null {
  if (!isRecord(raw)) return null
  const storiesRaw = Array.isArray(raw.stories) ? raw.stories : []
  const stories: VolumeOutlineStory[] = storiesRaw.filter(isRecord).map((item, index) => {
    const line = isRecord(item.line) ? item.line : {}
    const daily = isRecord(line.daily) ? line.daily : {}
    const subsRaw = Array.isArray(line.sub) ? line.sub : []
    const stRaw = Array.isArray(item.st) ? item.st : []
    return {
      id: typeof item.id === "number" ? item.id : index + 1,
      range: asString(item.range),
      title: asString(item.title),
      deliver: asString(item.deliver),
      gift: asString(item.gift),
      mid: asString(item.mid),
      twist: asString(item.twist),
      hook: asString(item.hook),
      climax: asString(item.climax),
      beats: asString(item.beats),
      line: {
        main: asString(line.main),
        sub: subsRaw.filter(isRecord).map((sub) => ({ n: asString(sub.n), v: asString(sub.v) })),
        daily: { v: asString(daily.v), u: asString(daily.u) },
      },
      st: stRaw.filter(isRecord).map((stage) => ({
        stage: asString(stage.stage),
        who: asString(stage.who),
        use: asString(stage.use),
        p: (Array.isArray(stage.p) ? stage.p : []).map(asString).filter(Boolean),
        pay: asString(stage.pay),
      })),
      link: asString(item.link),
    }
  })
  if (stories.length === 0) return null

  const foreshadowsRaw = Array.isArray(raw.foreshadows) ? raw.foreshadows : []
  const castRaw = Array.isArray(raw.cast) ? raw.cast : []
  const foreshadows = foreshadowsRaw.filter(isRecord).map((item) => ({
    v: asString(item.v),
    seed: asString(item.seed),
    pay: asString(item.pay),
  })).filter((item) => item.v || item.seed || item.pay)
  const cast = castRaw.filter(isRecord).map((item) => ({
    n: asString(item.n),
    role: asString(item.role),
    stories: asString(item.stories),
    u: asString(item.u),
  })).filter((item) => item.n)

  const positionRaw = isRecord(raw.position) ? raw.position : null
  const position = positionRaw
    && ["pitch", "theme", "narrative", "structure", "chapters", "ending"].some((key) => asString(positionRaw[key]))
    ? {
        pitch: asString(positionRaw.pitch),
        theme: asString(positionRaw.theme),
        narrative: asString(positionRaw.narrative),
        structure: asString(positionRaw.structure),
        chapters: asString(positionRaw.chapters),
        ending: asString(positionRaw.ending),
      }
    : undefined

  const roles = (Array.isArray(raw.roles) ? raw.roles : []).filter(isRecord)
    .map((item) => ({ n: asString(item.n), v: asString(item.v) }))
    .filter((item) => item.n)

  const escalation = (Array.isArray(raw.escalation) ? raw.escalation : []).filter(isRecord)
    .map((item, index) => ({
      id: typeof item.id === "number" ? item.id : index + 1,
      stake: asString(item.stake),
      lose: asString(item.lose),
      rise: asString(item.rise),
    }))
    .filter((item) => item.stake || item.lose || item.rise)

  const debts = (Array.isArray(raw.debts) ? raw.debts : []).filter(isRecord)
    .map((item) => ({ q: asString(item.q), from: asString(item.from), plan: asString(item.plan) }))
    .filter((item) => item.q)

  const rivals = (Array.isArray(raw.rivals) ? raw.rivals : []).filter(isRecord)
    .map((item) => ({
      n: asString(item.n),
      moves: (Array.isArray(item.moves) ? item.moves : []).filter(isRecord)
        .map((move, index) => ({ id: typeof move.id === "number" ? move.id : index + 1, v: asString(move.v) }))
        .filter((move) => move.v),
    }))
    .filter((item) => item.n)

  const growth = (Array.isArray(raw.growth) ? raw.growth : []).filter(isRecord)
    .map((item) => ({ n: asString(item.n), gains: asString(item.gains), state: asString(item.state) }))
    .filter((item) => item.n)

  const places = (Array.isArray(raw.places) ? raw.places : []).filter(isRecord)
    .map((item) => ({
      n: asString(item.n),
      kind: asString(item.kind),
      stories: asString(item.stories),
      u: asString(item.u),
    }))
    .filter((item) => item.n)

  return {
    title: asString(raw.title) || "卷纲",
    goal: asString(raw.goal),
    stories,
    ...(position ? { position } : {}),
    ...(roles.length ? { roles } : {}),
    ...(foreshadows.length ? { foreshadows } : {}),
    ...(cast.length ? { cast } : {}),
    ...(escalation.length ? { escalation } : {}),
    ...(debts.length ? { debts } : {}),
    ...(rivals.length ? { rivals } : {}),
    ...(growth.length ? { growth } : {}),
    ...(places.length ? { places } : {}),
  }
}

/** 校验卷纲数据是否完整（10 故事 × 10 环节 × 3 条目、承③≠转①）。 */
export function validateVolumeOutlineData(
  data: VolumeOutlineData | null,
  md: string,
): { ok: boolean; problems: string[] } {
  const problems: string[] = []

  if (!md.trim()) problems.push("MD 正文为空，无法保存。")

  if (!data) {
    problems.push("未解析到卷纲结构化数据（volumeOutlineData），无法渲染 HTML。")
    return { ok: false, problems }
  }

  if (data.stories.length < MIN_STORY_COUNT) {
    problems.push(`故事数量不足 10 个（当前 ${data.stories.length} 个）。`)
  }

  data.stories.forEach((story, index) => {
    const label = `第 ${index + 1} 个故事`
    if (!story.title) problems.push(`${label}缺少故事标题。`)
    for (const field of ["range", "deliver", "gift", "hook", "climax", "beats"] as const) {
      if (!story[field]) problems.push(`${label}缺少字段 ${field}。`)
    }
    if (story.st.length < MIN_STAGE_COUNT) {
      problems.push(`${label}环节不足 10 个（当前 ${story.st.length} 个）。`)
    }
    const stageIds = story.st.map((stage) => stage.stage)
    for (const required of REQUIRED_STAGES) {
      if (!stageIds.includes(required)) problems.push(`${label}缺少环节「${required}」。`)
    }
    story.st.forEach((stage) => {
      if (stage.p.length < MIN_ENTRY_COUNT) {
        problems.push(`${label}「${stage.stage || "未知环节"}」条目不足 3 条（当前 ${stage.p.length} 条）。`)
      }
    })
    if (story.mid && story.twist && story.mid === story.twist) {
      problems.push(`${label}承③ 与 转① 使用了相同反转类型「${story.mid}」。`)
    }
    if (!story.line.main) problems.push(`${label}缺少主线推进。`)
    if (!story.line.daily.v) problems.push(`${label}缺少日常插曲。`)
  })

  problems.push(...collectLedgerProblems(data))

  return { ok: problems.length === 0, problems }
}

/**
 * 跨故事台账字段的完整性校验：漏写即触发一次 AI 补全修复，
 * 修复后仍不齐才放行强制保存（与上面的故事级校验同等对待）。
 */
function collectLedgerProblems(data: VolumeOutlineData): string[] {
  const problems: string[] = []

  const missingPositionKeys = REQUIRED_POSITION_KEYS.filter((key) => !(data.position?.[key] ?? "").trim())
  if (missingPositionKeys.length > 0) {
    problems.push(`卷级定位（position）缺少字段：${missingPositionKeys.join(" / ")}。`)
  }

  const roles = data.roles ?? []
  const missingRoles = REQUIRED_ROLES.filter((role) => !roles.some((item) => item.n.includes(role)))
  if (missingRoles.length > 0) {
    problems.push(`卷级功能位总览（roles）缺少：${missingRoles.join(" / ")}。`)
  }

  const escalation = data.escalation ?? []
  if (escalation.length < MIN_STORY_COUNT) {
    problems.push(`大高潮分解与代价阶梯（escalation）不足 10 条（当前 ${escalation.length} 条）。`)
  }

  const debts = data.debts ?? []
  if (debts.length === 0) problems.push("缺少悬念债务表（debts）：本卷结束时仍未收回的悬念。")

  const rivals = data.rivals ?? []
  if (rivals.length === 0) {
    problems.push("缺少对手推进表（rivals）。")
  } else {
    const thinRivals = rivals.filter((rival) => rival.moves.length < MIN_RIVAL_MOVE_COUNT)
    if (thinRivals.length > 0) {
      problems.push(`对手推进表（rivals）里 ${thinRivals.map((rival) => rival.n).join("、")} 的出手少于 ${MIN_RIVAL_MOVE_COUNT} 次。`)
    }
  }

  if ((data.growth ?? []).length === 0) problems.push("缺少人物成长与资源表（growth）。")
  if ((data.places ?? []).length === 0) problems.push("缺少地点 / 组织索引（places）。")
  if ((data.foreshadows ?? []).length === 0) problems.push("缺少伏笔追踪表（foreshadows）。")
  if ((data.cast ?? []).length === 0) problems.push("缺少人物出场表（cast）。")

  return problems
}

/** 从 AI 回复中提取并解析 volumeOutlineData（优先在 ```json 围栏内查找）。 */
export function extractVolumeOutlineData(text: string): VolumeOutlineData | null {
  const candidates: string[] = []
  const fencePattern = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi
  for (const match of text.matchAll(fencePattern)) {
    if (/volumeOutlineData/i.test(match[1])) candidates.push(match[1])
  }
  if (candidates.length === 0 && /volumeOutlineData/i.test(text)) {
    candidates.push(text)
  }

  for (const candidate of candidates) {
    const start = candidate.indexOf("{")
    if (start < 0) continue
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
        if (depth === 0) {
          try {
            const payload = JSON.parse(candidate.slice(start, index + 1)) as unknown
            const raw = isRecord(payload) && isRecord(payload.volumeOutlineData)
              ? payload.volumeOutlineData
              : payload
            const normalized = normalizeVolumeOutlineData(raw)
            if (normalized) return normalized
          } catch {
            break
          }
          break
        }
      }
    }
  }
  return null
}

/** 供测试使用：模板是否成功加载。 */
export const VOLUME_OUTLINE_TEMPLATE_READY = REQUIRED_PLACEHOLDERS.every((placeholder) =>
  templateHtml.includes(placeholder))

/**
 * 给卷纲保存请求补上 htmlContent：
 * 若请求是卷纲，则优先用 AI 原文的 volumeOutlineData 套模板渲染 HTML；
 * 只有现有 htmlContent 确实是 HTML 文档时才原样保留。非卷纲请求原样返回。
 */
export function attachVolumeOutlineHtml<
  T extends { fileType: string; htmlContent?: string; content: string; structuredData?: string },
>(request: T, sourceText: string): T {
  if (request.fileType !== "volume-outline") return request
  const existing = request.htmlContent?.trim() ?? ""
  const data = extractVolumeOutlineData(sourceText)
  // 数据可解析时始终带上结构化数据（保存为伴生 .json，供章纲做交叉校验）
  const withData = data ? { ...request, structuredData: JSON.stringify(data) } : request
  // 已有真正的 HTML 文档则保留原 HTML，只补结构化数据
  if (/<html[\s>]/i.test(existing)) return withData
  if (!data) return existing ? { ...request, htmlContent: undefined } : request
  return { ...withData, htmlContent: renderVolumeOutlineHtml(data) }
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
      lines.push(
        `- 卷《${volume.title || "未命名卷"}》故事${story.id}${story.title ? ` ${story.title}` : ""}｜章号区间：${story.range || "未填"}｜节拍：${story.beats || "未填"}`,
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