import { readFile, listDirectory } from "@/commands/fs"
import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import type { FileNode } from "@/types/wiki"
import { useActivityStore } from "@/stores/activity-store"
import { getFileName, getRelativePath, normalizePath } from "@/lib/path-utils"
import { buildLanguageDirective } from "@/lib/output-language"
import { useWikiStore } from "@/stores/wiki-store"
import { buildContextPack, contextPackToPrompt } from "@/lib/novel/context-engine"
import i18n from "@/i18n"

export interface LintResult {
  type: "orphan" | "broken-link" | "no-outlinks" | "semantic"
  severity: "warning" | "info"
  page: string
  detail: string
  affectedPages?: string[]
}

export interface SemanticLintOptions {
  chapterContent?: string
  chapterNumber?: number
}

function flattenMdFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMdFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

function extractWikilinks(content: string): string[] {
  const links: string[] = []
  const regex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1].trim())
  }
  return links
}

function relativeToSlug(relativePath: string): string {
  return relativePath.replace(/\.md$/, "")
}

function buildSlugMap(
  wikiFiles: FileNode[],
  wikiRoot: string,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const f of wikiFiles) {
    const rel = getRelativePath(f.path, wikiRoot).replace(/\.md$/, "")
    map.set(rel.toLowerCase(), f.path)
    map.set(f.name.replace(/\.md$/, "").toLowerCase(), f.path)
  }
  return map
}

export async function runStructuralLint(projectPath: string): Promise<LintResult[]> {
  const wikiRoot = `${normalizePath(projectPath)}/wiki`
  let tree: FileNode[]
  try {
    tree = await listDirectory(wikiRoot)
  } catch {
    return []
  }

  const wikiFiles = flattenMdFiles(tree)
  const contentFiles = wikiFiles.filter(
    (f) => f.name !== "index.md" && f.name !== "log.md"
  )

  const slugMap = buildSlugMap(contentFiles, wikiRoot)

  type PageData = { path: string; slug: string; content: string; outlinks: string[] }
  const pages: PageData[] = []

  for (const f of contentFiles) {
    try {
      const content = await readFile(f.path)
      const slug = relativeToSlug(getRelativePath(f.path, wikiRoot))
      const outlinks = extractWikilinks(content)
      pages.push({ path: f.path, slug, content, outlinks })
    } catch {
    }
  }

  const inboundCounts = new Map<string, number>()
  for (const p of pages) {
    for (const link of p.outlinks) {
      const lookup = link.toLowerCase()
      const target = slugMap.has(lookup)
        ? relativeToSlug(getRelativePath(slugMap.get(lookup)!, wikiRoot)).toLowerCase()
        : lookup
      inboundCounts.set(target, (inboundCounts.get(target) ?? 0) + 1)
    }
  }

  const results: LintResult[] = []

  for (const p of pages) {
    const shortName = getRelativePath(p.path, wikiRoot)
    const inbound = inboundCounts.get(p.slug.toLowerCase()) ?? 0
    if (inbound === 0) {
      results.push({
        type: "orphan",
        severity: "info",
        page: shortName,
        detail: i18n.t("lint.details.orphan"),
      })
    }

    if (p.outlinks.length === 0) {
      results.push({
        type: "no-outlinks",
        severity: "info",
        page: shortName,
        detail: i18n.t("lint.details.noOutlinks"),
      })
    }

    for (const link of p.outlinks) {
      const lookup = link.toLowerCase()
      const basename = getFileName(link).replace(/\.md$/, "").toLowerCase()
      const exists = slugMap.has(lookup) || slugMap.has(basename)
      if (!exists) {
        results.push({
          type: "broken-link",
          severity: "warning",
          page: shortName,
          detail: i18n.t("lint.details.brokenLink", { link }),
        })
      }
    }
  }

  return results
}

const LINT_BLOCK_REGEX =
  /---LINT:\s*([^\n|]+?)\s*\|\s*([^\n|]+?)\s*\|\s*([^\n-]+?)\s*---\n([\s\S]*?)---END LINT---/g

function buildSemanticWikiPrompt(summaries: string[]): string {
  const summarySample = summaries.join("\n").slice(0, 2000)

  return [
    "You are a wiki quality analyst. Review the following wiki page summaries and identify issues.",
    "",
    buildLanguageDirective(summarySample),
    "",
    "For each issue, output exactly this format:",
    "",
    "---LINT: type | severity | Short title---",
    "Description of the issue.",
    "PAGES: page1.md, page2.md",
    "---END LINT---",
    "",
    "Types:",
    "- contradiction: two or more pages make conflicting claims",
    "- stale: information that appears outdated or superseded",
    "- missing-page: an important concept is heavily referenced but has no dedicated page",
    "- suggestion: a question or source worth adding to the wiki",
    "",
    "Severities:",
    "- warning: should be addressed",
    "- info: nice to have",
    "",
    "Only report genuine issues. Do not invent problems. Output ONLY the ---LINT--- blocks, no other text.",
    "",
    "## Wiki Pages",
    "",
    summaries.join("\n\n"),
  ].join("\n")
}

async function buildSemanticNovelPrompt(
  projectPath: string,
  chapterContent: string,
  chapterNumber?: number,
): Promise<string> {
  const contextPack = await buildContextPack(
    projectPath,
    `检查第${chapterNumber || "?"}章`,
    chapterNumber,
  )

  return [
    "你是一个小说连贯性检查编辑。请根据小说上下文包检查本章是否存在连贯性和执行偏差问题。",
    "",
    contextPackToPrompt(contextPack),
    "",
    "请重点检查：",
    "1. 本章必须完成：是否已完成，若未完成请指出缺失推进。",
    "2. 本章避免违背：是否存在违背设定、时间线、人设、认知状态的问题。",
    "3. 下一章推进建议：是否被完全忽略、反向推进，或缺少必要承接。",
    "4. 若正文出现与上下文包冲突的信息，也要报告。",
    "",
    buildLanguageDirective(chapterContent),
    "",
    "输出格式必须严格为：",
    "---LINT: type | severity | Short title---",
    "Description of the issue.",
    "PAGES: 当前章节",
    "---END LINT---",
    "",
    "Types:",
    "- contradiction: 与大纲、设定、人物状态、认知状态冲突",
    "- stale: 沿用了已过期或已被后文修正的信息",
    "- suggestion: 建议补足承接、回收伏笔、强化章节目标推进",
    "",
    "Severities:",
    "- warning: 应当修正",
    "- info: 建议优化",
    "",
    "章节正文：",
    chapterContent.slice(0, 8000),
  ].join("\n")
}

export async function runSemanticLint(
  projectPath: string,
  llmConfig: LlmConfig,
  options: SemanticLintOptions = {},
): Promise<LintResult[]> {
  const pp = normalizePath(projectPath)
  const activity = useActivityStore.getState()
  const activityId = activity.addItem({
    type: "lint",
    title: "语义连贯性检查",
    status: "running",
    detail: "正在读取资料页...",
    filesWritten: [],
  })

  const wikiRoot = `${pp}/wiki`
  let tree: FileNode[]
  try {
    tree = await listDirectory(wikiRoot)
  } catch {
    activity.updateItem(activityId, { status: "error", detail: "读取资料目录失败。" })
    return []
  }

  const wikiFiles = flattenMdFiles(tree).filter(
    (f) => f.name !== "log.md"
  )

  const summaries: string[] = []
  for (const f of wikiFiles) {
    try {
      const content = await readFile(f.path)
      const preview = content.slice(0, 500) + (content.length > 500 ? "..." : "")
      const shortPath = getRelativePath(f.path, wikiRoot)
      summaries.push(`### ${shortPath}\n${preview}`)
    } catch {
    }
  }

  if (summaries.length === 0) {
    activity.updateItem(activityId, { status: "done", detail: "没有可检查的资料页。" })
    return []
  }

  activity.updateItem(activityId, { detail: "正在进行语义分析..." })

  const novelMode = useWikiStore.getState().novelMode
  const prompt = novelMode && options.chapterContent?.trim()
    ? await buildSemanticNovelPrompt(pp, options.chapterContent, options.chapterNumber)
    : buildSemanticWikiPrompt(summaries)

  let raw = ""
  let hadError = false

  await streamChat(
    llmConfig,
    [{ role: "user", content: prompt }],
    {
      onToken: (token) => { raw += token },
      onDone: () => {},
      onError: (err) => {
        hadError = true
        activity.updateItem(activityId, {
          status: "error",
          detail: `LLM error: ${err.message}`,
        })
      },
    },
  )

  if (hadError) return []

  const results: LintResult[] = []
  const matches = raw.matchAll(LINT_BLOCK_REGEX)

  for (const match of matches) {
    const rawType = match[1].trim().toLowerCase()
    const severity = match[2].trim().toLowerCase()
    const title = match[3].trim()
    const body = match[4].trim()
    void rawType

    const pagesMatch = body.match(/^PAGES:\s*(.+)$/m)
    const affectedPages = pagesMatch
      ? pagesMatch[1].split(",").map((p) => p.trim())
      : undefined

    const detail = body.replace(/^PAGES:.*$/m, "").trim()

    results.push({
      type: "semantic",
      severity: (severity === "warning" ? "warning" : "info") as LintResult["severity"],
      page: title,
      detail: `[${rawType}] ${detail}`,
      affectedPages,
    })
  }

  activity.updateItem(activityId, {
    status: "done",
    detail: `发现 ${results.length} 个语义问题。`,
  })

  return results
}
