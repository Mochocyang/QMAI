/**
 * 本节速记 - 上下文筛选机制
 * 根据本章细纲，从追踪数据中筛选出本节所需的角色状态、伏笔信息和世界观约束
 */

import {
  readCharacterStateMd,
  readForeshadowingMd,
  readContextMd,
} from "./tracking-files"
import {
  loadForeshadowingTracker,
  createEmptyForeshadowingStore,
} from "./foreshadowing-tracker"
import {
  buildRelevantCharacterBriefs,
  buildRelevantForeshadowing,
  capOutlineSourcesToBudget,
  loadOutlineDocumentIndex,
} from "./outline-context-index"

const RELEVANT_CHARACTER_BRIEFS_MAX_CHARS = 8_000
const RELEVANT_FORESHADOWING_MAX_CHARS = 6_000

/**
 * 从细纲文本中提取出场角色名
 */
function extractCharacterNames(chapterOutlineContent: string): string[] {
  const names = new Set<string>()

  // 查找"出场角色/人物/参与角色"等标题行后的内容
  const headerPatterns = [
    /出场角色[：:]\s*([^\n]+)/i,
    /参与角色[：:]\s*([^\n]+)/i,
    /角色[：:]\s*([^\n]+)/i,
    /人物[：:]\s*([^\n]+)/i,
  ]
  for (const pattern of headerPatterns) {
    const match = chapterOutlineContent.match(pattern)
    if (match) {
      const chars = match[1].split(/[、，,]+/).map((c) => c.trim()).filter((c) => c.length >= 2)
      for (const c of chars) names.add(c)
    }
  }

  // 查找 Markdown 列表项中的候选名（单行列表，2-10 个字符）
  const listPattern = /^[-*]\s+(.{2,10}?)(?:[（(].*?[）)]|\s*[-—–]|\s*$)/gm
  let m: RegExpExecArray | null
  while ((m = listPattern.exec(chapterOutlineContent)) !== null) {
    const candidate = m[1].trim()
    if (candidate.length >= 2 && !/^[\d①②③④⑤⑥⑦⑧⑨⑩]+$/.test(candidate)) {
      names.add(candidate)
    }
  }

  return Array.from(names)
}

/**
 * 从细纲文本中提取伏笔相关线索
 */
function extractForeshadowingHints(chapterOutlineContent: string): string[] {
  const hints: string[] = []
  const pattern = /(?:伏笔|铺垫|悬念)[：:]\s*([^\n]+)/gi
  let m: RegExpExecArray | null
  while ((m = pattern.exec(chapterOutlineContent)) !== null) {
    const hint = m[1].trim()
    if (hint) hints.push(hint)
  }
  return hints
}

/**
 * 构建本节速记 Markdown 文本
 *
 * @param projectPath - 项目路径
 * @param chapterNumber - 当前章节号
 * @param chapterOutlineContent - 本章细纲文本内容
 * @returns 格式化的「本节速记」Markdown 文本，无可筛选内容时返回空字符串
 */
export async function buildSectionBriefing(
  projectPath: string,
  chapterNumber: number,
  chapterOutlineContent: string,
  task = "",
): Promise<string> {
  const sections: string[] = []
  const trimmedOutline = chapterOutlineContent.trim()
  const matchingText = [task, trimmedOutline].filter(Boolean).join("\n")

  // ── 1. 提取出场角色并筛选角色状态 ──────────────────
  const characterNames = extractCharacterNames(matchingText)

  if (characterNames.length > 0) {
    const charStore = await readCharacterStateMd(projectPath)
    const briefs: string[] = []

    if (charStore) {
      for (const name of characterNames) {
        const match = charStore.characters.find(
          (c) => c.characterName.includes(name) || name.includes(c.characterName),
        )
        if (match) {
          const parts: string[] = [`**${match.characterName}**`]
          parts.push(match.status || "正常")
          if (match.currentLocation && match.currentLocation !== "未知") {
            parts.push(`（${match.currentLocation}）`)
          }
          if (match.publicImage) {
            parts.push(`——公众形象：${match.publicImage}`)
          }
          briefs.push(`- ${parts.join(" ")}`)
        }
      }
    }

    if (briefs.length > 0) {
      sections.push("### 出场角色状态")
      sections.push(...briefs)
      sections.push("")
    }
  }

  try {
    const outlineIndex = await loadOutlineDocumentIndex(projectPath)
    const characterBriefs = capOutlineSourcesToBudget(
      buildRelevantCharacterBriefs(outlineIndex, matchingText),
      RELEVANT_CHARACTER_BRIEFS_MAX_CHARS,
    )
    if (characterBriefs) {
      sections.push("### 相关人物小传")
      sections.push(characterBriefs)
      sections.push("")
    }

    const outlineForeshadowing = capOutlineSourcesToBudget(
      buildRelevantForeshadowing(outlineIndex, chapterNumber, matchingText),
      RELEVANT_FORESHADOWING_MAX_CHARS,
    )
    if (outlineForeshadowing) {
      sections.push("### 相关伏笔规划")
      sections.push(outlineForeshadowing)
      sections.push("")
    }
  } catch {}

  // ── 2. 筛选相关伏笔 ────────────────────────────────
  // 先尝试读取新版 tracking 数据
  let fStore = await loadForeshadowingTracker(projectPath).catch(() => null)
  if (!fStore || fStore.items.length === 0) {
    // 回退到 wiki/tracking Markdown 文件
    const mdResult = await readForeshadowingMd(projectPath, createEmptyForeshadowingStore(), [])
    fStore = mdResult.store
  }

  const foreshadowingHints = extractForeshadowingHints(matchingText)

  const relevantForeshadowing = fStore.items.filter((f) => {
    if (f.status === "abandoned") return false
    // 细纲中明确提到了该伏笔的描述
    if (foreshadowingHints.some((hint) => f.description.includes(hint) || hint.includes(f.description.slice(0, 10)))) {
      return true
    }
    // 出场角色与该伏笔关联
    if (f.relatedCharacters && characterNames.some((name) => f.relatedCharacters!.includes(name))) {
      return true
    }
    // 伏笔的埋设/推进/回收在本章
    if (f.plantedChapter === chapterNumber) return true
    if (f.advancedChapters && f.advancedChapters.includes(chapterNumber)) return true
    if (f.resolvedChapter === chapterNumber) return true
    if (f.expectedResolveChapter === chapterNumber) return true
    return false
  })

  if (relevantForeshadowing.length > 0) {
    sections.push("### 相关伏笔")
    for (const f of relevantForeshadowing) {
      const chapterHint =
        f.plantedChapter === chapterNumber
          ? "（本章埋设）"
          : f.advancedChapters?.includes(chapterNumber)
            ? "（本章推进）"
            : f.resolvedChapter === chapterNumber
              ? "（本章回收）"
              : f.expectedResolveChapter === chapterNumber
                ? "（预计本章回收）"
                : ""

      const statusLabel =
        f.status === "resolved" ? "已回收"
        : f.status === "advanced" ? "推进中"
        : f.status === "abandoned" ? "已放弃"
        : "已埋设"

      sections.push(
        `- ${f.description} — 状态：${statusLabel}${chapterHint}` +
        (f.importance ? `，重要度：${f.importance === "high" ? "高" : f.importance === "low" ? "低" : "中"}` : ""),
      )
    }
    sections.push("")
  }

  // ── 3. 加载世界观约束 ──────────────────────────────
  const progress = await readContextMd(projectPath)
  if (progress) {
    const constraints: string[] = []
    if (progress.currentArc && progress.currentArc !== "尚未开始") {
      constraints.push(`当前剧情阶段：${progress.currentArc}`)
    }
    if (progress.relationshipStatus) {
      constraints.push(`当前关系状态：${progress.relationshipStatus}`)
    }
    if (constraints.length > 0) {
      sections.push("### 世界观约束")
      for (const c of constraints) {
        sections.push(`- ${c}`)
      }
      sections.push("")
    }
  }

  if (sections.length === 0) return ""

  return [
    "## 本节速记",
    "",
    ...sections,
  ].join("\n")
}
