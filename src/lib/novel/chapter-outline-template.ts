/**
 * 章纲（细纲）卡片流 HTML 渲染（方案 B：系统套模板）。
 *
 * AI 只负责产出结构化数据（17 节标准 + 对齐补字段），样式由技能目录下的
 * template.html 提供，由本模块读取模板并把数据注入，渲染出最终 HTML。
 * 好处：样式 100% 一致、AI 输出量可控、校验只需针对数据。
 */

import templateHtml from "../../../skills/SkillHub/ZhanggangSkill/zhanggangjiegouhua/template.html?raw"
import { fileExists, getExecutableDir, getResourceDir, readFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { BEAT_INTENSITY, STAGE_CHAPTER_MAP, checkBeats, type VolumeOutlineData } from "./volume-outline-template"

/** 17 节章纲标准 + 对齐补字段的单章数据。 */
export interface ChapterOutlineChapter {
  /** 章号（本书绝对章号） */
  n: number
  title: string
  /** 所属环节（起①~合②） */
  stage: string
  /** 本章节拍（平/升/起/落/缓/紧/顶/悬） */
  beat: string
  /** 本章主期待感（8 类） */
  expect: string
  /** 章内时间 */
  time: string
  /** 主要地点 */
  place: string
  /** 本章预埋的伏笔名（多个用「、」分隔） */
  seedFores: string
  /** 本章回收的伏笔名（多个用「、」分隔） */
  payFores: string

  /** §1 基础信息 */
  info: { attr: string; mood: string; words: string; goal: string }
  /** §2 上章承接 */
  carry: { hook: string; left: string; heroState: string; castState: string; fores: string; expect: string }
  /** §3 本章定位 */
  position: { main: string; advance: string; charArc: string; relation: string; whyRead: string; newExpect: string }
  /** §4 浓缩剧情（一句话公式） */
  digest: string
  /** §5 核心事件链（≥6 条且每条有因果） */
  events: Array<{ what: string; cause: string; action: string; result: string; use: string }>
  /** §6 关键词与必要条件 */
  keywords: { scene: string; mood: string; props: string; relation: string; sell: string }
  conditions: { enter: string; trigger: string; interact: string; result: string }
  /** §7 四段式 */
  fourBeat: { open: string; clash: string; burst: string; close: string }
  /** §8 情绪曲线 */
  moodCurve: Array<{ node: string; state: string; trigger: string; feel: string }>
  /** §9 爽点与看点 */
  sell: { first: string; main: string; build: string; release: string; react: string; after: string; fit: string }
  /** §10 关键信息与扩写方式 */
  expand: Array<{ info: string; how: string; skill: string; effect: string }>
  /** §11 画面细节 */
  visual: { env: string; micro: string; hint: string; replace: string; memory: string }
  /** §12 伏笔与钩子 */
  foreshadow: {
    payFrom: string; payHow: string; payLevel: string
    seedNew: string; seedAt: string; seedUse: string
    hookType: string; readerAsk: string; nextMust: string
  }
  /** §13 出场角色与状态变化 */
  castChanges: Array<{ who: string; role: string; inState: string; outState: string; relation: string }>
  /** §14 设定 / 世界观 / 道具更新 */
  worldUpdate: { setting: string; place: string; faction: string; item: string; writeBack: string }
  /** §15 写作约束 */
  rules: { must: string; forbid: string; secret: string; pace: string; style: string; sellPoint: string }
  /** §16 下一章交接 */
  handover: { nextStart: string; nextSolve: string; nextDelay: string; nextMood: string; nextHook: string }
  /** §17 写作检查清单（已覆盖的条目） */
  checks: string[]
}

export interface ChapterOutlineData {
  title: string
  /** 所属故事骨架（章纲自带，用于对齐校验） */
  story: { index: number; name: string; range: string; beats: string }
  chapters: ChapterOutlineChapter[]
  /** 总字数目标 */
  words: number
}

/**
 * 模板占位符。章纲卡流完全静态渲染（原生 details/summary），
 * 不依赖 JavaScript —— 软件内的预览 iframe 受 CSP 限制无法执行内联脚本。
 */
const TITLE_PLACEHOLDER = "__CHAPTER_TITLE__"
const SUMMARY_PLACEHOLDER = "__CHAPTER_SUMMARY__"
const CHIPS_PLACEHOLDER = "__CHAPTER_CHIPS__"
const NAV_PLACEHOLDER = "__CHAPTER_NAV__"
const ALIGN_PLACEHOLDER = "__CHAPTER_ALIGN__"
const EXPECT_PLACEHOLDER = "__CHAPTER_EXPECT__"
const FORES_PLACEHOLDER = "__CHAPTER_FORES__"
const SCENE_PLACEHOLDER = "__CHAPTER_SCENE__"
const CURVE_PLACEHOLDER = "__CHAPTER_CURVE__"
const CHECK_PLACEHOLDER = "__CHAPTER_CHECK__"
const CARDS_PLACEHOLDER = "__CHAPTER_CARDS__"
const REQUIRED_PLACEHOLDERS = [
  TITLE_PLACEHOLDER,
  SUMMARY_PLACEHOLDER,
  CHIPS_PLACEHOLDER,
  NAV_PLACEHOLDER,
  ALIGN_PLACEHOLDER,
  EXPECT_PLACEHOLDER,
  FORES_PLACEHOLDER,
  SCENE_PLACEHOLDER,
  CURVE_PLACEHOLDER,
  CHECK_PLACEHOLDER,
  CARDS_PLACEHOLDER,
]

/** 程序运行目录下的模板相对路径（便携版 / 安装版通用）。 */
const TEMPLATE_RELATIVE_PATHS = [
  "skills/SkillHub/ZhanggangSkill/zhanggangjiegouhua/template.html",
  "_up_/skills/SkillHub/ZhanggangSkill/zhanggangjiegouhua/template.html",
]

/** 项目内可覆盖模板的相对路径（用户在项目里改样式，改完立即生效）。 */
const PROJECT_OVERRIDE_RELATIVE_PATH = ".qmai/章纲模板.html"

let activeTemplate: string | null = null

/** 取当前生效的模板内容（默认内置模板）。 */
export function getChapterOutlineTemplate(): string {
  return activeTemplate ?? templateHtml
}

/** 供测试重置运行时模板状态。 */
export function resetChapterOutlineTemplateForTest(): void {
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

/** 与卷纲同款三级回退：项目覆盖 → 程序 skills 目录 → 内置模板。 */
export async function primeChapterOutlineTemplate(projectPath?: string | null): Promise<void> {
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

/** 供测试使用：模板是否成功加载。 */
export const CHAPTER_OUTLINE_TEMPLATE_READY = REQUIRED_PLACEHOLDERS.every((placeholder) =>
  templateHtml.includes(placeholder))

const MIN_CHAPTER_COUNT = 1
const MIN_EVENT_COUNT = 6
const MIN_MOOD_CURVE_NODES = 4
const WORD_TOLERANCE = 0.2
const MIN_WORD_COUNT = 500

/** §17 写作检查清单的 10 条固定项（与 SKILL.md 一致，关键词用于比对 AI 实际写入的条目）。 */
export const CHAPTER_CHECK_ITEMS: Array<{ label: string; keywords: string[] }> = [
  { label: "三行内入戏", keywords: ["入戏"] },
  { label: "有明确变化", keywords: ["变化"] },
  { label: "事件链有因果", keywords: ["因果"] },
  { label: "有核心记忆点", keywords: ["记忆点"] },
  { label: "有动作微细节", keywords: ["微细节"] },
  { label: "有爽点", keywords: ["爽点"] },
  { label: "回收旧信息", keywords: ["回收"] },
  { label: "埋新信息", keywords: ["埋"] },
  { label: "有追读钩子", keywords: ["钩子"] },
  { label: "已写明下一章交接", keywords: ["交接"] },
]

/** 10 环节的固定前进顺序（章纲里的环节必须单调前进）。 */
const STAGE_ORDER = [
  "起①", "起②", "起③", "承①", "承②", "承③", "转①", "转②", "合①", "合②",
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return (Array.isArray(value) ? value : []).filter(isRecord)
}

function escapeHtml(value: unknown): string {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function splitNames(value: string): string[] {
  return value.split(/[、,，；;\/]/).map((item) => item.trim()).filter(Boolean)
}

/** 归一化 AI 输出的章纲数据（容错：字段缺失取空、类型不符丢弃）。 */
export function normalizeChapterOutlineData(raw: unknown): ChapterOutlineData | null {
  if (!isRecord(raw)) return null
  const storyRaw = isRecord(raw.story) ? raw.story : {}
  const chapters = asRecordArray(raw.chapters).map((item, index) => {
    const info = isRecord(item.info) ? item.info : {}
    const carry = isRecord(item.carry) ? item.carry : {}
    const position = isRecord(item.position) ? item.position : {}
    const keywords = isRecord(item.keywords) ? item.keywords : {}
    const conditions = isRecord(item.conditions) ? item.conditions : {}
    const fourBeat = isRecord(item.fourBeat) ? item.fourBeat : {}
    const sell = isRecord(item.sell) ? item.sell : {}
    const visual = isRecord(item.visual) ? item.visual : {}
    const foreshadow = isRecord(item.foreshadow) ? item.foreshadow : {}
    const worldUpdate = isRecord(item.worldUpdate) ? item.worldUpdate : {}
    const rules = isRecord(item.rules) ? item.rules : {}
    const handover = isRecord(item.handover) ? item.handover : {}
    return {
      n: typeof item.n === "number" ? item.n : index + 1,
      title: asString(item.title),
      stage: asString(item.stage),
      beat: asString(item.beat),
      expect: asString(item.expect),
      time: asString(item.time),
      place: asString(item.place),
      seedFores: asString(item.seedFores),
      payFores: asString(item.payFores),
      info: {
        attr: asString(info.attr),
        mood: asString(info.mood),
        words: asString(info.words),
        goal: asString(info.goal),
      },
      carry: {
        hook: asString(carry.hook),
        left: asString(carry.left),
        heroState: asString(carry.heroState),
        castState: asString(carry.castState),
        fores: asString(carry.fores),
        expect: asString(carry.expect),
      },
      position: {
        main: asString(position.main),
        advance: asString(position.advance),
        charArc: asString(position.charArc),
        relation: asString(position.relation),
        whyRead: asString(position.whyRead),
        newExpect: asString(position.newExpect),
      },
      digest: asString(item.digest),
      events: asRecordArray(item.events).map((event) => ({
        what: asString(event.what),
        cause: asString(event.cause),
        action: asString(event.action),
        result: asString(event.result),
        use: asString(event.use),
      })),
      keywords: {
        scene: asString(keywords.scene),
        mood: asString(keywords.mood),
        props: asString(keywords.props),
        relation: asString(keywords.relation),
        sell: asString(keywords.sell),
      },
      conditions: {
        enter: asString(conditions.enter),
        trigger: asString(conditions.trigger),
        interact: asString(conditions.interact),
        result: asString(conditions.result),
      },
      fourBeat: {
        open: asString(fourBeat.open),
        clash: asString(fourBeat.clash),
        burst: asString(fourBeat.burst),
        close: asString(fourBeat.close),
      },
      moodCurve: asRecordArray(item.moodCurve).map((point) => ({
        node: asString(point.node),
        state: asString(point.state),
        trigger: asString(point.trigger),
        feel: asString(point.feel),
      })),
      sell: {
        first: asString(sell.first),
        main: asString(sell.main),
        build: asString(sell.build),
        release: asString(sell.release),
        react: asString(sell.react),
        after: asString(sell.after),
        fit: asString(sell.fit),
      },
      expand: asRecordArray(item.expand).map((row) => ({
        info: asString(row.info),
        how: asString(row.how),
        skill: asString(row.skill),
        effect: asString(row.effect),
      })),
      visual: {
        env: asString(visual.env),
        micro: asString(visual.micro),
        hint: asString(visual.hint),
        replace: asString(visual.replace),
        memory: asString(visual.memory),
      },
      foreshadow: {
        payFrom: asString(foreshadow.payFrom),
        payHow: asString(foreshadow.payHow),
        payLevel: asString(foreshadow.payLevel),
        seedNew: asString(foreshadow.seedNew),
        seedAt: asString(foreshadow.seedAt),
        seedUse: asString(foreshadow.seedUse),
        hookType: asString(foreshadow.hookType),
        readerAsk: asString(foreshadow.readerAsk),
        nextMust: asString(foreshadow.nextMust),
      },
      castChanges: asRecordArray(item.castChanges).map((row) => ({
        who: asString(row.who),
        role: asString(row.role),
        inState: asString(row.inState),
        outState: asString(row.outState),
        relation: asString(row.relation),
      })),
      worldUpdate: {
        setting: asString(worldUpdate.setting),
        place: asString(worldUpdate.place),
        faction: asString(worldUpdate.faction),
        item: asString(worldUpdate.item),
        writeBack: asString(worldUpdate.writeBack),
      },
      rules: {
        must: asString(rules.must),
        forbid: asString(rules.forbid),
        secret: asString(rules.secret),
        pace: asString(rules.pace),
        style: asString(rules.style),
        sellPoint: asString(rules.sellPoint),
      },
      handover: {
        nextStart: asString(handover.nextStart),
        nextSolve: asString(handover.nextSolve),
        nextDelay: asString(handover.nextDelay),
        nextMood: asString(handover.nextMood),
        nextHook: asString(handover.nextHook),
      },
      checks: (Array.isArray(item.checks) ? item.checks : []).map(asString).filter(Boolean),
    }
  })
  if (chapters.length === 0) return null
  return {
    title: asString(raw.title) || "章纲",
    story: {
      index: typeof storyRaw.index === "number" ? storyRaw.index : 1,
      name: asString(storyRaw.name),
      range: asString(storyRaw.range),
      beats: asString(storyRaw.beats),
    },
    chapters,
    words: asNumber(raw.words),
  }
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

function listBlock(items: string[]): string {
  if (items.length === 0) return `<p class="hint">未填</p>`
  return `<ul class="clist">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
}

function tableBlock(head: string[], rows: string[][]): string {
  if (rows.length === 0) return `<p class="hint">未填</p>`
  return `<div class="mxwrap"><table class="mx"><thead><tr>${
    head.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")
  }</tr></thead><tbody>${
    rows.map((row) => `<tr>${row.map((cell, index) => `<td${index === 0 ? ' class="mxh"' : ""}>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")
  }</tbody></table></div>`
}

type ChapterSectionSpec = {
  id: string
  title: string
  rows: Array<
    | { kind: "kv"; label: string; get: (c: ChapterOutlineChapter) => string }
    | { kind: "list"; label: string; get: (c: ChapterOutlineChapter) => string[] }
    | { kind: "table"; label: string; head: string[]; get: (c: ChapterOutlineChapter) => string[][] }
  >
}

/** 17 节章纲标准的展示定义（数据驱动，改节内容只动这张表）。 */
const CHAPTER_SECTIONS: ChapterSectionSpec[] = [
  {
    id: "s1", title: "§1 基础信息",
    rows: [
      { kind: "kv", label: "章节编号", get: (c) => `第 ${String(c.n).padStart(3, "0")} 章` },
      { kind: "kv", label: "章节标题", get: (c) => c.title },
      { kind: "kv", label: "所属环节", get: (c) => `${c.stage}${STAGE_CHAPTER_MAP[c.stage] ? `（${STAGE_CHAPTER_MAP[c.stage]}）` : ""}` },
      { kind: "kv", label: "本章节拍", get: (c) => c.beat },
      { kind: "kv", label: "字数目标", get: (c) => c.info.words },
      { kind: "kv", label: "章节属性", get: (c) => c.info.attr },
      { kind: "kv", label: "核心情绪", get: (c) => c.info.mood },
      { kind: "kv", label: "主期待感", get: (c) => c.expect },
      { kind: "kv", label: "章内时间", get: (c) => c.time },
      { kind: "kv", label: "主要地点", get: (c) => c.place },
      { kind: "kv", label: "一句话目标", get: (c) => c.info.goal },
    ],
  },
  {
    id: "s2", title: "§2 上章承接",
    rows: [
      { kind: "kv", label: "上章结尾钩子", get: (c) => c.carry.hook },
      { kind: "kv", label: "上章遗留问题", get: (c) => c.carry.left },
      { kind: "kv", label: "主角当前状态", get: (c) => c.carry.heroState },
      { kind: "kv", label: "角色当前状态", get: (c) => c.carry.castState },
      { kind: "kv", label: "未回收伏笔", get: (c) => c.carry.fores },
      { kind: "kv", label: "必须承接的期待", get: (c) => c.carry.expect },
    ],
  },
  {
    id: "s3", title: "§3 本章定位",
    rows: [
      { kind: "kv", label: "主线承接", get: (c) => c.position.main },
      { kind: "kv", label: "主线推进", get: (c) => c.position.advance },
      { kind: "kv", label: "人物变化", get: (c) => c.position.charArc },
      { kind: "kv", label: "关系变化", get: (c) => c.position.relation },
      { kind: "kv", label: "读者追读目的", get: (c) => c.position.whyRead },
      { kind: "kv", label: "结束后新期待", get: (c) => c.position.newExpect },
    ],
  },
  {
    id: "s4", title: "§4 浓缩剧情",
    rows: [{ kind: "kv", label: "一句话公式", get: (c) => c.digest }],
  },
  {
    id: "s5", title: "§5 核心事件链",
    rows: [{
      kind: "table", label: "事件因果链",
      head: ["事件", "起因", "行动", "结果", "作用"],
      get: (c) => c.events.map((event) => [event.what, event.cause, event.action, event.result, event.use]),
    }],
  },
  {
    id: "s6", title: "§6 关键词与必要条件",
    rows: [
      { kind: "kv", label: "场景关键词", get: (c) => c.keywords.scene },
      { kind: "kv", label: "情绪关键词", get: (c) => c.keywords.mood },
      { kind: "kv", label: "道具线索", get: (c) => c.keywords.props },
      { kind: "kv", label: "关系关键词", get: (c) => c.keywords.relation },
      { kind: "kv", label: "爽点冲突", get: (c) => c.keywords.sell },
      {
        kind: "table", label: "必要条件",
        head: ["类型", "内容"],
        get: (c) => [
          ["入场条件", c.conditions.enter],
          ["触发条件", c.conditions.trigger],
          ["互动条件", c.conditions.interact],
          ["结果条件", c.conditions.result],
        ],
      },
    ],
  },
  {
    id: "s7", title: "§7 四段式章纲",
    rows: [
      { kind: "kv", label: "开篇入戏", get: (c) => c.fourBeat.open },
      { kind: "kv", label: "中段冲突", get: (c) => c.fourBeat.clash },
      { kind: "kv", label: "核心爆点", get: (c) => c.fourBeat.burst },
      { kind: "kv", label: "强钩收尾", get: (c) => c.fourBeat.close },
    ],
  },
  {
    id: "s8", title: "§8 情绪曲线",
    rows: [{
      kind: "table", label: "四节点情绪",
      head: ["节点", "情绪状态", "触发事件", "读者感受"],
      get: (c) => c.moodCurve.map((point) => [point.node, point.state, point.trigger, point.feel]),
    }],
  },
  {
    id: "s9", title: "§9 爽点与看点",
    rows: [
      { kind: "kv", label: "章首看点", get: (c) => c.sell.first },
      { kind: "kv", label: "主要爽点", get: (c) => c.sell.main },
      { kind: "kv", label: "爽点铺垫", get: (c) => c.sell.build },
      { kind: "kv", label: "爽点释放", get: (c) => c.sell.release },
      { kind: "kv", label: "反应层对象", get: (c) => c.sell.react },
      { kind: "kv", label: "之后的新期待", get: (c) => c.sell.after },
      { kind: "kv", label: "与核心卖点一致", get: (c) => c.sell.fit },
    ],
  },
  {
    id: "s10", title: "§10 关键信息与扩写方式",
    rows: [{
      kind: "table", label: "信息 → 场景",
      head: ["关键信息", "如何扩写", "扩写技法", "情绪作用"],
      get: (c) => c.expand.map((row) => [row.info, row.how, row.skill, row.effect]),
    }],
  },
  {
    id: "s11", title: "§11 画面细节",
    rows: [
      { kind: "kv", label: "环境细节", get: (c) => c.visual.env },
      { kind: "kv", label: "动作微细节", get: (c) => c.visual.micro },
      { kind: "kv", label: "信息暗线", get: (c) => c.visual.hint },
      { kind: "kv", label: "可替代心理", get: (c) => c.visual.replace },
      { kind: "kv", label: "视觉记忆点", get: (c) => c.visual.memory },
    ],
  },
  {
    id: "s12", title: "§12 伏笔与钩子",
    rows: [
      { kind: "kv", label: "回收来源", get: (c) => c.foreshadow.payFrom },
      { kind: "kv", label: "如何回收", get: (c) => c.foreshadow.payHow },
      { kind: "kv", label: "回收程度", get: (c) => c.foreshadow.payLevel },
      { kind: "kv", label: "新伏笔", get: (c) => c.foreshadow.seedNew },
      { kind: "kv", label: "埋设位置", get: (c) => c.foreshadow.seedAt },
      { kind: "kv", label: "后续用途", get: (c) => c.foreshadow.seedUse },
      { kind: "kv", label: "钩子类型", get: (c) => c.foreshadow.hookType },
      { kind: "kv", label: "读者会问", get: (c) => c.foreshadow.readerAsk },
      { kind: "kv", label: "下章必须回应", get: (c) => c.foreshadow.nextMust },
    ],
  },
  {
    id: "s13", title: "§13 出场角色与状态变化",
    rows: [{
      kind: "table", label: "角色状态",
      head: ["角色", "本章作用", "入场状态", "结束状态", "关系变化"],
      get: (c) => c.castChanges.map((row) => [row.who, row.role, row.inState, row.outState, row.relation]),
    }],
  },
  {
    id: "s14", title: "§14 设定 / 世界观 / 道具更新",
    rows: [
      { kind: "kv", label: "新增设定", get: (c) => c.worldUpdate.setting },
      { kind: "kv", label: "新增地点", get: (c) => c.worldUpdate.place },
      { kind: "kv", label: "新增势力", get: (c) => c.worldUpdate.faction },
      { kind: "kv", label: "新增道具", get: (c) => c.worldUpdate.item },
      { kind: "kv", label: "需写回设定", get: (c) => c.worldUpdate.writeBack },
    ],
  },
  {
    id: "s15", title: "§15 写作约束",
    rows: [
      { kind: "kv", label: "必须写", get: (c) => c.rules.must },
      { kind: "kv", label: "禁止写", get: (c) => c.rules.forbid },
      { kind: "kv", label: "不能泄露", get: (c) => c.rules.secret },
      { kind: "kv", label: "节奏要求", get: (c) => c.rules.pace },
      { kind: "kv", label: "文风要求", get: (c) => c.rules.style },
      { kind: "kv", label: "不可偏离卖点", get: (c) => c.rules.sellPoint },
    ],
  },
  {
    id: "s16", title: "§16 下一章交接",
    rows: [
      { kind: "kv", label: "下章须承接", get: (c) => c.handover.nextStart },
      { kind: "kv", label: "下章须解决", get: (c) => c.handover.nextSolve },
      { kind: "kv", label: "可延迟揭示", get: (c) => c.handover.nextDelay },
      { kind: "kv", label: "推荐情绪", get: (c) => c.handover.nextMood },
      { kind: "kv", label: "推荐章尾钩子", get: (c) => c.handover.nextHook },
    ],
  },
  {
    id: "s17", title: "§17 写作检查清单",
    rows: [{ kind: "list", label: "已覆盖条目", get: (c) => c.checks }],
  },
]

function renderSectionRows(spec: ChapterSectionSpec, chapter: ChapterOutlineChapter): string {
  return spec.rows.map((row) => {
    if (row.kind === "kv") return kvRow(row.label, row.get(chapter))
    if (row.kind === "list") return listBlock(row.get(chapter))
    return tableBlock(row.head, row.get(chapter))
  }).join("")
}

/** 单章卡片（摘要行只放 5 个关键信息，展开是 17 节）。 */
function chapterCard(chapter: ChapterOutlineChapter, isFirst: boolean): string {
  const stageLabel = STAGE_CHAPTER_MAP[chapter.stage] ?? ""
  const summary = [
    `<span class="cno">第 ${escapeHtml(String(chapter.n))} 章</span>`,
    `<span class="ct">${escapeHtml(chapter.title || "未命名")}</span>`,
    chapter.info.attr ? `<span class="tag attr">${escapeHtml(chapter.info.attr)}</span>` : "",
    chapter.info.mood ? `<span class="tag mood">${escapeHtml(chapter.info.mood)}</span>` : "",
    chapter.expect ? `<span class="tag exp">期待 · ${escapeHtml(chapter.expect)}</span>` : "",
    chapter.stage ? `<span class="tag chap" title="${escapeHtml(stageLabel || chapter.stage)}">${escapeHtml(chapter.stage)}</span>` : "",
    chapter.beat ? `<span class="bt" data-b="${escapeHtml(chapter.beat)}">${escapeHtml(chapter.beat)}</span>` : "",
    chapter.info.goal ? `<span class="cgoal">${escapeHtml(chapter.info.goal)}</span>` : "",
  ].filter(Boolean).join("")
  const body = CHAPTER_SECTIONS.map((spec) =>
    `<div class="csec" id="ch-${escapeHtml(String(chapter.n))}-${spec.id}"><h4>${escapeHtml(spec.title)}</h4>${renderSectionRows(spec, chapter)}</div>`).join("")
  return `<details class="cc" id="ch-${escapeHtml(String(chapter.n))}"${isFirst ? " open" : ""}><summary>${summary}</summary><div class="cbody">${body}</div></details>`
}

function buildCardsHtml(data: ChapterOutlineData): string {
  if (data.chapters.length === 0) return emptyHint("未包含章纲数据（chapters 为空），请重新生成章纲。")
  return data.chapters.map((chapter, index) => chapterCard(chapter, index === 0)).join("")
}

function buildStorySummaryHtml(data: ChapterOutlineData): string {
  const story = data.story
  const beats = Array.from(story.beats || "")
  const beatChips = beats.length
    ? beats.map((beat) => `<span class="bt" data-b="${escapeHtml(beat)}">${escapeHtml(beat)}</span>`).join("")
    : `<span class="hint">骨架节拍未填</span>`
  const rows = [
    kvRow("所属故事", story.name ? `故事${story.index}：${story.name}` : `故事${story.index}`),
    kvRow("章号区间", story.range || `${data.chapters.length} 章`),
    kvRow("字数目标", data.words ? `约 ${(data.words / 10000).toFixed(1)} 万字` : "未填"),
    kvRow("章节数", `${data.chapters.length} 章`),
  ].join("")
  return `<div class="story-card">${rows}<div class="beatrow"><span class="kk">骨架节拍</span><div class="beats">${beatChips}</div></div></div>`
}

function buildChipsHtml(data: ChapterOutlineData): string {
  const chapters = data.chapters
  const eventCount = chapters.reduce((sum, chapter) => sum + chapter.events.length, 0)
  const seeds = chapters.reduce((sum, chapter) => sum + splitNames(chapter.seedFores).length, 0)
  const pays = chapters.reduce((sum, chapter) => sum + splitNames(chapter.payFores).length, 0)
  const peaks = chapters.filter((chapter) => chapter.beat === "顶").length
  const totalWords = data.words || chapters.reduce((sum, chapter) => sum + Number(chapter.info.words.replace(/[^\d]/g, "")) || 0, 0)
  return [
    `<span class="chip"><b>${chapters.length}</b> 章</span>`,
    totalWords ? `<span class="chip"><b>约 ${(totalWords / 10000).toFixed(1)}</b> 万字</span>` : "",
    `<span class="chip"><b>${eventCount}</b> 个事件</span>`,
    `<span class="chip"><b>${seeds}</b> 埋 / <b>${pays}</b> 收 伏笔</span>`,
    `<span class="chip"><b>${peaks}</b> 个峰值（顶）</span>`,
  ].filter(Boolean).join("")
}

function buildNavHtml(data: ChapterOutlineData): string {
  if (data.chapters.length === 0) return ""
  const links = data.chapters.map((chapter) =>
    `<a class="navlink" href="#ch-${escapeHtml(String(chapter.n))}"><b>${escapeHtml(String(chapter.n))}</b>${escapeHtml(chapter.title || "未命名")}</a>`).join("")
  return `<nav class="nav"><span class="navt">跳到章节</span>${links}</nav>`
}

/** 章 × 环节 × 节拍 对照 + 字数配比。 */
function buildAlignHtml(data: ChapterOutlineData): string {
  const chapters = data.chapters
  if (chapters.length === 0) return ""
  const rows = chapters.map((chapter, index) => [
    `第 ${chapter.n} 章`,
    chapter.stage || "未填",
    chapter.beat || "未填",
    data.story.beats[index] ?? "—",
    chapter.expect || "未填",
    chapter.info.attr || "未填",
  ])
  const alignPanel = tableBlock(
    ["章号", "所属环节", "本章节拍", "骨架节拍", "主期待感", "章节属性"],
    rows,
  )
  const alignNote = data.story.beats
    ? (rows.every((row) => row[2] === row[3]) ? "节拍与骨架逐字对齐" : "存在节拍不一致，见体检面板")
    : "骨架节拍未填"

  const wordRows = chapters.map((chapter, index) => {
    const target = Number(chapter.info.words.replace(/[^\d]/g, "")) || 0
    const cumulated = chapters.slice(0, index + 1)
      .reduce((sum, item) => sum + (Number(item.info.words.replace(/[^\d]/g, "")) || 0), 0)
    return [`第 ${chapter.n} 章`, chapter.info.words || "未填", target ? `${(target / 10000).toFixed(2)} 万` : "—", `${(cumulated / 10000).toFixed(2)} 万`]
  })
  const wordPanel = tableBlock(["章号", "字数目标", "本章", "累计"], wordRows)

  return [
    panelSection("章 × 环节 × 节拍 对照", alignNote, alignPanel),
    panelSection("字数配比", data.words ? `故事目标 约 ${(data.words / 10000).toFixed(1)} 万字` : "", wordPanel),
  ].join("")
}

/** 期待与钩子链 + 爽点节奏。 */
function buildExpectHtml(data: ChapterOutlineData): string {
  const chapters = data.chapters
  if (chapters.length === 0) return ""
  const chainRows = chapters.map((chapter) => [
    `第 ${chapter.n} 章`,
    chapter.carry.expect || "—",
    chapter.expect || "未填",
    chapter.foreshadow.hookType || "未填",
    chapter.foreshadow.readerAsk || "—",
    chapter.foreshadow.nextMust || "—",
  ])
  const chainPanel = tableBlock(
    ["章号", "承接上章的期待", "本章主期待", "章尾钩子类型", "读者会问", "下章必须回应"],
    chainRows,
  )

  const sellRows = chapters.map((chapter) => [
    `第 ${chapter.n} 章`,
    chapter.sell.first || "—",
    chapter.sell.main || "未填",
    chapter.sell.react || "—",
    chapter.sell.after || "—",
  ])
  const sellPanel = tableBlock(["章号", "章首看点", "主要爽点", "反应层对象", "爽点后新期待"], sellRows)

  return [
    panelSection("期待与钩子链", "承接 → 本章期待 → 章尾钩子 → 交给下一章", chainPanel),
    panelSection("爽点节奏表", "", sellPanel),
  ].join("")
}

/** 伏笔账本：本章埋 / 本章收 + 闭环状态。 */
function buildForesHtml(data: ChapterOutlineData): string {
  const chapters = data.chapters
  if (chapters.length === 0) return ""
  const rows: string[][] = []
  const seeded = new Set<string>()
  let unclosed = 0
  chapters.forEach((chapter) => {
    splitNames(chapter.seedFores).forEach((name) => {
      if (!seeded.has(name)) seeded.add(name)
      rows.push([`第 ${chapter.n} 章 · 埋`, name, chapter.foreshadow.seedAt || "—", chapter.foreshadow.seedUse || "—"])
    })
    splitNames(chapter.payFores).forEach((name) => {
      const closed = seeded.has(name)
      if (!closed) unclosed += 1
      rows.push([`第 ${chapter.n} 章 · 收`, name, chapter.foreshadow.payLevel || "—", closed ? "闭环保内" : "无同故事埋点"])
    })
  })
  if (rows.length === 0) {
    return panelSection("伏笔账本", "", emptyHint("本次未生成伏笔埋收数据（技能要求每章填 seedFores / payFores）。"))
  }
  const panel = tableBlock(["动作", "伏笔", "说明", "程度 / 用途"], rows)
  const note = unclosed > 0
    ? `${rows.length} 条记录 · ${unclosed} 条回收在本故事内找不到埋点`
    : `${rows.length} 条记录 · 本故事内埋收闭环`
  return panelSection("伏笔账本", note, panel)
}

/** 人物出场与状态变化 + 地点时间切换。 */
function buildSceneHtml(data: ChapterOutlineData): string {
  const chapters = data.chapters
  if (chapters.length === 0) return ""
  const castRows: string[][] = []
  chapters.forEach((chapter) => {
    chapter.castChanges.forEach((row) => {
      castRows.push([`第 ${chapter.n} 章`, row.who, row.role, row.inState, row.outState, row.relation])
    })
  })
  const castPanel = castRows.length
    ? tableBlock(["章号", "角色", "本章作用", "入场状态", "结束状态", "关系变化"], castRows)
    : emptyHint("本次未生成角色状态变化（技能要求每章填 castChanges）。")

  const placeRows = chapters.map((chapter) => [`第 ${chapter.n} 章`, chapter.place || "未填", chapter.time || "未填"])
  const placePanel = tableBlock(["章号", "主要地点", "章内时间"], placeRows)

  return [
    panelSection("人物出场与状态变化", castRows.length ? `${castRows.length} 条` : "", castPanel),
    panelSection("地点与时间切换", "", placePanel),
  ].join("")
}

/** 情绪曲线（inline SVG，静态绘制逐章节拍强度）。 */
function buildCurveHtml(data: ChapterOutlineData): string {
  const chapters = data.chapters
  if (chapters.length < 2) {
    return panelSection("情绪曲线", "", emptyHint("章节不足 2 章，无法绘制曲线。"))
  }
  const values = chapters.map((chapter) => BEAT_INTENSITY[chapter.beat] ?? 2.5)
  const width = 1200
  const height = 240
  const padLeft = 46
  const padRight = 16
  const padTop = 22
  const padBottom = 34
  const innerW = width - padLeft - padRight
  const innerH = height - padTop - padBottom
  const pointX = (index: number) => padLeft + (innerW * index) / (values.length - 1)
  const pointY = (value: number) => padTop + innerH * (1 - (value - 1) / 4)
  const line = values.map((value, index) => `${pointX(index).toFixed(1)},${pointY(value).toFixed(1)}`).join(" ")
  const area = `${padLeft},${(padTop + innerH).toFixed(1)} ${line} ${(padLeft + innerW).toFixed(1)},${(padTop + innerH).toFixed(1)}`
  const guides = [
    { value: 5, label: "顶" },
    { value: 3.2, label: "起" },
    { value: 1, label: "平" },
  ].map((guide) => [
    `<line class="cg" x1="${padLeft}" x2="${padLeft + innerW}" y1="${pointY(guide.value).toFixed(1)}" y2="${pointY(guide.value).toFixed(1)}"/>`,
    `<text class="ct" x="${padLeft - 8}" y="${(pointY(guide.value) + 4).toFixed(1)}" text-anchor="end">${guide.label}</text>`,
  ].join("")).join("")
  const labels = chapters.map((chapter, index) =>
    `<text class="ct" x="${pointX(index).toFixed(1)}" y="${height - 10}" text-anchor="middle">${escapeHtml(String(chapter.n))}</text>`).join("")
  const peaks = values.map((value, index) =>
    (value === 5 ? `<circle class="cp" cx="${pointX(index).toFixed(1)}" cy="${pointY(5).toFixed(1)}" r="3"/>` : "")).join("")
  const svg = [
    `<div class="svgwrap"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="逐章情绪强度曲线">`,
    guides,
    `<polygon class="ca" points="${area}"/>`,
    `<polyline class="cl" points="${line}"/>`,
    peaks,
    labels,
    `</svg></div>`,
  ].join("")
  const caption = `<p class="ecap">纵轴＝本章节拍强度（平 1 → 顶 5），横轴＝章号。低谷（平/落/缓）用来交代与消化代价，峰值（顶）用来收账。</p>`
  return panelSection("情绪曲线", `${chapters.length} 章 · 峰值 ${values.filter((value) => value === 5).length} 次`, svg + caption)
}

/** 一致性体检结果（渲染时重算一次，供阅读者直接看到）。 */
function buildCheckHtml(data: ChapterOutlineData): string {
  const problems = validateChapterOutlineData(data).problems
  // 非阻断提示：骨架节拍数与章节数不等（卷纲常见 10 章故事配 12 拍，属内容层面的口径差异）
  const notes: string[] = []
  const skeletonBeats = Array.from(data.story.beats || "")
  if (skeletonBeats.length > 0 && skeletonBeats.length !== data.chapters.length) {
    notes.push(`骨架节拍 ${skeletonBeats.length} 拍与章纲 ${data.chapters.length} 章数量不等，请确认卷纲口径。`)
  }
  const noteHtml = notes.length
    ? `<p class="hint">${escapeHtml(notes.join(" "))}</p>`
    : ""

  if (problems.length === 0) {
    return panelSection(
      "一致性体检",
      "全部通过",
      `<p class="okbox">章数、章号连续性、节拍对齐、环节顺序、伏笔闭环、日常落拍、事件链因果、必要条件、章间交接链、写作约束与字数配比均通过校验。</p>${noteHtml}`,
    )
  }
  const grouped = new Map<string, string[]>()
  problems.forEach((problem) => {
    const chapter = problem.match(/^第 \d+ 章/)?.[0] ?? "整体"
    const list = grouped.get(chapter) ?? []
    list.push(problem)
    grouped.set(chapter, list)
  })
  const body = [...grouped.entries()].map(([chapter, list]) =>
    `<div class="chk"><div class="chkh">${escapeHtml(chapter)}</div><ul class="issues">${list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`).join("")
  return panelSection("一致性体检", `${problems.length} 项待修`, body + noteHtml)
}

/** 用模板渲染章纲卡片流 HTML（纯静态，0 脚本）。 */
export function renderChapterOutlineHtml(
  data: ChapterOutlineData,
  template: string = getChapterOutlineTemplate(),
): string {
  const placeholders: Record<string, string> = {
    [TITLE_PLACEHOLDER]: escapeHtml(data.title || "章纲"),
    [SUMMARY_PLACEHOLDER]: buildStorySummaryHtml(data),
    [CHIPS_PLACEHOLDER]: buildChipsHtml(data),
    [NAV_PLACEHOLDER]: buildNavHtml(data),
    [ALIGN_PLACEHOLDER]: buildAlignHtml(data),
    [EXPECT_PLACEHOLDER]: buildExpectHtml(data),
    [FORES_PLACEHOLDER]: buildForesHtml(data),
    [SCENE_PLACEHOLDER]: buildSceneHtml(data),
    [CURVE_PLACEHOLDER]: buildCurveHtml(data),
    [CHECK_PLACEHOLDER]: buildCheckHtml(data),
    [CARDS_PLACEHOLDER]: buildCardsHtml(data),
  }
  // 用函数替换器，避免内容里的 $& / $1 等被当作替换模式
  return Object.entries(placeholders).reduce(
    (html, [placeholder, value]) => html.replace(placeholder, () => value),
    template,
  )
}

/** 11 条自动校验：章纲内部自洽 + 与自带骨架一致。 */
export function validateChapterOutlineData(
  data: ChapterOutlineData | null,
): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  if (!data) {
    problems.push("未解析到章纲结构化数据（chapterOutlineData），无法渲染 HTML。")
    return { ok: false, problems }
  }
  const chapters = data.chapters
  if (chapters.length < MIN_CHAPTER_COUNT) {
    problems.push("章纲未包含任何章节。")
    return { ok: false, problems }
  }

  // 1 / 2 章数与章号连续性
  const expected = parseChapterCount(data.story.range)
  if (expected && expected !== chapters.length) {
    problems.push(`章节数与故事骨架不一致：骨架 ${expected} 章，实际 ${chapters.length} 章。`)
  }
  chapters.forEach((chapter, index) => {
    if (index > 0 && chapter.n !== chapters[index - 1].n + 1) {
      problems.push(`第 ${chapter.n} 章的章号不连续（上一章为第 ${chapters[index - 1].n} 章）。`)
    }
  })

  // 3 节拍与骨架逐字对齐
  if (data.story.beats) {
    const skeleton = Array.from(data.story.beats)
    chapters.forEach((chapter, index) => {
      const beat = skeleton[index]
      if (beat && chapter.beat && chapter.beat !== beat) {
        problems.push(`第 ${chapter.n} 章节拍「${chapter.beat}」与骨架节拍「${beat}」不一致。`)
      }
    })
  }

  // 4 环节顺序：必须按 10 环节体系单调前进，不得回退或出现体系外环节
  let lastStageIndex = -1
  chapters.forEach((chapter) => {
    if (!chapter.stage) {
      problems.push(`第 ${chapter.n} 章缺少所属环节（stage）。`)
      return
    }
    const stageIndex = STAGE_ORDER.indexOf(chapter.stage)
    if (stageIndex < 0) {
      problems.push(`第 ${chapter.n} 章的环节「${chapter.stage}」不在 10 环节体系内。`)
      return
    }
    if (stageIndex < lastStageIndex) {
      problems.push(`第 ${chapter.n} 章的环节「${chapter.stage}」出现回退，不符合 10 环节前进顺序。`)
    }
    lastStageIndex = stageIndex
  })

  // 5 节拍纪律（只查纪律，不查节拍总数 —— 故事可能是 10 章，骨架也可能是 12 拍）
  const beatSequence = chapters.map((chapter) => chapter.beat).join("")
  const beatIssues = checkBeats(beatSequence).filter((issue) => !issue.startsWith("节拍数"))
  beatIssues.forEach((issue) => problems.push(`节拍纪律：${issue}。`))

  // 6 伏笔闭环：回收的伏笔必须在更早章节埋过
  const seeded = new Map<string, number>()
  chapters.forEach((chapter) => {
    splitNames(chapter.payFores).forEach((name) => {
      const seedAt = seeded.get(name)
      if (seedAt === undefined) {
        problems.push(`第 ${chapter.n} 章回收的伏笔「${name}」在本故事内没有更早的埋点。`)
      } else if (seedAt >= chapter.n) {
        problems.push(`第 ${chapter.n} 章回收的伏笔「${name}」埋点章号（第 ${seedAt} 章）不早于回收章。`)
      }
    })
    splitNames(chapter.seedFores).forEach((name) => {
      if (!seeded.has(name)) seeded.set(name, chapter.n)
    })
  })

  // 7 日常落拍：日常只能落在 平 / 落 / 缓 / 悬
  const dailyBeats = ["平", "落", "缓", "悬"]
  chapters.forEach((chapter) => {
    const isDaily = /日常/.test(chapter.position.advance) || /日常/.test(chapter.position.main)
    if (isDaily && !dailyBeats.includes(chapter.beat)) {
      problems.push(`第 ${chapter.n} 章为日常章，但节拍是「${chapter.beat}」（日常只能落在 平/落/缓/悬）。`)
    }
  })

  // 8 事件链
  chapters.forEach((chapter) => {
    if (chapter.events.length < MIN_EVENT_COUNT) {
      problems.push(`第 ${chapter.n} 章核心事件链不足 ${MIN_EVENT_COUNT} 条（当前 ${chapter.events.length} 条）。`)
    }
    chapter.events.forEach((event, index) => {
      if (!event.cause.trim()) problems.push(`第 ${chapter.n} 章第 ${index + 1} 个事件缺少起因，不构成因果链。`)
      if (!event.result.trim()) problems.push(`第 ${chapter.n} 章第 ${index + 1} 个事件缺少结果，不构成因果链。`)
    })
  })

  // 9 必要条件四类
  chapters.forEach((chapter) => {
    const missing = ([
      ["入场条件", chapter.conditions.enter],
      ["触发条件", chapter.conditions.trigger],
      ["互动条件", chapter.conditions.interact],
      ["结果条件", chapter.conditions.result],
    ] as const).filter(([, value]) => !value.trim()).map(([label]) => label)
    if (missing.length > 0) {
      problems.push(`第 ${chapter.n} 章缺少必要条件：${missing.join(" / ")}。`)
    }
  })

  // 10 章间交接链
  chapters.forEach((chapter, index) => {
    const next = chapters[index + 1]
    if (!next) return
    if (!chapter.handover.nextStart.trim()) {
      problems.push(`第 ${chapter.n} 章缺少「下一章交接」，第 ${next.n} 章会断档。`)
    }
    if (!next.carry.hook.trim()) {
      problems.push(`第 ${next.n} 章缺少「上章结尾钩子」，与第 ${chapter.n} 章接不上。`)
    }
  })

  // 11 写作约束 / 检查清单 / 字数
  chapters.forEach((chapter) => {
    if (!chapter.rules.must.trim() && !chapter.rules.forbid.trim()) {
      problems.push(`第 ${chapter.n} 章缺少写作约束（§15）。`)
    }
    if (chapter.checks.length === 0) {
      problems.push(`第 ${chapter.n} 章缺少写作检查清单（§17）。`)
    }
  })

  // 12 §17 检查清单必须覆盖 10 条固定项
  let checkMissChapters = 0
  chapters.forEach((chapter) => {
    if (chapter.checks.length === 0) return
    const missing = CHAPTER_CHECK_ITEMS
      .filter((item) => !chapter.checks.some((line) => item.keywords.some((keyword) => line.includes(keyword))))
      .map((item) => item.label)
    if (missing.length === 0) return
    checkMissChapters += 1
    if (checkMissChapters <= 3) {
      problems.push(`第 ${chapter.n} 章写作检查清单（§17）缺少固定项：${missing.slice(0, 5).join(" / ")}。`)
    }
  })
  if (checkMissChapters > 3) {
    problems.push(`另有 ${checkMissChapters - 3} 章的 §17 检查清单缺少固定项。`)
  }

  // 13 关键节非空：§8 情绪曲线 / §10 扩写方式 / §11 画面细节 / §13 出场角色 / §14 设定更新
  chapters.forEach((chapter) => {
    if (chapter.moodCurve.length < MIN_MOOD_CURVE_NODES) {
      problems.push(`第 ${chapter.n} 章情绪曲线（§8）不足 ${MIN_MOOD_CURVE_NODES} 个节点（当前 ${chapter.moodCurve.length} 个）。`)
    }
    if (chapter.expand.length === 0 || chapter.expand.some((item) => !item.info.trim() || !item.how.trim())) {
      problems.push(`第 ${chapter.n} 章关键信息与扩写方式（§10）缺失或没写清扩写方式。`)
    }
    if (!chapter.visual.env.trim() || !chapter.visual.memory.trim()) {
      problems.push(`第 ${chapter.n} 章画面细节（§11）缺少环境或记忆点。`)
    }
    if (chapter.castChanges.length === 0) {
      problems.push(`第 ${chapter.n} 章缺少出场角色与状态变化（§13）。`)
    }
    const hasWorldUpdate = [
      chapter.worldUpdate.setting,
      chapter.worldUpdate.place,
      chapter.worldUpdate.faction,
      chapter.worldUpdate.item,
      chapter.worldUpdate.writeBack,
    ].some((value) => value.trim().length > 0)
    if (!hasWorldUpdate) {
      problems.push(`第 ${chapter.n} 章缺少设定 / 世界观 / 道具更新（§14）。`)
    }
  })
  const totalWords = chapters.reduce((sum, chapter) => sum + (Number(chapter.info.words.replace(/[^\d]/g, "")) || 0), 0)
  if (data.words >= MIN_WORD_COUNT && totalWords > 0) {
    const deviation = Math.abs(totalWords - data.words) / data.words
    if (deviation > WORD_TOLERANCE) {
      problems.push(`逐章字数合计 ${totalWords} 与故事字数目标 ${data.words} 偏差超过 ${WORD_TOLERANCE * 100}%。`)
    }
  }

  return { ok: problems.length === 0, problems }
}

/** 从故事章号区间解析章节数，如「第 11–20 章」→ 10。 */
export function parseChapterCount(range: string): number | null {
  const numbers = String(range).match(/\d+/g)
  if (!numbers || numbers.length === 0) return null
  const start = Number(numbers[0])
  const end = numbers.length > 1 ? Number(numbers[1]) : start
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return end - start + 1
}

/** 从 `{` 起、在第一个深度归零的 JSON 对象。返回该 JSON 串，或超长/无起始时返回 null。 */
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

/** 从一段 JSON 里解出章纲数据（不管 AI 用什么信封名：整份/分批/裸 payload）。 */
function chapterDataFromPayload(payload: unknown): ChapterOutlineData | null {
  if (!isRecord(payload)) return null
  // 若顶层是单键信封（chapterOutlineData / chapterOutlineBatch / 别的什么名），
  // 先尝试把它当数据本身；再尝试把它包着的值当作数据。
  const direct = normalizeChapterOutlineData(payload)
  if (direct) return direct
  for (const value of Object.values(payload)) {
    if (!isRecord(value)) continue
    const inner = normalizeChapterOutlineData(value)
    if (inner) return inner
  }
  return null
}

/** 从 AI 回复中提取并解析章纲数据（优先在 ```json 围栏内查找）。 */
export function extractChapterOutlineData(text: string): ChapterOutlineData | null {
  const fencePattern = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi
  // 逐个 JSON 围栏尝试：只要里面有能解析成章纲的数据，就返回它。
  // 这样无论 AI 用 chapterOutlineData / chapterOutlineBatch / 其它信封名 / 裸对象，
  // 只要数据完整，就能渲染 HTML——避免「保存时提示未生成 HTML」。
  const candidates: string[] = []
  for (const match of text.matchAll(fencePattern)) {
    if (match[1].includes("{")) candidates.push(match[1])
  }
  if (candidates.length === 0 && text.includes("{")) candidates.push(text)

  for (const candidate of candidates) {
    const start = candidate.indexOf("{")
    if (start < 0) continue
    const block = balancedJsonBlock(candidate, start)
    if (!block) continue
    try {
      const payload = JSON.parse(block) as unknown
      const data = chapterDataFromPayload(payload)
      if (data) return data
    } catch {
      // 该围栏不是合法 JSON（可能是别的围栏），继续下一个
    }
  }
  return null
}

/** 默认每批章数：17 节标准体量大，一批超过 3 章容易被截断。 */
export const CHAPTER_BATCH_SIZE = 3

export interface ChapterOutlineBatchPayload {
  /** 本批解析出的章纲数据（story 骨架 + 本批 chapters） */
  data: ChapterOutlineData
  /** 本批的 MD 正文（用于最后合并成完整 .md） */
  md: string
}

function parseJsonPayloadByKey(text: string, key: string): unknown | null {
  const candidates: string[] = []
  const fencePattern = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi
  for (const match of text.matchAll(fencePattern)) {
    if (new RegExp(key, "i").test(match[1])) candidates.push(match[1])
  }
  if (candidates.length === 0 && new RegExp(key, "i").test(text)) candidates.push(text)

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
        else if (ch === "\"") inString = false
        continue
      }
      if (ch === "\"") inString = true
      else if (ch === "{") depth += 1
      else if (ch === "}") {
        depth -= 1
        if (depth === 0) {
          try {
            return JSON.parse(candidate.slice(start, index + 1)) as unknown
          } catch {
            return null
          }
        }
      }
    }
  }
  return null
}

/** 去掉 ```json 围栏后的正文（用于取本批 MD）。 */
function stripJsonFences(text: string): string {
  return text.replace(/```(?:json)?[ \t]*\r?\n[\s\S]*?```/gi, "").trim()
}

/**
 * 提取一批 chapterOutlineBatch 数据（分批生成时 AI 只输出该批数据，不带保存请求）。
 */
export function extractChapterOutlineBatch(text: string): ChapterOutlineBatchPayload | null {
  const payload = parseJsonPayloadByKey(text, "chapterOutlineBatch")
  if (!isRecord(payload)) return null
  const raw = isRecord(payload.chapterOutlineBatch) ? payload.chapterOutlineBatch : payload
  const data = normalizeChapterOutlineData(raw)
  if (!data) return null
  return { data, md: stripJsonFences(text) }
}

/** 解析章号区间，如「第 11–20 章」→ { start: 11, end: 20 }。 */
export function parseChapterBounds(range: string): { start: number; end: number } | null {
  const numbers = String(range).match(/\d+/g)
  if (!numbers || numbers.length === 0) return null
  const start = Number(numbers[0])
  const end = numbers.length > 1 ? Number(numbers[1]) : start
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return { start, end }
}

/** 合并多批数据：按章号排序去重，骨架取第一批，字数按各章合计补齐。 */
export function mergeChapterBatches(batches: ChapterOutlineData[]): ChapterOutlineData {
  const byNumber = new Map<number, ChapterOutlineChapter>()
  batches.forEach((batch) => {
    batch.chapters.forEach((chapter) => byNumber.set(chapter.n, chapter))
  })
  const chapters = [...byNumber.values()].sort((a, b) => a.n - b.n)
  const first = batches[0]
  const totalWords = chapters.reduce(
    (sum, chapter) => sum + (Number(chapter.info.words.replace(/[^\d]/g, "")) || 0),
    0,
  )
  return {
    title: first?.title ?? "章纲",
    story: first?.story ?? { index: 1, name: "", range: "", beats: "" },
    chapters,
    words: first?.words && first.words > 0 ? first.words : totalWords,
  }
}

/** 下一批的章号区间；null 表示已覆盖该故事全部章节。 */
export function nextChapterBatchRange(
  data: ChapterOutlineData,
  batchSize = CHAPTER_BATCH_SIZE,
): { from: number; to: number } | null {
  const bounds = parseChapterBounds(data.story.range)
  const maxDone = data.chapters.reduce((max, chapter) => Math.max(max, chapter.n), 0)
  const lastDone = maxDone > 0 ? maxDone : (bounds ? bounds.start - 1 : 0)
  if (lastDone <= 0) return null
  const end = bounds ? bounds.end : lastDone + data.chapters.length
  const from = lastDone + 1
  if (from > end) return null
  const remaining = end - from + 1
  // 按总章数均分：剩余章拆成等长的若干批（每批不超过 batchSize），
  // 例如 10 章 → 3/3/2/2，而不是 3/3/3/1，避免末批过小。
  const size = Math.max(1, Math.ceil(remaining / Math.ceil(remaining / batchSize)))
  return { from, to: Math.min(from + size - 1, end) }
}

/** 已完成章节的连续性摘要：供下一批保持伏笔埋收与章间交接。 */
export function buildChapterBatchCarrySummary(data: ChapterOutlineData): string {
  if (data.chapters.length === 0) return "（本批是第一批，无已完成内容）"
  return data.chapters
    .map((chapter) => [
      `第 ${chapter.n} 章《${chapter.title || "未命名"}》`,
      `环节 ${chapter.stage || "未填"} / 节拍 ${chapter.beat || "未填"} / 期待 ${chapter.expect || "未填"}`,
      `预埋伏笔：${chapter.seedFores || "无"}`,
      `回收伏笔：${chapter.payFores || "无"}`,
      `下一章须承接：${chapter.handover.nextStart || "未填"}`,
      `章尾钩子类型：${chapter.foreshadow.hookType || "未填"}`,
    ].join("；"))
    .join("\n")
}

/** 构造下一批章纲的提示词（含骨架与已完成摘要，保证跨批连续）。 */
export function buildChapterBatchPrompt(input: {
  data: ChapterOutlineData
  batch: { from: number; to: number }
  /** 可选：上一轮校验发现的问题（用于只重写有问题的批次） */
  problems?: string[]
}): string {
  const { data, batch, problems } = input
  const skeleton = JSON.stringify({
    title: data.title,
    story: data.story,
    words: data.words,
    doneChapters: data.chapters.map((chapter) => chapter.n),
  })
  const repairLines = problems?.length
    ? [
      "",
      `## 上一轮校验发现的问题（本批必须修好，共 ${problems.length} 项）`,
      ...problems.slice(0, 12).map((problem) => `- ${problem}`),
      problems.length > 12 ? `- （另有 ${problems.length - 12} 项同类问题，按同样方式修好）` : "",
    ].join("\n")
    : ""

  return [
    `继续生成章纲的第 ${batch.from}–${batch.to} 章（只写这一批，不要重复已完成的章节）。`,
    "",
    "## 故事骨架（不得改动，story.range / story.beats 必须与卷纲一致）",
    "```json",
    skeleton,
    "```",
    "",
    "## 已完成章节摘要（用于承接：伏笔埋收、章间交接、人物与地点连续性）",
    buildChapterBatchCarrySummary(data),
    "",
    "## 本批要求",
    `1. 只写第 ${batch.from} 章到第 ${batch.to} 章，每章必须写满 17 节（§1 基础信息 / §2 上章承接 / §3 本章定位 / §4 浓缩剧情 / §5 核心事件链（≥6 条且每条含 what/cause/action/result/use）/ §6 关键词与必要条件（enter/trigger/interact/result 四类齐全）/ §7 四段式 / §8 情绪曲线（4 节点）/ §9 爽点与看点 / §10 关键信息与扩写方式 / §11 画面细节 / §12 伏笔与钩子 / §13 出场角色与状态变化（至少 1 条）/ §14 设定与道具更新 / §15 写作约束 / §16 下一章交接 / §17 写作检查清单）。`,
    "2. 每章必须带对齐字段：stage（所属环节）/ beat（本章节拍，必须等于骨架 beats 对应位置的字符）/ expect（本章主期待感）/ time / place / seedFores / payFores。",
    "3. 第 N 章的 handover.nextStart 必须与第 N+1 章的 carry.hook 呼应；payFores 必须在更早章节的 seedFores 出现过。",
    "4. 输出顺序：先写本批 MD 正文，再写一个 ```json 围栏，顶层字段固定为 chapterOutlineBatch（结构与 chapterOutlineData 相同，chapters 只含本批章节）。",
    "5. 本批**不要**输出 outlineSaveRequest（软件会在最后一批之后合并并统一保存），不要输出 HTML，不要用「…」「同上」等省略写法。",
    "6. 关键节不得留空：§8 moodCurve 写满 4 个节点；§10 expand 至少 1 条且含 info/how；§11 visual.env 与 visual.memory 必须有内容；§13 castChanges 至少 1 条；§14 worldUpdate 至少一项有内容（确无新增就写「无新增」）。",
    "7. §17 checks 必须覆盖 10 条固定项：三行内入戏 / 有明确变化 / 事件链有因果 / 有核心记忆点 / 有动作微细节 / 有爽点 / 回收旧信息 / 埋新信息 / 有追读钩子 / 已写明下一章交接。",
    repairLines,
  ].filter(Boolean).join("\n")
}

/** 从校验问题文本里提取涉及的章号（用于只重写有问题的批次）。 */
export function collectProblemChapterNumbers(problems: string[]): number[] {
  const numbers = new Set<number>()
  problems.forEach((problem) => {
    for (const match of problem.matchAll(/第\s*(\d+)\s*章/g)) {
      const value = Number(match[1])
      if (Number.isFinite(value) && value > 0) numbers.add(value)
    }
  })
  return [...numbers].sort((a, b) => a - b)
}

/** 软件合成的章纲保存请求（字段与 OutlineSaveRequest 结构一致，避免循环依赖）。 */
export interface ChapterOutlineSaveRequestDraft {
  targetFolder: string
  fileName: string
  fileType: "chapter-outline"
  writeMode: "create"
  referencedSkills: string[]
  sourceIntent: string
  content: string
  htmlContent: string
}

/** 由合并后的数据合成一个章纲保存请求（软件侧合成，AI 无需重述全部内容）。 */
export function buildChapterOutlineSaveRequest(
  data: ChapterOutlineData,
  md: string,
): ChapterOutlineSaveRequestDraft {
  const numbers = data.chapters.map((chapter) => chapter.n)
  const start = numbers.length ? Math.min(...numbers) : 1
  const end = numbers.length ? Math.max(...numbers) : 1
  const pad = (value: number) => String(value).padStart(2, "0")
  return {
    targetFolder: "章纲",
    fileName: `章纲-第${pad(start)}–${pad(end)}章.md`,
    fileType: "chapter-outline",
    writeMode: "create",
    referencedSkills: ["ZhanggangSkill/zhanggangjiegouhua"],
    sourceIntent: `生成${data.story.name ? `故事${data.story.index} ${data.story.name}` : "章纲"}的章纲`,
    content: md,
    htmlContent: renderChapterOutlineHtml(data),
  }
}

/** 「1–5、7」这类故事编号串 → [1,2,3,4,5,7]。 */
function parseStoryIds(value: string): number[] {
  const ids = new Set<number>()
  const text = String(value ?? "")
  for (const match of text.matchAll(/(\d+)\s*[-—–－~～至到]\s*(\d+)/g)) {
    const start = Number(match[1])
    const end = Number(match[2])
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue
    for (let id = start; id <= end; id += 1) ids.add(id)
  }
  for (const match of text.replace(/\d+\s*[-—–－~～至到]\s*\d+/g, " ").matchAll(/\d+/g)) {
    ids.add(Number(match[0]))
  }
  return [...ids]
}

/** 「故事一 起①」这类位置串是否指向第 N 个故事。 */
function storyScopeMatches(text: string, storyIndex: number): boolean {
  if (!storyIndex || storyIndex <= 0) return false
  const compact = String(text ?? "").replace(/\s+/g, "")
  const label = storyIndex <= 10
    ? `(?:${storyIndex}|${["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][storyIndex]})`
    : String(storyIndex)
  return new RegExp(`故事${label}(?![0-9一二三四五六七八九十])`).test(compact)
}

/** 名字是否出现在文本里（容忍不写姓、或卷纲里带「（…）」备注）。 */
function nameAppearsInText(name: string, text: string): boolean {
  const clean = String(name ?? "").replace(/[（(].*?[)）]/g, "").trim()
  if (clean.length < 2 || !text) return false
  if (text.includes(clean)) return true
  const tail = clean.slice(-2)
  return tail.length >= 2 && text.includes(tail)
}

const TIME_ORDINAL_DIGITS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

/** 从「第一日 傍晚」这类章内时间里取天数序号；取不到返回 null（不参与校验）。 */
function parseTimeOrdinal(time: string): number | null {
  const match = String(time ?? "").trim().match(/^第\s*(\d+|[一二三四五六七八九十]+)\s*(?:日|天)/)
  if (!match) return null
  const raw = match[1]
  if (/^\d+$/.test(raw)) return Number(raw)
  if (raw === "十") return 10
  if (raw.startsWith("十")) return 10 + (TIME_ORDINAL_DIGITS[raw[1]] ?? 0)
  if (raw.length === 2 && raw[1] === "十") return (TIME_ORDINAL_DIGITS[raw[0]] ?? 0) * 10
  if (raw.length === 3 && raw[1] === "十") {
    return (TIME_ORDINAL_DIGITS[raw[0]] ?? 0) * 10 + (TIME_ORDINAL_DIGITS[raw[2]] ?? 0)
  }
  return TIME_ORDINAL_DIGITS[raw] ?? null
}

/** 卷纲伏笔条目「竹哨（姑姑旧物）」→ 名字「竹哨」。 */
function foreshadowName(value: string): string {
  return String(value ?? "").split(/[（(：:，,、]/)[0].trim()
}

function chapterMentionText(chapter: ChapterOutlineChapter): string {
  return [
    chapter.castChanges.map((item) => `${item.who} ${item.role} ${item.inState} ${item.outState}`).join(" "),
    chapter.position.main,
    chapter.position.advance,
    chapter.position.charArc,
    chapter.position.relation,
    chapter.carry.hook,
    chapter.carry.castState,
    chapter.digest,
    chapter.events.map((event) => `${event.what} ${event.action} ${event.result}`).join(" "),
  ].join(" ")
}

/**
 * 章纲与卷纲的交叉校验（有卷纲数据时才做）：
 * 返回问题列表；该卷纲里没有对应故事时返回 null（调用方继续试下一份卷纲）。
 */
export function crossCheckChapterAgainstVolume(
  chapterData: ChapterOutlineData,
  volume: VolumeOutlineData,
): string[] | null {
  const storyIndex = chapterData.story.index
  const storyRange = chapterData.story.range.trim()
  const target = volume.stories.find((story) => story.id === storyIndex)
    ?? (storyRange ? volume.stories.find((story) => story.range.trim() === storyRange) : undefined)
  if (!target) return null

  const problems: string[] = []
  const label = `故事${target.id}${target.title ? ` ${target.title}` : ""}`

  if (storyRange && target.range.trim() && storyRange !== target.range.trim()) {
    problems.push(`章纲骨架的章号区间「${storyRange}」与卷纲「${target.range}」不一致（卷纲：${label}）。`)
  }

  const chapterBeats = Array.from(chapterData.story.beats || "")
  const volumeBeats = Array.from(target.beats || "")
  const comparable = Math.min(chapterBeats.length, volumeBeats.length)
  if (comparable > 0) {
    const mismatchAt = Array.from({ length: comparable })
      .findIndex((_, index) => chapterBeats[index] !== volumeBeats[index])
    if (mismatchAt >= 0) {
      problems.push(
        `章纲骨架节拍的顺序与卷纲不一致：第 ${mismatchAt + 1} 位是「${chapterBeats[mismatchAt] || "空"}」，卷纲是「${volumeBeats[mismatchAt]}」。`,
      )
    }
  }

  const bounds = parseChapterBounds(storyRange) ?? parseChapterBounds(target.range)
  if (bounds) {
    const outOfRange = chapterData.chapters
      .filter((chapter) => chapter.n < bounds.start || chapter.n > bounds.end)
      .map((chapter) => chapter.n)
    if (outOfRange.length > 0) {
      problems.push(`章纲章号 ${outOfRange.join("、")} 超出卷纲该故事的范围（第 ${bounds.start}–${bounds.end} 章）。`)
    }
  }

  // 4 时间线不得倒退（只在各章 time 都能读出「第X日/第X天」时判断，避免误报）
  const timeline = chapterData.chapters.map((chapter) => ({ chapter, ordinal: parseTimeOrdinal(chapter.time) }))
  for (let index = 1; index < timeline.length; index += 1) {
    const previous = timeline[index - 1]
    const current = timeline[index]
    if (previous.ordinal === null || current.ordinal === null) continue
    if (current.ordinal < previous.ordinal) {
      problems.push(
        `章节时间线倒退：第 ${current.chapter.n} 章「${current.chapter.time}」早于第 ${previous.chapter.n} 章「${previous.chapter.time}」。`,
      )
      break
    }
  }

  const mentionText = chapterData.chapters.map(chapterMentionText).join(" ")

  // 5 卷纲人物出场表：声明在本故事出场的人物，章纲里应能找到
  const expectedCast = (volume.cast ?? []).filter((item) => parseStoryIds(item.stories).includes(storyIndex))
  const missingCast = expectedCast.filter((item) => !nameAppearsInText(item.n, mentionText)).map((item) => item.n)
  missingCast.slice(0, 3).forEach((name) => {
    problems.push(`卷纲人物出场表写明「${name}」在故事${storyIndex}出场，但章纲里找不到该人物。`)
  })
  if (missingCast.length > 3) {
    problems.push(`另有 ${missingCast.length - 3} 个卷纲人物在章纲里找不到（人物出场表对齐）。`)
  }

  // 6 对手推进表：卷纲安排对手在本故事出手时，章纲不能完全没有阻力/对手角色
  const activeRivals = (volume.rivals ?? []).filter((rival) =>
    (rival.moves ?? []).some((move) => move.id === storyIndex))
  if (activeRivals.length > 0) {
    const hasAntagonist = chapterData.chapters.some((chapter) =>
      chapter.castChanges.some((item) => /阻力|对手|反派|敌人|敌方|障碍/.test(`${item.role}${item.who}`)))
    const mentioned = activeRivals.some((rival) => nameAppearsInText(rival.n, mentionText))
    if (!hasAntagonist && !mentioned) {
      problems.push(
        `卷纲在故事${storyIndex}安排了对手出手（${activeRivals.map((rival) => rival.n).join("、")}），但章纲没有任何阻力/对手角色。`,
      )
    }
  }

  // 7 伏笔追踪表：卷纲标注在本故事埋下 / 回收的伏笔，章纲应对应写上 seedFores / payFores
  const seededNames = chapterData.chapters.flatMap((chapter) => splitNames(chapter.seedFores))
  const paidNames = chapterData.chapters.flatMap((chapter) => splitNames(chapter.payFores))
  const matchAnyName = (candidates: string[], name: string) =>
    candidates.some((candidate) => candidate.includes(name) || name.includes(candidate))
  const seedProblems: string[] = []
  const payProblems: string[] = []
  for (const item of volume.foreshadows ?? []) {
    const name = foreshadowName(item.v)
    if (name.length < 2) continue
    if (storyScopeMatches(item.seed, storyIndex) && !matchAnyName(seededNames, name)) {
      seedProblems.push(`卷纲伏笔「${name}」计划在故事${storyIndex}埋下，但章纲 seedFores 里没有。`)
    }
    if (storyScopeMatches(item.pay, storyIndex) && !matchAnyName(paidNames, name)) {
      payProblems.push(`卷纲伏笔「${name}」计划在故事${storyIndex}回收，但章纲 payFores 里没有。`)
    }
  }
  problems.push(...seedProblems.slice(0, 2), ...payProblems.slice(0, 2))
  if (seedProblems.length + payProblems.length > 4) {
    problems.push(`另有 ${seedProblems.length + payProblems.length - 4} 条卷纲伏笔在章纲里没有对应埋收。`)
  }

  return problems
}

/**
 * 给章纲保存请求补上 htmlContent：
 * 若请求是章纲且现有 htmlContent 不是真正的 HTML 文档，则用 AI 原文的
 * chapterOutlineData 套模板渲染。非章纲请求原样返回。
 */
export function attachChapterOutlineHtml<
  T extends { fileType: string; htmlContent?: string; content: string },
>(request: T, sourceText: string): T {
  if (request.fileType !== "chapter-outline") return request
  const existing = request.htmlContent?.trim() ?? ""
  if (/<html[\s>]/i.test(existing)) return request
  const data = extractChapterOutlineData(sourceText)
  if (!data) return existing ? { ...request, htmlContent: undefined } : request
  return { ...request, htmlContent: renderChapterOutlineHtml(data) }
}