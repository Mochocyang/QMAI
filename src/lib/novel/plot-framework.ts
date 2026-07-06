/**
 * 剧情框架四段循环 - 类型定义
 *
 * 设计依据：用户需求文档《拆书库与AI大纲设计与优化》
 *
 * 核心心智模型（固定方向模板，故事可不同，方向模板相同）：
 *   钩子（保持期待感）→ 铺垫（塑造舞台/压力/负面情绪/加深期待）
 *   → 爽点（反转/情绪释放）→ 结尾钩子（衔接下一循环）
 *
 * 能力边界：
 *  - AI 只做框架层（提取 + 套模板）
 *  - 血肉层（人设/文风/对话/整活/玩梗/小癖好）让位作者
 *
 * 跨作品共享：框架是顶层实体，可被多个拆文项目/章纲引用，不只绑死在单一 DismantlingProject
 */

/** 框架在主线/支线中的归属 */
export type PlotFrameworkLine = "main" | "sub"

/** 框架的四段循环内容 */
export interface PlotFrameworkBeats {
  /** 开局钩子：让读者保持期待感的剧情 */
  hook: string
  /** 铺垫：塑造舞台、规则、压力、负面情绪、加深期待 */
  buildup: string
  /** 爽点：反转剧情，将情绪一下子释放，让读者爽到 */
  payoff: string
  /** 结尾钩子：让读者继续保持期待感，衔接下一循环 */
  endingHook: string
}

/** 框架涉及的角色及其作用定位 */
export interface PlotFrameworkCharacter {
  /** 角色名 */
  name: string
  /** 在本框架中的作用定位，如“负责嘲讽主角，触发爽点对比” */
  role: string
}

/**
 * 完整剧情框架实体
 * 一个框架可覆盖多章，对应一组 hook→buildup→payoff→endingHook 循环
 */
export interface PlotFramework {
  /** 稳定唯一 ID（同项目内不可重复；跨项目通过 sourceDismantlingProjectId 区分） */
  id: string
  /** 框架标题（一句话总结方向，如"双S转职反差爽点"） */
  title: string
  /** 四段循环正文 */
  beats: PlotFrameworkBeats
  /** 覆盖的拆文章节 id 列表（决定作者节奏功底：紧凑型几章/水型十几章） */
  rangeChapterIds: string[]
  /** 主线 / 支线归属 */
  line: PlotFrameworkLine
  /** 涉及的角色（来源拆文的角色，作为模板套用时的占位） */
  characters: PlotFrameworkCharacter[]
  /** 埋设 / 回收的伏笔（来源拆文的伏笔描述） */
  foreshadowing: string[]
  /** 一句话可复用模板（如“先压后扬，规则打破”） */
  reusableTemplate: string
  /** 方向指引：让 AI 理解“什么时候该做什么”的约束，如“震惊时机：规则打破时；装逼时机：对比衬托到位时” */
  directionHints: string
  /** 作者发挥空间提示：标注这个框架的哪些节点适合手工发挥（玩梗/整活/人设对话），如“爽点处适合玩梗；铺垫处配角对话适合整活” */
  handcraftHints: string
  /** 来源拆文项目 id（可追溯） */
  sourceDismantlingProjectId?: string
  /** 来源拆文项目标题（备份展示，避免库引用查不到时显示空） */
  sourceDismantlingProjectTitle?: string
  /** 与上一框架的衔接点说明（保证主线不乱、支线不漏） */
  prevConnector?: string
  /** 与下一框架的衔接点说明 */
  nextConnector?: string
  /** 节奏初判：AI 自动判断 + 用户可调（紧凑型/水型/标准） */
  pacing?: "tight" | "standard" | "loose"
  /** AI 是否已自动初判（true=AI 给的初判，false=用户已手动校正） */
  autoPacing?: boolean
  /** 用户自定义标签（用于分类筛选，如"爽文"、"复仇"、"转职"） */
  tags?: string[]
  /** 版本历史（每次编辑保存前将上一版本快照存入此数组） */
  history?: PlotFrameworkSnapshot[]
  createdAt: number
  updatedAt: number
}

/** 框架版本快照（用于版本历史回滚） */
export interface PlotFrameworkSnapshot {
  /** 快照时间戳 */
  savedAt: number
  /** 快照时的标题 */
  title: string
  /** 快照时的四段正文 */
  beats: PlotFrameworkBeats
  /** 快照时的方向提示 */
  directionHints: string
  /** 快照时的手工提示 */
  handcraftHints: string
  /** 快照时的可复用模板 */
  reusableTemplate: string
}

/** 跨作品框架库（顶层共享实体） */
export interface PlotFrameworkLibrary {
  version: 1
  /** 全部框架（含主线/支线，跨多个来源拆文） */
  frameworks: PlotFramework[]
}

const DEFAULT_FRAMEWORK_LIBRARY: PlotFrameworkLibrary = {
  version: 1,
  frameworks: [],
}

/** 框架四段必填字段名（用于校验） */
export const PLOT_FRAMEWORK_REQUIRED_BEATS: ReadonlyArray<keyof PlotFrameworkBeats> = [
  "hook",
  "buildup",
  "payoff",
  "endingHook",
]

export function emptyPlotFrameworkLibrary(): PlotFrameworkLibrary {
  return { ...DEFAULT_FRAMEWORK_LIBRARY, frameworks: [] }
}

/** 规范化单个框架：补默认值、清理空字段、做最小校验 */
export function normalizePlotFramework(
  input: Partial<PlotFramework> | null | undefined,
): PlotFramework | null {
  if (!input) return null
  const now = Date.now()
  const beats = normalizeBeats(input.beats)
  // 四段任一缺失即视为不完整框架，不进入库（防 AI 拆文抖动产生半成品污染库）
  if (!beats) return null

  const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : `framework-${now}`
  const title = typeof input.title === "string" ? input.title.trim() : ""

  return {
    id,
    title: title || "未命名剧情框架",
    beats,
    rangeChapterIds: Array.isArray(input.rangeChapterIds)
      ? input.rangeChapterIds.filter((id) => typeof id === "string" && id.trim() !== "").map((id) => String(id).trim())
      : [],
    line: input.line === "sub" ? "sub" : "main",
    characters: normalizeCharacters(input.characters),
    directionHints: typeof input.directionHints === "string" ? input.directionHints.trim() : "",
    handcraftHints: typeof input.handcraftHints === "string" ? input.handcraftHints.trim() : "",
    foreshadowing: Array.isArray(input.foreshadowing)
      ? input.foreshadowing.filter((f) => typeof f === "string" && f.trim() !== "").map((f) => String(f).trim())
      : [],
    reusableTemplate: typeof input.reusableTemplate === "string" ? input.reusableTemplate.trim() : "",
    sourceDismantlingProjectId:
      typeof input.sourceDismantlingProjectId === "string" && input.sourceDismantlingProjectId.trim()
        ? input.sourceDismantlingProjectId.trim()
        : undefined,
    sourceDismantlingProjectTitle:
      typeof input.sourceDismantlingProjectTitle === "string" && input.sourceDismantlingProjectTitle.trim()
        ? input.sourceDismantlingProjectTitle.trim()
        : undefined,
    prevConnector: typeof input.prevConnector === "string" && input.prevConnector.trim() ? input.prevConnector.trim() : undefined,
    nextConnector: typeof input.nextConnector === "string" && input.nextConnector.trim() ? input.nextConnector.trim() : undefined,
    pacing: normalizePacing(input.pacing),
    autoPacing: typeof input.autoPacing === "boolean" ? input.autoPacing : true,
    tags: normalizeTags(input.tags),
    history: Array.isArray(input.history) ? input.history.slice(-20) : [],
    createdAt: Number(input.createdAt) || now,
    updatedAt: Number(input.updatedAt) || now,
  }
}

/** 规范化标签数组：去空、去重、trim */
function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of input) {
    if (typeof item !== "string") continue
    const tag = item.trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    result.push(tag)
  }
  return result
}

function normalizeCharacters(input: unknown): PlotFrameworkCharacter[] {
  if (!Array.isArray(input)) return []
  const result: PlotFrameworkCharacter[] = []
  for (const item of input) {
    // 兼容旧 string[] 格式
    if (typeof item === "string") {
      const name = item.trim()
      if (name) result.push({ name, role: "" })
      continue
    }
    // 新格式 { name, role }
    if (item && typeof item === "object") {
      const obj = item as { name?: unknown; role?: unknown }
      const name = typeof obj.name === "string" ? obj.name.trim() : ""
      if (name) {
        const role = typeof obj.role === "string" ? obj.role.trim() : ""
        result.push({ name, role })
      }
    }
  }
  return result
}

function normalizeBeats(input: Partial<PlotFrameworkBeats> | null | undefined): PlotFrameworkBeats | null {
  if (!input) return null
  const hook = typeof input.hook === "string" ? input.hook.trim() : ""
  const buildup = typeof input.buildup === "string" ? input.buildup.trim() : ""
  const payoff = typeof input.payoff === "string" ? input.payoff.trim() : ""
  const endingHook = typeof input.endingHook === "string" ? input.endingHook.trim() : ""
  // 四段都不可空（与"AI 必须给约束框架"对齐：缺一段即模板不可用）
  if (!hook || !buildup || !payoff || !endingHook) return null
  return { hook, buildup, payoff, endingHook }
}

function normalizePacing(input: unknown): PlotFramework["pacing"] {
  if (input === "tight" || input === "standard" || input === "loose") return input
  return undefined
}

/** 规范化框架库（去重 + 按时间稳定排序） */
export function normalizePlotFrameworkLibrary(
  input: Partial<PlotFrameworkLibrary> | null | undefined,
): PlotFrameworkLibrary {
  const frameworks = Array.isArray(input?.frameworks)
    ? input.frameworks
        .map((f) => normalizePlotFramework(f))
        .filter((f): f is PlotFramework => f !== null)
    : []

  // 去重：同 id 保留 updatedAt 最新者
  const seen = new Map<string, PlotFramework>()
  for (const fw of frameworks) {
    const existing = seen.get(fw.id)
    if (!existing || fw.updatedAt > existing.updatedAt) seen.set(fw.id, fw)
  }

  const unique = Array.from(seen.values()).sort((a, b) => {
    // 按 createdAt 升序，保证框架顺序稳定（主线串联视图依赖此顺序）
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
    return a.id.localeCompare(b.id)
  })

  return { version: 1, frameworks: unique }
}

/** 校验框架四段是否完整（外部写入前可调用） */
export function isPlotFrameworkComplete(fw: PlotFramework): boolean {
  return PLOT_FRAMEWORK_REQUIRED_BEATS.every((key) => {
    const value = fw.beats[key]
    return typeof value === "string" && value.trim().length > 0
  })
}

/**
 * 根据框架覆盖的章节数自动初判节奏功底
 * - 紧凑型（tight）：<= 3 章
 * - 标准（standard）：4-6 章
 * - 水型（loose）：>= 7 章
 *
 * 对应文档："有些人一个剧情框架要写十几二十章，也就是水文，有的人能控制得很好，可能就几章"
 *
 * @returns {pacing, autoPacing}，调用方可选择是否覆盖用户已校正过的框架
 */
export function autoJudgePacing(
  fw: PlotFramework,
): { pacing: NonNullable<PlotFramework["pacing"]>; autoPacing: true } {
  const count = fw.rangeChapterIds.length
  let pacing: NonNullable<PlotFramework["pacing"]>
  if (count <= 3) pacing = "tight"
  else if (count <= 6) pacing = "standard"
  else pacing = "loose"
  return { pacing, autoPacing: true }
}

/**
 * 给框架打上 AI 自动初判的节奏（仅当 autoPacing === true 时覆盖）
 * 用户手动校正过的框架（autoPacing === false）不会被覆盖
 */
export function applyAutoPacing(fw: PlotFramework): PlotFramework {
  // 用户已经手动校正过，不再覆盖
  if (fw.autoPacing === false && fw.pacing) return fw
  const judged = autoJudgePacing(fw)
  return { ...fw, ...judged, updatedAt: Date.now() }
}

/** 提取框架库的主线框架（按时间顺序，即文档里"主线不能乱"的可视化基础） */
export function listMainLineFrameworks(library: PlotFrameworkLibrary): PlotFramework[] {
  return library.frameworks
    .filter((f) => f.line === "main")
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** 提取框架库的支线框架（按时间顺序） */
export function listSubLineFrameworks(library: PlotFrameworkLibrary): PlotFramework[] {
  return library.frameworks
    .filter((f) => f.line === "sub")
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** 将剧情框架格式化为章纲生成提示词中的强约束上下文。 */
export function formatPlotFrameworkForOutlinePrompt(fw: PlotFramework): string {
  const lines = [
    "## 剧情框架强约束",
    "下面剧情框架来自拆书库，是本次章纲生成必须遵守的方向模板。",
    "必须按该框架生成章节细纲，不得只保留 framework_id 而忽略框架内容。",
    `框架标题：${fw.title}`,
    `归属：${fw.line === "main" ? "主线" : "支线"}`,
  ]

  if (fw.sourceDismantlingProjectTitle) {
    lines.push(`来源拆文：${fw.sourceDismantlingProjectTitle}`)
  }
  if (fw.reusableTemplate) {
    lines.push(`一句话可复用模板：${fw.reusableTemplate}`)
  }
  if (fw.prevConnector) {
    lines.push(`与上一框架衔接：${fw.prevConnector}`)
  }
  if (fw.nextConnector) {
    lines.push(`与下一框架衔接：${fw.nextConnector}`)
  }

  lines.push(
    "",
    "### 开局钩子",
    fw.beats.hook,
    "",
    "### 铺垫",
    fw.beats.buildup,
    "",
    "### 爽点",
    fw.beats.payoff,
    "",
    "### 结尾钩子",
    fw.beats.endingHook,
  )

  if (fw.characters.length > 0) {
    lines.push(
      "",
      "## 涉及角色与作用",
      ...fw.characters.map((character) => `- ${character.name}${character.role ? `：${character.role}` : ""}`),
    )
  }

  if (fw.directionHints) {
    lines.push("", "## 方向指引", fw.directionHints)
  }

  lines.push(
    "",
    "## 作者手搓留白要求",
    fw.handcraftHints || "必须明确标注哪些内容交给作者用人设卡、文风、对话设计、整活或玩梗手工填充。",
    "输出章节细纲时，必须包含 `### 作者手搓留白` 段，只标注需要作者补血肉的位置，不要替作者代写血肉层。",
  )

  return lines.join("\n")
}
