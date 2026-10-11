import type { OutlineSaveRequestFileType } from "./outline-save-request"
import { formatChapterOutlineFileName, sanitizeOutlineFileNamePart } from "./outline-workbench"

interface OutlineSaveClassificationInput {
  explicitFileType?: OutlineSaveRequestFileType
  referencedSkills?: string[]
  title: string
  content: string
  /** 用户原话、意图模块名等，用于在正文引用「卷纲」时仍能识别章纲 */
  sourceHint?: string
}

export interface OutlineSaveClassification {
  fileType: OutlineSaveRequestFileType
  targetFolder: string
  fileName: string
}

const FILE_TYPE_FOLDERS: Record<OutlineSaveRequestFileType, string> = {
  outline: "大纲",
  "volume-outline": "卷纲",
  "chapter-outline": "章纲",
  "event-outline": "事件细纲",
  character: "人物小传",
  setting: "设定",
  foreshadowing: "伏笔",
  organization: "组织",
  "quality-report": "质量检查",
}

export function getDefaultFolderForOutlineFileType(fileType: OutlineSaveRequestFileType): string {
  return FILE_TYPE_FOLDERS[fileType]
}

export function inferOutlineFileTypeFromSkills(skills: string[] = []): OutlineSaveRequestFileType | null {
  const text = skills.join("\n")
  if (text.includes("ZhanggangSkill/")) return "chapter-outline"
  if (text.includes("JueseSkill/")) return "character"
  if (text.includes("faction-system")) return "organization"
  if (text.includes("foreshadowing")) return "foreshadowing"
  if (text.includes("SheDingSkill/")) return "setting"
  if (text.includes("DagangSkill/")) return "outline"
  return null
}

/*
 * 「事件细纲」这个字符串**包含**「细纲」，而下面的 CHAPTER_TYPE_MARK / CHAPTER_SUBJECT 都认「细纲」。
 * 事件标记必须先判：否则模型漏写 fileType 时，事件细纲会按名字被判成 chapter-outline 落进「章纲」文件夹，
 * 章纲写作上下文引擎的 resolveChapterOutline 随后会把它当成真正的 17 节章纲读走 —— 隔离保证就此失效。
 * CHAPTER_TYPE_MARK / CHAPTER_SUBJECT 本身不动：没有「事件」二字时，「细纲」仍然只指章纲。
 */
const EVENT_TYPE_MARK = /事件细纲|事件清单|事件序列/
/**
 * 同一个事件标记的全局版，专供 `inferFileTypeFromHint` 把标记**摘掉**用。
 *
 * 为什么要摘：事件细纲向导发的那条可见用户消息内容就是「生成第N章事件细纲…」，
 * 它进 collectOutlineSaveSourceHint 之后，这个会话的 hint 会**永久**带着「事件细纲」
 * 四个字。于是同一会话里后出的任何交付物（「# 全书总纲」「# 世界观设定」…）
 * 只要标题与首个 H1 里没有章/卷/细纲字样，就会被 hint 判成 event-outline ——
 * 被本批的闸门静默丢弃，手动通道更会把它归进 wiki/outlines/事件细纲/。
 *
 * 摘掉会不会漏判真正的细纲？不会：真正的细纲在**上一步**就已经由文档自身认出来了
 * （`classifyOutlineSaveTarget` 里那句 `resolveChapterOrVolumeType(extractDocumentSubject(…))`，
 * 那里的 EVENT_TYPE_MARK 判定原样保留），正文那一层也还有 `inferFileTypeFromContent`。
 * hint 这一层因此不承担识别事件细纲的职责，只负责给「正文没明说、但用户/意图模块提过」的
 * 情况补充线索 —— 而事件细纲恰恰不该由对话措辞来定类型。
 */
const EVENT_TYPE_MARK_ALL = /事件细纲|事件清单|事件序列/g
const CHAPTER_TYPE_MARK = /章纲|细纲|章节细纲|章节大纲/
const VOLUME_TYPE_MARK = /卷纲|分卷大纲/
const CHAPTER_SUBJECT = /章纲|细纲|第\s*\d{1,4}\s*章/
const VOLUME_SUBJECT = /卷纲|分卷大纲|第\s*(?:\d+|[一二三四五六七八九十百千万]+)\s*卷/
/**
 * hint 层的**窄门**：只有 hint 自己明说了「章纲/卷纲」这一族的词，才允许它参与章/卷定型。
 *
 * 为什么不直接用 CHAPTER_SUBJECT 决定要不要委派：它还认裸章号 `第\s*\d{1,4}\s*章`，
 * 而事件细纲向导那条可见用户消息摘掉事件标记后剩下的正是「生成第 12 章（6 个事件）」
 * 这样的残句 —— 靠它委派，同一会话里后出的「# 全书总纲」仍会被定型成章纲，
 * 文件名退化成「全书总纲.md」并默认落到 `章纲/`（原设计 §4.2 记录的那条残留，
 * 成因就是这个裸章号兜底）。
 *
 * 收窄成窄门不会削弱既有契约：`outline-save-classifier.spec.ts` 里那条
 * 「用户原话是章纲时，正文引用卷纲不能改判成卷纲」依赖的是 hint 里的「**章纲**」二字
 * （`编写第 46 章章纲`），窄门照样命中。
 *
 * ⚠️ 修的是**委派条件**，不是 CHAPTER_SUBJECT：把 `第N章` 从 CHAPTER_SUBJECT 里删掉
 * 会同时削弱**文档层**（`extractDocumentSubject` 那条腿）的识别能力，那是承重的。
 */
const CHAPTER_OR_VOLUME_HINT_MARK = /章纲|细纲|章节细纲|章节大纲|卷纲|分卷大纲/

function extractDocumentSubject(title: string, content: string): string {
  const heading = title.replace(/^#+\s*/, "").trim()
  const firstH1 = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? ""
  return `${heading}\n${firstH1}`
}

function resolveChapterOrVolumeType(text: string): OutlineSaveRequestFileType | null {
  // 事件细纲优先级最高：它命中 CHAPTER_SUBJECT 的「细纲」，必须先被摘出去
  if (EVENT_TYPE_MARK.test(text)) return "event-outline"
  const chapter = CHAPTER_SUBJECT.test(text)
  const volume = VOLUME_SUBJECT.test(text)
  if (chapter && !volume) return "chapter-outline"
  if (volume && !chapter) return "volume-outline"
  if (chapter && volume) {
    if (CHAPTER_TYPE_MARK.test(text) && !VOLUME_TYPE_MARK.test(text)) return "chapter-outline"
    if (VOLUME_TYPE_MARK.test(text) && !CHAPTER_TYPE_MARK.test(text)) return "volume-outline"
    if (CHAPTER_TYPE_MARK.test(text)) return "chapter-outline"
    return "volume-outline"
  }
  return null
}

function inferFileTypeFromHint(hint: string): OutlineSaveRequestFileType | null {
  const text = hint.trim()
  if (!text) return null
  /*
   * 这里**刻意不认**「事件细纲」（详见 EVENT_TYPE_MARK_ALL 的注释）：
   * hint 里装的是对话文本，而事件细纲向导自己的用户消息就含「事件细纲」；
   * 一旦允许 hint 判定 event-outline，同一会话里后出的「# 全书总纲」
   * 这类交付物就会被误retype。真正的细纲已由文档自身在上一步认出来。
   *
   * 摘标记而不是直接跳过这一步：否则下面的 resolveChapterOrVolumeType 里
   * 那句 EVENT_TYPE_MARK 判定会把 event-outline 又带回来。
   *
   * 摘完之后**还要过窄门**（CHAPTER_OR_VOLUME_HINT_MARK）才委派：委派的判据若
   * 直接是 CHAPTER_SUBJECT，裸章号就会把「生成第 12 章（6 个事件）」这种残句
   * 当成章纲线索。不命中窄门时**继续下沉**到下面那些非章/卷分支
   * （人物/伏笔/设定/…/总纲），让文档自身与标题去决定类型。
   */
  const withoutEventMark = text.replace(EVENT_TYPE_MARK_ALL, "")
  if (CHAPTER_OR_VOLUME_HINT_MARK.test(withoutEventMark)) {
    const chapterOrVolume = resolveChapterOrVolumeType(withoutEventMark)
    if (chapterOrVolume) return chapterOrVolume
  }
  if (/人物小传|角色小传/.test(text)) return "character"
  if (/伏笔计划|伏笔/.test(text) && /伏笔/.test(text)) return "foreshadowing"
  if (/组织势力|势力设定/.test(text)) return "organization"
  if (/力量体系|能力体系|金手指|世界观|背景设定|地理设定/.test(text)) return "setting"
  if (/质量检查/.test(text)) return "quality-report"
  if (/故事大纲|总纲/.test(text)) return "outline"
  return null
}

function inferFileTypeFromContent(title: string, content: string): OutlineSaveRequestFileType {
  const text = `${title}\n${content}`
  // 事件标记先于章纲标记：正文里出现「事件序列 / 事件清单」就是事件细纲，别被标题的「细纲」抢走
  if (EVENT_TYPE_MARK.test(text)) return "event-outline"
  if (CHAPTER_TYPE_MARK.test(text)) return "chapter-outline"
  if (
    /(?:^|\n)#+\s*.*(?:卷纲|分卷大纲)/.test(text)
    || /第\s*(?:\d+|[一二三四五六七八九十百千万]+)\s*卷\s*(?:卷纲|大纲)/.test(text)
  ) {
    return "volume-outline"
  }
  if (/第\s*\d{1,4}\s*章/.test(text)) return "chapter-outline"
  if (/第\s*(?:\d+|[一二三四五六七八九十百千万]+)\s*卷/.test(text)) return "volume-outline"
  if (/人物小传|角色小传|男主|女主|男配|女配|反派|角色定位/.test(text)) return "character"
  if (/伏笔|线索|回收/.test(text)) return "foreshadowing"
  if (/组织|势力|阵营|门派|家族/.test(text)) return "organization"
  if (/世界观|设定|力量体系|金手指|地图|规则/.test(text)) return "setting"
  if (/质量检查|检查报告|问题清单/.test(text)) return "quality-report"
  return "outline"
}

function inferFileName(fileType: OutlineSaveRequestFileType, title: string, content: string): string {
  const chapter = `${title}\n${content}`.match(/第\s*(\d{1,4})\s*章\s*([^\n#]*)/)
  if (fileType === "chapter-outline" && chapter) {
    return formatChapterOutlineFileName(
      Number(chapter[1]),
      chapter[2]?.trim().replace(/^[：:\s-]+/, "") ?? "",
    )
  }
  // 事件细纲固定命名「事件细纲-第NNN章.md」，不照抄标题（标题常是一句话章名，不便于归档）
  if (fileType === "event-outline" && chapter) {
    return `事件细纲-第${String(Number(chapter[1])).padStart(3, "0")}章.md`
  }

  const safe = sanitizeOutlineFileNamePart(title.replace(/^#+\s*/, "")) || "大纲"
  if (fileType === "character") {
    const characterFileName = safe.startsWith("角色-") ? safe : `角色-${safe}`
    return characterFileName.toLowerCase().endsWith(".md") ? characterFileName : `${characterFileName}.md`
  }
  return safe.toLowerCase().endsWith(".md") ? safe : `${safe}.md`
}

export function classifyOutlineSaveTarget(input: OutlineSaveClassificationInput): OutlineSaveClassification {
  const fileType =
    input.explicitFileType ??
    inferOutlineFileTypeFromSkills(input.referencedSkills) ??
    resolveChapterOrVolumeType(extractDocumentSubject(input.title, input.content)) ??
    inferFileTypeFromHint(input.sourceHint ?? "") ??
    // 标题语义优先于正文推断：避免「《XX》全版本力量体系总纲」因正文提到「第N章」被误判为章纲
    inferFileTypeFromHint(input.title.replace(/^#+\s*/, "")) ??
    inferFileTypeFromContent(input.title, input.content)

  return {
    fileType,
    targetFolder: getDefaultFolderForOutlineFileType(fileType),
    fileName: inferFileName(fileType, input.title, input.content),
  }
}
