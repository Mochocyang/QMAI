import { normalizePath } from "@/lib/path-utils"
import type { CharacterSaveDraft } from "./character-save-extractor"
import { cleanNextStepArtifacts } from "./outline-next-step"
import { isLikelyChapterOutline } from "./outline-quality-check"
import { stripOutlineFrontmatter } from "./outline-markdown"
import { stripThoughtDumpFromText } from "@/lib/thought-dump"
import { attachVolumeOutlineHtml, pickVolumeOutlineDataForRequest, renderVolumeOutlineMarkdown } from "./volume-outline-template"
import { attachChapterOutlineHtml, extractChapterOutlineData, renderChapterOutlineMarkdown } from "./chapter-outline-template"
import { attachCharacterProfileHtml, pickCharacterProfileFromText, renderCharacterProfileForContent, renderCharacterProfileMarkdown } from "./character-profile-template"
import { attachFactionProfileHtml, extractFactionProfiles } from "./faction-profile-template"
import { attachPowerSystemHtml, extractPowerProfiles } from "./power-system-template"
import { attachGoldenFingerHtml, extractGoldenFingerProfiles } from "./golden-finger-template"
import { attachGeographyProfileHtml, extractGeographyProfiles } from "./geography-setting-template"
import { attachLocationProfileHtml, extractLocationProfiles } from "./location-setting-template"
import { attachBackgroundProfileHtml, extractBackgroundProfiles } from "./background-setting-template"
import { attachForeshadowingProfileHtml, extractForeshadowingProfiles } from "./foreshadowing-plan-template"
import { pickProfileDocument, renderProfileDocumentMarkdown, type ProfileDocument } from "./profile-document"
import { SETTING_PROFILE_SECTIONS, resolveSettingProfileKeysByDataKey, type SettingProfileKey } from "./setting-profile-contracts"
import {
  attachSettingOutlineHtml,
  extractSettingOutlineData,
  isSettingOutlineFileType,
  renderCardFlowForSpec,
  resolveNeutralOutlineSpec,
  resolveSettingSpecById,
  resolveSettingSpecForRequest,
} from "./setting-outline-template"

export type OutlineSaveRequestFileType =
  | "outline"
  | "volume-outline"
  | "chapter-outline"
  | "event-outline"
  | "character"
  | "setting"
  | "foreshadowing"
  | "organization"
  | "quality-report"

export type OutlineSaveRequestWriteMode = "create" | "append" | "replace" | "patch"

export interface OutlineSaveRequest {
  targetFolder: string
  fileName: string
  fileType: OutlineSaveRequestFileType
  writeMode: OutlineSaveRequestWriteMode
  referencedSkills: string[]
  sourceIntent: string
  content: string
  /** 可选：自包含 HTML 版本（如卷纲折叠树），保存时落盘为同名 .html 文件 */
  htmlContent?: string
  /** 可选：结构化数据（如卷纲 volumeOutlineData 的 JSON），保存时落盘为同名 .json 伴生文件，供章纲等后续环节做交叉校验 */
  structuredData?: string
}

interface OutlineSaveRequestParseResult {
  requests: OutlineSaveRequest[]
  errors: string[]
  /**
   * `errors` 里有多少条是「事件细纲被拒」造成的。
   *
   * 为什么需要它：事件细纲请求被拒后只进 errors、不进 requests，
   * 于是调用方看到的是「保存请求解析失败」，会去提示用户「请让 AI 重新输出
   * outlineSaveRequest」—— 而本版本拿到事件细纲请求**也是要丢掉的**，
   * 这个提示等于让模型白重出一遍。
   *
   * 计数口径是**错误条数**（不是请求条数）：调用方拿它与 `errors.length` 比，
   * 只有相等才说明「这一批错误全是事件细纲造成的」。一条事件细纲请求可能同时
   * 产生多条错误（例如既进不了结构闸门、又缺 fileName），所以口径必须对齐。
   *
   * 覆盖范围：**凡** `fileType` 归一化后等于 `event-outline` 的请求，它产生的
   * **每一条**错误都计入，共三处 —— ① `normalizeRequest` 阶段的（缺 fileName /
   * 缺 targetFolder、文件名不是 .md、文件名/目录含绝对路径…）；②
   * `fillContentFromText` 之后仍然缺 content 的那条（`content: ""` 能通过归一化
   * —— 归一化只在 content **非空**却只剩思考过程时报错）；③ 下文那条内容结构闸门
   * （内容不像事件细纲）。三处都按**错误条数**累加，与调用方的比较口径一致。
   *
   * ⚠️ 边界：`fileType: "细纲"` **不**计入。它的 fileType 归一化后仍是「细纲」
   * （白名单里没有它，见 FILE_TYPE_ALIASES 的注释），调用方无从判断这条请求
   * 本意是不是事件细纲 —— 它也可能是模型把 17 节章纲的类型写错了。
   * 那种情况下「请让 AI 重新输出 outlineSaveRequest」是**正确**的提示，
   * 所以这里刻意不把它算成事件细纲被拒。
   *
   * 为什么是**加字段**而不是直接在 `requests` 里过滤掉：`requests.length > 0`
   * 被 `isDiscussDeliveredOutline` 当作「本轮有没有交付物」的判据。若在此处
   * 摘掉事件细纲请求，一份事件细纲回复就会被看成「没有交付物」，
   * 会话被推进 outline_discuss 协议 —— 那是实打实的回归。
   */
  eventOutlineRejectionCount: number
}

interface OutlineSaveRequestSaveResult {
  saved: Array<{
    path: string
    fileName: string
    writeMode: OutlineSaveRequestWriteMode
  }>
  skipped: string[]
  errors: string[]
}

interface OutlineSaveRequestFs {
  createDirectory: (path: string) => Promise<void>
  fileExists: (path: string) => Promise<boolean>
  writeFile: (path: string, content: string) => Promise<void>
  readFile?: (path: string) => Promise<string>
}

/**
 * 覆盖写「历史版本」钩子。
 *
 * 为什么用一个注入的 hook，而不是在本模块里直接 import version-store / fs：
 * 本模块是**可注入 fs 的纯逻辑**，它自己的全部测试（outline-save-request.spec.ts）
 * 都用假 fs 跑，不碰真实磁盘。若在这里直接 import 真实读写实现，
 * 这些测试就会开始真写盘、变成依赖环境的集成测试。
 * 用 hook 注入既保住了可测性，也把「历史存在哪、什么格式」的决定权留给调用方。
 */
export interface OutlineSaveRequestsHistoryHook {
  /** 覆盖写 md 之前调用；实现方负责落版本，抛错会被吞掉。 */
  beforeOverwrite?: (input: {
    projectPath: string
    name: string
    previousContent: string
  }) => void | Promise<void>
}

const ALLOWED_FILE_TYPES = new Set<OutlineSaveRequestFileType>([
  "outline",
  "volume-outline",
  "chapter-outline",
  "event-outline",
  "character",
  "setting",
  "foreshadowing",
  "organization",
  "quality-report",
])

const ALLOWED_WRITE_MODES = new Set<OutlineSaveRequestWriteMode>([
  "create",
  "append",
  "replace",
  "patch",
])

const FILE_TYPE_ALIASES: Record<string, OutlineSaveRequestFileType> = {
  "大纲": "outline",
  "卷纲": "volume-outline",
  "章纲": "chapter-outline",
  /*
   * 「细纲」在本版本里**不是**合法 fileType：它不在这张别名表里，也不在
   * ALLOWED_FILE_TYPES 里，所以 `fileType: "细纲"` 的请求会被整条拒绝
   * （normalizeRequest 报出 `不支持的大纲文件类型：细纲。`，
   * 见 normalizeRequest 里那条 ALLOWED_FILE_TYPES 校验），而**不是**被归一化成某种类型。
   *
   * 为什么刻意不把它映射到 chapter-outline（这是本版本明确的选择，不是遗漏）：
   * classifyOutlineSaveTarget 的首个判据是 `input.explicitFileType ?? …`，
   * 也就是**显式 fileType 会短路掉所有基于正文的推断，包括优先级最高的
   * EVENT_TYPE_MARK 判定**。而事件细纲天然带着章纲关键词 —— 提示词里就要求
   * 「本章目标字数：约 N 字」与「必须留下一个章尾钩子」，两者都在
   * hasChapterOutlineStructure 的关键词集合里。所以一旦「细纲」被映射成
   * chapter-outline，模型只要写 fileType: "细纲"，一份事件细纲就会被合法地
   * 归进 wiki/outlines/章纲/，紧接着 resolveChapterOutline 会把它当成真正的
   * 17 节章纲读进章纲写作上下文 —— 正是本分支要堵的串味。
   * 拒绝整条请求比给它一个会短路的类型安全得多。
   *
   * 注意「细纲」在别处仍指 17 节章纲：outline-save-classifier 的
   * CHAPTER_TYPE_MARK 依旧认它（那里是**推断**，不构成短路，且事件标记先判）。
   * 两个模块对同一个词的处理不同是**有意**的：一个用于推断，一个用于显式声明。
   */
  "事件细纲": "event-outline",
  "人物小传": "character",
  "人物": "character",
  "角色": "character",
  "设定": "setting",
  "伏笔": "foreshadowing",
  "组织": "organization",
  "势力": "organization",
  "质量检查": "quality-report",
}

const WRITE_MODE_ALIASES: Record<string, OutlineSaveRequestWriteMode> = {
  "overwrite": "create",
  "write": "create",
  "save": "create",
  "new": "create",
  "override": "replace",
}

function normalizeFileTypeAlias(value: string): string {
  const trimmed = value.trim()
  if (ALLOWED_FILE_TYPES.has(trimmed as OutlineSaveRequestFileType)) return trimmed
  return FILE_TYPE_ALIASES[trimmed] ?? trimmed
}

function normalizeWriteModeAlias(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (ALLOWED_WRITE_MODES.has(trimmed as OutlineSaveRequestWriteMode)) return trimmed
  return WRITE_MODE_ALIASES[trimmed] ?? trimmed
}

function stripAbsoluteToRelativeFolder(value: string): string {
  const normalized = normalizePath(value).trim()
  if (!normalized) return normalized
  if (!normalized.startsWith("/") && !normalized.startsWith("\\") && !/^[a-zA-Z]:[\\/]/.test(normalized)) {
    return normalized
  }
  const marker = "wiki/outlines/"
  const markerIndex = normalized.toLowerCase().indexOf(marker)
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + marker.length)
  }
  const parts = normalized.split("/").filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : normalized
}

/** 提取 AI 原文中的 ```html 围栏内容（仅匹配 html 语言标记的围栏） */
export function extractHtmlBlocks(text: string): string[] {
  const blocks: string[] = []
  // 必须显式带 html 语言标记，否则会误抓 ```json 等其它围栏
  const fencePattern = /```html[ \t]*\r?\n([\s\S]*?)```/gi
  for (const match of text.matchAll(fencePattern)) {
    const block = match[1].trim()
    if (block) blocks.push(block)
  }
  return blocks
}

/**
 * 按 fileType 分派补 htmlContent（非真正 HTML 时用结构化数据套模板渲染）：
 * - 独立类型直接分派：卷纲 → 折叠树；章纲 → 卡片流；人物小传 → 角色卡；
 *   组织势力 → 势力卡；伏笔计划 → 伏笔台账；
 * - setting / outline：先判定子类型（`attachSettingFamilyHtml`），命中专属模板的走专属渲染
 *   （角色卡 / 势力卡 / 体系卡 / 能力卡 / 背景卡 / 地理卡 / 地点卡 / 伏笔台账）；
 * - 其余 → 通用「设定卡片流」。
 *
 * **出口保证**：分派之后若仍然没有 HTML，一律用请求自己的 MD 兜底渲染一份卡片流。
 * 见下方 `renderOutlineFallbackHtml` 的说明 —— 这个保证是本文件的调用方（保存确认框）
 * 能提供「HTML 形式」选项的前提。
 */
export function attachOutlineHtml<
  T extends {
    fileType: string
    htmlContent?: string
    content: string
    fileName?: string
    targetFolder?: string
    sourceIntent?: string
  },
>(request: T, text: string): T {
  const attached = dispatchOutlineHtml(request, text)
  if (attached.htmlContent?.trim()) return attached
  /*
   * 最终保证：**任何**大纲类型都不允许「有正文却没有 HTML」。
   *
   * 保存确认框的「HTML 形式（.html）」是否可勾选，完全取决于请求里有没有 htmlContent
   * （`outline-save-confirm-dialog.tsx` 的 hasHtmlContent）。缺了它，用户看到的是
   * 一个永久置灰的勾选框 + 「本轮未生成 HTML 版本，无法保存 HTML。」——无处可点。
   *
   * 而卷纲/章纲的专用渲染器依赖可解析的结构化 JSON，拿不到时旧实现是「干脆不出 HTML」，
   * 于是「AI 只给了 MD」「结构化数据不完整被放行保存」这些**常见**情况都会永久失去 HTML 选项。
   * 把保证放在这个唯一出口，而不是给每种类型各补一条分支：ALLOWED_FILE_TYPES 有 9 个成员，
   * 逐个补意味着「以后新增类型时又要记得补一处」，漏一处就重新出现置灰的保存框。
   */
  const fallback = renderOutlineFallbackHtml({
    fileType: attached.fileType,
    content: attached.content,
    fileName: attached.fileName,
    targetFolder: attached.targetFolder,
    sourceIntent: attached.sourceIntent,
  })
  return fallback ? ({ ...attached, htmlContent: fallback } as T) : attached
}

/** 各类型自己的渲染器分派；返回的请求可能仍不带 HTML（由 attachOutlineHtml 兜底）。 */
function dispatchOutlineHtml<
  T extends {
    fileType: string
    htmlContent?: string
    content: string
    fileName?: string
    targetFolder?: string
    sourceIntent?: string
  },
>(request: T, text: string): T {
  if (request.fileType === "volume-outline") return attachVolumeOutlineHtml(request, text)
  if (request.fileType === "chapter-outline") return attachChapterOutlineHtml(request, text)
  if (request.fileType === "character") return attachCharacterProfileHtml(request, text)
  if (request.fileType === "organization") return attachFactionProfileHtml(request, text)
  if (request.fileType === "foreshadowing") return attachForeshadowingProfileHtml(request, text)
  return attachSettingFamilyHtml(request, text)
}

/**
 * 兜底渲染：分派后仍没有 HTML 时，用请求**自己的 MD 正文**渲染一份卡片流。
 *
 * 两级选择：
 * 1. 先按「正文标题 → 文件名 → sourceIntent → 文件夹」嗅探**专属分项**。命中就用它 ——
 *    这正是原 `borrowSettingFamilyHtml` 的意图：被判错类型的文档（例如「全版本力量体系总纲」
 *    因正文提到「第 N 章」被误判为章纲）应当显示它**真正的样子**，而不是章纲的样子。
 * 2. 嗅不到具体分项时，用该大纲类型**自己的中性规格**（章纲 / 卷纲 / 质量检查 / 事件细纲），
 *    而不是一律退化成「设定 · 卡片流」。
 */
function renderOutlineFallbackHtml(request: {
  fileType: string
  content: string
  fileName?: string
  targetFolder?: string
  sourceIntent?: string
}): string | null {
  const text = request.content?.trim()
  if (!text) return null
  /*
   * 注意这里用的是设定家族的**专用渲染器**（体系卡 / 势力卡 / 背景卡 …），
   * 不是 `renderCardFlowForSpec` 的通用卡片流 —— 两者标题不同（「力量体系 · 体系卡」对「力量体系 · 卡片流」）。
   * 走 attachSettingFamilyHtml 与旧实现完全一致，保证被判错类型的文档渲染结果不变。
   */
  const borrowed = borrowSpecificSettingHtml(request, text)
  if (borrowed) return borrowed
  return renderCardFlowForSpec(text, resolveNeutralOutlineSpec(request.fileType))
}

/**
 * 只有当「标题 → 文件名 → sourceIntent → 文件夹」嗅探到**具体**设定分项时才借用设定家族的渲染结果；
 * 嗅不到（落到中性 generic-setting）时返回 null，交给调用方用该大纲类型自己的规格兜底。
 *
 * 这个区分是必须的：若不加判断地借用，一份章纲会被 `attachSettingOutlineHtml` 渲染成
 * 「设定 · 卡片流」——等于用错误标签换取「有 HTML」。
 */
function borrowSpecificSettingHtml(
  request: {
    fileType: string
    htmlContent?: string
    content: string
    fileName?: string
    targetFolder?: string
    sourceIntent?: string
  },
  text: string,
): string | null {
  const spec = resolveSettingSpecForRequest({
    fileType: "setting",
    fileName: request.fileName,
    targetFolder: request.targetFolder,
    sourceIntent: request.sourceIntent,
    content: text,
  })
  if (!SETTING_FAMILY_RENDERERS[spec.id]) return null
  const chained = attachSettingFamilyHtml({ ...request, fileType: "setting" }, text)
  return chained.htmlContent?.trim() ? chained.htmlContent : null
}

/**
 * setting / outline 家族分派：多种类型共用 fileType=`setting`，
 * 必须先按「JSON 标题 → 正文标题 → 文件名 → sourceIntent → 文件夹」判定子类型，
 * 命中专属模板的走专属渲染，其余走通用「设定卡片流」。
 *
 * 规格 id → 渲染器。**数据驱动**，避免新增分项时忘记在此加分支而悄悄退化成通用卡片流。
 */
const SETTING_FAMILY_RENDERERS: Record<
  string,
  <T extends { fileType: string; htmlContent?: string; content: string }>(request: T, text: string) => T
> = {
  characterBriefs: attachCharacterProfileHtml,
  organizationsOutline: attachFactionProfileHtml,
  powerSystem: attachPowerSystemHtml,
  goldenFinger: attachGoldenFingerHtml,
  backgroundSetting: attachBackgroundProfileHtml,
  geographySetting: attachGeographyProfileHtml,
  foreshadowingPlan: attachForeshadowingProfileHtml,
  locationsOutline: attachLocationProfileHtml,
}

function attachSettingFamilyHtml<
  T extends {
    fileType: string
    htmlContent?: string
    content: string
    fileName?: string
    targetFolder?: string
    sourceIntent?: string
  },
>(request: T, text: string): T {
  if (!isSettingOutlineFileType(request.fileType)) return request
  const existing = request.htmlContent?.trim() ?? ""
  if (!/<html[\s>]/i.test(existing)) {
    /*
     * 🔴 分项判定顺序：**先看回复里到底给了哪个结构化数据键**，再退回关键词嗅探。
     *
     * 结构化-only 之后 `content` 一开始是空串，H1 要等反推才有，而文件通常就叫对象名
     * （`九转玄功.md` / `竹屋.md`）。只靠「正文标题 → 文件名 → 文件夹」猜时，猜不中
     * **不会报错**，只会悄悄退回通用「设定卡片流」：页头从「力量体系」变成「设定」，
     * 等级阶梯加粗列、代价矩阵危险色表头、专属头图全没了 —— 同一批里五种设定是档案卡、
     * 另外几种是朴素卡片流，用户完全不知道为什么长得不一样。
     *
     * 只在 `fileType === "setting"` 时用数据键：character / organization / foreshadowing
     * 已被 fileType 唯一确定，不该被回复里别处出现的 JSON 改判。
     */
    const byDataKey = resolveSettingKeyByStructuredData(request, text)
    const spec = (byDataKey ? resolveSettingSpecById(byDataKey) : null) ?? resolveSettingSpecForRequest({
      fileType: request.fileType,
      fileName: request.fileName,
      targetFolder: request.targetFolder,
      sourceIntent: request.sourceIntent,
      content: request.content,
      dataTitle: extractSettingOutlineData(text)?.title,
    })
    const renderer = SETTING_FAMILY_RENDERERS[spec.id]
    if (renderer) return renderer(request, text)
  }
  return attachSettingOutlineHtml(request, text)
}

/** 由「文件夹 + 文件名」推断大纲类型（用于给历史 / 外部写入的 .md 补渲染）。 */
function inferOutlineFileTypeFromPath(folder: string, fileName: string): OutlineSaveRequestFileType {
  const hint = `${folder} ${fileName.replace(/\.md$/i, "")}`
  if (/卷纲|分卷/.test(hint)) return "volume-outline"
  if (/章纲|细纲/.test(hint)) return "chapter-outline"
  if (/人物|角色/.test(hint)) return "character"
  if (/组织|势力|阵营|门派|家族/.test(hint)) return "organization"
  if (/伏笔/.test(hint)) return "foreshadowing"
  if (/质量|检查/.test(hint)) return "quality-report"
  // 其余交给 setting 家族按「标题 → 文件名 → 文件夹」细分
  return "setting"
}

/**
 * 按路径与正文即时渲染大纲 HTML。
 *
 * 用于**磁盘上还没有伴生 `.html`** 的大纲文件（旧版本生成的、外部写入的、或示例/导入的文件），
 * 让预览也能提供 HTML 视图（新保存的文件仍以落盘的 `.html` 为准）。
 *
 * 只对**能明确归入某个专属卡片类型**的文件渲染（组织势力 / 人物小传 / 力量体系 / 金手指 /
 * 地理 / 地点 / 背景 / 伏笔），避免给「总纲」「写作通则」这类普通大纲套上不相干的卡片。
 * 卷纲/章纲依赖结构化 JSON，缺 JSON 时也返回 null（调用方回退为纯 MD 视图）。
 */
export function renderOutlineHtmlForPath(path: string, content: string): string | null {
  const text = content?.trim()
  if (!text) return null
  const segments = normalizePath(path).split("/").filter(Boolean)
  const fileName = segments[segments.length - 1] ?? ""
  if (!/\.md$/i.test(fileName)) return null
  const folder = segments.length >= 2 ? segments[segments.length - 2] : ""
  const fileType = inferOutlineFileTypeFromPath(folder, fileName)
  if (!isSettingOutlineFileType(fileType)) return null
  const spec = resolveSettingSpecForRequest({
    fileType,
    fileName,
    targetFolder: folder,
    sourceIntent: folder,
    content: text,
  })
  // 未能归入专属分项（generic-*）时不渲染，保留纯 MD 体验
  if (!SETTING_FAMILY_RENDERERS[spec.id]) return null
  const request: OutlineSaveRequest = {
    targetFolder: folder,
    fileName,
    fileType,
    writeMode: "create",
    referencedSkills: [],
    sourceIntent: folder,
    content: text,
  }
  return attachOutlineHtml(request, text).htmlContent ?? null
}

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{")
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === "\"") inString = false
      continue
    }
    if (character === "\"") inString = true
    else if (character === "{") depth += 1
    else if (character === "}") {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1).trim()
    }
  }
  return null
}

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = []
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi
  for (const match of text.matchAll(fencePattern)) {
    candidates.push(match[1].trim())
  }

  const lastFence = text.lastIndexOf("```")
  if (lastFence >= 0) {
    const afterOpen = text.slice(lastFence + 3)
    if (!afterOpen.includes("```")) {
      const unclosed = afterOpen.replace(/^(?:json)?\s*/i, "").trim()
      if (/outlineSaveRequests?/i.test(unclosed)) {
        candidates.push(extractBalancedJsonObject(unclosed) ?? unclosed)
      }
    }
  }

  const trimmed = text.trim()
  if (trimmed.startsWith("{") && (trimmed.endsWith("}") || /outlineSaveRequests?/i.test(trimmed))) {
    candidates.push(extractBalancedJsonObject(trimmed) ?? trimmed)
  }

  const lastBrace = text.lastIndexOf("{")
  if (lastBrace >= 0) {
    const tail = text.slice(lastBrace)
    if (/outlineSaveRequests?/i.test(tail)) {
      candidates.push(extractBalancedJsonObject(tail) ?? tail)
    }
  }

  return Array.from(new Set(candidates.filter(Boolean)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function validateRelativePath(value: string, label: string, allowSlash: boolean): string | null {
  const normalized = normalizePath(value).trim()
  if (!normalized) return `${label}不能为空。`
  if (normalized.startsWith("/") || normalized.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(normalized)) {
    return `${label}不能使用绝对路径。`
  }
  if (normalized.split("/").some((part) => part === "..")) {
    return `${label}不能包含上级目录。`
  }
  if (!allowSlash && normalized.includes("/")) {
    return `${label}不能包含路径分隔符。`
  }
  return null
}

function normalizeRequest(raw: unknown, index: number): {
  request: OutlineSaveRequest | null
  errors: string[]
  /**
   * 这条请求是否因「fileType 归一化后是 event-outline」而被拒。
   * 为 true 时该请求产生的**全部** errors 都要计入 eventOutlineRejectionCount。
   */
  eventOutlineRejected: boolean
} {
  if (!isRecord(raw)) {
    return { request: null, errors: [`第 ${index + 1} 个保存请求必须是对象。`], eventOutlineRejected: false }
  }

  const errors: string[] = []
  const targetFolder = stripAbsoluteToRelativeFolder(String(raw.targetFolder ?? "").trim())
  const fileName = String(raw.fileName ?? "").trim()
  const fileType = normalizeFileTypeAlias(String(raw.fileType ?? "")) as OutlineSaveRequestFileType
  const writeMode = normalizeWriteModeAlias(String(raw.writeMode ?? "")) as OutlineSaveRequestWriteMode
  const rawContent = String(raw.content ?? "").trim()
  const content = stripThoughtDumpFromText(rawContent).trim()
  const htmlContent = typeof raw.htmlContent === "string" ? raw.htmlContent.trim() : ""

  for (const [field, value] of Object.entries({
    targetFolder,
    fileName,
    fileType,
    writeMode,
  })) {
    if (!value) errors.push(`第 ${index + 1} 个保存请求缺少 ${field}。`)
  }

  const folderError = validateRelativePath(targetFolder, "目标文件夹", true)
  if (folderError) errors.push(folderError)
  const fileError = validateRelativePath(fileName, "文件名", false)
  if (fileError) errors.push(fileError)
  if (fileName && !fileName.toLowerCase().endsWith(".md")) {
    errors.push("文件名必须是 Markdown 文件。")
  }
  if (fileType && !ALLOWED_FILE_TYPES.has(fileType)) {
    errors.push(`不支持的大纲文件类型：${fileType}。`)
  }
  if (writeMode && !ALLOWED_WRITE_MODES.has(writeMode)) {
    errors.push(`不支持的写入模式：${writeMode}。`)
  }
  if (rawContent && !content) {
    errors.push(`第 ${index + 1} 个保存请求的 content 仅包含模型思考过程。`)
  }

  if (errors.length > 0) {
    return { request: null, errors, eventOutlineRejected: fileType === "event-outline" }
  }

  return {
    request: {
      targetFolder: normalizePath(targetFolder),
      fileName: normalizePath(fileName),
      fileType,
      writeMode,
      referencedSkills: Array.isArray(raw.referencedSkills)
        ? raw.referencedSkills.filter((item): item is string => typeof item === "string")
        : [],
      sourceIntent: String(raw.sourceIntent ?? "").trim(),
      content,
      ...(htmlContent ? { htmlContent } : {}),
    },
    errors: [],
    // 归一化成功就没被拒；内容结构闸门在下游另行计数。
    eventOutlineRejected: false,
  }
}

function collectRawRequests(payload: Record<string, unknown>): unknown[] {
  if (payload.outlineSaveRequest !== undefined) return [payload.outlineSaveRequest]
  if (Array.isArray(payload.outlineSaveRequests)) return payload.outlineSaveRequests
  return []
}

function isOutlineSaveProtocolJson(inner: string): boolean {
  const trimmed = inner.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false
  try {
    const payload = JSON.parse(trimmed) as unknown
    if (!isRecord(payload)) return false
    return "outlineSaveRequest" in payload || "outlineSaveRequests" in payload
  } catch {
    return /outlineSaveRequests?/i.test(trimmed)
  }
}

/**
 * 从 AI 回复中提取可保存的大纲正文：
 * - 展开 markdown/md 围栏与无语言标记的正文围栏
 * - 删除 json 协议块（及无语言标记但内容为 outlineSaveRequest 的围栏）
 * - 保留其它语言代码围栏原样
 */
export function extractBodyContent(text: string): string {
  return text
    .replace(
      /```([a-zA-Z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g,
      (full, lang: string, inner: string) => {
        const language = (lang || "").trim().toLowerCase()
        if (language === "json") return ""
        if (language === "markdown" || language === "md") return inner.trim()
        if (language === "html") return ""
        if (!language) {
          return isOutlineSaveProtocolJson(inner) ? "" : inner.trim()
        }
        return full
      },
    )
    .trim()
}

function splitBodyByH1(body: string): string[] {
  const lines = body.split(/\r?\n/)
  const sections: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (/^#\s+/.test(line.trim()) && current.length > 0) {
      sections.push(current.join("\n").trim())
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) {
    sections.push(current.join("\n").trim())
  }
  return sections.filter(Boolean)
}

/** 章纲必须具备结构字段，避免「下一步推荐/确认摘要」因偶含「章纲」二字被误放行 */
function hasChapterOutlineStructure(content: string, fileName: string): boolean {
  if (!isLikelyChapterOutline(content, fileName)) return false
  return /本章目标|核心事件|场景顺序|章尾钩子|章首钩子/.test(content)
}

/**
 * 模型手写的正文是否覆盖了「数据能产出的内容」。
 *
 * 判据只回答一个问题：这份手写正文能不能**替代**数据反推而不丢内容。
 *
 * 为什么需要它：`looksLikeProfileBody` / `hasChapterOutlineStructure` 都是
 * 「命中一个标题就算像」，于是模型只写了 1 个分区（或 3 节）也会被判成「真写了正文」
 * 而被原样保留，数据里剩下的分区一节不落地从 `.md` 里消失 —— 而 `.html` 是按数据
 * 渲染的完整版。同一份档案两种载体内容不一样，且没有任何报错。
 *
 * 不用「标题逐字相等」当判据：模型写同一份章纲也会用 `§1 基础信息` / `一、基础信息`
 * 这类不同措辞，逐字比对会把完整正文误判成残缺、反而用数据覆盖掉它。
 * 这里只要求两件事：
 *   1. 手写正文的标题数不少于数据产出的标题数（广度够）；
 *   2. 至少一半标题能对上（归一化掉编号与标点后互相包含），确认写的是同一份东西。
 */
function outlineBodyCoversData(content: string, markdown: string): boolean {
  const collect = (text: string) =>
    [...text.matchAll(/^#{1,6}\s+(\S.*)$/gm)].map((match) => match[1].trim())
  const dataHeadings = collect(markdown)
  if (dataHeadings.length === 0) return true
  const bodyHeadings = collect(content.replace(/\r/g, ""))
  if (bodyHeadings.length < dataHeadings.length) return false
  const normalize = (heading: string) =>
    heading
      .replace(/^§?\s*\d+(?:[.、．)]|\s)\s*/, "")
      .replace(/^[一二三四五六七八九十]+[、.．)）]\s*/, "")
      .replace(/[#*_`\s\d.、．:：()（）【】[\]「」"'“”‘’·・-]/g, "")
  const normalizedBody = bodyHeadings.map(normalize).filter(Boolean)
  if (normalizedBody.length === 0) return false
  const hits = dataHeadings.filter((heading) => {
    const target = normalize(heading)
    if (!target) return false
    return normalizedBody.some((body) => body.includes(target) || target.includes(body))
  }).length
  return hits >= Math.ceil(dataHeadings.length / 2)
}

/**
 * 事件细纲必须真的是一份事件清单，避免「好的，我已完成本章细纲。」这类确认摘要被误放行。
 *
 * 事件分节标记才是闸门的关键（摘要里不会出现「事件1 / 事件序列 / 事件清单 / 编号分节」）；
 * 列表行数只要 ≥2 即可 —— 细节抓手本来就是自由措辞，用关键词卡「台词/神情/动作」
 * 会把一份正常但换了写法的细纲误判成不合格。
 */
function hasEventOutlineStructure(content: string): boolean {
  // 编号分节（`## 1. 院子里的哭声`）也算：提示词虽已强制「## 事件N」，
  // 但模型换个写法就把一份卡片上看着合格的细纲挡在保存闸门外，用户只能看到「保存请求解析失败」。
  const hasEventSection = /事件\s*[一二三四五六七八九十\d]|事件序列|事件清单|^#{2,4}\s*\d+[.、]/m.test(content)
  const listLines = content.split(/\r?\n/).filter((line) => /^\s*(?:[-*·]|\d+[.、])\s*\S/.test(line))
  return hasEventSection && listLines.length >= 2
}

/**
 * 正文是否已经是一份「带分区标题的档案」。
 *
 * 用来区分两种情况：模型真写了完整档案（保留它，别用数据覆盖），
 * 还是只吐了结构化数据、围栏外剩一句「已生成…」（必须用数据补正文）。
 *
 * 判据特意**不只看长度**：模型完全可能只写一份两三个分区的短档案，
 * 而 `## 经济来源（见下方 JSON）` 这类交代语也带着分区名。所以先看有没有命中
 * 本类分区标题，再看标题之外还剩下多少真内容 —— 交代语标题外几乎不留字。
 */
function looksLikeProfileBody(content: string, headings: string[] = []): boolean {
  const text = content.trim()
  if (!text) return false
  const sectionPattern = (heading: string) =>
    new RegExp(`^#{1,6}\\s*(?:\\d+[.、]\\s*)?${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m")
  const hits = headings.filter((heading) => sectionPattern(heading).test(text)).length
  if (hits >= 1) {
    // 去掉标题行后的实际字数：一句「见下方 JSON」不够 12 字，正常条目远超
    const body = text.replace(/^#{1,6}.*$/gm, "").replace(/\s+/g, "")
    return body.length >= 12
  }
  return text.length >= 200 && /^#{1,6}\s/m.test(text)
}

/** 设定档案类型 → 从 AI 原文解析出结构化档案。七类共用 `ProfileDocument`。 */
const SETTING_PROFILE_DOC_EXTRACTORS: Record<string, (text: string) => ProfileDocument[]> = {
  organizationsOutline: extractFactionProfiles,
  powerSystem: extractPowerProfiles,
  goldenFinger: extractGoldenFingerProfiles,
  backgroundSetting: extractBackgroundProfiles,
  geographySetting: extractGeographyProfiles,
  foreshadowingPlan: extractForeshadowingProfiles,
  locationsOutline: extractLocationProfiles,
}

/** 文件名里常见的分项前缀，比对名称前先剥掉（`力量体系-九转玄功.md` → `九转玄功`）。 */
const PROFILE_FILE_NAME_PREFIX = /^(?:力量体系|人物小传|角色|人物|组织势力|势力|组织|阵营|金手指|背景设定|背景|世界观|地理设定|地理|地点设定|地点|场景|伏笔计划|伏笔)[-－—_· ]+/i

function normalizeProfileName(value: string): string {
  return (value ?? "").replace(/[\s　·・.,，。:：;；!！?？()（）[\]【】「」"'“”‘’*_`#]/g, "").toLowerCase()
}

/**
 * 一条回复里同时出现多类设定时（模型一次把人物 + 势力都给了），
 * 按「文件名 / 正文首标题」把每个保存请求配回它自己的那一类。
 *
 * 先做**全等**匹配（`九转玄功.md` ↔ `九转玄功`），再做双向包含（按重叠最长取），
 * 匹配不到就返回 null 交回关键词嗅探 —— 宁可退回通用卡片流，也不能把势力的档案套上
 * 力量体系的模板。
 */
function disambiguateSettingFamily(
  keys: SettingProfileKey[],
  text: string,
  request: { fileName?: string; content?: string },
): SettingProfileKey | null {
  const raw = (request.fileName ?? "").replace(/\.md$/i, "").trim()
  const names = [raw, raw.replace(PROFILE_FILE_NAME_PREFIX, "").trim()]
    .filter(Boolean)
    .map(normalizeProfileName)
    .filter(Boolean)
  if (names.length === 0) return null
  /*
   * 分两轮：先找**全等**，再按「重叠最长」取候选。
   *
   * 单轮双向包含会错配。实测：一条回复里同时有「背景设定：北境」与「地理设定：北境地理」
   * （大背景和它的地理分区，名字天然是包含关系），保存请求 `北境地理.md` 在遍历到背景时
   * 就先撞上 `name.includes("北境")` → 地理设定被套上背景卡：页头写「背景设定」、
   * 分区标题按背景契约渲染、专属版式（地理卡的地形/气候区块）全丢，而文件写成功了，
   * 没有任何报错。判据与 `pickProfileDocument` 对齐：精确相等优先，包含只作兜底，
   * 且多个候选时取重叠更长的那个。
   */
  const partial: Array<{ key: SettingProfileKey; overlap: number }> = []
  for (const key of keys) {
    const docs = SETTING_PROFILE_DOC_EXTRACTORS[key]?.(text) ?? []
    for (const doc of docs) {
      const docName = normalizeProfileName(doc.name ?? "")
      if (!docName) continue
      if (names.some((name) => name === docName)) return key
      for (const name of names) {
        if (name.includes(docName) || docName.includes(name)) {
          // 重叠长度按较短串算：「北境」×「北境地理」= 2，「北境地理」×「北境地理」= 4。
          partial.push({ key, overlap: Math.min(name.length, docName.length) })
        }
      }
    }
  }
  partial.sort((a, b) => b.overlap - a.overlap)
  return partial[0]?.key ?? null
}

/**
 * 按回复里实际出现的结构化数据键判定设定分项（只对 `fileType=setting` 生效）。
 *
 * 🔴 HTML 分派与 MD 反推必须**共用这一处**。
 * 分开判过一次：`attachSettingFamilyHtml` 走数据键 + 文件名配对，而 `fillSettingProfileContent`
 * 还留着旧的关键词嗅探。结果「背景 + 地点」同一条回复里，`竹屋.md` 的 .html 是地点卡，
 * .md 正文却是 `# 北境`（背景 extractor 先跑，`pickProfileDocument` 对单文档直接返回
 * docs[0]）—— 同一份内容的两份文件对不上，而 .md 才是主阅读载体。
 */
function resolveSettingKeyByStructuredData(
  request: { fileType: string; fileName?: string; content?: string },
  text: string,
): SettingProfileKey | null {
  if (request.fileType !== "setting") return null
  const keys = resolveSettingProfileKeysByDataKey(text)
  if (keys.length === 1) return keys[0]
  return keys.length > 1 ? disambiguateSettingFamily(keys, text, request) : null
}

/** 本次请求对应的设定分项（正文标题 → 文件名 → 目录 → fileType 四级线索）。 */
function resolveProfileSpec(
  request: Pick<OutlineSaveRequest, "fileType" | "fileName" | "targetFolder" | "sourceIntent" | "content">,
  text: string,
) {
  return resolveSettingSpecForRequest({
    fileType: request.fileType,
    fileName: request.fileName,
    targetFolder: request.targetFolder,
    sourceIntent: request.sourceIntent,
    content: request.content,
    dataTitle: extractSettingOutlineData(text)?.title,
  })
}

function sectionHeadingsOf(specId: string): string[] {
  const sections = (SETTING_PROFILE_SECTIONS as Record<string, Array<{ heading: string }>>)[specId]
  return sections ? sections.map((section) => section.heading) : []
}

/**
 * 从结构化数据反推设定档案正文。
 *
 * 七类设定（势力 / 力量 / 金手指 / 背景 / 地理 / 地点 / 伏笔）从 2026-10-18 起
 * 不再让模型手写 MD —— 它们的正文本来就是「分区 → 字段/条目/表格」的机械展开，
 * 让模型再写一遍等于同一份内容付两次钱。
 *
 * 先按分项规格命中的解析器，再逐个兜底：模型偶尔把 JSON 写进别的顶层 key，
 * 或者文件名起得毫无线索（`青云会.md` 落在 `设定/` 下）时，靠「谁能解析出数据」兜住，
 * 否则正文会空着、保存直接失败。
 */
function renderSettingProfileMarkdownFromData(
  request: OutlineSaveRequest,
  text: string,
  specId: string,
): string | null {
  const preferred = SETTING_PROFILE_DOC_EXTRACTORS[specId]
  const extractors = preferred
    ? [preferred, ...Object.values(SETTING_PROFILE_DOC_EXTRACTORS).filter((item) => item !== preferred)]
    : Object.values(SETTING_PROFILE_DOC_EXTRACTORS)
  for (const extract of extractors) {
    const docs = extract(text)
    if (docs.length === 0) continue
    const picked = pickProfileDocument(docs, {
      fileName: request.fileName,
      targetFolder: request.targetFolder,
      content: request.content,
    })
    if (picked) return renderProfileDocumentMarkdown(picked)
  }
  return null
}

/**
 * 设定档案的正文兜底：只有「正文不像一份档案」时才用结构化数据反推。
 *
 * 不做无条件覆盖（卷纲才是无条件覆盖，因为它的折叠树与正文必须来自同一份数据）：
 * 模型如果没听指令、真写了一份完整档案，那是真内容，覆盖会静默丢掉它写的细节。
 * 结构化-only 之后这条路只在「模型不听指令」时才走，属于极少数的防御分支。
 */
function fillSettingProfileContent(request: OutlineSaveRequest, text: string): OutlineSaveRequest {
  /*
   * 分项判定与 HTML 分派**同源**（`resolveSettingKeyByStructuredData`）。
   *
   * 旧实现只走 `resolveProfileSpec` 的关键词嗅探，而结构化-only 之后正文起始为空、
   * 文件名就是对象名、数据里又没有 `settingOutlineData.title` —— 嗅探基本猜不中，
   * 于是「背景 + 地点」同一条回复里，`竹屋.md` 的正文被按背景反推成 `# 北境`，
   * 而它的 .html 是地点卡。.md 与 .html 内容对不上，且没有任何报错。
   */
  const byDataKey = resolveSettingKeyByStructuredData(request, text)
  const spec = (byDataKey ? resolveSettingSpecById(byDataKey) : null) ?? resolveProfileSpec(request, text)
  const markdown = renderSettingProfileMarkdownFromData(request, text, spec.id)
  if (!markdown) return request
  /*
   * 保留模型手写正文的前提是「它没比数据少」——见 `outlineBodyCoversData`。
   * 旧写法只要 `looksLikeProfileBody` 命中一个分区标题就整份保留，
   * 模型只写了「基本信息」时另外五个分区从 .md 里彻底消失，而 .html 是完整版。
   */
  if (looksLikeProfileBody(request.content, sectionHeadingsOf(spec.id)) && outlineBodyCoversData(request.content, markdown)) {
    return request
  }
  return { ...request, content: markdown }
}

function fillContentFromText(requests: OutlineSaveRequest[], text: string): OutlineSaveRequest[] {
  const body = cleanNextStepArtifacts(extractBodyContent(text))
  if (!body) return requests

  const fillOne = (request: OutlineSaveRequest, content: string): OutlineSaveRequest =>
    request.content.trim() ? request : { ...request, content }

  if (requests.length === 1) {
    return requests.map((request) => fillOne(request, body))
  }

  const sections = splitBodyByH1(body)
  if (sections.length >= requests.length) {
    return requests.map((request, i) => fillOne(request, sections[i] || ""))
  }

  // 多文件且无法按一级标题拆分时，禁止用同一份正文填满所有请求
  return requests
}

export function parseOutlineSaveRequests(text: string): OutlineSaveRequestParseResult {
  const requests: OutlineSaveRequest[] = []
  const errors: string[] = []
  // 只用于让调用方分辨「这堆错误里有多少条其实是事件细纲被拒」，
  // 不改 requests 的语义（原因见 OutlineSaveRequestParseResult 的注释）。
  let eventOutlineRejectionCount = 0

  for (const candidate of extractJsonCandidates(text)) {
    let payload: unknown
    try {
      payload = JSON.parse(candidate)
    } catch {
      continue
    }
    if (!isRecord(payload)) continue
    const rawRequests = collectRawRequests(payload)
    rawRequests.forEach((raw, index) => {
      const normalized = normalizeRequest(raw, index)
      if (normalized.request) requests.push(normalized.request)
      errors.push(...normalized.errors)
      /*
       * 归一化阶段就被拒的事件细纲请求（缺 fileName / 缺 targetFolder、
       * 文件名不是 .md、路径不合法…）同样要计数，否则调用方会把
       * 「这一批错误全是事件细纲造成的」看成「有真正的解析错误」，
       * 于是要求模型重出一遍 —— 重出一次还是会被丢掉。
       * 按错误**条数**累加，与下面结构闸门（以及下面缺 content 那处）同口径。
       *
       * 注意缺 content **不**在这个阶段：`content: ""` 会带着空串通过
       * normalizeRequest（那里只在 content 非空却只剩思考过程时报错），
       * 由下面的 `!request.content.trim()` 分支负责，并且同样计数。
       */
      if (normalized.eventOutlineRejected) eventOutlineRejectionCount += normalized.errors.length
    })
  }

  const htmlBlocks = extractHtmlBlocks(text)
  const filled = fillContentFromText(requests, text)
  const usable: OutlineSaveRequest[] = []
  filled.forEach((raw, index) => {
    /*
     * 卷纲不再让模型写 MD 正文：content 由结构化数据反推。
     * 这里**无条件**用数据生成的正文覆盖（而不是只在空的时候填）——
     * 模型在 JSON 围栏外偶尔会补一句「已生成」，fillContentFromText 会把它
     * 当成正文填进来，那样存下来的 .md 就只剩一句话。数据才是唯一权威。
     */
    let request = raw
    if (request.fileType === "volume-outline") {
      /*
       * 按「这一条请求」挑数据，而不是全局取第一份：
       * 一条回复里同时出现两卷（用户说「卷一和卷二一起写」）时，
       * 两个保存请求必须各拿各的，否则卷二.md 里会是卷一的正文。
       */
      const data = pickVolumeOutlineDataForRequest(text, request)
      if (data) request = { ...request, content: renderVolumeOutlineMarkdown(data) }
    }
    /*
     * 人物小传同理不再让模型写 MD 正文（结构化数据即正文），但**不无条件覆盖**：
     * 模型如果没听指令、老老实实写了完整 MD，那是真内容，覆盖会丢掉它写的东西。
     * 只有「正文不像一份档案」时才用数据反推 —— 也就是 content 为空，
     * 或者围栏外只剩一句「已生成…」的交代语（fillContentFromText 会把它当正文填进来）。
     *
     * 「像一份档案」还要看**写没写全**：只写了一个分区就整份保留，
     * 数据里其余五个分区会从 .md 里消失（HTML 是完整的），见 `outlineBodyCoversData`。
     */
    if (request.fileType === "character") {
      const profile = pickCharacterProfileFromText(text, {
        fileName: request.fileName,
        targetFolder: request.targetFolder,
        content: request.content,
      })
      const markdown = profile ? renderCharacterProfileMarkdown(profile) : ""
      const keep = Boolean(markdown)
        && looksLikeProfileBody(request.content, sectionHeadingsOf("characterBriefs"))
        && outlineBodyCoversData(request.content, markdown)
      if (markdown && !keep) request = { ...request, content: markdown }
    }
    /*
     * 其余七类设定（势力 / 力量 / 金手指 / 背景 / 地理 / 地点 / 伏笔）同样只收结构化数据，
     * 正文由 `renderSettingProfileMarkdownFromData` 反推。`outline` 不在其中 ——
     * 它是普通大纲（总纲 / 写作通则），没有对应的分区契约，不能硬套档案格式。
     */
    if (request.fileType === "setting" || request.fileType === "organization" || request.fileType === "foreshadowing") {
      request = fillSettingProfileContent(request, text)
    }
    /*
     * 章纲同样只收结构化数据：正文由 `renderChapterOutlineMarkdown` 反推。
     *
     * 🔴 这段不能少。分批产线（`chapterOutlineBatch`）是在合并时显式调反推的，
     * 但**单条** `chapterOutlineData` 走不到那里 —— 模型偶尔会不听「请分批」的指令
     * 直接给完整章纲（共创讨论轮判「前文不足」时尤其常见）。那时 content 只能是
     * `fillContentFromText` 从围栏外正文捞来的「已生成」一句话，紧接着就被下面的
     * 章纲结构闸门（`hasChapterOutlineStructure`）判「内容不像章纲」整条拒收：
     * 用户看到的是「保存请求解析失败」，而数据其实完好。
     *
     * 判据与闸门**同口径**（同一个 `hasChapterOutlineStructure`）：模型真写了合格章纲
     * 就原样保留，不拿数据覆盖；只有明显不像章纲时才反推 —— 这样既不丢模型写的细节，
     * 又保证「过闸的那份内容」一定存在。
     *
     * 「真写了」还要再判一层：写全了才保留。模型只写了 3 节、数据里有 17 节时，
     * 原样保留等于让另外 14 节从 .md 里消失（HTML 是完整的），见 `outlineBodyCoversData`。
     */
    if (request.fileType === "chapter-outline") {
      const data = extractChapterOutlineData(text)
      const markdown = data ? renderChapterOutlineMarkdown(data) : ""
      const keep = Boolean(markdown) && hasChapterOutlineStructure(request.content, request.fileName)
        && outlineBodyCoversData(request.content, markdown)
      if (markdown && !keep) request = { ...request, content: markdown }
    }
    if (!request.content.trim()) {
      errors.push(`第 ${index + 1} 个保存请求缺少 content，且无法从正文中提取。`)
      /*
       * 缺 content 也要计数（仅对事件细纲）。
       *
       * 这条是**归一化之后**才发现的：`content: ""` 会带着空串通过
       * normalizeRequest，所以漏掉这里，一份「只有事件细纲请求、而它缺 content」
       * 的回复就会得到 `errors.length === 1 && eventOutlineRejectionCount === 0`
       * ⇒ 调用方判成「有真正的解析错误」，弹出「请让 AI 重新输出 outlineSaveRequest」
       * —— 而这一版拿到事件细纲请求**本来就是丢掉的**，重出一次还是会被丢掉。
       * 正是 E8 要消除的那个症状。此处只 push 了一条错误，故 +1 与「错误条数」等价。
       *
       * `fileType: "细纲"` 不在此列：它归一化后仍然是「细纲」（不在别名表里），
       * 不算事件细纲（理由见 OutlineSaveRequestParseResult 的注释）。
       */
      if (request.fileType === "event-outline") eventOutlineRejectionCount += 1
      return
    }
    if (
      request.fileType === "chapter-outline"
      && !hasChapterOutlineStructure(request.content, request.fileName)
    ) {
      errors.push(
        `第 ${index + 1} 个保存请求「${request.fileName}」内容不像章纲（缺少本章目标/核心事件等），已拒绝写入。`,
      )
      return
    }
    if (request.fileType === "event-outline" && !hasEventOutlineStructure(request.content)) {
      errors.push(
        `第 ${index + 1} 个保存请求「${request.fileName}」内容不像事件细纲（缺少事件分节或细节抓手），已拒绝写入。`,
      )
      eventOutlineRejectionCount += 1
      return
    }
    usable.push(
      attachOutlineHtml(
        request.htmlContent
          ? request
          : request.fileType === "volume-outline" && htmlBlocks[0]
            ? { ...request, htmlContent: htmlBlocks[0] }
            : request,
        text,
      ),
    )
  })

  return { requests: usable, errors, eventOutlineRejectionCount }
}

/**
 * 从自动保存通道的解析结果里摘掉事件细纲请求。
 *
 * 事件细纲只作为大纲对话里的消息 + 卡片存在（随 `<项目>/.qmai/outline-chats.json` 持久化），
 * 不再写进 `wiki/outlines/事件细纲/`。
 *
 * ⚠️ 本函数**不是死代码**，别删：只有**结构不合法**的事件细纲请求会在
 * `parseOutlineSaveRequests` 里被提前拒掉（那种走不到这里，只进 errors、
 * 配 `eventOutlineRejectionCount`）；**结构合法**的事件细纲请求
 * （`## 事件1` + 细节抓手那些）会**完整地出现在 requests 里**，
 * 正是由本函数在这里摘掉的 —— 旧会话重放或手工/计划模式绕过来的请求
 * 就属于这一类。删掉它，那些请求就会直接弹确认框、写进大纲列表。
 *
 * 作用范围仅限**自动保存通道**；手动通道（handleSaveAsOutline）有自己的咽喉闸门，
 * 不经过本函数。
 */
export function excludeEventOutlineSaveRequests(requests: OutlineSaveRequest[]): {
  requests: OutlineSaveRequest[]
  droppedEventOutlineCount: number
} {
  const kept = requests.filter((request) => request.fileType !== "event-outline")
  return { requests: kept, droppedEventOutlineCount: requests.length - kept.length }
}

export function formatOutlineSaveParseFeedback(errors: string[]): string {
  const uniqueErrors = Array.from(new Set(errors.filter(Boolean)))
  if (uniqueErrors.length === 0) return ""
  const preview = uniqueErrors.slice(0, 4).join("；")
  const remaining = uniqueErrors.length > 4 ? `；另有 ${uniqueErrors.length - 4} 项未列出` : ""
  return [
    `保存请求解析失败：${preview}${remaining}。`,
    "请让 AI 重新输出 outlineSaveRequest，必须包含 targetFolder、fileName、fileType、writeMode、referencedSkills、sourceIntent、content。",
    "当前内容不会写入文件。",
  ].join("")
}

export function characterDraftsToSaveRequests(
  drafts: CharacterSaveDraft[],
  sourceIntent: string,
): OutlineSaveRequest[] {
  return drafts
    .filter((draft) => draft.selected)
    .map((draft) => {
      // 优先用草稿上已挂好的角色卡 HTML（来自 characterProfileData）；否则从该草稿 MD 兜底渲染
      const htmlContent = draft.htmlContent?.trim() || renderCharacterProfileForContent(draft.content)
      /*
       * 过一遍 attachOutlineHtml，让**同一个出口保证**也覆盖人物小传：
       * 人物确认框的 HTML 勾选框在 mode==="character" 时是无条件可用的，
       * 所以草稿解析不出结构化档案时若没有 HTML，用户会勾上「HTML 形式」却拿不到 .html —— 静默失败。
       */
      return attachOutlineHtml(
        {
          targetFolder: "人物小传",
          fileName: draft.fileName,
          fileType: "character" as const,
          writeMode: "create" as const,
          referencedSkills: ["JueseSkill/character-design"],
          sourceIntent,
          content: draft.content,
          ...(htmlContent ? { htmlContent } : {}),
        },
        "",
      )
    })
}

export function splitConfirmRequiredSaveRequests(requests: OutlineSaveRequest[]): {
  autoSaveable: OutlineSaveRequest[]
  confirmRequired: OutlineSaveRequest[]
} {
  return {
    // 所有大纲类型均需用户确认后写入，禁止静默落盘
    autoSaveable: [],
    confirmRequired: [...requests],
  }
}

/** 按 targetFolder+fileName 去重合并；同名时以 incoming 覆盖。保留 existing 顺序，新增项追加在末尾。 */
export function mergeOutlineSaveRequests(
  existing: OutlineSaveRequest[],
  incoming: OutlineSaveRequest[],
): OutlineSaveRequest[] {
  const keyOf = (request: OutlineSaveRequest) => `${request.targetFolder}\0${request.fileName}`
  const byKey = new Map<string, OutlineSaveRequest>()
  for (const request of existing) byKey.set(keyOf(request), request)
  for (const request of incoming) byKey.set(keyOf(request), request)

  const merged: OutlineSaveRequest[] = []
  const seen = new Set<string>()
  for (const request of existing) {
    const key = keyOf(request)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(byKey.get(key)!)
  }
  for (const request of incoming) {
    const key = keyOf(request)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(byKey.get(key)!)
  }
  return merged
}

function buildSaveContent(request: OutlineSaveRequest): string {
  return stripOutlineFrontmatter(request.content)
}

/** 历史版本的 key：文件名去掉 `.md` 后缀。`总纲.md` → `总纲`。 */
function outlineVersionNameOf(mdFileName: string): string {
  return mdFileName.replace(/\.md$/i, "").trim()
}

/** 本次保存会用的输入里，与历史版本相关的那部分。 */
type OutlineSaveHistoryContext = Pick<OutlineSaveRequestFs, "fileExists" | "readFile">
  & OutlineSaveRequestsHistoryHook
  & { projectPath?: string }

/**
 * 在覆盖写 `.md` 之前把旧内容交给调用方落成历史版本。
 *
 * 四条「不落版本」的安全边界，缺一条都会产生垃圾版本或写错位置：
 * 1. 调用方没传 `projectPath` —— 历史库的根目录无从得知，宁可跳过；
 * 2. 调用方没传 hook —— 这条保存流程本来就不留历史；
 * 3. 旧内容为空 —— 存一条空白历史只会污染列表；
 * 4. `previousContent` 未给时读不到旧文件 / 读到空 —— 说明不是覆盖，没什么可留。
 *
 * 全程吞掉异常：历史是「保险」，不是主流程。历史库写坏了绝不能让用户以为
 * 正文没保存成功 —— 那比丢一条历史严重得多。
 */
function callBeforeOverwrite(
  context: OutlineSaveHistoryContext,
  name: string,
  previousContent: string,
): void {
  if (!context.projectPath) return
  if (!context.beforeOverwrite) return
  if (!previousContent.trim()) return
  try {
    // 不 await：hook 里同步抛错走 catch，异步 reject 由下面的 void/catch 兜住。
    const outcome = context.beforeOverwrite({
      projectPath: context.projectPath,
      name,
      previousContent,
    })
    if (outcome && typeof (outcome as Promise<void>).catch === "function") {
      void (outcome as Promise<void>).catch((error: unknown) => {
        console.warn(`留历史版本失败（已忽略，不影响保存）：${name}`, error)
      })
    }
  } catch (error) {
    console.warn(`留历史版本失败（已忽略，不影响保存）：${name}`, error)
  }
}

/**
 * 覆盖写分支的旧内容读取。
 *
 * 只有「文件已存在、且调用方给了 readFile」时才有旧内容可存；
 * 读失败一律当作「没有旧内容」，不让历史读取成为保存的前置条件。
 */
async function readPreviousOutlineContent(
  context: OutlineSaveHistoryContext,
  path: string,
): Promise<string> {
  if (!context.readFile) return ""
  if (!(await context.fileExists(path))) return ""
  try {
    return await context.readFile(path)
  } catch (error) {
    console.warn(`读取大纲旧内容失败，本次不留历史版本：${path}`, error)
    return ""
  }
}

async function resolveUniquePath(
  fs: Pick<OutlineSaveRequestFs, "fileExists">,
  targetDir: string,
  fileName: string,
): Promise<{ path: string; fileName: string }> {
  const first = `${targetDir}/${fileName}`
  if (!(await fs.fileExists(first))) return { path: first, fileName }

  const extensionIndex = fileName.lastIndexOf(".")
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : ""
  for (let index = 2; index <= 99; index++) {
    const candidateName = `${stem}-${index}${extension}`
    const candidatePath = `${targetDir}/${candidateName}`
    if (!(await fs.fileExists(candidatePath))) {
      return { path: candidatePath, fileName: candidateName }
    }
  }
  const fallbackName = `${stem}-${Date.now()}${extension}`
  return { path: `${targetDir}/${fallbackName}`, fileName: fallbackName }
}

export async function saveOutlineSaveRequests(input: {
  outlineRoot: string
  requests: OutlineSaveRequest[]
  confirmed?: boolean
  /** 保存格式选择：md 默认 true；html 仅当请求含 htmlContent 且此处为 true 时写入伴生 .html */
  formats?: { md: boolean; html: boolean }
  /**
   * 书根目录，用于把被覆盖的旧内容落成历史版本。
   *
   * 刻意由**调用方**传入而不是从 `outlineRoot` 反推：`outlineRoot` 形如
   * `<书根>/wiki/outlines`，反推要猜分隔符与目录层级，猜错就会把历史写到
   * 一个不存在的地方。缺省时安全跳过落版本（不影响保存本身）。
   */
  projectPath?: string
} & OutlineSaveRequestsHistoryHook & OutlineSaveRequestFs): Promise<OutlineSaveRequestSaveResult> {
  const outlineRoot = normalizePath(input.outlineRoot).replace(/\/+$/, "")
  const result: OutlineSaveRequestSaveResult = { saved: [], skipped: [], errors: [] }
  const formats = input.formats ?? { md: true, html: true }

  for (const request of input.requests) {
    const targetDir = `${outlineRoot}/${request.targetFolder}`
    await input.createDirectory(targetDir)

    if (request.writeMode === "replace" || request.writeMode === "patch") {
      if (!input.confirmed) {
        result.skipped.push(`已跳过 ${request.fileName}：${request.writeMode} 需要用户明确确认。`)
        continue
      }
      await writeRequestFormats(input, targetDir, request.fileName, request, formats, result)
      continue
    }

    if (request.writeMode === "append") {
      /*
       * append 的契约是「追加到文件末尾」（提示词与 skills/SkillHub/AI_OUTLINE_OUTPUT_PROTOCOL.md
       * 都这么写：适合伏笔记录、角色出场记录、设定更新记录），所以**不论 confirmed 与否**
       * 都必须先读原文再拼接。
       *
       * 旧实现把 confirmed 分支写成 `writeFile(targetPath, content)` —— 那是覆盖写。
       * 而唯一的调用点（大纲对话保存，outline-chat-panel）恒传 `confirmed: true`，
       * 于是 append 永远走覆盖分支：用户已有的伏笔台账 / 设定更新记录会被这一轮
       * 新增的那一小段整个替换掉，旧内容不可恢复（.md 没有版本历史）。
       *
       * 只有在「读不到原文」时才退化成纯写入 —— 那是新文件，行为与覆盖写等价。
       */
      const targetPath = `${targetDir}/${request.fileName}`
      const body = stripOutlineFrontmatter(request.content).trim()
      const exists = await input.fileExists(targetPath)
      if (formats.md) {
        if (exists && !input.readFile) {
          // 文件已存在但读不到原文：宁可不写，也不能用覆盖写把旧内容抹掉
          result.skipped.push(`已跳过 ${request.fileName}：当前环境缺少追加读取能力。`)
        } else {
          const original = exists && input.readFile ? await input.readFile(targetPath) : ""
          /*
           * 复用上面已经读到的 `original`，**不再二次 readFile**：
           * append 本来就必须读原文才能拼接，旧内容已经在这一份手里了。
           * 再读一次既多一次 IO，也可能读到刚被别的进程改过的内容，
           * 存下的「历史」就不再是本次真正被追加的那一版。
           */
          callBeforeOverwrite(input, outlineVersionNameOf(request.fileName), original)
          const merged = original
            ? `${stripOutlineFrontmatter(original).replace(/\s*$/, "\n\n")}${body}\n`
            : `${body}\n`
          await input.writeFile(targetPath, merged)
          result.saved.push({ path: targetPath, fileName: request.fileName, writeMode: request.writeMode })
        }
      }
      if (request.htmlContent && formats.html) {
        const htmlFileName = request.fileName.replace(/\.md$/i, ".html")
        const htmlPath = `${targetDir}/${htmlFileName}`
        await input.writeFile(htmlPath, request.htmlContent)
        result.saved.push({ path: htmlPath, fileName: htmlFileName, writeMode: request.writeMode })
      }
      continue
    }

    const target = await resolveUniquePath(input, targetDir, request.fileName)
    await writeRequestFormats(input, targetDir, target.fileName, request, formats, result)
  }

  return result
}

async function writeRequestFormats(
  fs: Pick<OutlineSaveRequestFs, "writeFile" | "fileExists" | "readFile">
    & OutlineSaveRequestsHistoryHook
    & { projectPath?: string },
  targetDir: string,
  mdFileName: string,
  request: OutlineSaveRequest,
  formats: { md: boolean; html: boolean },
  result: OutlineSaveRequestSaveResult,
): Promise<void> {
  const mdPath = `${targetDir}/${mdFileName}`
  if (formats.md) {
    /*
     * 覆盖前留版本：这一支处理的是 replace / patch（以及 create 落到同名文件时的
     * 唯一路径解析）。`writeMode === "create"` 落到的是 `resolveUniquePath` 挑出的
     * **不重名**路径，通常没有旧内容可存；真有同名文件时读到的旧内容照样值得留一份。
     *
     * 只对 `.md` 主文件落版本：`.html` / `.json` 是伴生文件，能从同一个请求
     * 重新渲染出来，留历史没有必要且会成倍放大版本库体积。
     */
    const previousContent = await readPreviousOutlineContent(fs, mdPath)
    callBeforeOverwrite(fs, outlineVersionNameOf(mdFileName), previousContent)
    await fs.writeFile(mdPath, buildSaveContent({ ...request, fileName: mdFileName }))
    result.saved.push({ path: mdPath, fileName: mdFileName, writeMode: request.writeMode })
  }
  if (request.htmlContent && formats.html) {
    const htmlFileName = mdFileName.replace(/\.md$/i, ".html")
    const htmlPath = `${targetDir}/${htmlFileName}`
    await fs.writeFile(htmlPath, request.htmlContent)
    result.saved.push({ path: htmlPath, fileName: htmlFileName, writeMode: request.writeMode })
  }
  // 卷纲的结构化数据落盘为伴生 .json，供章纲做「卷纲↔章纲」交叉校验（与 HTML 同开关）
  if (request.fileType === "volume-outline" && request.structuredData && formats.html) {
    const jsonFileName = mdFileName.replace(/\.md$/i, ".json")
    const jsonPath = `${targetDir}/${jsonFileName}`
    await fs.writeFile(jsonPath, request.structuredData)
    result.saved.push({ path: jsonPath, fileName: jsonFileName, writeMode: request.writeMode })
  }
}
